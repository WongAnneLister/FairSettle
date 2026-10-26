import ast
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from fairsettle_agent.decision import RefundDecision
from fairsettle_agent.clients.models import (
    OrderStatus, RefundableAmount, RefundControlState,
)
from fairsettle_agent.evidence import (
    order_event_ref, order_item_ref, order_ref, payment_ref, refundable_ref,
)
from fairsettle_agent.policy import (
    PolicyConfig,
    Rule,
    check_evidence_refs,
    check_liability_split,
    check_not_delivered,
    check_reason_cap,
    check_refundable_amount,
    check_repeat_complaint,
    evaluate,
    reason_cap_cents,
)
from policy_factory import (
    PAYMENT_ID, make_decision, make_evidence, make_order, make_refundable,
    make_timeline,
)


def default_json_fields():
    return {
        "decision": "partial_refund",
        "amount_cents": 450,
        "reason_code": "missing_item",
        "liability": [
            {"party": "restaurant", "basis_points": 10000},
            {"party": "driver", "basis_points": 0},
            {"party": "platform", "basis_points": 0},
        ],
        "explanation": "The drink on order line 11 was not delivered.",
        "evidence_refs": ["order:1", "order-item:11"],
    }


def test_decision_parses_from_model_json():
    parsed = RefundDecision.model_validate_json(json.dumps(default_json_fields()))
    assert parsed == make_decision()


def test_decision_schema_is_strict():
    cases = []
    for value in (450.0, "450", True):
        cases.append({**default_json_fields(), "amount_cents": value})
    cases.extend([
        {**default_json_fields(), "note": "An unknown field"},
        {**default_json_fields(), "decision": "refund"},
    ])
    party = default_json_fields()
    party["liability"][0]["party"] = "courier"
    cases.append(party)
    points = default_json_fields()
    points["liability"][0]["basis_points"] = "10000"
    cases.append(points)
    for explanation in ("", "x" * 2001):
        cases.append({**default_json_fields(), "explanation": explanation})
    for refs in ([""], ["x" * 129], ["order:1"] * 51):
        cases.append({**default_json_fields(), "evidence_refs": refs})
    for fields in cases:
        with pytest.raises(ValidationError):
            RefundDecision.model_validate_json(json.dumps(fields))


def test_decision_shape_by_kind():
    for overrides in (
        {"decision": "reject", "amount_cents": 450, "liability": ()},
        {"decision": "escalate", "amount_cents": 0},
        {"decision": "partial_refund", "amount_cents": 0},
    ):
        with pytest.raises(ValidationError):
            make_decision(**overrides)
    rejected = make_decision(
        decision="reject", amount_cents=0, liability=(), evidence_refs=(),
    )
    escalated = make_decision(decision="escalate", amount_cents=0, liability=())
    assert rejected.decision == "reject"
    assert escalated.decision == "escalate"


def test_evidence_refs_cover_every_part():
    evidence = make_evidence()
    assert evidence.refs == frozenset({
        "order:1", "order-item:11", "order-item:12",
        "order-event:101", "order-event:102", "order-event:103",
        f"payment:{PAYMENT_ID}", f"refundable:{PAYMENT_ID}",
    })
    assert order_ref(1) == "order:1"
    assert order_item_ref(11) == "order-item:11"
    assert order_event_ref(101) == "order-event:101"
    assert payment_ref(PAYMENT_ID) == f"payment:{PAYMENT_ID}"
    assert refundable_ref(PAYMENT_ID) == f"refundable:{PAYMENT_ID}"
    assert evidence.item("order-item:11") is evidence.order.items[0]
    assert evidence.item("order-item:99") is None
    assert evidence.item("Order-item:11") is None


def test_evidence_rejects_mismatched_parts():
    another_id = "pay_01HZX9K2M4N6P8Q0R2S4T6V8W1"
    euro = RefundableAmount(**{**make_refundable().model_dump(), "currency": "EUR"})
    for overrides in (
        {"timeline": make_timeline(2)},
        {"order": make_order(ledger_payment_id=another_id)},
        {"refundable": make_refundable(payment_id=another_id)},
        {"refundable": euro},
        {"prior_complaints": -1},
        {"prior_complaints": True},
    ):
        with pytest.raises(ValueError):
            make_evidence(**overrides)


def test_rule1_amount_over_refundable_fails():
    evidence = make_evidence(refundable=make_refundable(captured=1250, refunded=1000))
    violation = check_refundable_amount(make_decision(), evidence)
    assert violation.rule == Rule.REFUNDABLE_AMOUNT
    assert violation.message == "amount 450 exceeds refundable 250"


def test_rule1_amount_equal_to_refundable_passes():
    evidence = make_evidence(
        refundable=make_refundable(captured=1250, refunded=500, reserved=300),
    )
    assert check_refundable_amount(make_decision(), evidence) is None


def test_rule1_blocked_payment_refunds_nothing():
    blocked = RefundableAmount(**{
        **make_refundable().model_dump(),
        "control_state": RefundControlState.DISPUTE_BLOCKED,
        "refundable_minor": 0,
    })
    violation = check_refundable_amount(
        make_decision(amount_cents=1), make_evidence(refundable=blocked),
    )
    assert violation.rule == Rule.REFUNDABLE_AMOUNT
    assert violation.message == "amount 1 exceeds refundable 0"


def test_rule2_missing_item_capped_at_cited_lines():
    decision = make_decision(amount_cents=451)
    evidence = make_evidence()
    assert reason_cap_cents(decision, evidence, PolicyConfig()) == 450
    violation = check_reason_cap(decision, evidence, PolicyConfig())
    assert violation.rule == Rule.REASON_CAP
    assert violation.message == "amount 451 exceeds the missing_item cap 450"


def test_rule2_two_cited_lines_add_up():
    decision = make_decision(
        amount_cents=1250,
        evidence_refs=("order-item:11", "order-item:12", "order-item:11"),
    )
    evidence = make_evidence()
    assert reason_cap_cents(decision, evidence, PolicyConfig()) == 1250
    assert check_reason_cap(decision, evidence, PolicyConfig()) is None


def test_rule2_item_reason_without_cited_line_has_no_cap():
    decision = make_decision(
        reason_code="wrong_item", amount_cents=100, evidence_refs=("order:1",),
    )
    evidence = make_evidence()
    assert reason_cap_cents(decision, evidence, PolicyConfig()) == 0
    violation = check_reason_cap(decision, evidence, PolicyConfig())
    assert violation.rule == Rule.REASON_CAP
    assert violation.message == "amount 100 exceeds the wrong_item cap 0"


def test_rule2_late_delivery_capped_at_delivery_fee():
    evidence = make_evidence()
    over = make_decision(reason_code="late_delivery", amount_cents=300)
    violation = check_reason_cap(over, evidence, PolicyConfig())
    assert violation.rule == Rule.REASON_CAP
    assert violation.message == "amount 300 exceeds the late_delivery cap 299"
    assert check_reason_cap(
        make_decision(reason_code="late_delivery", amount_cents=299),
        evidence, PolicyConfig(),
    ) is None
    assert check_reason_cap(over, evidence, PolicyConfig(delivery_fee_cents=350)) is None


def test_rule2_quality_capped_at_twenty_percent():
    evidence = make_evidence()
    decision = make_decision(reason_code="quality", amount_cents=251)
    assert reason_cap_cents(decision, evidence, PolicyConfig()) == 250
    violation = check_reason_cap(decision, evidence, PolicyConfig())
    assert violation.rule == Rule.REASON_CAP
    assert violation.message == "amount 251 exceeds the quality cap 250"
    assert check_reason_cap(
        make_decision(reason_code="quality", amount_cents=250), evidence, PolicyConfig(),
    ) is None
    assert reason_cap_cents(
        decision, make_evidence(order=make_order(total_cents=1249)), PolicyConfig(),
    ) == 249


def test_rule2_delivery_failed_capped_at_order_total():
    evidence = make_evidence()
    decision = make_decision(reason_code="delivery_failed", amount_cents=1250)
    assert check_reason_cap(decision, evidence, PolicyConfig()) is None
    violation = check_reason_cap(
        make_decision(reason_code="delivery_failed", amount_cents=1251),
        evidence, PolicyConfig(),
    )
    assert violation.rule == Rule.REASON_CAP
    assert violation.message == "amount 1251 exceeds the delivery_failed cap 1250"
    null_total = make_evidence(order=make_order(total_cents=None))
    violation = check_reason_cap(
        make_decision(reason_code="delivery_failed", amount_cents=1),
        null_total, PolicyConfig(),
    )
    assert violation.rule == Rule.REASON_CAP
    assert violation.message == "amount 1 exceeds the delivery_failed cap 0"


def test_rule2_other_reason_never_refunds():
    decision = make_decision(reason_code="other", amount_cents=1)
    evidence = make_evidence()
    assert reason_cap_cents(decision, evidence, PolicyConfig()) == 0
    violation = check_reason_cap(decision, evidence, PolicyConfig())
    assert violation.rule == Rule.REASON_CAP
    assert violation.message == "amount 1 exceeds the other cap 0"


def test_rule3_split_must_sum_to_10000():
    decision = make_decision(
        liability=(("restaurant", 5000), ("driver", 4000), ("platform", 0)),
    )
    violation = check_liability_split(decision)
    assert violation.rule == Rule.LIABILITY_SPLIT
    assert violation.message == (
        "liability must be restaurant, driver and platform once each, "
        "0–10000 bp, summing to 10000; got restaurant=5000, driver=4000, platform=0"
    )


def test_rule3_parties_exactly_once():
    for shares in (
        (("restaurant", 5000), ("restaurant", 5000), ("platform", 0)),
        (("restaurant", 5000), ("driver", 5000)),
        (("restaurant", 5000), ("driver", 5000), ("platform", 0), ("platform", 0)),
    ):
        violation = check_liability_split(make_decision(liability=shares))
        assert violation.rule == Rule.LIABILITY_SPLIT
        assert violation.message == (
            "liability must be restaurant, driver and platform once each, "
            "0–10000 bp, summing to 10000; got "
            + ", ".join(f"{party}={points}" for party, points in shares)
        )


def test_rule3_shares_within_range():
    violation = check_liability_split(make_decision(
        liability=(("restaurant", 12000), ("driver", -2000), ("platform", 0)),
    ))
    assert violation.rule == Rule.LIABILITY_SPLIT
    assert violation.message == (
        "liability must be restaurant, driver and platform once each, "
        "0–10000 bp, summing to 10000; got restaurant=12000, driver=-2000, platform=0"
    )


def test_rule3_valid_splits_pass():
    for shares in (
        (("restaurant", 10000), ("driver", 0), ("platform", 0)),
        (("restaurant", 0), ("driver", 0), ("platform", 10000)),
        (("platform", 5000), ("restaurant", 5000), ("driver", 0)),
    ):
        assert check_liability_split(make_decision(liability=shares)) is None


def test_rule4_unknown_ref_fails():
    decision = make_decision(evidence_refs=("order:1", "order-item:99", "Order:1"))
    violation = check_evidence_refs(decision, make_evidence())
    assert violation.rule == Rule.EVIDENCE_REFS
    assert violation.message == "unknown evidence refs: Order:1, order-item:99"


def test_rule4_refund_needs_a_ref_and_reject_does_not():
    evidence = make_evidence()
    violation = check_evidence_refs(make_decision(evidence_refs=()), evidence)
    assert violation.rule == Rule.EVIDENCE_REFS
    assert violation.message == "a refund must cite evidence"
    assert check_evidence_refs(make_decision(
        decision="reject", amount_cents=0, liability=(), evidence_refs=(),
    ), evidence) is None
    violation = check_evidence_refs(make_decision(
        decision="reject", amount_cents=0, liability=(), evidence_refs=("order-item:99",),
    ), evidence)
    assert violation.rule == Rule.EVIDENCE_REFS
    assert violation.message == "unknown evidence refs: order-item:99"


def test_rule5_late_or_quality_needs_delivery():
    evidence = make_evidence(order=make_order(status=OrderStatus.PICKED_UP))
    for reason in ("late_delivery", "quality"):
        violation = check_not_delivered(make_decision(reason_code=reason), evidence)
        assert violation.rule == Rule.NOT_DELIVERED
        assert violation.message == f"{reason} needs a delivered order; order is PickedUp"
    assert check_not_delivered(make_decision(), evidence) is None
    assert check_not_delivered(
        make_decision(reason_code="late_delivery"), make_evidence(),
    ) is None


def test_rule6_third_complaint_in_seven_days():
    assert check_repeat_complaint(make_evidence(prior_complaints=1), PolicyConfig()) is None
    for prior, current in ((2, 3), (5, 6)):
        violation = check_repeat_complaint(
            make_evidence(prior_complaints=prior), PolicyConfig(),
        )
        assert violation.rule == Rule.REPEAT_COMPLAINT
        assert violation.message == f"complaint {current} within 7 days; limit is 3"


def test_passing_refund_is_proposed_unchanged():
    decision = make_decision()
    verdict = evaluate(decision, make_evidence())
    assert verdict.outcome == "propose"
    assert verdict.violations == ()
    assert verdict.decision is decision


def test_any_violation_escalates_without_trimming():
    decision = make_decision(amount_cents=900)
    evidence = make_evidence(refundable=make_refundable(refunded=650))
    verdict = evaluate(decision, evidence)
    assert verdict.outcome == "escalate"
    assert tuple(v.rule for v in verdict.violations) == (
        Rule.REFUNDABLE_AMOUNT, Rule.REASON_CAP,
    )
    assert verdict.decision is decision
    assert verdict.decision.amount_cents == 900


def test_every_failing_rule_is_reported_in_order():
    decision = make_decision(
        reason_code="late_delivery", amount_cents=2000,
        liability=(("restaurant", 5000), ("driver", 5000), ("platform", 5000)),
        evidence_refs=("nope",),
    )
    evidence = make_evidence(
        order=make_order(status=OrderStatus.PICKED_UP), prior_complaints=2,
    )
    verdict = evaluate(decision, evidence)
    assert verdict.outcome == "escalate"
    assert tuple(v.rule for v in verdict.violations) == (
        Rule.REFUNDABLE_AMOUNT, Rule.REASON_CAP, Rule.LIABILITY_SPLIT,
        Rule.EVIDENCE_REFS, Rule.NOT_DELIVERED, Rule.REPEAT_COMPLAINT,
    )


@pytest.mark.parametrize(
    "scenario, outcome, rules",
    [
        (1, "propose", ()),
        (2, "propose", ()),
        (3, "propose", ()),
        (4, "reject", ()),
        (5, "escalate", (Rule.REFUNDABLE_AMOUNT,)),
        (6, "escalate", (Rule.NOT_DELIVERED,)),
        (7, "escalate", (Rule.REFUNDABLE_AMOUNT, Rule.REASON_CAP)),
        (8, "escalate", (Rule.REPEAT_COMPLAINT,)),
        (10, "propose", ()),
    ],
)
def test_prd_scenarios(scenario, outcome, rules):
    evidence = make_evidence()
    if scenario in (1, 2):
        shares = (
            (("restaurant", 0), ("driver", 0), ("platform", 10000))
            if scenario == 1 else
            (("restaurant", 0), ("driver", 10000), ("platform", 0))
        )
        decision = make_decision(
            reason_code="late_delivery", amount_cents=299,
            liability=shares, evidence_refs=("order-event:103",),
        )
    elif scenario == 3:
        decision = make_decision()
    elif scenario == 4:
        decision = make_decision(
            decision="reject", amount_cents=0, liability=(), evidence_refs=("order:1",),
        )
    elif scenario == 5:
        decision = make_decision()
        evidence = make_evidence(refundable=make_refundable(refunded=1250))
    elif scenario == 6:
        decision = make_decision(reason_code="late_delivery", amount_cents=299)
        evidence = make_evidence(order=make_order(status=OrderStatus.PICKED_UP))
    elif scenario == 7:
        decision = make_decision(amount_cents=50000)
    elif scenario == 8:
        decision = make_decision()
        evidence = make_evidence(prior_complaints=2)
    else:
        assert scenario == 10
        decision = make_decision(
            decision="full_refund", reason_code="delivery_failed", amount_cents=1250,
            liability=(("restaurant", 0), ("driver", 10000), ("platform", 0)),
            evidence_refs=("order-event:103",),
        )
    verdict = evaluate(decision, evidence)
    assert verdict.outcome == outcome
    assert tuple(v.rule for v in verdict.violations) == rules
    assert verdict.decision is decision


def test_model_escalate_skips_the_rules():
    decision = make_decision(
        decision="escalate", amount_cents=0, liability=(), evidence_refs=("nope",),
    )
    verdict = evaluate(decision, make_evidence(prior_complaints=9))
    assert verdict.outcome == "escalate"
    assert verdict.violations == ()
    assert verdict.decision is decision


def test_reject_with_repeat_complaint_escalates():
    decision = make_decision(
        decision="reject", amount_cents=0, liability=(), evidence_refs=("order:1",),
    )
    verdict = evaluate(decision, make_evidence(prior_complaints=2))
    assert verdict.outcome == "escalate"
    assert tuple(v.rule for v in verdict.violations) == (Rule.REPEAT_COMPLAINT,)


def test_policy_is_pure():
    package = Path(__file__).resolve().parents[1] / "fairsettle_agent"
    forbidden = {
        "httpx", "os", "time", "datetime", "random", "logging", "socket", "asyncio",
        "fairsettle_agent.clients.dispatch", "fairsettle_agent.clients.ledger",
        "fairsettle_agent.clients.replay",
    }
    for module in ("decision", "evidence", "policy"):
        tree = ast.parse((package / f"{module}.py").read_text())
        for node in ast.walk(tree):
            imports = []
            if isinstance(node, ast.Import):
                imports = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                if node.level:
                    base = "fairsettle_agent." + base
                imports = [base] + [f"{base}.{alias.name}" for alias in node.names]
            for imported in imports:
                assert not any(
                    imported == banned or imported.startswith(banned + ".")
                    for banned in forbidden
                ), imported
            if module == "policy":
                assert not (isinstance(node, ast.Name) and node.id == "float")
                assert not (isinstance(node, ast.Constant) and isinstance(node.value, float))
    decision, evidence = make_decision(), make_evidence()
    before = decision.model_dump()
    first = evaluate(decision, evidence)
    second = evaluate(decision, evidence)
    assert first == second
    assert first.decision is decision and second.decision is decision
    assert decision.model_dump() == before
