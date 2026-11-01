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
from .execution import refund_outcome
from .gather import DispatchReader, GatherFailure, LedgerReader, gather
from .investigate import Investigation, investigate
from .model import ModelConfig
from .policy import PolicyConfig, PolicyVerdict, Violation, Rule
from .proactive import is_proactive
from .proposal import ProposalLedger, proposal_request
from .store import ComplaintStore
from .tracing import Stage, Tracing


class RunState(TypedDict, total=False):
    complaint: dict
    received_at: str
    evidence: dict
    verdict: dict
    investigation: dict
    run: dict
    escalation: dict
    proposal: dict
    review: dict
    refund: dict
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
    tracing: Tracing


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


def _trace_escalation(observation: Stage, stage, reason, detail):
    result = _escalation(stage, reason, detail)
    observation.update(level="WARNING", status_message=reason, metadata=result["escalation"])
    return result


def _verdict(state):
    value = state["verdict"]
    return PolicyVerdict(
        value["outcome"], RefundDecision.model_validate_json(value["decision_json"]),
        tuple(Violation(Rule(v["rule"]), v["message"]) for v in value["violations"]),
    )


def build_graph(deps: GraphDeps) -> StateGraph:
    async def gather_node(state):
        with deps.tracing.stage("gather") as observation:
            complaint = ComplaintInput.model_validate(state["complaint"])
            evidence = await gather(complaint.to_complaint(0), deps.dispatch, deps.ledger)
            if isinstance(evidence, GatherFailure):
                return _trace_escalation(observation, "gather", evidence.reason, evidence.detail)
            return {"evidence": {
                name: getattr(evidence, name).model_dump(mode="json", by_alias=True)
                for name in ("order", "timeline", "payment", "refundable")
            }}

    async def count(state):
        with deps.tracing.stage("count") as observation:
            evidence = evidence_from_state(state)
            if evidence.order.customer is None:
                return _trace_escalation(observation, "count", "customer_unknown", f"order {evidence.order.id} has no customer")
            complaint_id = state["complaint"]["complaint_id"]
            await deps.store.record_customer(complaint_id, evidence.order.customer.id)
            if is_proactive(complaint_id):
                n = 0
            else:
                n = await deps.store.count_prior(
                    evidence.order.customer.id, complaint_id, datetime.fromisoformat(state["received_at"]),
                )
            observation.update(metadata={"prior_complaints_in_7_days": n})
            return {"evidence": {**state["evidence"], "prior_complaints_in_7_days": n}}

    async def investigate_node(state):
        with deps.tracing.stage("investigate") as observation:
            evidence = evidence_from_state(state)
            complaint = ComplaintInput.model_validate(state["complaint"]).to_complaint(evidence.prior_complaints_in_7_days)
            result = await investigate(
                complaint, state["complaint"]["complaint_id"], datetime.fromisoformat(state["received_at"]),
                evidence, deps.model, deps.policy, deps.dispatch, deps.ledger, deps.store, deps.complete,
            )
            observation.update(metadata={
                "steps": result.steps, "tools": [f.tool for f in result.findings], "stopped": result.stopped,
                "prompt_tokens": result.prompt_tokens, "completion_tokens": result.completion_tokens,
            })
            return {"investigation": result.to_state()}

    async def decide_node(state):
        with deps.tracing.stage("decide", as_type="generation") as observation:
            evidence = evidence_from_state(state)
            complaint = ComplaintInput.model_validate(state["complaint"]).to_complaint(evidence.prior_complaints_in_7_days)
            started = time.perf_counter()
            outcome, attempts, prompt_tokens, completion_tokens = await decide(
                complaint, evidence, deps.model, deps.policy, deps.complete,
                investigation=Investigation.from_state(state.get("investigation")),
            )
            result = {"run": {
                "model": deps.model.model, "attempts": attempts, "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "stage_ms": {"decide": int((time.perf_counter() - started) * 1000)},
            }}
            observation.update(
                model=deps.model.model, usage_details={"input": prompt_tokens, "output": completion_tokens},
                metadata={"attempts": attempts},
            )
            if isinstance(outcome, Escalation):
                result.update(_trace_escalation(observation, "decide", outcome.reason, outcome.detail))
            else:
                result["verdict"] = {
                    "outcome": outcome.outcome, "decision_json": outcome.decision.model_dump_json(),
                    "violations": [{"rule": str(v.rule), "message": v.message} for v in outcome.violations],
                }
                observation.update(metadata={
                    "outcome": outcome.outcome, "decision": outcome.decision.decision,
                    "amount_cents": outcome.decision.amount_cents, "reason_code": outcome.decision.reason_code,
                    "violations": [str(v.rule) for v in outcome.violations],
                    "evidence_refs": list(outcome.decision.evidence_refs),
                })
            return result

    async def submit(state):
        with deps.tracing.stage("submit") as observation:
            complaint_id = state["complaint"]["complaint_id"]
            attempts = await deps.store.begin_submit(complaint_id)
            observation.update(metadata={"attempt": attempts})
            request = proposal_request(
                _verdict(state), evidence_from_state(state), complaint_id, complaint_id,
                trace_id=Tracing.trace_id(complaint_id) if deps.tracing.enabled else None,
            )
            try:
                proposal = await deps.ledger.create_proposal(request)
            except ClientError as error:
                if error.retryable:
                    if attempts < deps.max_submit_attempts:
                        await deps.store.set_status(complaint_id, "submit_retry")
                        observation.update(level="WARNING", status_message="submit_retry")
                        raise SubmitDeferred(complaint_id) from error
                    return _trace_escalation(observation, "submit", "ledger_unavailable", f"{type(error).__name__} after {attempts} attempts")
                code = error.code or f"HTTP {error.status}"
                return _trace_escalation(observation, "submit", "proposal_refused", f"{type(error).__name__}: {code}")
            observation.update(metadata={"proposal_id": proposal.id})
            for name in ("complaint_id", "payment_id", "amount_minor"):
                if getattr(proposal, name) != getattr(request, name):
                    return _trace_escalation(observation, "submit", "proposal_mismatch", f"{name} differs")
            await deps.store.mark_awaiting(complaint_id, proposal.id)
            return {"proposal": {"id": proposal.id, "status": str(proposal.status)}}

    def await_review(state):
        review = interrupt({"proposal_id": state["proposal"]["id"]})
        with deps.tracing.stage("await_review") as observation:
            if not (
                review.get("status") == "APPROVED" and review.get("refund_id")
                or review.get("status") == "REJECTED" and review.get("rejection_reason")
            ):
                raise ValueError("invalid resumed review")
            observation.update(metadata={"proposal_id": state["proposal"]["id"], "review_status": review["status"]})
            return {"review": review}

    async def approved(state):
        with deps.tracing.stage("approved") as observation:
            await deps.store.mark_approved(state["complaint"]["complaint_id"])
            observation.update(metadata={"refund_id": state["review"]["refund_id"]})
            return {"proposal": {**state["proposal"], "status": "APPROVED"}}

    def await_refund(state):
        refund = interrupt({"refund_id": state["review"]["refund_id"]})
        with deps.tracing.stage("await_refund") as observation:
            observation.update(metadata={
                "refund_id": refund["id"], "refund_status": refund["refund_status"],
                "resolution_status": refund["resolution_status"],
            })
            evidence = evidence_from_state(state)
            expected = {
                "id": state["review"]["refund_id"], "payment_id": evidence.payment.id,
                "amount_minor": _verdict(state).decision.amount_cents, "currency": evidence.payment.currency,
            }
            for name, value in expected.items():
                if refund[name] != value:
                    return _trace_escalation(observation, "execute", "refund_mismatch", f"{name} differs")
            if refund_outcome(refund) == "waiting":
                raise ValueError("refund is not final")
            return {"refund": refund}

    async def finish(state):
        with deps.tracing.stage("finish") as observation:
            if "escalation" in state or state.get("verdict", {}).get("outcome") == "escalate":
                final = "escalated"
            elif "refund" in state:
                final = refund_outcome(state["refund"])
            elif state.get("verdict", {}).get("outcome") == "reject":
                final = "declined"
            else:
                final = {"APPROVED": "approved", "REJECTED": "rejected"}[state["review"]["status"]]
            await deps.store.finish(state["complaint"]["complaint_id"], final)
            observation.update(metadata={"final": final}, **({"level": "WARNING"} if final in ("escalated", "refund_failed") else {}))
            return {"final": final}

    graph = StateGraph(RunState)
    for name, node in (
        ("gather", gather_node), ("count", count), ("investigate", investigate_node), ("decide", decide_node), ("submit", submit),
        ("await_review", await_review), ("approved", approved), ("await_refund", await_refund), ("finish", finish),
    ):
        graph.add_node(name, node)
    graph.add_edge(START, "gather")
    for current, next_node in (("gather", "count"), ("count", "investigate"), ("investigate", "decide"), ("submit", "await_review")):
        graph.add_conditional_edges(current, lambda state, target=next_node: "finish" if "escalation" in state else target)
    graph.add_conditional_edges("decide", lambda state: "submit" if state.get("verdict", {}).get("outcome") == "propose" else "finish")
    graph.add_conditional_edges("await_review", lambda state: "approved" if state["review"]["status"] == "APPROVED" else "finish")
    graph.add_edge("approved", "await_refund")
    graph.add_edge("await_refund", "finish")
    graph.add_edge("finish", END)
    return graph
