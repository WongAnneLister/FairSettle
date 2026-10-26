from dataclasses import dataclass

from .clients.models import Order, OrderItem, OrderTimeline, Payment, RefundableAmount


def order_ref(order_id: int) -> str:
    return f"order:{order_id}"


def order_item_ref(item_id: int) -> str:
    return f"order-item:{item_id}"


def order_event_ref(event_id: int) -> str:
    return f"order-event:{event_id}"


def payment_ref(payment_id: str) -> str:
    return f"payment:{payment_id}"


def refundable_ref(payment_id: str) -> str:
    return f"refundable:{payment_id}"


@dataclass(frozen=True)
class Evidence:
    order: Order
    timeline: OrderTimeline
    payment: Payment
    refundable: RefundableAmount
    prior_complaints_in_7_days: int

    def __post_init__(self) -> None:
        if self.timeline.order_id != self.order.id:
            raise ValueError("timeline order_id must match the order id")
        if self.order.ledger_payment_id != self.payment.id:
            raise ValueError("order ledger_payment_id must match the payment id")
        if self.refundable.payment_id != self.payment.id:
            raise ValueError("refundable payment_id must match the payment id")
        if self.refundable.currency != self.payment.currency:
            raise ValueError("refundable currency must match the payment currency")
        if type(self.prior_complaints_in_7_days) is not int or self.prior_complaints_in_7_days < 0:
            raise ValueError("prior_complaints_in_7_days must be a non-negative integer")

    @property
    def refs(self) -> frozenset[str]:
        return frozenset({
            order_ref(self.order.id),
            *(order_item_ref(item.id) for item in self.order.items),
            *(order_event_ref(event.id) for event in self.timeline.events),
            payment_ref(self.payment.id),
            refundable_ref(self.refundable.payment_id),
        })

    def item(self, ref: str) -> OrderItem | None:
        return next((item for item in self.order.items if order_item_ref(item.id) == ref), None)
