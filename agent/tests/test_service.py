import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
import logging
import os
from pathlib import Path
import time

import httpx
import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from fairsettle_agent.service import ServiceConfig, create_app, poll_loop
from fairsettle_agent.__main__ import main
from fairsettle_agent.agent import RunStatus, ThreadStateError, open_persistence
from fairsettle_agent.clients import ClientError, LedgerClient, MalformedResponse, RefundProposal
from fairsettle_agent.tracing import Tracing
from conftest import APP_TOKEN
from policy_factory import NOW
from resume_factory import PROPOSAL_ID, FakeProposalLedger, make_input, make_tracing, open_test_agent, spans
from test_clients import raw
from test_execute import metadata, named
from test_resume import COMPLAINT_ID, creates, read_row


def app_for(database_url, **kwargs):
    return create_app(lambda: open_test_agent(database_url, **kwargs), poll_seconds=3600)


def test_post_complaint_starts_the_run(database_url):
    with TestClient(app_for(database_url)) as client:
        response = client.post('/v1/complaints', json=make_input().model_dump(mode='json'))
        assert response.status_code == 201
        assert response.json() == {
            'complaint_id': COMPLAINT_ID, 'thread_id': COMPLAINT_ID,
            'status': 'awaiting_review', 'proposal_id': PROPOSAL_ID, 'trace_id': None,
        }
        assert read_row(database_url)['status'] == 'awaiting_review'


def test_duplicate_and_invalid_complaints_are_refused(database_url):
    body = make_input().model_dump(mode='json')
    with TestClient(app_for(database_url)) as client:
        assert client.post('/v1/complaints', json=body).status_code == 201
        duplicate = client.post('/v1/complaints', json=body)
        assert duplicate.status_code == 409 and duplicate.json() == {'code': 'DUPLICATE_COMPLAINT'}
        for invalid in (
            {key: value for key, value in body.items() if key != 'text'},
            {**body, 'prior_complaints_in_7_days': 0}, {**body, 'order_id': 0}, {**body, 'complaint_type': 'refund'},
        ):
            assert client.post('/v1/complaints', json=invalid).status_code == 422
        with psycopg.connect(database_url) as conn:
            assert conn.execute('SELECT count(*) FROM agent_complaint').fetchone()[0] == 1


def test_get_complaint_returns_status_and_trace_id(database_url):
    tracing, exporter = make_tracing()
    with TestClient(app_for(database_url, tracing=tracing)) as client:
        assert client.post('/v1/complaints', json=make_input().model_dump(mode='json')).status_code == 201
        response = client.get('/v1/complaints/' + COMPLAINT_ID)
        assert response.status_code == 200
        assert response.json()['trace_id'] == Tracing.trace_id(COMPLAINT_ID)
        assert response.json()['status'] == 'awaiting_review'
        missing = client.get('/v1/complaints/unknown-1')
        assert missing.status_code == 404 and missing.json() == {'code': 'NOT_FOUND'}


class HealthAgent:
    @property
    def tracing(self):
        raise AssertionError('Health read tracing')

    async def start(self, complaint):
        raise AssertionError('Health started a complaint')

    async def status(self, complaint_id):
        raise AssertionError('Health read a complaint')

    async def running(self):
        return []

    async def poll(self):
        return []


def test_health_needs_no_agent():
    @asynccontextmanager
    async def open_fake():
        yield HealthAgent()
    with TestClient(create_app(open_fake, poll_seconds=3600)) as client:
        response = client.get('/health')
        assert response.status_code == 200 and response.json() == {'status': 'UP'}


def test_poll_loop_survives_failures_and_logs_no_text(caplog):
    class Fake:
        calls = 0
        async def poll(self):
            self.calls += 1
            if self.calls == 2:
                raise ThreadStateError('c1', 'not waiting for review')
            return [RunStatus('c2', 'c2', 'refunded', PROPOSAL_ID)] if self.calls == 3 else []
    fake, sleeps = Fake(), []
    async def sleep(interval):
        sleeps.append(interval)
        if len(sleeps) == 3:
            raise asyncio.CancelledError()
    with caplog.at_level(logging.INFO, logger='fairsettle_agent.service'):
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(poll_loop(fake, 7, sleep=sleep))
    assert fake.calls == 3 and sleeps == [7, 7, 7]
    records = [record for record in caplog.records if record.name == 'fairsettle_agent.service']
    assert [r.getMessage() for r in records if r.levelno == logging.ERROR] == ['poll pass failed: ThreadStateError']
    assert [r.getMessage() for r in records if r.levelno == logging.INFO] == ['complaint c2 is refunded']
    assert all(make_input().text not in r.getMessage() for r in records)


def test_lifespan_logs_running_rows_and_stops_polling(caplog):
    class Fake:
        calls = 0
        task = None
        closed = False
        async def running(self):
            return ['c-left-1']
        async def poll(self):
            self.calls += 1
            self.task = asyncio.current_task()
            return []
    fake = Fake()
    @asynccontextmanager
    async def open_fake():
        try:
            yield fake
        finally:
            fake.closed = True
    with caplog.at_level(logging.WARNING, logger='fairsettle_agent.service'):
        with TestClient(create_app(open_fake, poll_seconds=3600)):
            deadline = time.monotonic() + 2
            while fake.calls == 0 and time.monotonic() < deadline:
                time.sleep(0.01)
            assert fake.calls == 1
    assert fake.closed and fake.task.done()
    messages = [r.getMessage() for r in caplog.records if r.name == 'fairsettle_agent.service' and r.levelno == logging.WARNING]
    assert messages == ['complaint c-left-1 was left running by an earlier process and is not resumed']


def test_service_config_from_env():
    default = ServiceConfig.from_env({})
    assert (default.host, default.poll_seconds) == ('127.0.0.1', 5.0)
    custom = ServiceConfig.from_env({'FAIRSETTLE_HTTP_HOST': '0.0.0.0', 'FAIRSETTLE_POLL_SECONDS': '2.5'})
    assert (custom.host, custom.poll_seconds) == ('0.0.0.0', 2.5)
    for value in ('0', '301', 'abc'):
        with pytest.raises(ValueError, match='FAIRSETTLE_POLL_SECONDS must be a number from 1 to 300'):
            ServiceConfig.from_env({'FAIRSETTLE_POLL_SECONDS': value})


def test_running_lists_only_running_rows(database_url):
    async def run():
        async with open_persistence(database_url) as (store, saver):
            await store.register('c1', 1, NOW)
            await store.register('c2', 1, NOW)
            await store.set_status('c2', 'awaiting_review')
        async with open_test_agent(database_url) as agent:
            assert await agent.running() == ['c1']
    asyncio.run(run())


def test_decide_span_carries_cited_evidence(database_url):
    tracing, exporter = make_tracing()
    ledger = FakeProposalLedger()
    async def run():
        async with open_test_agent(database_url, tracing=tracing, ledger=ledger) as agent:
            await agent.start(make_input())
        refs = metadata(named(spans(tracing, exporter), 'decide')[0], 'evidence_refs')
        assert refs == ['order:1', 'order-item:11']
        assert list(creates(ledger)[0].evidence_refs) == refs
    asyncio.run(run())


def test_proposal_refund_id_must_be_a_refund_id():
    body = deepcopy(raw('ledger-proposal-approved')['response']['body'])
    async def run():
        async with httpx.AsyncClient(base_url='http://ledger.invalid', transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body))) as http:
            client = LedgerClient(http, APP_TOKEN)
            proposal = await client.get_proposal(body['id'])
            assert isinstance(proposal, RefundProposal) and proposal.refund_id == body['refundId']
            body['refundId'] = 'rfd_01M63ZP5F3S0VQ2WNNKZMG5AMP'
            with pytest.raises(MalformedResponse, match='refundId') as caught:
                await client.get_proposal(body['id'])
            assert isinstance(caught.value, ClientError)
    asyncio.run(run())


def test_main_builds_the_service_without_serving():
    calls = []
    env = {
        'FAIRSETTLE_DATABASE_URL': 'postgresql://test:test@localhost/test', 'DISPATCH_BASE_URL': 'http://dispatch.invalid',
        'AGENT_SERVICE_TOKEN': 't' * 40, 'LEDGER_BASE_URL': 'http://ledger.invalid', 'LEDGER_APP_TOKEN': APP_TOKEN,
        'FAIRSETTLE_TRACING': 'off', 'FAIRSETTLE_HTTP_HOST': '0.0.0.0',
    }
    def fake(app, **kwargs):
        calls.append((app, kwargs))
    main(env, run=fake)
    assert len(calls) == 1 and isinstance(calls[0][0], FastAPI)
    assert calls[0][1] == {'host': '0.0.0.0', 'port': 8000, 'log_level': 'info'}
    assert os.environ['LITELLM_LOCAL_MODEL_COST_MAP'] == 'True'
    with pytest.raises(ValueError, match='FAIRSETTLE_DATABASE_URL is required'):
        main({})
    assert len(calls) == 1


def test_service_modules_stay_off_the_money_path():
    package = Path(__file__).resolve().parents[1] / 'fairsettle_agent'
    for name in ('service.py', '__main__.py'):
        contents = (package / name).read_text()
        assert 'paypal' not in contents.lower()
        assert 'LedgerClient' not in contents and 'httpx' not in contents
