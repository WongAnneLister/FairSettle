from contextlib import asynccontextmanager
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

from langfuse import Langfuse
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from decide_factory import DECISION_JSON, FakeDispatch, FakeLedger, MockCompletion, make_complaint
from policy_factory import NOW, PAYMENT_ID, make_decision, make_evidence
from fairsettle_agent.agent import Agent, open_persistence
from fairsettle_agent.clients.models import Refund, RefundProposal
from fairsettle_agent.complaint import ComplaintInput
from fairsettle_agent.model import ModelConfig
from fairsettle_agent.policy import PolicyVerdict
from fairsettle_agent.proposal import proposal_request
from fairsettle_agent.tracing import Tracing

PROPOSAL_ID = "prop_01HZX9K2M4N6P8Q0R2S4T6V8W2"
REFUND_ID = "ref_01HZX9K2M4N6P8Q0R2S4T6V8W3"


def make_refund(**overrides) -> Refund:
    fields = dict(
        id=REFUND_ID, payment_id=PAYMENT_ID, amount_minor=450, currency="USD",
        refund_status="RESERVED", resolution_status="KNOWN", financial_status="NOT_APPLICABLE",
        provider_refund_id=None, provider_status=None, control_state="NORMAL", created_at=NOW, updated_at=NOW,
    )
    fields.update(overrides)
    return Refund(**fields)


def make_input(**overrides) -> ComplaintInput:
    fields = make_complaint().model_dump(exclude={"prior_complaints_in_7_days"})
    fields.update(overrides)
    return ComplaintInput(**fields)


def make_proposal(request=None, *, status="PENDING_REVIEW", **overrides) -> RefundProposal:
    if request is None:
        complaint_id = make_input().complaint_id
        request = proposal_request(
            PolicyVerdict("propose", make_decision(), ()), make_evidence(), complaint_id, complaint_id,
        )
    fields = {key: value for key, value in request.model_dump().items() if key in RefundProposal.model_fields}
    fields.update(
        id=PROPOSAL_ID, status=status, created_at=NOW,
        reviewed_at=None if status == "PENDING_REVIEW" else NOW,
        rejection_reason="Photo shows the drink was delivered." if status == "REJECTED" else None,
        refund_id=REFUND_ID if status == "APPROVED" else None,
    )
    fields.update(overrides)
    return RefundProposal(**fields)


class FakeProposalLedger(FakeLedger):
    def __init__(self, *, create_results=None, review=None, refund=None, on_create=None, **kwargs):
        super().__init__(**kwargs)
        self.create_results = list(create_results or [])
        self.review = make_proposal() if review is None else review
        self.on_create = on_create
        self.refund = make_refund() if refund is None else refund

    async def create_proposal(self, request):
        self.calls.append(("create_proposal", request))
        if self.on_create is not None:
            self.on_create()
        result = self.create_results.pop(0) if self.create_results else make_proposal(request)
        if isinstance(result, Exception):
            raise result
        return result

    async def get_proposal(self, proposal_id):
        self.calls.append(("get_proposal", proposal_id))
        if isinstance(self.review, Exception):
            raise self.review
        return self.review

    async def get_refund(self, refund_id):
        self.calls.append(("get_refund", refund_id))
        if isinstance(self.refund, Exception):
            raise self.refund
        return self.refund


@asynccontextmanager
async def open_test_agent(
    database_url, *, dispatch=None, ledger=None, complete=None, now=lambda: NOW,
    max_submit_attempts=3, tracing=None, failures=None,
):
    async with open_persistence(database_url) as (store, saver):
        yield Agent(
            store=store, checkpointer=saver,
            dispatch=FakeDispatch() if dispatch is None else dispatch,
            ledger=FakeProposalLedger() if ledger is None else ledger,
            complete=MockCompletion(["DONE", DECISION_JSON]) if complete is None else complete,
            failures=failures,
            model=ModelConfig(api_key="sk-test-" + "k" * 32), now=now,
            max_submit_attempts=max_submit_attempts,
            tracing=Tracing.off() if tracing is None else tracing,
        )


def run_child(mode, database_url, calls_path) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.pop("DEEPSEEK_API_KEY", None)
    env.update(LITELLM_LOCAL_MODEL_COST_MAP="True", PYTHONPATH=".:tests")
    return subprocess.run(
        [sys.executable, "tests/resume_child.py", mode, database_url, str(calls_path)],
        cwd=Path(__file__).resolve().parents[1], env=env,
        capture_output=True, text=True, timeout=120,
    )


def restarted(database_url, **kwargs):
    kwargs.setdefault("dispatch", FakeDispatch(errors={
        "get_order": AssertionError("Gather repeated after restart"),
        "get_timeline": AssertionError("Gather repeated after restart"),
    }))
    kwargs.setdefault("complete", MockCompletion([]))
    return open_test_agent(database_url, **kwargs)


def make_tracing() -> tuple[Tracing, InMemorySpanExporter]:
    exporter = InMemorySpanExporter()
    client = Langfuse(
        public_key="pk-lf-test-" + uuid4().hex, secret_key="sk-lf-test", base_url="http://langfuse.invalid",
        span_exporter=exporter, tracer_provider=TracerProvider(),
    )
    return Tracing(client), exporter


def spans(tracing, exporter) -> list[ReadableSpan]:
    tracing.flush()
    return list(exporter.get_finished_spans())


def approved_thread(database_url, tmp_path) -> None:
    result = run_child("pause", database_url, tmp_path / "calls.json")
    assert result.returncode == 0, result.stderr

    async def approve():
        ledger = FakeProposalLedger(review=make_proposal(status="APPROVED"))
        async with restarted(database_url, ledger=ledger) as agent:
            status = await agent.poll()
            assert len(status) == 1 and status[0].status == "approved"

    import asyncio
    asyncio.run(approve())
