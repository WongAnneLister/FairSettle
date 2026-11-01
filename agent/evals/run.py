import os
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

import argparse
import asyncio
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import sys

import litellm

from fairsettle_agent.decide import Completion, Escalation, decide
from fairsettle_agent.decision import RefundDecision
from fairsettle_agent.gather import GatherFailure, gather
from fairsettle_agent.investigate import investigate
from fairsettle_agent.model import ModelConfig
from fairsettle_agent.policy import PolicyConfig, Rule
from .scenarios import Expected, SCENARIOS, Scenario

COUNTED_RULES = frozenset({Rule.REFUNDABLE_AMOUNT, Rule.REASON_CAP, Rule.LIABILITY_SPLIT,
                           Rule.EVIDENCE_REFS, Rule.NOT_DELIVERED})
EVAL_MODEL = "deepseek/deepseek-v4-pro"


@dataclass(frozen=True)
class RunResult:
    scenario: str
    run: int
    outcome: str
    stage: str
    reason: str | None
    decision: RefundDecision | None
    rules: tuple[str, ...]
    steps: int
    prompt_tokens: int
    completion_tokens: int


class FixtureDispatch:
    def __init__(self, scenario: Scenario):
        self.scenario = scenario

    async def get_order(self, order_id):
        return self.scenario.order

    async def get_timeline(self, order_id):
        return self.scenario.timeline


class FixtureLedger:
    def __init__(self, scenario: Scenario):
        self.scenario = scenario

    async def get_payment(self, payment_id):
        return self.scenario.payment

    async def get_refundable(self, payment_id):
        return self.scenario.refundable


class FixtureHistory:
    def __init__(self, scenario: Scenario):
        self.scenario = scenario

    async def history(self, customer_id, complaint_id, received_at, *, days, limit):
        rows = sorted(self.scenario.history, key=lambda row: row.complaint_id)
        return sorted(rows, key=lambda row: row.received_at, reverse=True)[:limit]


async def run_case(scenario: Scenario, run: int, model: ModelConfig, policy: PolicyConfig,
                   complete: Completion) -> RunResult:
    complaint = scenario.complaint.to_complaint(scenario.prior_complaints_in_7_days)
    dispatch, ledger = FixtureDispatch(scenario), FixtureLedger(scenario)
    evidence = await gather(complaint, dispatch, ledger)
    if isinstance(evidence, GatherFailure):
        return RunResult(scenario.id, run, "escalate", "gather", evidence.reason, None, (), 0, 0, 0)
    investigation = await investigate(
        complaint, scenario.complaint.complaint_id, scenario.received_at, evidence,
        model, policy, dispatch, ledger, FixtureHistory(scenario), complete,
    )
    outcome, attempts, pt, ct = await decide(
        complaint, evidence, model, policy, complete, investigation=investigation,
    )
    pt += investigation.prompt_tokens
    ct += investigation.completion_tokens
    if isinstance(outcome, Escalation):
        return RunResult(scenario.id, run, "escalate", "decide", outcome.reason, None, (), investigation.steps, pt, ct)
    return RunResult(
        scenario.id, run, outcome.outcome, "policy", None, outcome.decision,
        tuple(v.rule.value for v in outcome.violations), investigation.steps, pt, ct,
    )


def counted_violations(result: RunResult) -> tuple[str, ...]:
    return tuple(rule for rule in result.rules if rule in COUNTED_RULES)


def is_correct(expected: Expected, result: RunResult) -> bool:
    if result.outcome not in expected.outcomes or result.stage == "decide":
        return False
    if expected.gather_reason is not None:
        return result.stage == "gather" and result.reason == expected.gather_reason
    if result.outcome == "propose" and expected.decision is not None:
        decision = result.decision
        return (
            decision is not None
            and decision.decision == expected.decision
            and decision.reason_code == expected.reason_code
            and decision.amount_cents == expected.amount_cents
            and [share.party for share in decision.liability if share.basis_points == 10000] == [expected.liable_party]
            and counted_violations(result) == ()
        )
    return True


def _party(result: RunResult) -> str | None:
    if result.decision is not None:
        return next((share.party for share in result.decision.liability if share.basis_points == 10000), None)
    return None


def _expected(expected: Expected) -> str:
    parts = []
    for outcome in sorted(expected.outcomes):
        if outcome == "propose" and expected.decision is not None:
            parts.append(f"propose {expected.decision} {expected.reason_code} {expected.amount_cents} {expected.liable_party}")
        else:
            parts.append(outcome)
    text = " or ".join(parts)
    if expected.gather_reason is not None:
        text += f" (gather: {expected.gather_reason})"
    return text


def _totals(results: list[RunResult]) -> tuple[int, int, float]:
    scenarios = {s.id: s for s in SCENARIOS}
    correct = sum(is_correct(scenarios[result.scenario].expected, result) for result in results)
    violations = sum(bool(counted_violations(result)) for result in results)
    return correct, violations, correct / len(results) if results else 0.0


def render(results: list[RunResult], model: str, runs: int, generated_at: datetime, commit: str) -> str:
    correct, violations, accuracy = _totals(results)
    lines = [
        "# Evaluation results (F27)", "",
        f"Generated: {generated_at.astimezone(timezone.utc).isoformat()} · Model: {model} · Runs per scenario: {runs} · Commit: {commit}",
        f"Accuracy: {correct}/{len(results)} ({accuracy:.2f}) · Violations: {violations}/{len(results)}",
        "", "## Scenarios", "",
        "| # | Scenario | Expected | Correct | Violations | Outcomes | Steps (avg) | Tokens (avg) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    misses = []
    for scenario in SCENARIOS:
        items = [result for result in results if result.scenario == scenario.id]
        count = len(items)
        passed = sum(is_correct(scenario.expected, result) for result in items)
        failed_rules = sum(bool(counted_violations(result)) for result in items)
        outcomes = ", ".join(
            f"propose {result.decision.amount_cents} {_party(result)}"
            if result.outcome == "propose" and result.decision is not None else result.outcome
            for result in items
        )
        steps = sum(result.steps for result in items) / count if count else 0.0
        tokens = sum(result.prompt_tokens + result.completion_tokens for result in items) / count if count else 0.0
        lines.append(f"| {scenario.prd} | {scenario.title} | {_expected(scenario.expected)} | {passed}/{count} | {failed_rules}/{count} | {outcomes} | {steps:.1f} | {tokens:.1f} |")
        for result in items:
            if is_correct(scenario.expected, result) and not counted_violations(result):
                continue
            text = f"- {result.scenario} run {result.run}: {result.outcome} [{result.stage}/{result.reason}]"
            if result.decision is not None:
                decision = result.decision
                text += f" [{decision.decision} {decision.reason_code} {decision.amount_cents} {_party(result)}]"
            if result.rules:
                text += f" [rules: {', '.join(result.rules)}]"
            misses.append(text)
    return "\n".join([*lines, "", "## Misses", "", *(misses or ["None."])]) + "\n"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def main(argv: list[str] | None = None, env: Mapping[str, str] = os.environ,
         complete: Completion = litellm.acompletion, now: Callable[[], datetime] = _utc_now) -> int:
    parser = argparse.ArgumentParser(description="Evaluate the ten PRD scenarios from fixtures.")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--assert-zero-violations", action="store_true")
    parser.add_argument("--min-accuracy", type=float)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.runs < 1:
        parser.error("--runs must be at least 1")
    if args.min_accuracy is not None and not 0 <= args.min_accuracy <= 1:
        parser.error("--min-accuracy must be from 0 to 1")
    api_key = env.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("DEEPSEEK_API_KEY is required", file=sys.stderr)
        return 2
    try:
        model = ModelConfig(model=env.get("FAIRSETTLE_MODEL", EVAL_MODEL), api_key=api_key)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2

    async def run_all():
        policy = PolicyConfig()
        results = []
        for scenario in SCENARIOS:
            for run in range(1, args.runs + 1):
                results.append(await run_case(scenario, run, model, policy, complete))
        return results

    results = asyncio.run(run_all())
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=Path(__file__).resolve().parents[2],
            text=True, stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        commit = "unknown"
    document = render(results, model.model, args.runs, now(), commit)
    args.out.write_text(document, encoding="utf-8")
    print("\n".join(document.splitlines()[2:4]))
    _, violations, accuracy = _totals(results)
    if args.assert_zero_violations and violations or args.min_accuracy is not None and accuracy < args.min_accuracy:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
