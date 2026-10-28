import asyncio

import litellm
import pytest

from fairsettle_agent.complaint import Complaint
from policy_factory import (
    make_decision, make_order, make_payment, make_refundable, make_timeline,
)

DECISION_JSON = make_decision().model_dump_json()


def make_complaint(**overrides) -> Complaint:
    fields = {
        "complaint_id": "complaint-missing-drink-001",
        "order_id": 1,
        "complaint_type": "missing_item",
        "text": "My lemonade was missing.",
        "prior_complaints_in_7_days": 0,
    }
    fields.update(overrides)
    return Complaint(**fields)


class Gate:
    def __init__(self, n):
        self.n = n
        self.arrivals = 0
        self.ready = asyncio.Event()

    async def arrive(self):
        self.arrivals += 1
        if self.arrivals == self.n:
            self.ready.set()
        await self.ready.wait()


class FakeDispatch:
    def __init__(self, order=None, timeline=None, errors=None, gate=None):
        self.order = make_order() if order is None else order
        self.timeline = make_timeline() if timeline is None else timeline
        self.errors = {} if errors is None else errors
        self.gate = gate
        self.calls: list[tuple[str, object]] = []

    async def _read(self, name, argument, value):
        self.calls.append((name, argument))
        if self.gate is not None:
            await self.gate.arrive()
        if name in self.errors:
            raise self.errors[name]
        return value

    async def get_order(self, order_id):
        return await self._read("get_order", order_id, self.order)

    async def get_timeline(self, order_id):
        return await self._read("get_timeline", order_id, self.timeline)


class FakeLedger:
    def __init__(self, payment=None, refundable=None, errors=None, gate=None):
        self.payment = make_payment() if payment is None else payment
        self.refundable = make_refundable() if refundable is None else refundable
        self.errors = {} if errors is None else errors
        self.gate = gate
        self.calls: list[tuple[str, object]] = []

    async def _read(self, name, argument, value):
        self.calls.append((name, argument))
        if self.gate is not None:
            await self.gate.arrive()
        if name in self.errors:
            raise self.errors[name]
        return value

    async def get_payment(self, payment_id):
        return await self._read("get_payment", payment_id, self.payment)

    async def get_refundable(self, payment_id):
        return await self._read("get_refundable", payment_id, self.refundable)


class MockCompletion:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    async def __call__(self, **kwargs):
        index = len(self.calls)
        self.calls.append(kwargs)
        if index >= len(self.replies):
            pytest.fail("Completion called more times than there are replies")
        item = self.replies[index]
        if isinstance(item, str):
            return await litellm.acompletion(**kwargs, mock_response=item)
        if isinstance(item, Exception):
            raise item
        assert isinstance(item, litellm.ModelResponse)
        return item


def model_response(
    content, finish_reason="stop", prompt_tokens=10, completion_tokens=20,
) -> litellm.ModelResponse:
    return litellm.ModelResponse(
        choices=[{
            "message": {"role": "assistant", "content": content},
            "finish_reason": finish_reason,
        }],
        usage={
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    )
