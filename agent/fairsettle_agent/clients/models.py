from enum import StrEnum
from typing import Annotated, Self

from pydantic import (
    AwareDatetime, BaseModel, ConfigDict, Field, StrictInt,
    StringConstraints, model_validator,
)
from pydantic.alias_generators import to_camel


class Wire(BaseModel):
    model_config = ConfigDict(
        frozen=True, populate_by_name=True, alias_generator=to_camel, extra="ignore",
    )


Cents = Annotated[StrictInt, Field(ge=0)]
PaymentId = Annotated[str, StringConstraints(pattern=r"^pay_[0-7][0-9A-HJKMNP-TV-Z]{25}$")]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]


class OrderStatus(StrEnum):
    PENDING = "Pending"
    COOKING = "Cooking"
    COOKED = "Cooked"
    PICKED_UP = "PickedUp"
    DELIVERED = "Delivered"


class OrderPaymentStatus(StrEnum):
    NOT_REQUIRED = "NotRequired"
    AWAITING_PAYMENT = "AwaitingPayment"
    PAID = "Paid"
    FAILED = "Failed"


class OrderEventKind(StrEnum):
    CREATED = "CREATED"
    STATUS_CHANGED = "STATUS_CHANGED"
    DRIVER_ASSIGNED = "DRIVER_ASSIGNED"


class OrderEventActor(StrEnum):
    OWNER = "Owner"
    CLIENT = "Client"
    ASSIGNED_DRIVER = "AssignedDriver"
    FULFILLMENT_PROVIDER = "FulfillmentProvider"


class PartyRef(Wire):
    id: int


class RestaurantRef(Wire):
    id: int
    name: str


class DishRef(Wire):
    id: int
    name: str
    price_cents: Cents


class ItemOption(Wire):
    name: str
    choice: str | None


class OrderItem(Wire):
    id: int
    dish: DishRef | None
    options: tuple[ItemOption, ...] | None


class Order(Wire):
    id: int
    created_at: AwareDatetime
    updated_at: AwareDatetime
    status: OrderStatus
    payment_status: OrderPaymentStatus
    total_cents: Cents | None
    ledger_payment_id: str | None
    customer: PartyRef | None
    driver: PartyRef | None
    restaurant: RestaurantRef | None
    items: tuple[OrderItem, ...]


class OrderEvent(Wire):
    id: int
    kind: OrderEventKind
    from_status: OrderStatus | None
    to_status: OrderStatus | None
    actor: OrderEventActor
    driver_id: int | None
    provider_event_id: str | None
    occurred_at: AwareDatetime


class OrderTimeline(Wire):
    order_id: int
    events: tuple[OrderEvent, ...]

    def transitions(self) -> tuple[OrderEvent, ...]:
        return tuple(event for event in self.events if event.kind in (
            OrderEventKind.CREATED, OrderEventKind.STATUS_CHANGED,
        ))

    def courier_timeline(self) -> tuple[OrderEvent, ...]:
        return tuple(event for event in self.events if (
            event.kind == OrderEventKind.DRIVER_ASSIGNED
            or (event.kind == OrderEventKind.STATUS_CHANGED and event.to_status in (
                OrderStatus.PICKED_UP, OrderStatus.DELIVERED,
            ))
        ))


class ResolutionStatus(StrEnum):
    KNOWN = "KNOWN"
    UNKNOWN = "UNKNOWN"
    CONFLICT = "CONFLICT"


class FinancialStatus(StrEnum):
    NOT_APPLICABLE = "NOT_APPLICABLE"
    PENDING_EVIDENCE = "PENDING_EVIDENCE"
    PARTIALLY_POSTED = "PARTIALLY_POSTED"
    POSTED = "POSTED"
    CONFLICT = "CONFLICT"


class RefundControlState(StrEnum):
    NORMAL = "NORMAL"
    EXTERNAL_CONFLICT = "EXTERNAL_CONFLICT"
    DISPUTE_BLOCKED = "DISPUTE_BLOCKED"


class PaymentProviderRefs(Wire):
    checkout_session_id: str | None = None
    latest_charge_id: str | None = None


class Payment(Wire):
    id: PaymentId
    order_key: str
    provider: PaymentProviderRefs
    payment_status: str
    resolution_status: ResolutionStatus
    financial_status: FinancialStatus
    amount_minor: Cents
    currency: Currency
    captured_amount_minor: Cents
    created_at: AwareDatetime
    updated_at: AwareDatetime


class RefundableAmount(Wire):
    payment_id: PaymentId
    currency: Currency
    captured_minor: Cents
    refunded_minor: Cents
    reserved_minor: Cents
    refundable_minor: Cents
    control_state: RefundControlState

    @model_validator(mode="after")
    def validate_refundable_amount(self) -> Self:
        expected = (
            max(0, self.captured_minor - self.refunded_minor - self.reserved_minor)
            if self.control_state == RefundControlState.NORMAL else 0
        )
        if self.refundable_minor != expected:
            raise ValueError("refundableMinor does not follow the contract formula")
        return self
