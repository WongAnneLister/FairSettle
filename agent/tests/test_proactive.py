import asyncio
from contextlib import asynccontextmanager
from datetime import timedelta
import json
import logging

import pytest
from fastapi.testclient import TestClient

from conftest import APP_TOKEN
from decide_factory import FakeDispatch
from policy_factory import NOW, make_order, make_timeline
from resume_factory import open_test_agent
from test_clients import order_id, raw
from fairsettle_agent.agent import AgentConfig, DuplicateComplaint, RunStatus, open_persistence
from fairsettle_agent.clients import DOCUMENT, DispatchClient
from fairsettle_agent.clients.models import (
    DeliveryFailure, FailureReason, OrderEvent, OrderEventActor, OrderEventKind,
    OrderStatus, OrderTimeline,
)
from fairsettle_agent.clients.replay import FixtureReplay
from fairsettle_agent.complaint import ComplaintInput
from fairsettle_agent.policy import Rule
from fairsettle_agent.proactive import CURSOR, DeliveryFailureTrigger, complaint_for, is_proactive
from fairsettle_agent.service import create_app, poll_loop
from fairsettle_agent.tracing import Tracing


def failure(event_id=11, order_id=7):
    return DeliveryFailure(
        event_id=event_id, order_id=order_id,
        failure_reason=FailureReason.DRIVER_FAULT, occurred_at=NOW,
    )


class FakeFeed:
    def __init__(self, failures):
        self.failures = failures
        self.calls = []

    async def delivery_failures(self, after_event_id, limit):
        self.calls.append((after_event_id, limit))
        return self.failures


class FakeCursors:
    def __init__(self, after=10):
        self.after = after
        self.gets = []
        self.sets = []

    async def get_cursor(self, name):
        self.gets.append(name)
        return self.after

    async def set_cursor(self, name, event_id):
        self.sets.append((name, event_id))
        self.after = event_id


class FakeStart:
    def __init__(self, errors=None):
        self.errors = errors or {}
        self.calls = []
        self.statuses = []

    async def __call__(self, complaint):
        self.calls.append(complaint)
        if complaint.order_id in self.errors:
            raise self.errors[complaint.order_id]
        status = RunStatus(complaint.complaint_id, complaint.complaint_id, 'awaiting_review', None)
        self.statuses.append(status)
        return status


def test_complaint_for_builds_the_case():
    assert complaint_for(failure(event_id=9)) == ComplaintInput(
        complaint_id='delivery-failed-7', order_id=7, complaint_type='delivery_failed',
        text='Dispatch reports that the delivery of order 7 failed (DRIVER_FAULT). '
             'No customer complaint was received.',
    )


def test_is_proactive():
    assert is_proactive('delivery-failed-7') is True
    assert is_proactive('complaint-missing-drink-001') is False
    assert is_proactive('delivery-7') is False


def test_run_once_starts_each_failure_and_moves_the_cursor():
    feed = FakeFeed([failure(), failure(12, 8)])
    cursors, start = FakeCursors(), FakeStart()
    statuses = asyncio.run(DeliveryFailureTrigger(feed, cursors, start).run_once())
    assert CURSOR == 'dispatch.delivery_failures'
    assert feed.calls == [(10, 50)]
    assert cursors.gets == [CURSOR]
    assert [case.complaint_id for case in start.calls] == ['delivery-failed-7', 'delivery-failed-8']
    assert cursors.sets == [(CURSOR, 11), (CURSOR, 12)]
    assert cursors.after == 12
    assert statuses == start.statuses and len(statuses) == 2


def test_duplicates_are_skipped_but_passed():
    feed = FakeFeed([failure(), failure(12, 8)])
    cursors, start = FakeCursors(), FakeStart({7: DuplicateComplaint('delivery-failed-7')})
    statuses = asyncio.run(DeliveryFailureTrigger(feed, cursors, start).run_once())
    assert [case.complaint_id for case in start.calls] == ['delivery-failed-7', 'delivery-failed-8']
    assert [status.complaint_id for status in statuses] == ['delivery-failed-8']
    assert statuses == start.statuses
    assert cursors.sets == [(CURSOR, 11), (CURSOR, 12)]
    assert cursors.after == 12


def test_a_failing_start_keeps_the_event_for_the_next_pass():
    feed = FakeFeed([failure(), failure(12, 8)])
    cursors, start = FakeCursors(), FakeStart({8: RuntimeError('start failed')})
    with pytest.raises(RuntimeError, match='start failed'):
        asyncio.run(DeliveryFailureTrigger(feed, cursors, start).run_once())
    assert [case.complaint_id for case in start.calls] == ['delivery-failed-7', 'delivery-failed-8']
    assert cursors.sets == [(CURSOR, 11)]
    assert cursors.after == 11


def test_no_failures_changes_nothing():
    feed, cursors, start = FakeFeed([]), FakeCursors(), FakeStart()
    assert asyncio.run(DeliveryFailureTrigger(feed, cursors, start).run_once()) == []
    assert feed.calls == [(10, 50)]
    assert start.calls == [] and cursors.sets == []
    assert cursors.after == 10


def test_dispatch_client_reads_delivery_failures():
    replay = FixtureReplay.load('dispatch-delivery-failures')
    recorded = raw('dispatch-delivery-failures')['response']['body']['data']['deliveryFailures']['failures']
    async def run():
        async with replay.client() as http:
            client = DispatchClient(http, 's' * 40)
            failures = await client.delivery_failures(0, 50)
            assert len(failures) == 1
            assert failures == [DeliveryFailure.model_validate(recorded[0])]
            assert (failures[0].event_id, failures[0].order_id, failures[0].failure_reason) == (
                recorded[0]['eventId'], recorded[0]['orderId'], FailureReason(recorded[0]['failureReason']),
            )
            for after, limit in ((-1, 50), (0, 0), (0, 101), (True, 50)):
                with pytest.raises(ValueError):
                    await client.delivery_failures(after, limit)
    asyncio.run(run())
    assert len(replay.requests) == 1
    body = json.loads(replay.requests[0].content)
    assert body['operationName'] == 'AgentDeliveryFailures'
    assert body['query'] == DOCUMENT
    assert body['variables'] == {'afterEventId': 0, 'limit': 50}


def test_delivery_failed_order_and_timeline_parse():
    replay = FixtureReplay.load('dispatch-order-delivery-failed', 'dispatch-timeline-delivery-failed')
    events = raw('dispatch-timeline-delivery-failed')['response']['body']['data']['orderTimeline']['events']
    async def run():
        async with replay.client() as http:
            client = DispatchClient(http, 's' * 40)
            order = await client.get_order(order_id('dispatch-order-delivery-failed'))
            timeline = await client.get_timeline(order_id('dispatch-timeline-delivery-failed'))
            assert order.status == OrderStatus.DELIVERY_FAILED
            assert timeline.events[-1].to_status == OrderStatus.DELIVERY_FAILED
            assert timeline.events[-1].failure_reason == FailureReason(events[-1]['failureReason'])
            assert all(event.failure_reason is None for event in timeline.events[:-1])
    asyncio.run(run())


def test_proactive_switch():
    env = {
        'FAIRSETTLE_DATABASE_URL': 'postgresql://test:test-password@localhost/test',
        'DISPATCH_BASE_URL': 'http://dispatch.invalid', 'AGENT_SERVICE_TOKEN': 's' * 40,
        'LEDGER_BASE_URL': 'http://ledger.invalid', 'LEDGER_APP_TOKEN': APP_TOKEN,
        'FAIRSETTLE_TRACING': 'off',
    }
    config = AgentConfig.from_env(env)
    assert config.proactive is True
    assert AgentConfig.from_env({**env, 'FAIRSETTLE_PROACTIVE': 'off'}).proactive is False
    with pytest.raises(ValueError, match='^FAIRSETTLE_PROACTIVE must be on or off$'):
        AgentConfig.from_env({**env, 'FAIRSETTLE_PROACTIVE': 'maybe'})
    representation = repr(config)
    assert 'proactive=True' in representation
    for secret in (env['FAIRSETTLE_DATABASE_URL'], 'test-password', 's' * 40, APP_TOKEN):
        assert secret not in representation


def test_api_refuses_reserved_ids():
    class Fake:
        tracing = Tracing.off()
        def __init__(self):
            self.starts = []
        async def running(self):
            return []
        async def poll(self):
            return []
        async def poll_failures(self):
            return []
        async def start(self, complaint):
            self.starts.append(complaint)
            return RunStatus(complaint.complaint_id, complaint.complaint_id, 'awaiting_review', None)
    fake = Fake()
    @asynccontextmanager
    async def open_fake():
        yield fake
    with TestClient(create_app(open_fake, poll_seconds=3600)) as client:
        response = client.post('/v1/complaints', json=complaint_for(failure()).model_dump(mode='json'))
        assert response.status_code == 422
        assert response.json() == {'code': 'RESERVED_COMPLAINT_ID'}
    assert fake.starts == []


def test_poll_loop_runs_proactive_pass_and_survives_its_failure(caplog):
    class Fake:
        calls = 0
        async def poll(self):
            return []
        async def poll_failures(self):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError('proactive failure')
            return [RunStatus('delivery-failed-7', 'delivery-failed-7', 'awaiting_review', None)]
    fake, sleeps = Fake(), []
    async def sleep(interval):
        sleeps.append(interval)
        if len(sleeps) == 2:
            raise asyncio.CancelledError()
    with caplog.at_level(logging.INFO, logger='fairsettle_agent.service'):
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(poll_loop(fake, 7, sleep=sleep))
    assert fake.calls == 2 and sleeps == [7, 7]
    records = [record for record in caplog.records if record.name == 'fairsettle_agent.service']
    assert [record.getMessage() for record in records if record.levelno == logging.ERROR] == [
        'proactive pass failed: RuntimeError',
    ]
    assert [record.getMessage() for record in records if record.levelno == logging.INFO] == [
        'proactive case delivery-failed-7 is awaiting_review',
    ]


def test_cursor_store_is_monotonic(database_url):
    async def run():
        async with open_persistence(database_url) as (store, saver):
            assert await store.get_cursor('x') == 0
            await store.set_cursor('x', 5)
            await store.set_cursor('x', 3)
            assert await store.get_cursor('x') == 5
            with pytest.raises(ValueError):
                await store.set_cursor('x', -1)
    asyncio.run(run())


def test_proactive_cases_do_not_count_as_complaints(database_url):
    async def run():
        async with open_persistence(database_url) as (store, saver):
            for name in ('delivery-failed-1', 'c-1'):
                await store.register(name, 1, NOW - timedelta(days=1))
                await store.record_customer(name, 7)
            assert await store.count_prior(7, 'other', NOW) == 1
    asyncio.run(run())


def test_proactive_start_ignores_prior_complaints(database_url):
    failed = failure(event_id=104, order_id=1)
    feed = FakeFeed([failed])
    dispatch = FakeDispatch(
        order=make_order(status=OrderStatus.DELIVERY_FAILED),
        timeline=OrderTimeline(order_id=1, events=(
            make_timeline().events[0],
            OrderEvent(
                id=104, kind=OrderEventKind.STATUS_CHANGED,
                from_status=OrderStatus.PICKED_UP, to_status=OrderStatus.DELIVERY_FAILED,
                actor=OrderEventActor.ASSIGNED_DRIVER, driver_id=8, provider_event_id=None,
                occurred_at=NOW, failure_reason=FailureReason.DRIVER_FAULT,
            ),
        )),
    )
    async def run():
        async with open_test_agent(database_url, dispatch=dispatch, failures=feed) as agent:
            for number in range(3):
                name = f'prior-{number}'
                await agent._store.register(name, 1, NOW - timedelta(days=1))
                await agent._store.record_customer(name, 7)
            result = await agent.start(complaint_for(failed))
            state = await agent.state('delivery-failed-1')
            assert state.values['evidence']['prior_complaints_in_7_days'] == 0
            assert Rule.REPEAT_COMPLAINT not in [
                violation['rule'] for violation in state.values['verdict']['violations']
            ]
            assert result.status == 'awaiting_review', state.values
            assert (await agent._store.get('delivery-failed-1')).status == 'awaiting_review'
            assert await agent.poll_failures() == []
    asyncio.run(run())
