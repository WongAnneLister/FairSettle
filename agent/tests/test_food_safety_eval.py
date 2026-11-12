import asyncio

import pytest

from decide_factory import model_response
from fairsettle_agent.clients.models import OrderStatus
from fairsettle_agent.decision import LiabilityShare, RefundDecision
from fairsettle_agent.evidence import Evidence
from fairsettle_agent.gather import gather
from fairsettle_agent.model import SYSTEM_PROMPT
from evals.food_safety import COMPLAINT_TEXT, FOOD_SAFETY, main
from evals.run import FixtureDispatch, FixtureLedger
from evals.scenarios import SCENARIOS

KEY = "sk-test-" + "k" * 32
EXPLANATION = "Synthetic explanation that must never appear in the output."
DEFINITION = (
    "- Food safety means a foreign object such as an insect, hair or glass, or contamination; "
    "poor taste or temperature is quality."
)
NEW_LINE = (
    "- Food safety is decided on the customer's own report: no photo, inspection or chat reaches you, "
    "so their absence is no reason to escalate. On a delivered order the report supports the complaint "
    "unless the order, timeline or payment contradicts it; cite the order and the Delivered event."
)


def decision_json(decision="full_refund", amount_cents=1500, party="restaurant",
                  refs=("order:3", "order-event:306")):
    refund = decision != "escalate"
    return RefundDecision(
        decision=decision, amount_cents=amount_cents if refund else 0, reason_code="food_safety",
        liability=tuple(LiabilityShare(party=p, basis_points=10000 if p == party else 0)
                        for p in ("restaurant", "driver", "platform")) if refund else (),
        explanation=EXPLANATION, evidence_refs=refs if refund else (),
    ).model_dump_json()


class FoodSafetyCompletion:
    def __init__(self, reply):
        self.reply = reply
        self.calls = []

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if "tools" in kwargs:
            return model_response("DONE")
        return model_response(self.reply)


def test_prompt_decides_food_safety_on_the_report():
    lines = SYSTEM_PROMPT.splitlines()
    assert NEW_LINE in lines
    assert lines[lines.index(DEFINITION) + 1] == NEW_LINE


def test_fixture_is_a_clean_delivered_order():
    assert FOOD_SAFETY.order.status == OrderStatus.DELIVERED
    assert FOOD_SAFETY.order.total_cents == 1500
    assert FOOD_SAFETY.complaint.complaint_type == "food_safety"
    assert FOOD_SAFETY.prior_complaints_in_7_days == 0
    assert FOOD_SAFETY.history == ()
    assert "photo" not in COMPLAINT_TEXT.lower()
    evidence = asyncio.run(gather(
        FOOD_SAFETY.complaint.to_complaint(0), FixtureDispatch(FOOD_SAFETY), FixtureLedger(FOOD_SAFETY),
    ))
    assert isinstance(evidence, Evidence)


def test_prd_scenarios_unchanged():
    assert len(SCENARIOS) == 10
    assert [s.id for s in SCENARIOS] == [f"s{n:02d}" for n in range(1, 11)]
    assert "fs01" not in {s.id for s in SCENARIOS}


def test_passes_when_every_run_proposes_the_default(capsys):
    fake = FoodSafetyCompletion(decision_json())
    assert main(["--runs", "3"], env={"DEEPSEEK_API_KEY": KEY}, complete=fake) == 0
    out = capsys.readouterr().out
    for run in (1, 2, 3):
        assert f"run {run}: propose full_refund food_safety 1500 restaurant" in out
    assert "correct: 3/3" in out


def test_fails_when_the_model_escalates(capsys):
    fake = FoodSafetyCompletion(decision_json(decision="escalate"))
    assert main(["--runs", "3"], env={"DEEPSEEK_API_KEY": KEY}, complete=fake) == 1
    assert "correct: 0/3" in capsys.readouterr().out


def test_fails_on_a_policy_violation(capsys):
    fake = FoodSafetyCompletion(decision_json(amount_cents=1501))
    assert main(["--runs", "1"], env={"DEEPSEEK_API_KEY": KEY}, complete=fake) == 1
    out = capsys.readouterr().out
    assert "violations refundable_amount,reason_cap" in out
    assert "correct: 0/1" in out


def test_fails_when_another_party_pays(capsys):
    fake = FoodSafetyCompletion(decision_json(party="platform"))
    assert main(["--runs", "1"], env={"DEEPSEEK_API_KEY": KEY}, complete=fake) == 1
    assert "correct: 0/1" in capsys.readouterr().out


def test_needs_a_key(capsys):
    fake = FoodSafetyCompletion(decision_json())
    assert main([], env={}, complete=fake) == 2
    assert "DEEPSEEK_API_KEY is required" in capsys.readouterr().err
    assert fake.calls == []


def test_rejects_zero_runs():
    fake = FoodSafetyCompletion(decision_json())
    with pytest.raises(SystemExit) as raised:
        main(["--runs", "0"], env={"DEEPSEEK_API_KEY": KEY}, complete=fake)
    assert raised.value.code == 2
    assert fake.calls == []


def test_output_holds_no_text_or_key(capsys):
    fake = FoodSafetyCompletion(decision_json())
    assert main(["--runs", "1"], env={"DEEPSEEK_API_KEY": KEY}, complete=fake) == 0
    captured = capsys.readouterr()
    for text in (captured.out, captured.err):
        for secret in (COMPLAINT_TEXT, EXPLANATION, "order-event:306", KEY):
            assert secret not in text
