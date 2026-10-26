from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from .clients.models import OrderStatus
from .decision import RefundDecision
from .evidence import Evidence


class Rule(StrEnum):
    REFUNDABLE_AMOUNT = "refundable_amount"
    REASON_CAP = "reason_cap"
    LIABILITY_SPLIT = "liability_split"
    EVIDENCE_REFS = "evidence_refs"
    NOT_DELIVERED = "not_delivered"
    REPEAT_COMPLAINT = "repeat_complaint"


@dataclass(frozen=True)
class PolicyConfig:
    delivery_fee_cents: int = 299
    quality_cap_basis_points: int = 2000
    repeat_complaint_limit: int = 3

    def __post_init__(self) -> None:
        if type(self.delivery_fee_cents) is not int or self.delivery_fee_cents < 0:
            raise ValueError("delivery_fee_cents must be a non-negative integer")
        if type(self.quality_cap_basis_points) is not int or not 0 <= self.quality_cap_basis_points <= 10000:
            raise ValueError("quality_cap_basis_points must be an integer from 0 to 10000")
        if type(self.repeat_complaint_limit) is not int or self.repeat_complaint_limit < 1:
            raise ValueError("repeat_complaint_limit must be an integer of at least 1")


@dataclass(frozen=True)
class Violation:
    rule: Rule
    message: str


@dataclass(frozen=True)
class PolicyVerdict:
    outcome: Literal["propose", "reject", "escalate"]
    decision: RefundDecision
    violations: tuple[Violation, ...]


def check_refundable_amount(decision: RefundDecision, evidence: Evidence) -> Violation | None:
    refundable = evidence.refundable.refundable_minor
    if decision.amount_cents > refundable:
        return Violation(
            Rule.REFUNDABLE_AMOUNT,
            f"amount {decision.amount_cents} exceeds refundable {refundable}",
        )
    return None


def reason_cap_cents(decision: RefundDecision, evidence: Evidence, config: PolicyConfig) -> int:
    if decision.reason_code == "late_delivery":
        return config.delivery_fee_cents
    if decision.reason_code in ("missing_item", "wrong_item"):
        return sum(
            item.dish.price_cents
            for ref in set(decision.evidence_refs)
            if (item := evidence.item(ref)) is not None and item.dish is not None
        )
    if decision.reason_code == "quality":
        return (evidence.order.total_cents or 0) * config.quality_cap_basis_points // 10000
    if decision.reason_code == "delivery_failed":
        return evidence.order.total_cents or 0
    return 0


def check_reason_cap(
    decision: RefundDecision, evidence: Evidence, config: PolicyConfig,
) -> Violation | None:
    cap = reason_cap_cents(decision, evidence, config)
    if decision.amount_cents > cap:
        return Violation(
            Rule.REASON_CAP,
            f"amount {decision.amount_cents} exceeds the {decision.reason_code} cap {cap}",
        )
    return None


def check_liability_split(decision: RefundDecision) -> Violation | None:
    shares = decision.liability
    if (
        len(shares) != 3
        or {share.party for share in shares} != {"restaurant", "driver", "platform"}
        or any(not 0 <= share.basis_points <= 10000 for share in shares)
        or sum(share.basis_points for share in shares) != 10000
    ):
        given = ", ".join(f"{share.party}={share.basis_points}" for share in shares)
        return Violation(
            Rule.LIABILITY_SPLIT,
            "liability must be restaurant, driver and platform once each, "
            f"0–10000 bp, summing to 10000; got {given}",
        )
    return None


def check_evidence_refs(decision: RefundDecision, evidence: Evidence) -> Violation | None:
    unknown = set(decision.evidence_refs) - evidence.refs
    if unknown:
        return Violation(
            Rule.EVIDENCE_REFS, "unknown evidence refs: " + ", ".join(sorted(unknown)),
        )
    if decision.decision in ("full_refund", "partial_refund") and not decision.evidence_refs:
        return Violation(Rule.EVIDENCE_REFS, "a refund must cite evidence")
    return None


def check_not_delivered(decision: RefundDecision, evidence: Evidence) -> Violation | None:
    if (
        decision.reason_code in ("late_delivery", "quality")
        and evidence.order.status != OrderStatus.DELIVERED
    ):
        return Violation(
            Rule.NOT_DELIVERED,
            f"{decision.reason_code} needs a delivered order; order is {evidence.order.status}",
        )
    return None


def check_repeat_complaint(evidence: Evidence, config: PolicyConfig) -> Violation | None:
    if evidence.prior_complaints_in_7_days >= config.repeat_complaint_limit - 1:
        return Violation(
            Rule.REPEAT_COMPLAINT,
            f"complaint {evidence.prior_complaints_in_7_days + 1} within 7 days; "
            f"limit is {config.repeat_complaint_limit}",
        )
    return None


def evaluate(
    decision: RefundDecision, evidence: Evidence, config: PolicyConfig = PolicyConfig(),
) -> PolicyVerdict:
    if decision.decision == "escalate":
        return PolicyVerdict("escalate", decision, ())

    checks: list[Violation | None] = []
    if decision.decision in ("full_refund", "partial_refund"):
        checks.extend((
            check_refundable_amount(decision, evidence),
            check_reason_cap(decision, evidence, config),
            check_liability_split(decision),
            check_evidence_refs(decision, evidence),
            check_not_delivered(decision, evidence),
            check_repeat_complaint(evidence, config),
        ))
    else:
        checks.extend((
            check_evidence_refs(decision, evidence),
            check_repeat_complaint(evidence, config),
        ))
    violations = tuple(violation for violation in checks if violation is not None)
    outcome = "escalate" if violations else "reject" if decision.decision == "reject" else "propose"
    return PolicyVerdict(outcome, decision, violations)
