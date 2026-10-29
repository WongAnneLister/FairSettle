import asyncio
from copy import deepcopy
import json
from pathlib import Path
import re
import uuid

import httpx
import pytest

from conftest import APP_TOKEN, TOKEN
from fairsettle_agent.clients import (
    DOCUMENT,
    DispatchClient,
    Forbidden,
    LedgerClient,
    MalformedResponse,
    NotFound,
    Order,
    OrderEventActor,
    OrderEventKind,
    OrderPaymentStatus,
    OrderStatus,
    Payment,
    ServiceError,
    Unauthorized,
    Unavailable,
    UnrecordedRequest,
)
from fairsettle_agent.clients.replay import FIXTURES_DIR, FixtureReplay, Recording

EXPECTED_NAMES = {
    "dispatch-order-delivered", "dispatch-timeline-delivered",
    "dispatch-order-pending", "dispatch-timeline-pending",
    "dispatch-order-not-found", "dispatch-unauthorized",
    "ledger-payment-captured", "ledger-refundable-full",
    "ledger-refundable-partial", "ledger-payment-not-found", "ledger-unauthorized",
    "ledger-proposal-created", "ledger-proposal-replayed", "ledger-proposal-conflict",
    "ledger-proposal-limit", "ledger-proposal-pending", "ledger-proposal-approved",
    "ledger-proposal-rejected",
}
OPS_TOKEN = re.compile(r"ops_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.")
PRODUCERS = {
    "dispatch/test/agent-fixtures.e2e-spec.ts",
    "ledger/src/test/java/com/paymentsledger/payment/AgentFixturesHttpIT.java",
}


def raw(name):
    return json.loads((FIXTURES_DIR / f"{name}.json").read_text())


def recording(name, *, body=None, status=None):
    value = raw(name)
    request = value["request"]
    return Recording(
        name=value["name"], method=request["method"], path=request["path"],
        operation_name=request["operationName"], variables=request["variables"],
        status=value["response"]["status"] if status is None else status,
        body=value["response"]["body"] if body is None else body,
    )


def order_id(name="dispatch-order-delivered"):
    variables = raw(name)["request"]["variables"]
    return variables.get("id", variables.get("orderId"))


def payment_id(name="ledger-payment-captured"):
    return raw(name)["request"]["path"].split("/")[3]


def test_every_fixture_is_well_formed(fixture_names):
    assert set(fixture_names) == EXPECTED_NAMES
    for name in fixture_names:
        value = raw(name)
        assert set(value) == {"name", "source", "request", "response"}
        assert value["name"] == name
        assert value["source"] in PRODUCERS
        assert set(value["request"]) == {"method", "path", "operationName", "variables"}
        assert set(value["response"]) == {"status", "body"}
        assert isinstance(value["response"]["body"], dict)


def test_fixtures_contain_no_credentials(fixture_names):
    prohibited = ("s" * 40, "b" * 43, "x-service-token", "authorization", "bearer ",
                  "app_", "@", TOKEN.lower(), APP_TOKEN.lower())
    assert OPS_TOKEN.search(("OpsBearer ops_" + str(uuid.UUID(int=1)) + "." + "b" * 43).lower())
    for name in fixture_names:
        contents = (FIXTURES_DIR / f"{name}.json").read_text().lower()
        assert not OPS_TOKEN.search(contents), f"Forbidden content in {name}"
        for secret in prohibited:
            assert secret not in contents, f"Forbidden content in {name}"


def test_operations_match_the_contract():
    contract = Path(__file__).resolve().parents[2] / "contracts/dispatch-agent-operations.graphql"
    text = "\n".join(line for line in contract.read_text().splitlines()
                     if not line.lstrip().startswith("#"))
    normalize = lambda value: re.sub(r"\s+", " ", value).strip()
    assert normalize(text) == normalize(DOCUMENT)


def test_dispatch_request_shape(make_replay):
    replay = make_replay("dispatch-order-delivered")
    async def run():
        async with replay.client() as http:
            await DispatchClient(http, TOKEN).get_order(order_id())
    asyncio.run(run())
    request = replay.requests[0]
    assert request.method == "POST"
    assert request.url.path == "/graphql"
    assert request.headers["X-Service-Token"] == TOKEN
    assert "Authorization" not in request.headers
    body = json.loads(request.content)
    assert body["query"] == DOCUMENT
    assert body["operationName"] == "AgentOrder"
    assert body["variables"] == {"id": order_id()}


def test_get_order_delivered(make_replay):
    async def run():
        async with make_replay("dispatch-order-delivered").client() as http:
            order = await DispatchClient(http, TOKEN).get_order(order_id())
            assert isinstance(order, Order)
            assert order.status == OrderStatus.DELIVERED
            assert order.payment_status == OrderPaymentStatus.NOT_REQUIRED
            assert order.total_cents == 1250 and type(order.total_cents) is int
            assert len(order.items) == 1
            assert order.items[0].dish.price_cents == 1250
            assert order.driver is not None
            assert order.created_at.utcoffset() is not None
            assert order.updated_at.utcoffset() is not None
    asyncio.run(run())


def test_timeline_delivered(make_replay):
    async def run():
        async with make_replay("dispatch-timeline-delivered").client() as http:
            timeline = await DispatchClient(http, TOKEN).get_timeline(
                order_id("dispatch-timeline-delivered"))
            assert [(e.kind, e.from_status, e.to_status, e.actor) for e in timeline.events] == [
                (OrderEventKind.CREATED, None, OrderStatus.PENDING, OrderEventActor.CLIENT),
                (OrderEventKind.STATUS_CHANGED, OrderStatus.PENDING, OrderStatus.COOKING, OrderEventActor.OWNER),
                (OrderEventKind.STATUS_CHANGED, OrderStatus.COOKING, OrderStatus.COOKED, OrderEventActor.OWNER),
                (OrderEventKind.DRIVER_ASSIGNED, None, None, OrderEventActor.ASSIGNED_DRIVER),
                (OrderEventKind.STATUS_CHANGED, OrderStatus.COOKED, OrderStatus.PICKED_UP, OrderEventActor.ASSIGNED_DRIVER),
                (OrderEventKind.STATUS_CHANGED, OrderStatus.PICKED_UP, OrderStatus.DELIVERED, OrderEventActor.FULFILLMENT_PROVIDER),
            ]
            assert timeline.transitions() == tuple(timeline.events[i] for i in (0, 1, 2, 4, 5))
            assert timeline.courier_timeline() == timeline.events[3:]
            assert timeline.events[-1].provider_event_id
    asyncio.run(run())


def test_timeline_pending(make_replay):
    async def run():
        async with make_replay("dispatch-order-pending", "dispatch-timeline-pending").client() as http:
            client = DispatchClient(http, TOKEN)
            order = await client.get_order(order_id("dispatch-order-pending"))
            timeline = await client.get_timeline(order_id("dispatch-timeline-pending"))
            assert order.status == OrderStatus.PENDING
            assert order.driver is None
            assert len(timeline.events) == 1
            assert timeline.events[0].kind == OrderEventKind.CREATED
            assert timeline.courier_timeline() == ()
    asyncio.run(run())


def test_dispatch_not_found(make_replay):
    async def run():
        async with make_replay("dispatch-order-not-found").client() as http:
            with pytest.raises(NotFound) as caught:
                await DispatchClient(http, TOKEN).get_order(999999)
            assert caught.value.service == "dispatch"
            assert caught.value.code == "NOT_FOUND"
    asyncio.run(run())


def test_dispatch_unauthorized(make_replay):
    async def run():
        async with make_replay("dispatch-unauthorized").client() as http:
            with pytest.raises(Unauthorized) as caught:
                await DispatchClient(http, TOKEN).get_order(order_id("dispatch-unauthorized"))
            assert TOKEN not in str(caught.value)
            assert TOKEN not in repr(caught.value)
    asyncio.run(run())


def test_dispatch_rejects_invalid_ids_before_sending(make_replay):
    replay = FixtureReplay([])
    async def run():
        async with replay.client() as http:
            client = DispatchClient(http, TOKEN)
            for value in (0, -1, True, 1.0):
                with pytest.raises(ValueError):
                    await client.get_order(value)
            with pytest.raises(ValueError):
                await client.get_timeline("1")
    asyncio.run(run())
    assert replay.requests == []


def test_dispatch_envelope_forbidden_and_other_codes():
    async def run():
        for code, error in (("FORBIDDEN", Forbidden), ("INTERNAL", ServiceError)):
            body = {"data": {"getOrder": {"ok": False, "code": code, "error": "x", "order": None}}}
            replay = FixtureReplay([recording("dispatch-order-delivered", body=body)])
            async with replay.client() as http:
                with pytest.raises(error) as caught:
                    await DispatchClient(http, TOKEN).get_order(order_id())
                assert caught.value.code == code
    asyncio.run(run())


def test_dispatch_malformed_responses():
    original = raw("dispatch-order-delivered")["response"]["body"]
    bodies = [[], {"data": None}, {"data": {"getOrder": {"ok": True, "order": None}}}]
    for key, value in (("totalCents", 1250.0), ("status", "Cancelled"),
                       ("createdAt", "2026-10-26T10:00:00")):
        body = deepcopy(original)
        body["data"]["getOrder"]["order"][key] = value
        bodies.append(body)
    async def run():
        for body in bodies:
            replay = FixtureReplay([recording("dispatch-order-delivered", body=body)])
            async with replay.client() as http:
                with pytest.raises(MalformedResponse):
                    await DispatchClient(http, TOKEN).get_order(order_id())
    asyncio.run(run())


def test_ledger_request_shape(make_replay):
    replay = make_replay("ledger-payment-captured")
    async def run():
        async with replay.client() as http:
            await LedgerClient(http, APP_TOKEN).get_payment(payment_id())
    asyncio.run(run())
    request = replay.requests[0]
    assert request.method == "GET"
    assert request.url.path == f"/v1/payments/{payment_id()}"
    assert request.headers["Authorization"] == "Bearer " + APP_TOKEN
    assert "X-Service-Token" not in request.headers


def test_get_payment_and_refundable(make_replay):
    async def run():
        async with make_replay("ledger-payment-captured", "ledger-refundable-full").client() as http:
            client = LedgerClient(http, APP_TOKEN)
            payment = await client.get_payment(payment_id())
            assert isinstance(payment, Payment)
            assert payment.amount_minor == 100
            assert payment.captured_amount_minor == 100
            full = await client.get_refundable(payment_id("ledger-refundable-full"))
            assert (full.captured_minor, full.refunded_minor, full.reserved_minor, full.refundable_minor) == (100, 0, 0, 100)
            assert all(type(value) is int for value in (payment.amount_minor, payment.captured_amount_minor,
                       full.captured_minor, full.refunded_minor, full.reserved_minor, full.refundable_minor))
        async with make_replay("ledger-refundable-partial").client() as http:
            partial = await LedgerClient(http, APP_TOKEN).get_refundable(payment_id("ledger-refundable-partial"))
            assert partial.reserved_minor == 60
            assert partial.refundable_minor == 40
            assert all(type(value) is int for value in (partial.captured_minor, partial.refunded_minor,
                       partial.reserved_minor, partial.refundable_minor))
    asyncio.run(run())


def test_ledger_errors(make_replay):
    async def run():
        for name, error, code in (("ledger-payment-not-found", NotFound, "NOT_FOUND"),
                                  ("ledger-unauthorized", Unauthorized, "UNAUTHORIZED")):
            async with make_replay(name).client() as http:
                with pytest.raises(error) as caught:
                    await LedgerClient(http, APP_TOKEN).get_payment(payment_id(name))
                assert caught.value.code == code
                if error is NotFound:
                    assert caught.value.request_id
                assert APP_TOKEN not in str(caught.value)
                assert APP_TOKEN not in repr(caught.value)
    asyncio.run(run())


def test_ledger_retryable_and_unknown_errors():
    async def run():
        for status, code, retryable in ((429, "RATE_LIMITED", True), (500, "INTERNAL_ERROR", False)):
            body = {"code": code, "message": "Request failed", "retryable": retryable, "requestId": "test-request"}
            replay = FixtureReplay([recording("ledger-payment-captured", body=body, status=status)])
            async with replay.client() as http:
                with pytest.raises(ServiceError) as caught:
                    await LedgerClient(http, APP_TOKEN).get_payment(payment_id())
                assert caught.value.retryable is retryable
                assert caught.value.code == code
        transport = httpx.MockTransport(lambda request: httpx.Response(503, text="Service unavailable"))
        async with httpx.AsyncClient(base_url="http://fixture.invalid", transport=transport) as http:
            with pytest.raises(Unavailable) as caught:
                await LedgerClient(http, APP_TOKEN).get_payment(payment_id())
            assert caught.value.retryable is True
            assert caught.value.code is None
    asyncio.run(run())


def test_refundable_must_follow_the_contract_formula():
    original = raw("ledger-refundable-full")["response"]["body"]
    changes = [ {"refundableMinor": 50},
                {"controlState": "DISPUTE_BLOCKED", "refundableMinor": 100},
                {"refundableMinor": 40.0}, {"reservedMinor": -1} ]
    async def run():
        for change in changes:
            body = {**original, **change}
            replay = FixtureReplay([recording("ledger-refundable-full", body=body)])
            async with replay.client() as http:
                with pytest.raises(MalformedResponse):
                    await LedgerClient(http, APP_TOKEN).get_refundable(payment_id("ledger-refundable-full"))
    asyncio.run(run())


def test_ledger_rejects_invalid_payment_ids_before_sending():
    replay = FixtureReplay([])
    async def run():
        async with replay.client() as http:
            client = LedgerClient(http, APP_TOKEN)
            for value in ("pay_123", "ref_01HZX9K2M4N6P8Q0R2S4T6V8W0",
                          "pay_81HZX9K2M4N6P8Q0R2S4T6V8W0",
                          "pay_01HZX9K2M4N6P8Q0R2S4T6V8W0/../x"):
                with pytest.raises(ValueError):
                    await client.get_payment(value)
    asyncio.run(run())
    assert replay.requests == []


def test_transport_errors_are_unavailable():
    def fail(request):
        raise httpx.ConnectTimeout("Connection timed out", request=request)
    async def run():
        for client_type, token in ((DispatchClient, TOKEN), (LedgerClient, APP_TOKEN)):
            async with httpx.AsyncClient(base_url="http://fixture.invalid", transport=httpx.MockTransport(fail)) as http:
                client = client_type(http, token)
                with pytest.raises(Unavailable) as caught:
                    if client_type is DispatchClient:
                        await client.get_order(1)
                    else:
                        await client.get_payment("pay_01HZX9K2M4N6P8Q0R2S4T6V8W0")
                assert caught.value.retryable is True
                assert isinstance(caught.value.__cause__, httpx.ConnectTimeout)
    asyncio.run(run())


def test_replay_never_reaches_the_network(make_replay):
    replay = make_replay("ledger-payment-captured")
    async def run():
        async with replay.client() as http:
            with pytest.raises(UnrecordedRequest):
                await LedgerClient(http, APP_TOKEN).get_refundable(payment_id())
            with pytest.raises(UnrecordedRequest):
                await DispatchClient(http, TOKEN).get_order(1)
    asyncio.run(run())
    value = recording("ledger-payment-captured")
    with pytest.raises(ValueError):
        FixtureReplay([value, value])
