from typing import Annotated

from pydantic import Field, StringConstraints

from .decision import Contract, ReasonCode


class Complaint(Contract):
    complaint_id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9._:-]{1,128}$")]
    order_id: Annotated[int, Field(ge=1)]
    complaint_type: ReasonCode
    text: Annotated[str, StringConstraints(min_length=1, max_length=4000)]
    prior_complaints_in_7_days: Annotated[int, Field(ge=0)]


class ComplaintInput(Contract):
    complaint_id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9._:-]{1,128}$")]
    order_id: Annotated[int, Field(ge=1)]
    complaint_type: ReasonCode
    text: Annotated[str, StringConstraints(min_length=1, max_length=4000)]

    def to_complaint(self, prior_complaints_in_7_days: int) -> Complaint:
        return Complaint(**self.model_dump(), prior_complaints_in_7_days=prior_complaints_in_7_days)
