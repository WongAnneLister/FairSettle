from datetime import datetime, timezone

from fairsettle_agent.clients.models import (
    DishRef,
    FinancialStatus,
    Order,
    OrderEvent,
    OrderEventActor,
    OrderEventKind,
    OrderItem,
    OrderPaymentStatus,
    OrderStatus,
    OrderTimeline,
    PartyRef,
    Payment,
    PaymentProviderRefs,
    RefundableAmount,
    RefundControlState,
    ResolutionStatus,
    RestaurantRef,
)
from fairsettle_agent.decision import LiabilityShare, RefundDecision
from fairsettle_agent.evidence import Evidence

PAYMENT_ID = "pay_01HZX9K2M4N6P8Q0R2S4T6V8W0"
NOW = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)


def make_order(
    *, status=OrderStatus.DELIVERED, total_cents=1250,
    items=((11, 450), (12, 800)), ledger_payment_id=PAYMENT_ID,
) -> Order:
    names = ("Lemonade", "Pizza")
    return Order(
        id=1, created_at=NOW, updated_at=NOW, status=status,
        payment_status=OrderPaymentStatus.PAID, total_cents=total_cents,
        ledger_payment_id=ledger_payment_id, customer=PartyRef(id=7),
        driver=PartyRef(id=8), restaurant=RestaurantRef(id=5, name="Test Kitchen"),
        items=tuple(
            OrderItem(
                id=item_id,
                dish=DishRef(id=21 + index, name=names[index], price_cents=price),
                options=None,
            )
            for index, (item_id, price) in enumerate(items)
        ),
    )


def make_timeline(order_id: int = 1, *, event_ids=(101, 102, 103)) -> OrderTimeline:
    return OrderTimeline(
        order_id=order_id,
        events=tuple(
            OrderEvent(
                id=event_id, kind=OrderEventKind.CREATED,
                from_status=None, to_status=OrderStatus.PENDING,
                actor=OrderEventActor.CLIENT, driver_id=None,
                provider_event_id=None, occurred_at=NOW,
            )
            for event_id in event_ids
        ),
    )


def make_payment(payment_id: str = PAYMENT_ID) -> Payment:
    return Payment(
        id=payment_id, order_key="order-1", provider=PaymentProviderRefs(),
        payment_status="SUCCEEDED", resolution_status=ResolutionStatus.KNOWN,
        financial_status=FinancialStatus.POSTED, amount_minor=1250,
        currency="USD", captured_amount_minor=1250, created_at=NOW, updated_at=NOW,
    )


def make_refundable(
    *, captured=1250, refunded=0, reserved=0, payment_id=PAYMENT_ID,
) -> RefundableAmount:
    return RefundableAmount(
        payment_id=payment_id, currency="USD", captured_minor=captured,
        refunded_minor=refunded, reserved_minor=reserved,
        refundable_minor=max(0, captured - refunded - reserved),
        control_state=RefundControlState.NORMAL,
    )


def make_evidence(
    *, order=None, timeline=None, payment=None, refundable=None, prior_complaints=0,
) -> Evidence:
    return Evidence(
        order=make_order() if order is None else order,
        timeline=make_timeline() if timeline is None else timeline,
        payment=make_payment() if payment is None else payment,
        refundable=make_refundable() if refundable is None else refundable,
        prior_complaints_in_7_days=prior_complaints,
    )


def make_decision(**overrides) -> RefundDecision:
    fields = {
        "decision": "partial_refund",
        "amount_cents": 450,
        "reason_code": "missing_item",
        "liability": (("restaurant", 10000), ("driver", 0), ("platform", 0)),
        "explanation": "The drink on order line 11 was not delivered.",
        "evidence_refs": ("order:1", "order-item:11"),
    }
    fields.update(overrides)
    fields["liability"] = tuple(
        LiabilityShare(party=party, basis_points=points)
        for party, points in fields["liability"]
    )
    return RefundDecision(**fields)
