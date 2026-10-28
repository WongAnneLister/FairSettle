import asyncio
from dataclasses import dataclass
from typing import Literal, Protocol

from .clients.errors import ClientError
from .clients.models import Order, OrderTimeline, Payment, RefundableAmount, ResolutionStatus
from .complaint import Complaint
from .evidence import Evidence


class DispatchReader(Protocol):
    async def get_order(self, order_id: int) -> Order: ...
    async def get_timeline(self, order_id: int) -> OrderTimeline: ...


class LedgerReader(Protocol):
    async def get_payment(self, payment_id: str) -> Payment: ...
    async def get_refundable(self, payment_id: str) -> RefundableAmount: ...


@dataclass(frozen=True)
class GatherFailure:
    reason: Literal[
        "source_unavailable", "no_payment", "inconsistent_evidence", "payment_unconfirmed",
    ]
    detail: str


def _source_failure(names: tuple[str, str], results: list) -> GatherFailure | None:
    for result in results:
        if isinstance(result, BaseException) and not isinstance(result, ClientError):
            raise result
    failures = sorted(
        f"{name}: {type(result).__name__}"
        for name, result in zip(names, results)
        if isinstance(result, ClientError)
    )
    return GatherFailure("source_unavailable", ", ".join(failures)) if failures else None


async def gather(
    complaint: Complaint, dispatch: DispatchReader, ledger: LedgerReader,
) -> Evidence | GatherFailure:
    first = await asyncio.gather(
        dispatch.get_order(complaint.order_id),
        dispatch.get_timeline(complaint.order_id),
        return_exceptions=True,
    )
    failure = _source_failure(("get_order", "get_timeline"), first)
    if failure is not None:
        return failure
    order, timeline = first
    if order.ledger_payment_id is None:
        return GatherFailure("no_payment", f"order {order.id} has no ledger payment")

    second = await asyncio.gather(
        ledger.get_payment(order.ledger_payment_id),
        ledger.get_refundable(order.ledger_payment_id),
        return_exceptions=True,
    )
    failure = _source_failure(("get_payment", "get_refundable"), second)
    if failure is not None:
        return failure
    payment, refundable = second
    try:
        evidence = Evidence(
            order, timeline, payment, refundable, complaint.prior_complaints_in_7_days,
        )
    except ValueError as error:
        return GatherFailure("inconsistent_evidence", str(error))
    if payment.payment_status != "SUCCEEDED" or payment.resolution_status != ResolutionStatus.KNOWN:
        return GatherFailure(
            "payment_unconfirmed", f"payment {payment.payment_status}/{payment.resolution_status}",
        )
    return evidence
