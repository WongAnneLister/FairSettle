import httpx
from pydantic import TypeAdapter, ValidationError

from .errors import MalformedResponse, NotFound, ServiceError, Unauthorized, Unavailable
from .models import Payment, PaymentId, ProposalId, ProposalRequest, RefundableAmount, RefundProposal

_PAYMENT_ID = TypeAdapter(PaymentId)
_PROPOSAL_ID = TypeAdapter(ProposalId)
_ERROR_CODES = {
    "VALIDATION_ERROR", "IDEMPOTENCY_KEY_REQUIRED", "UNAUTHORIZED", "FORBIDDEN",
    "NOT_FOUND", "IDEMPOTENCY_CONFLICT", "REFUND_BLOCKED", "PROPOSAL_EXISTS",
    "PROPOSAL_NOT_PENDING", "REFUND_LIMIT_EXCEEDED", "LIABILITY_SPLIT_INVALID",
    "RATE_LIMITED", "INTERNAL_ERROR", "SERVICE_UNAVAILABLE", "ORDER_INTENT_CONFLICT",
    "AMOUNT_MISMATCH", "CURRENCY_NOT_ENABLED", "PROVIDER_UNKNOWN_RESULT",
}


def proposal_idempotency_key(complaint_id: str) -> str:
    return "refund-proposal:" + complaint_id


class LedgerClient:
    def __init__(self, http: httpx.AsyncClient, app_token: str) -> None:
        if not isinstance(app_token, str) or not app_token:
            raise ValueError("app_token must be a non-empty string")
        self._http = http
        self._app_token = app_token

    def __repr__(self) -> str:
        return f"LedgerClient(base_url={self._http.base_url!s})"

    async def get_payment(self, payment_id: str) -> Payment:
        self._validate_id(payment_id)
        return await self._get(f"/v1/payments/{payment_id}", Payment)

    async def get_refundable(self, payment_id: str) -> RefundableAmount:
        self._validate_id(payment_id)
        return await self._get(f"/v1/payments/{payment_id}/refundable", RefundableAmount)

    async def create_proposal(self, request: ProposalRequest) -> RefundProposal:
        return await self._send(
            "POST", "/v1/refund-proposals", RefundProposal, json=request.body(),
            headers={"Idempotency-Key": proposal_idempotency_key(request.complaint_id)},
        )

    async def get_proposal(self, proposal_id: str) -> RefundProposal:
        try:
            _PROPOSAL_ID.validate_python(proposal_id)
        except ValidationError:
            raise ValueError("proposal_id must be a valid proposal id") from None
        return await self._get(f"/v1/refund-proposals/{proposal_id}", RefundProposal)

    @staticmethod
    def _validate_id(payment_id: str) -> None:
        try:
            _PAYMENT_ID.validate_python(payment_id)
        except ValidationError:
            raise ValueError("payment_id must be a valid payment resource id") from None

    async def _get(self, path: str, model):
        return await self._send("GET", path, model)

    async def _send(self, method, path, model, *, json=None, headers=None):
        request = self._http.build_request(
            method, path, json=json,
            headers={**(headers or {}), "Authorization": f"Bearer {self._app_token}"},
        )
        request.headers.pop("X-Service-Token", None)
        try:
            response = await self._http.send(request, auth=None)
        except httpx.TransportError as exc:
            raise Unavailable("ledger", "Transport unavailable") from exc
        if response.status_code == 200 or (method == "POST" and response.status_code == 201):
            try:
                body = response.json()
            except ValueError as exc:
                raise MalformedResponse("ledger", "Response is not JSON") from exc
            if not isinstance(body, dict):
                raise MalformedResponse("ledger", "Response must be an object")
            try:
                return model.model_validate(body)
            except ValidationError as exc:
                fields = ", ".join(".".join(map(str, error["loc"])) or "refundableMinor"
                                   for error in exc.errors())
                raise MalformedResponse("ledger", f"Invalid fields: {fields}") from exc
        code = None
        retryable = False
        message = f"HTTP {response.status_code}"
        request_id = response.headers.get("X-Request-Id")
        try:
            body = response.json()
        except ValueError:
            body = None
        if (isinstance(body, dict)
                and isinstance(body.get("code"), str)
                and body["code"] in _ERROR_CODES
                and isinstance(body.get("message"), str)
                and type(body.get("retryable")) is bool
                and isinstance(body.get("requestId"), str)):
            code = body["code"]
            retryable = body["retryable"]
            message = body["message"].replace(self._app_token, "[redacted]")
            request_id = body["requestId"]
        if response.status_code in (401, 403):
            error_type = Unauthorized
        elif response.status_code == 404:
            error_type = NotFound
        elif response.status_code in (502, 503, 504):
            error_type = Unavailable
        else:
            error_type = ServiceError
        raise error_type(
            "ledger", message, status=response.status_code, code=code,
            request_id=request_id, retryable=retryable,
        )
