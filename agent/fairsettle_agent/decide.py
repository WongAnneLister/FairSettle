import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import time
from typing import TYPE_CHECKING, Any, Literal

import litellm
from openai import OpenAIError

from .complaint import Complaint
from .gather import DispatchReader, GatherFailure, LedgerReader, gather
from .evidence import Evidence
from .model import ModelConfig, DecisionInvalid, build_messages, parse_decision, retry_messages
from .policy import PolicyConfig, PolicyVerdict, evaluate

if TYPE_CHECKING:
    from .investigate import Investigation

Completion = Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class Escalation:
    stage: Literal["gather", "decide"]
    reason: Literal[
        "source_unavailable", "no_payment", "inconsistent_evidence",
        "payment_unconfirmed", "decision_invalid", "model_unavailable",
    ]
    detail: str


Outcome = PolicyVerdict | Escalation


@dataclass(frozen=True)
class RunRecord:
    complaint_id: str
    model: str
    attempts: int
    prompt_tokens: int
    completion_tokens: int
    stage_ms: dict[str, int]


@dataclass(frozen=True)
class RunResult:
    outcome: Outcome
    record: RunRecord


async def decide(
    complaint: Complaint, evidence: Evidence, model: ModelConfig,
    policy: PolicyConfig = PolicyConfig(), complete: Completion = litellm.acompletion,
    *, investigation: "Investigation | None" = None,
) -> tuple[Outcome, int, int, int]:
    original = build_messages(complaint, evidence, policy, investigation=investigation)
    messages = original
    prompt_tokens = completion_tokens = 0
    for attempt in (1, 2):
        try:
            response = await complete(
                model=model.model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0,
                max_tokens=model.max_tokens,
                timeout=model.timeout_s,
                num_retries=0,
                api_key=model.api_key,
            )
        except (OpenAIError, asyncio.TimeoutError) as error:
            return (
                Escalation("decide", "model_unavailable", type(error).__name__),
                attempt, prompt_tokens, completion_tokens,
            )
        usage = getattr(response, "usage", None)
        prompt_tokens += getattr(usage, "prompt_tokens", 0) or 0
        completion_tokens += getattr(usage, "completion_tokens", 0) or 0
        choice = response.choices[0]
        content = choice.message.content
        try:
            decision = parse_decision(content, choice.finish_reason)
        except DecisionInvalid as error:
            if attempt == 2:
                return (
                    Escalation("decide", "decision_invalid", f"{error.kind}: {error.detail}"),
                    attempt, prompt_tokens, completion_tokens,
                )
            messages = retry_messages(original, content, error)
        else:
            return evaluate(decision, evidence, policy), attempt, prompt_tokens, completion_tokens


async def run_complaint(
    complaint: Complaint, dispatch: DispatchReader, ledger: LedgerReader,
    model: ModelConfig, policy: PolicyConfig = PolicyConfig(),
    complete: Completion = litellm.acompletion,
) -> RunResult:
    started = time.perf_counter()
    evidence = await gather(complaint, dispatch, ledger)
    stage_ms = {"gather": int((time.perf_counter() - started) * 1000)}
    if isinstance(evidence, GatherFailure):
        return RunResult(
            Escalation("gather", evidence.reason, evidence.detail),
            RunRecord(complaint.complaint_id, model.model, 0, 0, 0, stage_ms),
        )
    started = time.perf_counter()
    outcome, attempts, prompt_tokens, completion_tokens = await decide(
        complaint, evidence, model, policy, complete,
    )
    stage_ms["decide"] = int((time.perf_counter() - started) * 1000)
    return RunResult(
        outcome,
        RunRecord(
            complaint.complaint_id, model.model, attempts, prompt_tokens,
            completion_tokens, stage_ms,
        ),
    )
