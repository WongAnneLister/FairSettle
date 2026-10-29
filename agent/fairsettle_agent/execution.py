from collections.abc import Mapping
from typing import Literal

from .clients.models import Refund


def refund_outcome(refund: Refund | Mapping[str, object]) -> Literal["waiting", "refunded", "refund_failed"]:
    values = refund.model_dump() if isinstance(refund, Refund) else refund
    if values["resolution_status"] == "CONFLICT":
        return "refund_failed"
    if values["refund_status"] == "SUCCEEDED":
        return "refunded"
    if values["refund_status"] in ("FAILED", "CANCELED"):
        return "refund_failed"
    return "waiting"


def refund_resume_value(refund: Refund) -> dict:
    return {
        "id": refund.id, "payment_id": refund.payment_id, "amount_minor": refund.amount_minor,
        "currency": refund.currency, "refund_status": str(refund.refund_status),
        "resolution_status": str(refund.resolution_status), "financial_status": str(refund.financial_status),
        "provider_status": refund.provider_status, "updated_at": refund.updated_at.isoformat(),
    }
