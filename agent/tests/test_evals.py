import asyncio
from dataclasses import replace
from datetime import datetime, timezone
import json

import pytest

from decide_factory import MockCompletion, model_response
from fairsettle_agent.clients.models import DeliveryFailure, FailureReason
from fairsettle_agent.decision import LiabilityShare, RefundDecision
from fairsettle_agent.evidence import Evidence
from fairsettle_agent.gather import GatherFailure, gather
from fairsettle_agent.model import ModelConfig, SYSTEM_PROMPT, evidence_document
from fairsettle_agent.policy import PolicyConfig
from fairsettle_agent.proactive import complaint_for
from evals.scenarios import SCENARIOS
from evals.run import (
    FixtureDispatch, FixtureLedger, RunResult, counted_violations, is_correct, main, run_case,
)

KEY = "sk-test-" + "k" * 32
GENERATED = datetime(2026, 10, 27, 14, 0, tzinfo=timezone.utc)
EXPLANATION = "Synthetic explanation that must never appear in a results file."
PRD_DEFAULTS = """- Default refund and liable party (PRD), when the evidence supports the complaint:
  - Late delivery after slow dispatch (Cooked to PickedUp took longer than policy slowDispatchMinutes): the delivery fee; platform 10000.
  - Late delivery after slow delivery (PickedUp to Delivered took longer than policy slowDeliveryMinutes): the delivery fee; driver 10000.
  - Missing or wrong item: the cited item's price; restaurant 10000.
  - Quality: at most the quality cap; restaurant 5000, platform 5000.
  - Delivery failed: the order total; the party named by failureReason."""


def decision_for(scenario, *, reject=False):
    expected = scenario.expected
    if reject or scenario.prd in (4, 5, 6, 8):
        return RefundDecision(
            decision="reject" if reject or scenario.prd in (4, 5) else "escalate",
            amount_cents=0, reason_code="other", liability=(),
            explanation=EXPLANATION, evidence_refs=(),
        )
    ref = (
        f"order-item:{scenario.prd * 10 + 2}"
        if expected.reason_code == "missing_item" else f"order-event:{scenario.prd * 100 + 6}"
    )
    return RefundDecision(
        decision=expected.decision, amount_cents=expected.amount_cents, reason_code=expected.reason_code,
        liability=tuple(LiabilityShare(party=party, basis_points=10000 if party == expected.liable_party else 0)
                        for party in ("restaurant", "driver", "platform")),
        explanation=EXPLANATION, evidence_refs=(ref,),
    )


def result_for(scenario, **changes):
    result = RunResult(scenario.id, 1, "propose", "policy", None, decision_for(scenario), (), 0, 10, 20)
    return replace(result, **changes)


class FakeCompletion:
    def __init__(self, *, reject=False, violate=False):
        self.reject = reject
        self.violate = violate
        self.calls = []

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if "tools" in kwargs:
            return model_response("DONE")
        message = kwargs["messages"][1]["content"]
        document = json.loads(message.split("<<<EVIDENCE>>>\n")[1].split("\n<<<END EVIDENCE>>>")[0])
        matches = [s for s in SCENARIOS if s.complaint.text in message and document["order"]["ref"] == f"order:{s.order.id}"]
        assert len(matches) == 1
        scenario = matches[0]
        decision = decision_for(scenario, reject=self.reject)
        if self.violate and scenario.prd == 7:
            decision = decision.model_copy(update={"amount_cents": 50000})
        return model_response(decision.model_dump_json())


def test_ten_scenarios_in_prd_order():
    assert [s.prd for s in SCENARIOS] == list(range(1, 11))
    assert [s.id for s in SCENARIOS] == [f"s{n:02d}" for n in range(1, 11)]
    assert len({s.id for s in SCENARIOS}) == 10
    assert len({s.complaint.complaint_id for s in SCENARIOS}) == 10
    assert SCENARIOS[9].complaint == complaint_for(DeliveryFailure(
        event_id=1006, order_id=10, failure_reason=FailureReason.DRIVER_FAULT,
        occurred_at=datetime(2026, 10, 27, 12, 50, tzinfo=timezone.utc),
    ))


def test_fixtures_gather_as_planned():
    async def run():
        for scenario in SCENARIOS:
            complaint = scenario.complaint.to_complaint(scenario.prior_complaints_in_7_days)
            evidence = await gather(complaint, FixtureDispatch(scenario), FixtureLedger(scenario))
            if scenario.prd == 9:
                assert isinstance(evidence, GatherFailure) and evidence.reason == "payment_unconfirmed"
            else:
                assert isinstance(evidence, Evidence)
                assert Evidence(scenario.order, scenario.timeline, scenario.payment, scenario.refundable,
                                scenario.prior_complaints_in_7_days) == evidence
    asyncio.run(run())


def test_is_correct():
    scenario = SCENARIOS[0]
    correct = result_for(scenario)
    assert is_correct(scenario.expected, correct)
    for changes in (
        {"amount_cents": 298},
        {"liability": tuple(LiabilityShare(party=party, basis_points=10000 if party == "driver" else 0)
                            for party in ("restaurant", "driver", "platform"))},
        {"reason_code": "missing_item"},
    ):
        assert not is_correct(scenario.expected, replace(correct, decision=correct.decision.model_copy(update=changes)))
    assert not is_correct(scenario.expected, replace(correct, rules=("reason_cap",)))
    for outcome in ("reject", "escalate"):
        result = replace(correct, scenario="s06", outcome=outcome, decision=None)
        assert is_correct(SCENARIOS[5].expected, result)
    failure = replace(correct, scenario="s06", outcome="escalate", stage="decide", reason="model_unavailable", decision=None)
    assert not is_correct(SCENARIOS[5].expected, failure)
    unconfirmed = replace(failure, scenario="s09", stage="gather", reason="payment_unconfirmed")
    assert is_correct(SCENARIOS[8].expected, unconfirmed)
    assert not is_correct(SCENARIOS[8].expected, replace(unconfirmed, reason="no_payment"))


def test_counted_violations_skip_repeat_complaint():
    result = result_for(SCENARIOS[0], rules=("repeat_complaint",))
    assert counted_violations(result) == ()
    assert counted_violations(replace(result, rules=("reason_cap", "repeat_complaint"))) == ("reason_cap",)


def test_run_case_runs_investigate_then_decide():
    scenario = SCENARIOS[2]
    complete = MockCompletion(["DONE", decision_for(scenario).model_dump_json()])
    result = asyncio.run(run_case(scenario, 1, ModelConfig(api_key=KEY), PolicyConfig(), complete))
    assert result.outcome == "propose" and result.stage == "policy" and result.steps == 0
    assert is_correct(scenario.expected, result)
    assert len(complete.calls) == 2
    assert "tools" in complete.calls[0] and "response_format" in complete.calls[1]


def test_payment_unconfirmed_never_calls_the_model():
    complete = MockCompletion([])
    result = asyncio.run(run_case(SCENARIOS[8], 1, ModelConfig(api_key=KEY), PolicyConfig(), complete))
    assert result.outcome == "escalate" and result.stage == "gather" and result.reason == "payment_unconfirmed"
    assert result.decision is None and result.rules == () and result.steps == 0
    assert result.prompt_tokens == 0 and result.completion_tokens == 0
    assert complete.calls == []


def test_main_writes_results_and_passes(tmp_path):
    output = tmp_path / "r.md"
    assert main(["--runs", "2", "--assert-zero-violations", "--min-accuracy", "0.9", "--out", str(output)],
                env={"DEEPSEEK_API_KEY": KEY}, complete=FakeCompletion(), now=lambda: GENERATED) == 0
    text = output.read_text()
    assert text.startswith("# Evaluation results (F27)")
    assert "Accuracy: 20/20 (1.00)" in text and "Violations: 0/20" in text


def test_main_fails_on_low_accuracy_and_still_writes(tmp_path):
    output = tmp_path / "r.md"
    assert main(["--runs", "1", "--min-accuracy", "0.9", "--out", str(output)],
                env={"DEEPSEEK_API_KEY": KEY}, complete=FakeCompletion(reject=True), now=lambda: GENERATED) == 1
    assert output.exists()
    assert "## Misses\n\n- s01 run 1:" in output.read_text()


def test_main_fails_on_violations(tmp_path):
    output = tmp_path / "r.md"
    assert main(["--runs", "1", "--assert-zero-violations", "--out", str(output)],
                env={"DEEPSEEK_API_KEY": KEY}, complete=FakeCompletion(violate=True), now=lambda: GENERATED) == 1
    assert "Violations: 1/10" in output.read_text()


def test_main_needs_a_key(tmp_path):
    output = tmp_path / "r.md"
    complete = FakeCompletion()
    assert main(["--runs", "1", "--out", str(output)], env={}, complete=complete) == 2
    assert not output.exists() and complete.calls == []


def test_results_hold_no_text_or_key(tmp_path):
    output = tmp_path / "r.md"
    assert main(["--runs", "2", "--assert-zero-violations", "--min-accuracy", "0.9", "--out", str(output)],
                env={"DEEPSEEK_API_KEY": KEY}, complete=FakeCompletion(), now=lambda: GENERATED) == 0
    text = output.read_text()
    for scenario in SCENARIOS:
        assert scenario.complaint.text not in text
    assert "sk-test-" not in text and EXPLANATION not in text


def test_prompt_and_policy_carry_the_prd_defaults():
    policy = PolicyConfig()
    assert policy.slow_dispatch_minutes == 20 and policy.slow_delivery_minutes == 30
    with pytest.raises(ValueError, match="^slow_dispatch_minutes must be an integer from 1 to 240$"):
        PolicyConfig(slow_dispatch_minutes=0)
    with pytest.raises(ValueError, match="^slow_delivery_minutes must be an integer from 1 to 240$"):
        PolicyConfig(slow_delivery_minutes=241)
    scenario = SCENARIOS[0]
    evidence = Evidence(scenario.order, scenario.timeline, scenario.payment, scenario.refundable, 0)
    document = evidence_document(evidence, policy)["policy"]
    assert document["slowDispatchMinutes"] == 20 and document["slowDeliveryMinutes"] == 30
    assert PRD_DEFAULTS in SYSTEM_PROMPT
