import httpx
from pydantic import ValidationError

from .errors import (
    Forbidden, MalformedResponse, NotFound, ServiceError, Unauthorized, Unavailable,
)
from .models import DeliveryFailure, Order, OrderTimeline

AGENT_ORDER_QUERY: str = """query AgentOrder($id: Float!) {
  getOrder(input: {id: $id}) {
    ok
    code
    error
    order {
      id
      createdAt
      updatedAt
      status
      paymentStatus
      totalCents
      ledgerPaymentId
      customer { id }
      driver { id }
      restaurant { id name }
      items { id dish { id name priceCents } options { name choice } }
    }
  }
}"""

AGENT_ORDER_TIMELINE_QUERY: str = """query AgentOrderTimeline($orderId: Int!) {
  orderTimeline(input: {orderId: $orderId}) {
    ok
    code
    error
    events {
      id
      kind
      fromStatus
      toStatus
      actor
      driverId
      providerEventId
      failureReason
      occurredAt
    }
  }
}"""

AGENT_DELIVERY_FAILURES_QUERY: str = """query AgentDeliveryFailures($afterEventId: Int!, $limit: Int!) {
  deliveryFailures(input: {afterEventId: $afterEventId, limit: $limit}) {
    ok
    code
    error
    failures {
      eventId
      orderId
      failureReason
      occurredAt
    }
  }
}"""

DOCUMENT: str = AGENT_ORDER_QUERY + "\n\n" + AGENT_ORDER_TIMELINE_QUERY + "\n\n" + AGENT_DELIVERY_FAILURES_QUERY


class DispatchClient:
    def __init__(self, http: httpx.AsyncClient, service_token: str) -> None:
        if not isinstance(service_token, str) or not service_token:
            raise ValueError("service_token must be a non-empty string")
        self._http = http
        self._service_token = service_token

    def __repr__(self) -> str:
        return f"DispatchClient(base_url={self._http.base_url!s})"

    async def get_order(self, order_id: int) -> Order:
        self._validate_id(order_id)
        envelope = await self._query("AgentOrder", {"id": order_id}, "getOrder")
        try:
            return Order.model_validate(envelope.get("order"))
        except ValidationError as exc:
            raise self._validation_error(exc) from exc

    async def get_timeline(self, order_id: int) -> OrderTimeline:
        self._validate_id(order_id)
        envelope = await self._query(
            "AgentOrderTimeline", {"orderId": order_id}, "orderTimeline",
        )
        try:
            return OrderTimeline.model_validate({
                "order_id": order_id, "events": envelope.get("events"),
            })
        except ValidationError as exc:
            raise self._validation_error(exc) from exc

    async def delivery_failures(self, after_event_id: int, limit: int) -> list[DeliveryFailure]:
        if type(after_event_id) is not int or after_event_id < 0:
            raise ValueError("after_event_id must be an integer of at least 0")
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError("limit must be an integer from 1 to 100")
        envelope = await self._query(
            "AgentDeliveryFailures", {"afterEventId": after_event_id, "limit": limit}, "deliveryFailures",
        )
        failures = envelope.get("failures")
        if not isinstance(failures, list):
            raise MalformedResponse("dispatch", "Invalid fields: failures")
        try:
            return [DeliveryFailure.model_validate(item) for item in failures]
        except ValidationError as exc:
            raise self._validation_error(exc) from exc

    @staticmethod
    def _validate_id(order_id: int) -> None:
        if type(order_id) is not int or order_id < 1:
            raise ValueError("order_id must be an integer of at least 1")

    @staticmethod
    def _validation_error(exc: ValidationError) -> MalformedResponse:
        fields = ", ".join(".".join(map(str, error["loc"])) or "response"
                           for error in exc.errors())
        return MalformedResponse("dispatch", f"Invalid fields: {fields}")

    async def _query(self, operation_name: str, variables: dict, field: str) -> dict:
        request = self._http.build_request(
            "POST", "/graphql",
            json={"query": DOCUMENT, "operationName": operation_name, "variables": variables},
            headers={"X-Service-Token": self._service_token},
        )
        request.headers.pop("Authorization", None)
        try:
            response = await self._http.send(request, auth=None)
        except httpx.TransportError as exc:
            raise Unavailable("dispatch", "Transport unavailable") from exc
        if response.status_code in (502, 503, 504):
            raise Unavailable("dispatch", f"HTTP {response.status_code}", status=response.status_code)
        if response.status_code != 200:
            raise ServiceError("dispatch", f"HTTP {response.status_code}", status=response.status_code)
        try:
            body = response.json()
        except ValueError as exc:
            raise MalformedResponse("dispatch", "Response is not JSON") from exc
        if not isinstance(body, dict):
            raise MalformedResponse("dispatch", "Response must be an object")
        if "errors" in body:
            errors = body["errors"]
            first = errors[0] if isinstance(errors, list) and errors else {}
            extensions = first.get("extensions") if isinstance(first, dict) else None
            code = extensions.get("code") if isinstance(extensions, dict) else None
            error_type = Unauthorized if code == "FORBIDDEN" else ServiceError
            raise error_type("dispatch", "GraphQL request refused", status=200, code=code)
        data = body.get("data")
        envelope = data.get(field) if isinstance(data, dict) else None
        if not isinstance(envelope, dict):
            raise MalformedResponse("dispatch", f"Missing object: data.{field}")
        if envelope.get("ok") is False:
            code = envelope.get("code")
            error_type = {"NOT_FOUND": NotFound, "FORBIDDEN": Forbidden}.get(code, ServiceError)
            message = envelope.get("error")
            if not isinstance(message, str):
                message = "Request failed"
            message = message.replace(self._service_token, "[redacted]")
            raise error_type("dispatch", message, status=200, code=code)
        if envelope.get("ok") is not True:
            raise MalformedResponse("dispatch", "Invalid field: ok")
        return envelope
