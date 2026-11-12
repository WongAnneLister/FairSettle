from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Party = Literal["restaurant", "driver", "platform"]
DecisionKind = Literal["full_refund", "partial_refund", "reject", "escalate"]
ReasonCode = Literal[
    "late_delivery", "missing_item", "wrong_item", "quality", "food_safety", "delivery_failed", "other",
]


class Contract(BaseModel):
    model_config = ConfigDict(frozen=True, strict=True, extra="forbid")


class LiabilityShare(Contract):
    party: Party
    basis_points: int


class RefundDecision(Contract):
    """Schema failures follow F21's retry-then-escalate path; hard rules live in policy.py."""

    decision: DecisionKind
    amount_cents: int
    reason_code: ReasonCode
    liability: tuple[LiabilityShare, ...]
    explanation: Annotated[str, StringConstraints(min_length=1, max_length=2000)]
    evidence_refs: Annotated[
        tuple[Annotated[str, StringConstraints(min_length=1, max_length=128)], ...],
        Field(max_length=50),
    ]

    @model_validator(mode="after")
    def shape(self) -> Self:
        if self.decision in ("reject", "escalate"):
            if self.amount_cents != 0 or self.liability:
                raise ValueError("reject and escalate require amount_cents 0 and no liability")
        elif self.amount_cents < 1:
            raise ValueError("a refund requires amount_cents of at least 1")
        return self
