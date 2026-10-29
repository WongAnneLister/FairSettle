from dataclasses import dataclass
from datetime import datetime
import time
from typing import Protocol, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from .clients.errors import ClientError
from .clients.models import Order, OrderTimeline, Payment, RefundableAmount
from .complaint import ComplaintInput
from .decide import Completion, Escalation, decide
from .decision import RefundDecision
from .evidence import Evidence
from .gather import DispatchReader, GatherFailure, LedgerReader, gather
from .model import ModelConfig
from .policy import PolicyConfig, PolicyVerdict, Violation, Rule
from .proposal import ProposalLedger, proposal_request
from .store import ComplaintStore


class RunState(TypedDict, total=False):
    complaint: dict
    received_at: str
    evidence: dict
    verdict: dict
    run: dict
    escalation: dict
    proposal: dict
    review: dict
    final: str


class AgentLedger(LedgerReader, ProposalLedger, Protocol):
    pass


@dataclass(frozen=True)
class GraphDeps:
    store: ComplaintStore
    dispatch: DispatchReader
    ledger: AgentLedger
    model: ModelConfig
    policy: PolicyConfig
    complete: Completion
    max_submit_attempts: int


class SubmitDeferred(Exception):
    def __init__(self, complaint_id: str):
        self.complaint_id = complaint_id
        super().__init__(complaint_id)


def evidence_from_state(state: RunState) -> Evidence:
    evidence = state["evidence"]
    return Evidence(
        Order.model_validate(evidence["order"]), OrderTimeline.model_validate(evidence["timeline"]),
        Payment.model_validate(evidence["payment"]), RefundableAmount.model_validate(evidence["refundable"]),
        evidence.get("prior_complaints_in_7_days", 0),
    )


def _escalation(stage, reason, detail):
    return {"escalation": {"stage": stage, "reason": reason, "detail": detail}}


def _verdict(state):
    value = state["verdict"]
    return PolicyVerdict(
        value["outcome"], RefundDecision.model_validate_json(value["decision_json"]),
        tuple(Violation(Rule(v["rule"]), v["message"]) for v in value["violations"]),
    )


def build_graph(deps: GraphDeps) -> StateGraph:
    async def gather_node(state):
        complaint = ComplaintInput.model_validate(state["complaint"])
        evidence = await gather(complaint.to_complaint(0), deps.dispatch, deps.ledger)
        if isinstance(evidence, GatherFailure):
            return _escalation("gather", evidence.reason, evidence.detail)
        return {"evidence": {
            name: getattr(evidence, name).model_dump(mode="json", by_alias=True)
            for name in ("order", "timeline", "payment", "refundable")
        }}

    async def count(state):
        evidence = evidence_from_state(state)
        if evidence.order.customer is None:
            return _escalation("count", "customer_unknown", f"order {evidence.order.id} has no customer")
        complaint_id = state["complaint"]["complaint_id"]
        await deps.store.record_customer(complaint_id, evidence.order.customer.id)
        n = await deps.store.count_prior(
            evidence.order.customer.id, complaint_id, datetime.fromisoformat(state["received_at"]),
        )
        return {"evidence": {**state["evidence"], "prior_complaints_in_7_days": n}}

    async def decide_node(state):
        evidence = evidence_from_state(state)
        complaint = ComplaintInput.model_validate(state["complaint"]).to_complaint(evidence.prior_complaints_in_7_days)
        started = time.perf_counter()
        outcome, attempts, prompt_tokens, completion_tokens = await decide(
            complaint, evidence, deps.model, deps.policy, deps.complete,
        )
        result = {"run": {
            "model": deps.model.model, "attempts": attempts, "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "stage_ms": {"decide": int((time.perf_counter() - started) * 1000)},
        }}
        if isinstance(outcome, Escalation):
            result.update(_escalation("decide", outcome.reason, outcome.detail))
        else:
            result["verdict"] = {
                "outcome": outcome.outcome, "decision_json": outcome.decision.model_dump_json(),
                "violations": [{"rule": str(v.rule), "message": v.message} for v in outcome.violations],
            }
        return result

    async def submit(state):
        complaint_id = state["complaint"]["complaint_id"]
        attempts = await deps.store.begin_submit(complaint_id)
        request = proposal_request(_verdict(state), evidence_from_state(state), complaint_id, complaint_id)
        try:
            proposal = await deps.ledger.create_proposal(request)
        except ClientError as error:
            if error.retryable:
                if attempts < deps.max_submit_attempts:
                    await deps.store.set_status(complaint_id, "submit_retry")
                    raise SubmitDeferred(complaint_id) from error
                return _escalation("submit", "ledger_unavailable", f"{type(error).__name__} after {attempts} attempts")
            code = error.code or f"HTTP {error.status}"
            return _escalation("submit", "proposal_refused", f"{type(error).__name__}: {code}")
        for name in ("complaint_id", "payment_id", "amount_minor"):
            if getattr(proposal, name) != getattr(request, name):
                return _escalation("submit", "proposal_mismatch", f"{name} differs")
        await deps.store.mark_awaiting(complaint_id, proposal.id)
        return {"proposal": {"id": proposal.id, "status": str(proposal.status)}}

    def await_review(state):
        review = interrupt({"proposal_id": state["proposal"]["id"]})
        if not (
            review.get("status") == "APPROVED" and review.get("refund_id")
            or review.get("status") == "REJECTED" and review.get("rejection_reason")
        ):
            raise ValueError("invalid resumed review")
        return {"review": review}

    async def finish(state):
        if "escalation" in state or state.get("verdict", {}).get("outcome") == "escalate":
            final = "escalated"
        elif state.get("verdict", {}).get("outcome") == "reject":
            final = "declined"
        else:
            final = {"APPROVED": "approved", "REJECTED": "rejected"}[state["review"]["status"]]
        await deps.store.finish(state["complaint"]["complaint_id"], final)
        return {"final": final}

    graph = StateGraph(RunState)
    for name, node in (
        ("gather", gather_node), ("count", count), ("decide", decide_node),
        ("submit", submit), ("await_review", await_review), ("finish", finish),
    ):
        graph.add_node(name, node)
    graph.add_edge(START, "gather")
    for current, next_node in (("gather", "count"), ("count", "decide"), ("submit", "await_review")):
        graph.add_conditional_edges(current, lambda state, target=next_node: "finish" if "escalation" in state else target)
    graph.add_conditional_edges("decide", lambda state: "submit" if state.get("verdict", {}).get("outcome") == "propose" else "finish")
    graph.add_edge("await_review", "finish")
    graph.add_edge("finish", END)
    return graph
