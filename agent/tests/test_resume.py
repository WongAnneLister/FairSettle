import asyncio
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta
import json
from urllib.parse import urlsplit

import httpx
import psycopg
from psycopg.rows import dict_row
import pytest
from pydantic import ValidationError

from conftest import APP_TOKEN, database_url as database_url_fixture
from decide_factory import DECISION_JSON, FakeDispatch, MockCompletion
from policy_factory import NOW, PAYMENT_ID, make_decision, make_evidence, make_order
from resume_factory import (
    PROPOSAL_ID, REFUND_ID, FakeProposalLedger, make_input, make_proposal,
    open_test_agent, restarted, run_child,
)
from test_clients import raw
from fairsettle_agent.agent import (
    AgentConfig, DuplicateComplaint, RunStatus, ThreadStateError, open_agent, open_persistence,
)
from fairsettle_agent.clients import LedgerClient, MalformedResponse, ServiceError, Unavailable
from fairsettle_agent.clients.models import RefundProposal
from fairsettle_agent.clients.ledger import proposal_idempotency_key
from fairsettle_agent.clients.replay import FixtureReplay
from fairsettle_agent.policy import PolicyVerdict
from fairsettle_agent.proposal import proposal_request

COMPLAINT_ID = "complaint-missing-drink-001"


def default_request():
    return proposal_request(PolicyVerdict("propose", make_decision(), ()), make_evidence(), COMPLAINT_ID, COMPLAINT_ID)


def recorded_request(name="ledger-proposal-created"):
    body = raw(name)["response"]["body"]
    return default_request().model_copy(update={
        "payment_id": body["paymentId"], "complaint_id": body["complaintId"],
        "amount_minor": body["amountMinor"],
    })


def expected_status(status, proposal_id=PROPOSAL_ID):
    return RunStatus(COMPLAINT_ID, COMPLAINT_ID, status, proposal_id)


def read_row(database_url):
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        return conn.execute("SELECT * FROM agent_complaint WHERE complaint_id = %s", (COMPLAINT_ID,)).fetchone()


def creates(ledger):
    return [argument for name, argument in ledger.calls if name == "create_proposal"]


def test_proposal_request_maps_to_contract():
    decision = make_decision(liability=(("platform", 0), ("driver", 2500), ("restaurant", 7500)))
    body = proposal_request(PolicyVerdict("propose", decision, ()), make_evidence(), "c-1", "c-1").body()
    expected = {
        "complaintId": "c-1", "orderRef": "1", "paymentId": PAYMENT_ID,
        "decision": "PARTIAL_REFUND", "amountMinor": 450, "currency": "USD", "reasonCode": "MISSING_ITEM",
        "liability": [{"party": "RESTAURANT", "basisPoints": 7500},
                      {"party": "DRIVER", "basisPoints": 2500}, {"party": "PLATFORM", "basisPoints": 0}],
        "explanation": decision.explanation, "evidenceRefs": ["order:1", "order-item:11"],
        "agentRun": {"threadId": "c-1"},
    }
    assert body == expected
    assert list(body) == list(expected)


def test_only_propose_becomes_a_request():
    for outcome in ("reject", "escalate"):
        with pytest.raises(ValueError):
            proposal_request(PolicyVerdict(outcome, make_decision(), ()), make_evidence(), "c-1", "c-1")


def test_create_proposal_sends_the_contract_request():
    replay = FixtureReplay.load("ledger-proposal-created")
    request = recorded_request()
    async def run():
        async with httpx.AsyncClient(base_url="http://ledger.invalid", transport=replay.transport(),
                                     headers={"X-Service-Token": "drop-this"}) as http:
            result = await LedgerClient(http, APP_TOKEN).create_proposal(request)
            assert isinstance(result, RefundProposal)
            assert result.status == "PENDING_REVIEW"
            assert result.id == raw("ledger-proposal-created")["response"]["body"]["id"]
    asyncio.run(run())
    assert len(replay.requests) == 1
    sent = replay.requests[0]
    assert (sent.method, sent.url.path) == ("POST", "/v1/refund-proposals")
    assert sent.headers["Authorization"] == "Bearer " + APP_TOKEN
    assert sent.headers["Idempotency-Key"] == "refund-proposal:" + request.complaint_id
    assert sent.headers["Content-Type"] == "application/json"
    assert "X-Service-Token" not in sent.headers
    assert json.loads(sent.content) == request.body()


def test_create_proposal_replay_is_success():
    replay = FixtureReplay.load("ledger-proposal-replayed")
    assert raw("ledger-proposal-replayed")["response"]["status"] == 200
    async def run():
        async with replay.client() as http:
            result = await LedgerClient(http, APP_TOKEN).create_proposal(recorded_request())
            assert result.id == raw("ledger-proposal-created")["response"]["body"]["id"]
    asyncio.run(run())


def test_create_proposal_errors_are_typed():
    async def run():
        for name, status, code in (("ledger-proposal-conflict", 409, "IDEMPOTENCY_CONFLICT"),
                                   ("ledger-proposal-limit", 422, "REFUND_LIMIT_EXCEEDED")):
            replay = FixtureReplay.load(name)
            async with replay.client() as http:
                with pytest.raises(ServiceError) as caught:
                    await LedgerClient(http, APP_TOKEN).create_proposal(default_request())
            assert caught.value.status == status
            assert caught.value.code == code
            assert caught.value.retryable is False
            assert APP_TOKEN not in str(caught.value)
    asyncio.run(run())


def test_get_proposal_reads_each_status():
    async def run():
        for suffix in ("pending", "approved", "rejected"):
            name = "ledger-proposal-" + suffix
            replay = FixtureReplay.load(name)
            async with replay.client() as http:
                client = LedgerClient(http, APP_TOKEN)
                result = await client.get_proposal(raw(name)["response"]["body"]["id"])
                assert result.status == ("PENDING_REVIEW" if suffix == "pending" else suffix.upper())
                if suffix == "pending":
                    assert (result.reviewed_at, result.rejection_reason, result.refund_id) == (None, None, None)
                elif suffix == "approved":
                    assert result.refund_id and result.reviewed_at
                else:
                    assert result.rejection_reason and result.refund_id is None
                count = len(replay.requests)
                with pytest.raises(ValueError, match="proposal_id must be a valid proposal id"):
                    await client.get_proposal("prop_bad")
                assert len(replay.requests) == count
    asyncio.run(run())


def test_proposal_status_must_match_review_fields():
    async def run():
        for suffix, field in (("approved", "refundId"), ("rejected", "rejectionReason")):
            body = deepcopy(raw("ledger-proposal-" + suffix)["response"]["body"])
            body[field] = None
            with pytest.raises(ValidationError, match="proposal review fields do not match its status"):
                RefundProposal.model_validate(body)
            async with httpx.AsyncClient(base_url="http://ledger.invalid", transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json=body),
            )) as http:
                with pytest.raises(MalformedResponse):
                    await LedgerClient(http, APP_TOKEN).get_proposal(body["id"])
    asyncio.run(run())


def test_register_once_per_complaint(database_url):
    async def run():
        async with open_persistence(database_url) as (store, saver):
            assert await store.register(COMPLAINT_ID, 1, NOW) is True
            assert await store.register(COMPLAINT_ID, 1, NOW) is False
            row = await store.get(COMPLAINT_ID)
            assert row.status == "running"
            assert row.submit_attempts == 0
        with psycopg.connect(database_url) as conn:
            assert conn.execute("SELECT count(*) FROM agent_complaint").fetchone()[0] == 1
    asyncio.run(run())


def test_count_prior_is_per_customer_and_7_days(database_url):
    async def run():
        async with open_persistence(database_url) as (store, saver):
            await store.register(COMPLAINT_ID, 1, NOW)
            await store.record_customer(COMPLAINT_ID, 7)
            for name, when, customer in (
                ("yesterday", NOW - timedelta(days=1), 7), ("boundary", NOW - timedelta(days=7), 7),
                ("old", NOW - timedelta(days=7, seconds=1), 7), ("future", NOW + timedelta(hours=1), 7),
                ("other", NOW - timedelta(hours=1), 8), ("unknown", NOW - timedelta(days=1), None),
            ):
                await store.register(name, 1, when)
                if customer is not None:
                    await store.record_customer(name, customer)
            assert await store.count_prior(7, COMPLAINT_ID, NOW) == 2
    asyncio.run(run())


def test_naive_received_at_is_refused(database_url):
    async def run():
        async with open_persistence(database_url) as (store, saver):
            with pytest.raises(ValueError):
                await store.register(COMPLAINT_ID, 1, datetime(2026, 10, 27))
    asyncio.run(run())


def test_start_proposes_and_pauses_in_postgres(database_url):
    ledger = FakeProposalLedger()
    async def run():
        async with open_test_agent(database_url, ledger=ledger) as agent:
            assert await agent.start(make_input()) == expected_status("awaiting_review")
            assert creates(ledger) == [default_request()]
            state = await agent.state(COMPLAINT_ID)
            assert state.next == ("await_review",)
            assert len(state.interrupts) == 1
            assert state.interrupts[0].value == {"proposal_id": PROPOSAL_ID}
            assert json.loads(json.dumps(state.values)) == state.values
            assert state.values["evidence"]["prior_complaints_in_7_days"] == 0
        with psycopg.connect(database_url) as conn:
            assert conn.execute("SELECT count(*) FROM checkpoints WHERE thread_id = %s", (COMPLAINT_ID,)).fetchone()[0] > 0
        row = read_row(database_url)
        assert set(row) == {"complaint_id", "order_id", "customer_id", "received_at", "status", "proposal_id", "submit_attempts", "updated_at"}
        assert all(make_input().text not in str(value) for value in row.values())
    asyncio.run(run())


def test_duplicate_complaint_is_refused(database_url):
    complete, ledger = MockCompletion(["DONE", DECISION_JSON]), FakeProposalLedger()
    async def run():
        async with open_test_agent(database_url, ledger=ledger, complete=complete) as agent:
            await agent.start(make_input())
            with pytest.raises(DuplicateComplaint):
                await agent.start(make_input())
            assert len(complete.calls) == 2
            assert len(creates(ledger)) == 1
    asyncio.run(run())


def test_restart_then_approval_resumes_without_resubmitting(database_url, tmp_path):
    path = tmp_path / "calls.json"
    child = run_child("pause", database_url, path)
    assert child.returncode == 0, child.stderr
    assert json.loads(child.stdout) == {"status": "awaiting_review", "proposal_id": PROPOSAL_ID}
    assert json.loads(path.read_text()) == [["get_payment", PAYMENT_ID], ["get_refundable", PAYMENT_ID], ["create_proposal", default_request().body()]]
    ledger, complete, dispatch = FakeProposalLedger(review=make_proposal(status="APPROVED")), MockCompletion([]), FakeDispatch(errors={
        "get_order": AssertionError("Gather repeated"), "get_timeline": AssertionError("Gather repeated"),
    })
    async def run():
        async with restarted(database_url, ledger=ledger, complete=complete, dispatch=dispatch) as agent:
            assert await agent.poll() == [expected_status("approved")]
            assert ledger.calls == [("get_proposal", PROPOSAL_ID)]
            assert not dispatch.calls and not complete.calls
            state = await agent.state(COMPLAINT_ID)
            assert state.next == ("await_refund",)
            assert state.values["review"] == {"status": "APPROVED", "refund_id": REFUND_ID, "rejection_reason": None, "reviewed_at": NOW.isoformat()}
            assert read_row(database_url)["status"] == "approved"
    asyncio.run(run())


def test_restart_then_rejection_resumes_to_rejected(database_url, tmp_path):
    child = run_child("pause", database_url, tmp_path / "calls.json")
    assert child.returncode == 0, child.stderr
    ledger = FakeProposalLedger(review=make_proposal(status="REJECTED"))
    async def run():
        async with restarted(database_url, ledger=ledger) as agent:
            assert await agent.poll() == [expected_status("rejected")]
            state = await agent.state(COMPLAINT_ID)
            assert state.next == ()
            assert state.values["review"]["rejection_reason"] == "Photo shows the drink was delivered."
            assert ledger.calls == [("get_proposal", PROPOSAL_ID)]
    asyncio.run(run())


def test_poll_after_approval_only_reads_the_refund(database_url, tmp_path):
    assert run_child("pause", database_url, tmp_path / "calls.json").returncode == 0
    ledger = FakeProposalLedger(review=make_proposal(status="APPROVED"))
    async def run():
        async with restarted(database_url, ledger=ledger) as agent:
            assert await agent.poll() == [expected_status("approved")]
            ledger.calls.clear()
            assert await agent.poll() == []
            assert ledger.calls == [("get_refund", REFUND_ID)]
    asyncio.run(run())


def test_pending_or_unreadable_review_stays_paused(database_url):
    ledger = FakeProposalLedger()
    async def run():
        async with open_test_agent(database_url, ledger=ledger) as agent:
            await agent.start(make_input())
            for review in (make_proposal(), Unavailable("ledger", "x")):
                ledger.review = review
                assert await agent.poll() == []
                assert await agent.status(COMPLAINT_ID) == expected_status("awaiting_review")
                assert (await agent.state(COMPLAINT_ID)).next == ("await_review",)
    asyncio.run(run())


def test_resume_refuses_a_thread_that_is_not_waiting(database_url):
    ledger, complete = FakeProposalLedger(review=make_proposal(status="APPROVED")), MockCompletion(["DONE", DECISION_JSON])
    async def run():
        async with open_test_agent(database_url, ledger=ledger, complete=complete) as agent:
            await agent.start(make_input())
            complete.calls.clear()
            with psycopg.connect(database_url, autocommit=True) as conn:
                for table in ("checkpoints", "checkpoint_blobs", "checkpoint_writes"):
                    conn.execute(psycopg.sql.SQL("DELETE FROM {} WHERE thread_id = %s").format(psycopg.sql.Identifier(table)), (COMPLAINT_ID,))
            with pytest.raises(ThreadStateError, match="not waiting for review"):
                await agent.poll()
            assert complete.calls == []
            with psycopg.connect(database_url) as conn:
                assert conn.execute("SELECT count(*) FROM checkpoints WHERE thread_id = %s", (COMPLAINT_ID,)).fetchone()[0] == 0
    asyncio.run(run())


def test_review_for_another_complaint_is_refused(database_url):
    ledger = FakeProposalLedger(review=make_proposal(status="APPROVED", complaint_id="other"))
    async def run():
        async with open_test_agent(database_url, ledger=ledger) as agent:
            await agent.start(make_input())
            with pytest.raises(ThreadStateError, match="proposal belongs to another complaint"):
                await agent.poll()
            assert await agent.status(COMPLAINT_ID) == expected_status("awaiting_review")
    asyncio.run(run())


def test_policy_escalation_is_not_submitted(database_url):
    ledger = FakeProposalLedger()
    async def run():
        async with open_test_agent(database_url, ledger=ledger, complete=MockCompletion(["DONE", make_decision(amount_cents=900).model_dump_json()])) as agent:
            assert await agent.start(make_input()) == expected_status("escalated", None)
            assert creates(ledger) == []
            state = await agent.state(COMPLAINT_ID)
            assert state.next == ()
            assert state.values["verdict"]["outcome"] == "escalate"
            assert "reason_cap" in [v["rule"] for v in state.values["verdict"]["violations"]]
    asyncio.run(run())


def test_reject_decision_is_declined(database_url):
    ledger = FakeProposalLedger()
    decision = make_decision(decision="reject", amount_cents=0, liability=(), evidence_refs=("order:1",))
    async def run():
        async with open_test_agent(database_url, ledger=ledger, complete=MockCompletion(["DONE", decision.model_dump_json()])) as agent:
            assert await agent.start(make_input()) == expected_status("declined", None)
            assert creates(ledger) == []
    asyncio.run(run())


def test_gather_failure_and_unknown_customer_escalate_without_model(database_url, postgres_url):
    async def check(url, dispatch, escalation):
        complete, ledger = MockCompletion([]), FakeProposalLedger()
        async with open_test_agent(url, dispatch=dispatch, ledger=ledger, complete=complete) as agent:
            assert await agent.start(make_input()) == expected_status("escalated", None)
            assert (await agent.state(COMPLAINT_ID)).values["escalation"] == escalation
            assert not complete.calls and not creates(ledger)
    asyncio.run(check(database_url, FakeDispatch(errors={"get_order": Unavailable("dispatch", "x")}), {
        "stage": "gather", "reason": "source_unavailable", "detail": "get_order: Unavailable",
    }))
    with contextmanager(database_url_fixture.__wrapped__)(postgres_url) as other_url:
        asyncio.run(check(other_url, FakeDispatch(order=make_order().model_copy(update={"customer": None})), {
            "stage": "count", "reason": "customer_unknown", "detail": "order 1 has no customer",
        }))


def test_repeat_complaints_are_counted(database_url):
    ledger = FakeProposalLedger()
    async def run():
        async with open_persistence(database_url) as (store, saver):
            for n in (1, 2):
                await store.register(f"prior-{n}", 1, NOW - timedelta(days=n))
                await store.record_customer(f"prior-{n}", 7)
        async with open_test_agent(database_url, ledger=ledger) as agent:
            assert await agent.start(make_input()) == expected_status("escalated", None)
            state = await agent.state(COMPLAINT_ID)
            assert state.values["evidence"]["prior_complaints_in_7_days"] == 2
            assert "repeat_complaint" in [v["rule"] for v in state.values["verdict"]["violations"]]
            assert not creates(ledger)
    asyncio.run(run())


def test_crash_after_post_recovers_by_replay(database_url, tmp_path):
    path = tmp_path / "calls.json"
    child = run_child("crash", database_url, path)
    assert child.returncode == 3, child.stderr
    calls = json.loads(path.read_text())
    assert sum(name == "create_proposal" for name, _ in calls) == 1
    assert read_row(database_url)["status"] == "submitting"
    ledger, complete, dispatch = FakeProposalLedger(create_results=[make_proposal()]), MockCompletion([]), FakeDispatch(errors={
        "get_order": AssertionError("Gather repeated"), "get_timeline": AssertionError("Gather repeated"),
    })
    async def run():
        async with restarted(database_url, ledger=ledger, complete=complete, dispatch=dispatch) as agent:
            assert (await agent.state(COMPLAINT_ID)).next == ("submit",)
            assert await agent.status(COMPLAINT_ID) == expected_status("submit_retry", None)
            assert await agent.poll() == [expected_status("awaiting_review")]
            assert [name for name, _ in ledger.calls] == ["create_proposal"]
            request = creates(ledger)[0]
            assert request.body() == calls[-1][1]
            assert proposal_idempotency_key(request.complaint_id) == "refund-proposal:" + calls[-1][1]["complaintId"]
            assert not complete.calls and not dispatch.calls
    asyncio.run(run())


def test_transient_submit_failure_retries_from_checkpoint(database_url):
    ledger, complete, dispatch = FakeProposalLedger(create_results=[Unavailable("ledger", "x")]), MockCompletion(["DONE", DECISION_JSON]), FakeDispatch()
    async def run():
        async with open_test_agent(database_url, ledger=ledger, complete=complete, dispatch=dispatch) as agent:
            assert await agent.start(make_input()) == expected_status("submit_retry", None)
            assert read_row(database_url)["submit_attempts"] == 1
            assert await agent.poll() == [expected_status("awaiting_review")]
            assert creates(ledger) == [default_request(), default_request()]
            assert len(complete.calls) == 2
            assert dispatch.calls == [("get_order", 1), ("get_timeline", 1)]
            assert [name for name, _ in ledger.calls].count("get_payment") == 1
            assert [name for name, _ in ledger.calls].count("get_refundable") == 1
    asyncio.run(run())


def test_submit_gives_up_after_max_attempts(database_url):
    ledger = FakeProposalLedger(create_results=[Unavailable("ledger", "x") for _ in range(3)])
    async def run():
        async with open_test_agent(database_url, ledger=ledger) as agent:
            assert await agent.start(make_input()) == expected_status("submit_retry", None)
            assert await agent.poll() == []
            assert await agent.status(COMPLAINT_ID) == expected_status("submit_retry", None)
            assert await agent.poll() == [expected_status("escalated", None)]
            assert (await agent.state(COMPLAINT_ID)).values["escalation"] == {
                "stage": "submit", "reason": "ledger_unavailable", "detail": "Unavailable after 3 attempts",
            }
            assert len(creates(ledger)) == 3
    asyncio.run(run())


def test_refused_proposal_escalates_without_retry(database_url):
    ledger = FakeProposalLedger(create_results=[ServiceError("ledger", "m", status=422, code="REFUND_LIMIT_EXCEEDED")])
    async def run():
        async with open_test_agent(database_url, ledger=ledger) as agent:
            assert await agent.start(make_input()) == expected_status("escalated", None)
            assert (await agent.state(COMPLAINT_ID)).values["escalation"] == {
                "stage": "submit", "reason": "proposal_refused", "detail": "ServiceError: REFUND_LIMIT_EXCEEDED",
            }
            assert len(creates(ledger)) == 1
            assert await agent.poll() == []
    asyncio.run(run())


def test_mismatched_proposal_escalates(database_url):
    ledger = FakeProposalLedger(create_results=[make_proposal(amount_minor=400)])
    async def run():
        async with open_test_agent(database_url, ledger=ledger) as agent:
            assert await agent.start(make_input()) == expected_status("escalated", None)
            assert (await agent.state(COMPLAINT_ID)).values["escalation"] == {
                "stage": "submit", "reason": "proposal_mismatch", "detail": "amount_minor differs",
            }
    asyncio.run(run())


def test_config_from_env_and_open_agent(database_url):
    env = {
        "FAIRSETTLE_DATABASE_URL": database_url, "DISPATCH_BASE_URL": "http://dispatch.invalid",
        "AGENT_SERVICE_TOKEN": "t" * 40, "LEDGER_BASE_URL": "http://ledger.invalid", "LEDGER_APP_TOKEN": APP_TOKEN,
    }
    for missing in env:
        with pytest.raises(ValueError, match=missing + " is required"):
            AgentConfig.from_env({key: value for key, value in env.items() if key != missing})
    config = AgentConfig.from_env({**env, "FAIRSETTLE_TRACING": "off"})
    representation = repr(config)
    assert "http://dispatch.invalid" in representation and "http://ledger.invalid" in representation
    assert "<set>" in representation
    assert env["AGENT_SERVICE_TOKEN"] not in representation and APP_TOKEN not in representation
    assert urlsplit(database_url).password not in representation
    async def run():
        async with open_agent(config, complete=MockCompletion([])) as agent:
            assert await agent.status("none") is None
        with psycopg.connect(database_url) as conn:
            names = {row[0] for row in conn.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")}
            assert {"checkpoint_migrations", "checkpoints", "checkpoint_blobs", "checkpoint_writes", "agent_complaint"} <= names
    asyncio.run(run())
