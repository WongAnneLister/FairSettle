import os
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

import argparse
import asyncio
from collections.abc import Mapping
from dataclasses import replace
import sys

import litellm

from fairsettle_agent.complaint import ComplaintInput
from fairsettle_agent.decide import Completion
from fairsettle_agent.model import ModelConfig
from fairsettle_agent.policy import PolicyConfig
from .run import EVAL_MODEL, RunResult, _expected, _party, counted_violations, is_correct, run_case
from .scenarios import Expected, SCENARIOS, Scenario

COMPLAINT_TEXT = ("There was a dead mosquito in my pizza. We found it halfway through the meal, "
                  "so we could not eat the rest.")

FOOD_SAFETY: Scenario = replace(
    SCENARIOS[2],
    id="fs01",
    title="Food safety on the customer's report",
    complaint=ComplaintInput(complaint_id="eval-fs01", order_id=3, complaint_type="food_safety", text=COMPLAINT_TEXT),
    expected=Expected(frozenset({"propose"}), "full_refund", "food_safety", 1500, "restaurant"),
)


def line(result: RunResult) -> str:
    d = result.decision
    if d is not None:
        outcome = f"{result.outcome} {d.decision} {d.reason_code} {d.amount_cents} {_party(result) or 'none'}"
    else:
        outcome = f"{result.outcome} ({result.stage}: {result.reason})"
    violations = counted_violations(result)
    if violations:
        outcome += f" violations {','.join(violations)}"
    return f"run {result.run}: {outcome}"


def main(argv: list[str] | None = None, env: Mapping[str, str] = os.environ,
         complete: Completion = litellm.acompletion) -> int:
    parser = argparse.ArgumentParser(description="Run the food-safety fixture against the real model.")
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args(argv)
    if args.runs < 1:
        parser.error("--runs must be at least 1")
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
        return [await run_case(FOOD_SAFETY, run, model, policy, complete) for run in range(1, args.runs + 1)]

    results = asyncio.run(run_all())
    print(f"expected: {_expected(FOOD_SAFETY.expected)}")
    for result in results:
        print(line(result))
    correct = sum(is_correct(FOOD_SAFETY.expected, result) for result in results)
    print(f"correct: {correct}/{args.runs}")
    return 0 if correct == args.runs else 1


if __name__ == "__main__":
    sys.exit(main())
