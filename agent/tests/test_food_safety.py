import pytest
from pydantic import ValidationError

from fairsettle_agent.clients.models import OrderStatus
from fairsettle_agent.complaint import ComplaintInput
from fairsettle_agent.model import SYSTEM_PROMPT
from fairsettle_agent.policy import (
    PolicyConfig, Rule, check_not_delivered, check_reason_cap, evaluate, reason_cap_cents,
)
from fairsettle_agent.proposal import proposal_request
from fairsettle_agent.ui import COMPLAINT_TYPES

from policy_factory import make_decision, make_evidence, make_order


def test_food_safety_capped_at_order_total():
    evidence = make_evidence()
    assert check_reason_cap(
        make_decision(reason_code="food_safety", amount_cents=1250), evidence, PolicyConfig(),
    ) is None
    violation = check_reason_cap(
        make_decision(reason_code="food_safety", amount_cents=1251), evidence, PolicyConfig(),
    )
    assert violation.rule == Rule.REASON_CAP
    assert violation.message == "amount 1251 exceeds the food_safety cap 1250"
    assert reason_cap_cents(
        make_decision(reason_code="food_safety", amount_cents=1),
        make_evidence(order=make_order(total_cents=None)), PolicyConfig(),
    ) == 0


def test_food_safety_needs_delivery():
    picked_up = make_evidence(order=make_order(status=OrderStatus.PICKED_UP))
    violation = check_not_delivered(make_decision(reason_code="food_safety"), picked_up)
    assert violation.rule == Rule.NOT_DELIVERED
    assert violation.message == "food_safety needs a delivered order; order is PickedUp"
    assert check_not_delivered(make_decision(reason_code="food_safety"), make_evidence()) is None


def test_quality_cap_unchanged():
    decision = make_decision(reason_code="quality", amount_cents=1)
    assert reason_cap_cents(decision, make_evidence(), PolicyConfig()) == 250


def test_full_refund_proposes_to_ledger():
    evidence = make_evidence()
    decision = make_decision(
        decision="full_refund", reason_code="food_safety", amount_cents=1250, evidence_refs=("order:1",),
    )
    verdict = evaluate(decision, evidence)
    assert verdict.outcome == "propose"
    request = proposal_request(verdict, evidence, "c-1", "t-1")
    assert request.reason_code == "FOOD_SAFETY"
    assert request.amount_minor == 1250
    assert {share.party: share.basis_points for share in request.liability}["RESTAURANT"] == 10000


def test_prompt_describes_food_safety():
    assert '"food_safety"' in SYSTEM_PROMPT
    assert "Food safety: at most the order total." in SYSTEM_PROMPT
    assert "Late delivery, quality or food safety needs a delivered order." in SYSTEM_PROMPT
    assert "  - Food safety: the order total; restaurant 10000." in SYSTEM_PROMPT


def test_complaint_page_offers_food_safety():
    assert "food_safety" in COMPLAINT_TYPES
    assert ComplaintInput(
        complaint_id="ui-0000000000000001", order_id=7,
        complaint_type="food_safety", text="There was a dead mosquito in the soup.",
    ).complaint_type == "food_safety"
    with pytest.raises(ValidationError):
        ComplaintInput(
            complaint_id="ui-0000000000000002", order_id=7,
            complaint_type="contamination", text="Something was in the soup.",
        )
