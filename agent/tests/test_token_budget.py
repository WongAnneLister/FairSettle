import asyncio

import litellm
import pytest

from decide_factory import (
    DECISION_JSON, FakeDispatch, FakeLedger, MockCompletion, make_complaint,
    model_response,
)
from fairsettle_agent.decide import decide
from fairsettle_agent.investigate import Finding, Investigation, investigate
from fairsettle_agent.model import ModelConfig
from fairsettle_agent.policy import PolicyConfig
from policy_factory import NOW, make_evidence

TEST_KEY = "sk-test-" + "k" * 32


def tool_reply(*calls, finish_reason="tool_calls"):
    return litellm.ModelResponse(
        choices=[{
            "message": {
                "role": "assistant", "content": None,
                "tool_calls": [
                    {"id": call_id, "type": "function", "function": {
                        "name": name, "arguments": arguments,
                    }}
                    for call_id, name, arguments in calls
                ],
            },
            "finish_reason": finish_reason,
        }],
        usage={"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
    )


class FakeHistory:
    def __init__(self):
        self.calls = []

    async def history(self, customer_id, complaint_id, received_at, *, days, limit):
        self.calls.append((customer_id, complaint_id, received_at, days, limit))
        return []


async def run_investigation(complete, history=None):
    complaint = make_complaint()
    return await investigate(
        complaint, complaint.complaint_id, NOW, make_evidence(),
        ModelConfig(api_key=TEST_KEY), PolicyConfig(), FakeDispatch(), FakeLedger(),
        FakeHistory() if history is None else history, complete,
    )


def test_default_budget():
    model = ModelConfig()
    assert model.max_tokens == 6000
    assert model.timeout_s == 90.0
    assert "max_tokens=6000, timeout_s=90.0" in repr(model)
    with pytest.raises(ValueError):
        ModelConfig(max_tokens=8001)


def test_decide_sends_the_budget():
    complete = MockCompletion([DECISION_JSON])
    asyncio.run(decide(
        make_complaint(), make_evidence(), ModelConfig(api_key=TEST_KEY),
        PolicyConfig(), complete,
    ))
    assert complete.calls[0]["max_tokens"] == 6000
    assert complete.calls[0]["timeout"] == 90.0


def test_investigate_sends_the_budget():
    complete = MockCompletion(["DONE"])
    asyncio.run(run_investigation(complete))
    assert complete.calls[0]["max_tokens"] == 6000
    assert complete.calls[0]["timeout"] == 90.0


def test_truncated_turn_stops_investigating():
    complete = MockCompletion([model_response("", finish_reason="length")])
    result = asyncio.run(run_investigation(complete))
    assert result.stopped == "truncated"
    assert result.steps == 0
    assert result.findings == ()
    assert len(complete.calls) == 1


def test_truncated_tool_call_is_not_run():
    history = FakeHistory()
    complete = MockCompletion([
        tool_reply(("call_1", "get_customer_history", "{}"), finish_reason="length"),
        "DONE",
    ])
    result = asyncio.run(run_investigation(complete, history))
    assert history.calls == []
    assert result.steps == 0
    assert result.stopped == "truncated"


def test_truncation_after_a_step_keeps_the_finding():
    complete = MockCompletion([
        tool_reply(("call_1", "get_customer_history", "{}")),
        model_response("", finish_reason="length"),
    ])
    result = asyncio.run(run_investigation(complete))
    assert result.steps == 1
    assert result.findings == (Finding("get_customer_history", {"complaints": []}),)
    assert result.stopped == "truncated"
    assert len(complete.calls) == 2


def test_truncated_round_trips():
    investigation = Investigation((), 0, "truncated", 1, 2)
    assert Investigation.from_state(investigation.to_state()) == investigation
