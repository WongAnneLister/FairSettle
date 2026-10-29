import ast
import asyncio
from contextlib import contextmanager
from copy import deepcopy
import inspect
import json
from pathlib import Path
import re

import httpx
import psycopg
from psycopg import sql
import pytest

from fairsettle_agent.execution import refund_outcome, refund_resume_value
from fairsettle_agent.tracing import Tracing, TracingConfig
from fairsettle_agent.agent import AgentConfig, RunStatus, ThreadStateError, open_persistence
from fairsettle_agent.clients import LedgerClient, MalformedResponse, Refund, Unavailable
from fairsettle_agent.clients.replay import FixtureReplay
from conftest import APP_TOKEN, database_url as database_url_fixture
from decide_factory import FakeDispatch, MockCompletion
from policy_factory import NOW, PAYMENT_ID, make_decision
from resume_factory import (
    PROPOSAL_ID, REFUND_ID, FakeProposalLedger, approved_thread, make_input, make_proposal,
    make_refund, make_tracing, open_test_agent, restarted, spans,
)
from test_clients import raw
from test_resume import COMPLAINT_ID, creates, expected_status, read_row

COLUMNS = {"complaint_id", "order_id", "customer_id", "received_at", "status", "proposal_id", "submit_attempts", "updated_at"}
new_database = contextmanager(database_url_fixture.__wrapped__)


def metadata(span, name):
    return json.loads(span.attributes["langfuse.observation.metadata." + name])


def named(items, name):
    return [span for span in items if span.name == name]


def test_get_refund_reads_the_recorded_refund():
    body = raw("ledger-refund-reserved")["response"]["body"]
    assert "providerRefundId" not in body and "providerStatus" not in body
    replay = FixtureReplay.load("ledger-refund-reserved")
    async def run():
        async with httpx.AsyncClient(base_url="http://ledger.invalid", transport=replay.transport(),
                                     headers={"X-Service-Token": "drop-this"}) as http:
            refund = await LedgerClient(http, APP_TOKEN).get_refund(body["id"])
            assert isinstance(refund, Refund)
            assert refund.refund_status == "RESERVED" and refund.amount_minor == 60
            assert refund.provider_refund_id is None and refund.provider_status is None
    asyncio.run(run())
    assert len(replay.requests) == 1
    request = replay.requests[0]
    assert (request.method, request.url.path) == ("GET", "/v1/refunds/" + body["id"])
    assert request.headers["Authorization"] == "Bearer " + APP_TOKEN
    assert "X-Service-Token" not in request.headers


def test_refund_statuses_parse():
    recorded = raw("ledger-refund-reserved")["response"]["body"]
    async def run():
        for status, resolution, financial in (
            ("SUCCEEDED", "KNOWN", "POSTED"), ("FAILED", "KNOWN", "NOT_APPLICABLE"),
            ("CANCELED", "KNOWN", "NOT_APPLICABLE"), ("SUBMITTED", "UNKNOWN", "NOT_APPLICABLE"),
        ):
            body = {**deepcopy(recorded), "refundStatus": status, "resolutionStatus": resolution, "financialStatus": financial}
            if status == "SUCCEEDED":
                body.update(providerRefundId="PAYPAL-REF-1", providerStatus="COMPLETED")
            requests = []
            def handle(request):
                requests.append(request)
                return httpx.Response(200, json=body)
            async with httpx.AsyncClient(base_url="http://ledger.invalid", transport=httpx.MockTransport(handle)) as http:
                client = LedgerClient(http, APP_TOKEN)
                refund = await client.get_refund(body["id"])
                assert (refund.refund_status, refund.resolution_status, refund.financial_status) == (status, resolution, financial)
                if status == "SUCCEEDED":
                    assert (refund.provider_refund_id, refund.provider_status) == ("PAYPAL-REF-1", "COMPLETED")
                body["refundStatus"] = "LOST"
                with pytest.raises(MalformedResponse):
                    await client.get_refund(body["id"])
                count = len(requests)
                with pytest.raises(ValueError, match="refund_id must be a valid refund id"):
                    await client.get_refund("ref_bad")
                assert len(requests) == count
    asyncio.run(run())


def test_refund_outcome_rules():
    cases = [(status, "KNOWN", "waiting") for status in ("RESERVED", "SUBMITTED", "PENDING", "REQUIRES_ACTION")]
    cases += [
        ("SUBMITTED", "UNKNOWN", "waiting"), ("SUCCEEDED", "KNOWN", "refunded"),
        ("SUCCEEDED", "UNKNOWN", "refunded"), ("FAILED", "KNOWN", "refund_failed"),
        ("CANCELED", "KNOWN", "refund_failed"), ("SUBMITTED", "CONFLICT", "refund_failed"),
        ("SUCCEEDED", "CONFLICT", "refund_failed"),
    ]
    for status, resolution, expected in cases:
        refund = make_refund(refund_status=status, resolution_status=resolution, financial_status="PENDING_EVIDENCE")
        assert refund_outcome(refund) == expected
        assert refund_outcome(refund_resume_value(refund)) == expected


def test_trace_id_is_deterministic_and_fits_the_contract():
    trace_id = Tracing.trace_id(COMPLAINT_ID)
    assert trace_id == Tracing.trace_id(COMPLAINT_ID)
    assert re.fullmatch(r"[0-9a-f]{32}", trace_id)
    assert trace_id != Tracing.trace_id("other")
    assert Tracing.off().enabled is False


def test_config_requires_langfuse_unless_off():
    env = {
        "FAIRSETTLE_DATABASE_URL": "postgresql://test:test@localhost/test", "DISPATCH_BASE_URL": "http://dispatch.invalid",
        "AGENT_SERVICE_TOKEN": "t" * 40, "LEDGER_BASE_URL": "http://ledger.invalid", "LEDGER_APP_TOKEN": APP_TOKEN,
    }
    lf = {"LANGFUSE_PUBLIC_KEY": "pk-lf-test-config", "LANGFUSE_SECRET_KEY": "sk-lf-test-config", "LANGFUSE_BASE_URL": "http://langfuse.invalid"}
    for missing in lf:
        with pytest.raises(ValueError, match=missing + " is required"):
            AgentConfig.from_env({**env, **{key: value for key, value in lf.items() if key != missing}})
    partial = dict(env)
    for key, value in lf.items():
        with pytest.raises(ValueError, match=key + " is required"):
            AgentConfig.from_env(partial)
        partial[key] = value
    assert AgentConfig.from_env({**env, "FAIRSETTLE_TRACING": "off"}).tracing is None
    with pytest.raises(ValueError, match="FAIRSETTLE_TRACING must be on or off"):
        AgentConfig.from_env({**env, "FAIRSETTLE_TRACING": "maybe"})
    config = AgentConfig.from_env({**env, **lf})
    assert isinstance(config.tracing, TracingConfig)
    assert config.tracing.public_key == lf["LANGFUSE_PUBLIC_KEY"]
    assert config.tracing.base_url == lf["LANGFUSE_BASE_URL"]
    assert lf["LANGFUSE_SECRET_KEY"] not in repr(config)
    assert lf["LANGFUSE_PUBLIC_KEY"] in repr(config) and lf["LANGFUSE_BASE_URL"] in repr(config)


def test_ledger_is_the_only_money_path():
    public = {name for name, value in inspect.getmembers(LedgerClient) if not name.startswith("_") and callable(value)}
    assert public == {"get_payment", "get_refundable", "create_proposal", "get_proposal", "get_refund"}
    package = Path(__file__).resolve().parents[1] / "fairsettle_agent"
    tree = ast.parse((package / "clients/ledger.py").read_text())
    writes = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "_send":
            if node.args and isinstance(node.args[0], ast.Constant) and node.args[0].value != "GET":
                writes.append((node.args[0].value, node.args[1].value))
    assert writes == [("POST", "/v1/refund-proposals")]
    for path in package.rglob("*.py"):
        assert "paypal" not in path.read_text().lower(), path


def test_approval_pauses_for_the_refund(database_url, tmp_path):
    approved_thread(database_url, tmp_path)
    row = read_row(database_url)
    assert row["status"] == "approved" and set(row) == COLUMNS
    async def run():
        async with restarted(database_url) as agent:
            state = await agent.state(COMPLAINT_ID)
            assert state.values["review"]["refund_id"] == REFUND_ID
            assert state.next == ("await_refund",)
            assert len(state.interrupts) == 1
            assert state.interrupts[0].value == {"refund_id": REFUND_ID}
    asyncio.run(run())


def test_refund_success_finishes_after_restart(database_url, tmp_path):
    approved_thread(database_url, tmp_path)
    refund = make_refund(refund_status="SUCCEEDED", provider_refund_id="PAYPAL-REF-1", provider_status="COMPLETED", financial_status="POSTED")
    ledger, complete = FakeProposalLedger(refund=refund), MockCompletion([])
    dispatch = FakeDispatch(errors={"get_order": AssertionError("Gather repeated"), "get_timeline": AssertionError("Gather repeated")})
    async def run():
        async with restarted(database_url, ledger=ledger, complete=complete, dispatch=dispatch) as agent:
            assert await agent.poll() == [RunStatus(COMPLAINT_ID, COMPLAINT_ID, "refunded", PROPOSAL_ID)]
            assert ledger.calls == [("get_refund", REFUND_ID)]
            assert not complete.calls and not dispatch.calls
            state = await agent.state(COMPLAINT_ID)
            assert state.next == ()
            assert state.values["refund"] == refund_resume_value(refund)
            assert read_row(database_url)["status"] == "refunded"
    asyncio.run(run())


def test_unfinished_refund_stays_paused(database_url, tmp_path):
    approved_thread(database_url, tmp_path)
    ledger = FakeProposalLedger()
    async def run():
        async with restarted(database_url, ledger=ledger) as agent:
            for refund in (make_refund(), make_refund(refund_status="SUBMITTED", resolution_status="UNKNOWN"), Unavailable("ledger", "x")):
                ledger.refund = refund
                assert await agent.poll() == []
                assert read_row(database_url)["status"] == "approved"
                assert (await agent.state(COMPLAINT_ID)).next == ("await_refund",)
    asyncio.run(run())


def test_failed_canceled_or_conflicting_refund_ends_refund_failed(postgres_url, tmp_path):
    for status, resolution in (("FAILED", "KNOWN"), ("CANCELED", "KNOWN"), ("SUBMITTED", "CONFLICT")):
        with new_database(postgres_url) as url:
            approved_thread(url, tmp_path)
            async def run():
                async with restarted(url, ledger=FakeProposalLedger(refund=make_refund(refund_status=status, resolution_status=resolution))) as agent:
                    assert await agent.poll() == [expected_status("refund_failed")]
                    assert (await agent.state(COMPLAINT_ID)).next == ()
                    assert read_row(url)["status"] == "refund_failed"
            asyncio.run(run())


def test_refund_mismatch_escalates(postgres_url, tmp_path):
    for changes, detail in (({"amount_minor": 400}, "amount_minor differs"),
                            ({"payment_id": "pay_01HZX9K2M4N6P8Q0R2S4T6V8W1"}, "payment_id differs")):
        with new_database(postgres_url) as url:
            approved_thread(url, tmp_path)
            async def run():
                async with restarted(url, ledger=FakeProposalLedger(refund=make_refund(refund_status="SUCCEEDED", **changes))) as agent:
                    assert await agent.poll() == [expected_status("escalated")]
                    assert (await agent.state(COMPLAINT_ID)).values["escalation"] == {
                        "stage": "execute", "reason": "refund_mismatch", "detail": detail,
                    }
            asyncio.run(run())


def test_resume_refuses_a_refund_thread_that_is_not_waiting(database_url, tmp_path):
    approved_thread(database_url, tmp_path)
    with psycopg.connect(database_url, autocommit=True) as conn:
        for table in ("checkpoints", "checkpoint_blobs", "checkpoint_writes"):
            conn.execute(sql.SQL("DELETE FROM {} WHERE thread_id = %s").format(sql.Identifier(table)), (COMPLAINT_ID,))
    async def run():
        async with restarted(database_url, ledger=FakeProposalLedger(refund=make_refund(refund_status="SUCCEEDED"))) as agent:
            with pytest.raises(ThreadStateError, match="not waiting for refund"):
                await agent.poll()
            with psycopg.connect(database_url) as conn:
                assert conn.execute("SELECT count(*) FROM checkpoints WHERE thread_id = %s", (COMPLAINT_ID,)).fetchone()[0] == 0
    asyncio.run(run())


def test_ledger_calls_over_a_whole_run(database_url):
    ledger = FakeProposalLedger(review=make_proposal(status="APPROVED"), refund=make_refund(refund_status="SUCCEEDED"))
    async def run():
        async with open_test_agent(database_url, ledger=ledger) as agent:
            assert (await agent.start(make_input())).status == "awaiting_review"
            assert await agent.poll() == [expected_status("approved")]
            assert await agent.poll() == [expected_status("refunded")]
            assert [name for name, value in ledger.calls] == ["get_payment", "get_refundable", "create_proposal", "get_proposal", "get_refund"]
    asyncio.run(run())


def test_store_upgrades_an_f22_table(database_url):
    ddl = """
        CREATE TABLE agent_complaint (
            complaint_id text PRIMARY KEY,
            order_id bigint NOT NULL,
            customer_id bigint,
            received_at timestamptz NOT NULL,
            status text NOT NULL CHECK (status IN (
                'running', 'submitting', 'submit_retry', 'awaiting_review',
                'approved', 'rejected', 'declined', 'escalated')),
            proposal_id text,
            submit_attempts integer NOT NULL DEFAULT 0 CHECK (submit_attempts >= 0),
            updated_at timestamptz NOT NULL
        )
    """
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(ddl)
        conn.execute("INSERT INTO agent_complaint (complaint_id, order_id, received_at, status, updated_at) VALUES (%s, 1, %s, 'approved', %s)", (COMPLAINT_ID, NOW, NOW))
    async def run():
        async with open_persistence(database_url) as (store, saver):
            row = read_row(database_url)
            assert row["status"] == "approved" and set(row) == COLUMNS
            with psycopg.connect(database_url, autocommit=True) as conn:
                conn.execute("UPDATE agent_complaint SET status = 'refunded' WHERE complaint_id = %s", (COMPLAINT_ID,))
                with pytest.raises(psycopg.errors.CheckViolation):
                    conn.execute("UPDATE agent_complaint SET status = 'bogus' WHERE complaint_id = %s", (COMPLAINT_ID,))
            await store.setup()
            assert read_row(database_url)["status"] == "refunded"
    asyncio.run(run())


def test_start_is_traced_by_complaint_id(database_url):
    tracing, exporter = make_tracing()
    ledger = FakeProposalLedger()
    async def run():
        async with open_test_agent(database_url, ledger=ledger, tracing=tracing) as agent:
            assert agent.tracing is tracing
            await agent.start(make_input())
            record = (await agent.state(COMPLAINT_ID)).values["run"]
        items = spans(tracing, exporter)
        assert {span.name for span in items} == {"start", "gather", "count", "decide", "submit"}
        root = named(items, "start")[0]
        for span in items:
            assert format(span.context.trace_id, "032x") == Tracing.trace_id(COMPLAINT_ID)
            assert span.attributes["session.id"] == COMPLAINT_ID
            assert span.attributes["langfuse.trace.name"] == "complaint"
            if span.name != "start":
                assert span.parent.span_id == root.context.span_id
        generation = named(items, "decide")[0]
        assert generation.attributes["langfuse.observation.type"] == "generation"
        assert generation.attributes["langfuse.observation.model.name"] == "deepseek/deepseek-flash"
        assert json.loads(generation.attributes["langfuse.observation.usage_details"]) == {"input": record["prompt_tokens"], "output": record["completion_tokens"]}
        request = creates(ledger)[0]
        assert request.agent_run.trace_id == Tracing.trace_id(COMPLAINT_ID)
        assert request.body()["agentRun"]["traceId"] == Tracing.trace_id(COMPLAINT_ID)
    asyncio.run(run())


def test_every_invocation_joins_the_same_trace(database_url):
    all_spans = []
    async def run():
        for action in ("start", "resume_review", "resume_refund"):
            tracing, exporter = make_tracing()
            ledger = FakeProposalLedger(review=make_proposal(status="APPROVED"), refund=make_refund(refund_status="SUCCEEDED"))
            opener = open_test_agent if action == "start" else restarted
            async with opener(database_url, ledger=ledger, tracing=tracing) as agent:
                if action == "start":
                    await agent.start(make_input())
                else:
                    await agent.poll()
            items = spans(tracing, exporter)
            assert len(named(items, action)) == 1
            if action == "resume_review":
                assert metadata(named(items, "await_review")[0], "review_status") == "APPROVED"
                assert len(named(items, "approved")) == 1
            if action == "resume_refund":
                assert len(named(items, "await_refund")) == 1
                assert metadata(named(items, "finish")[0], "final") == "refunded"
            all_spans.extend(items)
        for span in all_spans:
            assert format(span.context.trace_id, "032x") == Tracing.trace_id(COMPLAINT_ID)
            assert span.attributes["session.id"] == COMPLAINT_ID
        exported_ids = {span.context.span_id for span in all_spans}
        roots = [span.name for span in all_spans if span.parent is None or span.parent.span_id not in exported_ids]
        assert roots == ["start", "resume_review", "resume_refund"]
    asyncio.run(run())


def test_escalations_and_failures_are_traced(postgres_url):
    async def check(url, case):
        tracing, exporter = make_tracing()
        ledger = FakeProposalLedger(create_results=[Unavailable("ledger", "x")] if case == "retry" else [],
                                    review=make_proposal(status="APPROVED"), refund=make_refund(refund_status="FAILED"))
        dispatch = FakeDispatch(errors={"get_order": Unavailable("dispatch", "x")} if case == "gather" else {})
        async with open_test_agent(url, dispatch=dispatch, ledger=ledger, tracing=tracing) as agent:
            await agent.start(make_input())
            if case == "retry":
                await agent.poll()
            if case == "failed":
                await agent.poll()
                await agent.poll()
        items = spans(tracing, exporter)
        if case == "gather":
            stage = named(items, "gather")[0]
            assert stage.attributes["langfuse.observation.level"] == "WARNING"
            assert stage.attributes["langfuse.observation.status_message"] == "source_unavailable"
            assert metadata(named(items, "finish")[0], "final") == "escalated"
        elif case == "retry":
            stage = named(items, "submit")[0]
            assert stage.attributes["langfuse.observation.level"] == "WARNING"
            assert stage.attributes["langfuse.observation.status_message"] == "submit_retry"
            assert len(named(items, "retry_submit")) == 1
        else:
            stage = named(items, "finish")[0]
            assert metadata(stage, "final") == "refund_failed"
            assert stage.attributes["langfuse.observation.level"] == "WARNING"
    for case in ("gather", "retry", "failed"):
        with new_database(postgres_url) as url:
            asyncio.run(check(url, case))


def test_traces_hold_no_complaint_text(database_url):
    tracing, exporter = make_tracing()
    async def run():
        ledger = FakeProposalLedger(review=make_proposal(status="APPROVED"), refund=make_refund(refund_status="SUCCEEDED"))
        async with open_test_agent(database_url, ledger=ledger, tracing=tracing) as agent:
            await agent.start(make_input())
            await agent.poll()
            await agent.poll()
        other = "complaint-rejected-002"
        ledger = FakeProposalLedger(review=make_proposal(status="REJECTED", complaint_id=other))
        async with open_test_agent(database_url, ledger=ledger, tracing=tracing) as agent:
            await agent.start(make_input(complaint_id=other))
            await agent.poll()
        prohibited = (make_input().text, make_decision().explanation, "Photo shows the drink was delivered.", "Pizza", "Lemonade")
        for span in spans(tracing, exporter):
            for key, value in span.attributes.items():
                assert "customer" not in key.lower()
                assert not any(text in str(value) for text in prohibited), (span.name, key)
    asyncio.run(run())


def test_tracing_off_sends_nothing(database_url, monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("Tracing off constructed a Langfuse client")
    monkeypatch.setattr("langfuse.Langfuse.__init__", refuse)
    ledger = FakeProposalLedger()
    async def run():
        async with open_test_agent(database_url, ledger=ledger) as agent:
            assert (await agent.start(make_input())).status == "awaiting_review"
        request = creates(ledger)[0]
        assert request.agent_run.trace_id is None
        assert "traceId" not in request.body()["agentRun"]
    asyncio.run(run())
