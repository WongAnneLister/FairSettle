from enum import StrEnum
from typing import Annotated, Literal, Self

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
    DELIVERY_FAILED = "DeliveryFailed"


class FailureReason(StrEnum):
    DRIVER_FAULT = "DRIVER_FAULT"
    PLATFORM_FAULT = "PLATFORM_FAULT"


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
    failure_reason: FailureReason | None = None
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


class DeliveryFailure(Wire):
    event_id: Annotated[int, Field(ge=1)]
    order_id: Annotated[int, Field(ge=1)]
    failure_reason: FailureReason
    occurred_at: AwareDatetime


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


ProposalId = Annotated[str, StringConstraints(pattern=r"^prop_[0-9A-HJKMNP-TV-Z]{26}$")]
ResourceId = Annotated[str, StringConstraints(pattern=r"^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$")]


class Outgoing(BaseModel):
    model_config = ConfigDict(
        frozen=True, strict=True, extra="forbid", alias_generator=to_camel, populate_by_name=True,
    )


class ProposalShare(Outgoing):
    party: Literal["RESTAURANT", "DRIVER", "PLATFORM"]
    basis_points: Annotated[StrictInt, Field(ge=0, le=10000)]


class AgentRunRef(Outgoing):
    thread_id: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    trace_id: Annotated[str, StringConstraints(min_length=1, max_length=128)] | None = None


class ProposalRequest(Outgoing):
    complaint_id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9._:-]{1,128}$")]
    order_ref: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    payment_id: PaymentId
    decision: Literal["FULL_REFUND", "PARTIAL_REFUND"]
    amount_minor: Annotated[StrictInt, Field(ge=1)]
    currency: Currency
    reason_code: Literal["LATE_DELIVERY", "MISSING_ITEM", "WRONG_ITEM", "QUALITY", "FOOD_SAFETY", "DELIVERY_FAILED", "OTHER"]
    liability: tuple[ProposalShare, ProposalShare, ProposalShare]
    explanation: Annotated[str, StringConstraints(min_length=1, max_length=2000)]
    evidence_refs: Annotated[
        tuple[Annotated[str, StringConstraints(min_length=1, max_length=128)], ...],
        Field(min_length=1, max_length=50),
    ]
    agent_run: AgentRunRef

    def body(self) -> dict:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


class ProposalStatus(StrEnum):
    PENDING_REVIEW = "PENDING_REVIEW"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


RefundId = Annotated[str, StringConstraints(pattern=r"^ref_[0-9A-HJKMNP-TV-Z]{26}$")]


class RefundProposal(Wire):
    id: ProposalId
    complaint_id: str
    order_ref: str
    payment_id: PaymentId
    decision: str
    amount_minor: Cents
    currency: Currency
    reason_code: str
    status: ProposalStatus
    created_at: AwareDatetime
    reviewed_at: AwareDatetime | None
    rejection_reason: str | None
    refund_id: RefundId | None

    @model_validator(mode="after")
    def validate_review(self) -> Self:
        valid = (
            self.status == ProposalStatus.PENDING_REVIEW
            and self.reviewed_at is None and self.rejection_reason is None and self.refund_id is None
        ) or (
            self.status == ProposalStatus.APPROVED
            and self.reviewed_at is not None and bool(self.refund_id) and self.rejection_reason is None
        ) or (
            self.status == ProposalStatus.REJECTED
            and self.reviewed_at is not None and bool(self.rejection_reason) and self.refund_id is None
        )
        if not valid:
            raise ValueError("proposal review fields do not match its status")
        return self


class RefundStatus(StrEnum):
    RESERVED = "RESERVED"
    SUBMITTED = "SUBMITTED"
    PENDING = "PENDING"
    REQUIRES_ACTION = "REQUIRES_ACTION"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


class Refund(Wire):
    id: RefundId
    payment_id: PaymentId
    amount_minor: Cents
    currency: Currency
    refund_status: RefundStatus
    resolution_status: ResolutionStatus
    financial_status: FinancialStatus
    provider_refund_id: str | None = None
    provider_status: str | None = None
    control_state: RefundControlState
    created_at: AwareDatetime
    updated_at: AwareDatetime
