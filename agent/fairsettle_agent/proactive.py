"""Proactive cases: a dispatch delivery failure starts the complaint flow once per order (F25)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Protocol

from .clients.models import DeliveryFailure
from .complaint import ComplaintInput

if TYPE_CHECKING:
    from .agent import RunStatus

PROACTIVE_PREFIX = "delivery-failed-"
CURSOR = "dispatch.delivery_failures"
BATCH = 50


def is_proactive(complaint_id: str) -> bool:
    return complaint_id.startswith(PROACTIVE_PREFIX)


def complaint_for(failure: DeliveryFailure) -> ComplaintInput:
    return ComplaintInput(
        complaint_id=f"{PROACTIVE_PREFIX}{failure.order_id}",
        order_id=failure.order_id,
        complaint_type="delivery_failed",
        text=f"Dispatch reports that the delivery of order {failure.order_id} failed "
             f"({failure.failure_reason.value}). No customer complaint was received.",
    )


class FailureFeed(Protocol):
    async def delivery_failures(self, after_event_id: int, limit: int) -> list[DeliveryFailure]: ...


class CursorStore(Protocol):
    async def get_cursor(self, name: str) -> int: ...
    async def set_cursor(self, name: str, event_id: int) -> None: ...


class DeliveryFailureTrigger:
    def __init__(self, feed: FailureFeed, cursors: CursorStore,
                 start: Callable[[ComplaintInput], Awaitable[RunStatus]], *, limit: int = BATCH) -> None:
        self._feed = feed
        self._cursors = cursors
        self._start = start
        self._limit = limit

    async def run_once(self) -> list[RunStatus]:
        from .agent import DuplicateComplaint

        after = await self._cursors.get_cursor(CURSOR)
        failures = await self._feed.delivery_failures(after, self._limit)
        statuses = []
        for failure in failures:
            try:
                status = await self._start(complaint_for(failure))
                statuses.append(status)
            except DuplicateComplaint:
                pass
            await self._cursors.set_cursor(CURSOR, failure.event_id)
        return statuses
