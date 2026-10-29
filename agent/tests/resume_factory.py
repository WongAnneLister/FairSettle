from contextlib import asynccontextmanager
import os
from pathlib import Path
import subprocess
import sys

from decide_factory import DECISION_JSON, FakeDispatch, FakeLedger, MockCompletion, make_complaint
from policy_factory import NOW, make_decision, make_evidence
from fairsettle_agent.agent import Agent, open_persistence
from fairsettle_agent.clients.models import RefundProposal
from fairsettle_agent.complaint import ComplaintInput
from fairsettle_agent.model import ModelConfig
from fairsettle_agent.policy import PolicyVerdict
from fairsettle_agent.proposal import proposal_request

PROPOSAL_ID = "prop_01HZX9K2M4N6P8Q0R2S4T6V8W2"
REFUND_ID = "ref_01HZX9K2M4N6P8Q0R2S4T6V8W3"


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
    def __init__(self, *, create_results=None, review=None, on_create=None, **kwargs):
        super().__init__(**kwargs)
        self.create_results = list(create_results or [])
        self.review = make_proposal() if review is None else review
        self.on_create = on_create

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


@asynccontextmanager
async def open_test_agent(
    database_url, *, dispatch=None, ledger=None, complete=None, now=lambda: NOW,
    max_submit_attempts=3,
):
    async with open_persistence(database_url) as (store, saver):
        yield Agent(
            store=store, checkpointer=saver,
            dispatch=FakeDispatch() if dispatch is None else dispatch,
            ledger=FakeProposalLedger() if ledger is None else ledger,
            complete=MockCompletion([DECISION_JSON]) if complete is None else complete,
            model=ModelConfig(api_key="sk-test-" + "k" * 32), now=now,
            max_submit_attempts=max_submit_attempts,
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
