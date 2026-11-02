import asyncio
import json
import os
import re

import httpx
import pytest
from fastapi.testclient import TestClient

from fairsettle_agent.complaint import ComplaintInput
from fairsettle_agent.ui import (
    FINAL, SUBMIT_TIMEOUT_S, UiConfig, build_ui, is_final, main,
    new_complaint_id, read_status, render, submit,
)
import gradio as gr

from decide_factory import MockCompletion
from resume_factory import make_input, open_test_agent
from test_service import app_for


def test_config_defaults_and_validation():
    config = UiConfig.from_env({})
    assert config == UiConfig("http://127.0.0.1:8000", None, "127.0.0.1", 7860, 3.0)
    assert UiConfig.from_env({"TRACE_BASE_URL": "http://h/traces"}).trace_base_url == "http://h/traces/"
    for env, message in (
        ({"AGENT_BASE_URL": "ftp://x"}, "AGENT_BASE_URL must be an http(s) URL"),
        ({"UI_PORT": "0"}, "UI_PORT must be an integer from 1 to 65535"),
        ({"UI_PORT": "70000"}, "UI_PORT must be an integer from 1 to 65535"),
        ({"UI_PORT": "x"}, "UI_PORT must be an integer from 1 to 65535"),
        ({"UI_POLL_SECONDS": "0.5"}, "UI_POLL_SECONDS must be a number from 1 to 60"),
        ({"UI_POLL_SECONDS": "61"}, "UI_POLL_SECONDS must be a number from 1 to 60"),
    ):
        with pytest.raises(ValueError) as caught:
            UiConfig.from_env(env)
        assert str(caught.value) == message


def test_complaint_ids():
    ids = [new_complaint_id() for _ in range(100)]
    assert len(set(ids)) == 100
    for complaint_id in ids:
        assert re.fullmatch(r"ui-[0-9a-f]{16}", complaint_id)
        assert not complaint_id.startswith("delivery-failed-")
        assert ComplaintInput(
            complaint_id=complaint_id, order_id=7,
            complaint_type="missing_item", text="The drink was missing.",
        ).complaint_id == complaint_id


def test_submit_sends_one_post():
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(201, json={"complaint_id": json.loads(request.content)["complaint_id"]})

    async def run():
        async with httpx.AsyncClient(base_url="http://agent.invalid", transport=httpx.MockTransport(respond)) as http:
            complaint_id, message = await submit(http, 7.0, "missing_item", "  The drink was missing. \n")
        assert message == "" and re.fullmatch(r"ui-[0-9a-f]{16}", complaint_id)
        assert len(requests) == 1
        request = requests[0]
        assert request.method == "POST" and request.url.path == "/v1/complaints"
        assert json.loads(request.content) == {
            "complaint_id": complaint_id, "order_id": 7,
            "complaint_type": "missing_item", "text": "The drink was missing.",
        }
        assert type(json.loads(request.content)["order_id"]) is int
        assert SUBMIT_TIMEOUT_S == 660.0
        assert request.extensions["timeout"]["read"] == 660.0
    asyncio.run(run())


def test_submit_validates_and_maps_errors():
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(201)

    async def run():
        async with httpx.AsyncClient(base_url="http://agent.invalid", transport=httpx.MockTransport(respond)) as http:
            for order, kind, text, message in (
                (0, "missing_item", "Missing", "Enter an order number."),
                (None, "missing_item", "Missing", "Enter an order number."),
                (2.5, "missing_item", "Missing", "Enter an order number."),
                (7, "invalid", "Missing", "Choose what went wrong."),
                (7, "missing_item", "  ", "Describe the problem in up to 4000 characters."),
                (7, "missing_item", "x" * 4001, "Describe the problem in up to 4000 characters."),
            ):
                assert await submit(http, order, kind, text) == (None, message)
            assert requests == []
        for code, message in (
            (409, "This complaint was already sent."),
            (422, "The agent could not accept this complaint. Check the order number."),
            (503, "The agent answered 503. Try again later."),
        ):
            async with httpx.AsyncClient(
                base_url="http://agent.invalid",
                transport=httpx.MockTransport(lambda request: httpx.Response(code, text="private-response-body")),
            ) as http:
                result = await submit(http, 7, "missing_item", "Missing")
                assert result == (None, message)
                assert "private-response-body" not in result[1]

        def fail(request):
            raise httpx.ConnectError("private-error-text", request=request)

        async with httpx.AsyncClient(base_url="http://agent.invalid", transport=httpx.MockTransport(fail)) as http:
            result = await submit(http, 7, "missing_item", "Missing")
            assert result == (None, "The agent is not reachable. Try again later.")
            assert "private-error-text" not in result[1]
    asyncio.run(run())


def test_read_status():
    async def run():
        body = {"complaint_id": "ui-123", "status": "awaiting_review"}
        for code, expected in ((200, body), (404, None), (500, {"status": "unknown"})):
            def respond(request):
                assert request.method == "GET" and request.url.path == "/v1/complaints/ui-123"
                assert request.extensions["timeout"]["read"] == 10.0
                return httpx.Response(code, json=body)
            async with httpx.AsyncClient(base_url="http://agent.invalid", transport=httpx.MockTransport(respond)) as http:
                assert await read_status(http, "ui-123") == expected

        def fail(request):
            raise httpx.ConnectError("private-error-text", request=request)

        async with httpx.AsyncClient(base_url="http://agent.invalid", transport=httpx.MockTransport(fail)) as http:
            assert await read_status(http, "ui-123") == {"status": "unknown"}
    asyncio.run(run())


def test_render():
    assert render(None, None) == "No complaint yet."
    body = {
        "complaint_id": "ui-123", "proposal_id": "prop_X", "trace_id": "trace_X",
        "status": "awaiting_review", "text": "private-complaint-text",
        "decision": {
            "outcome": "propose", "decision": "partial_refund", "amount_cents": 300,
            "reason_code": "missing_item", "liability": [
                {"party": "restaurant", "basis_points": 10000},
                {"party": "driver", "basis_points": 0},
                {"party": "platform", "basis_points": 0},
            ], "violations": [],
        },
    }
    result = render(body, "http://h/traces/")
    parts = [
        "Waiting for a reviewer", "`prop_X`", "partial refund of $3.00 for missing item",
        "restaurant 100%", "[Open the trace](http://h/traces/trace_X)",
    ]
    positions = [result.index(part) for part in parts]
    assert positions == sorted(positions)
    assert "private-complaint-text" not in result
    assert "Open the trace" not in render(body, None)
    body["decision"]["liability"] = [
        {"party": "restaurant", "basis_points": 5000},
        {"party": "driver", "basis_points": 0},
        {"party": "platform", "basis_points": 5000},
    ]
    assert "restaurant 50%, platform 50%" in render(body, None)
    body["decision"] = {"outcome": "escalate", "stage": "decide", "reason": "decision_invalid"}
    assert "passed to a person (decide: decision invalid)" in render(body, None)
    body["decision"] = {"outcome": "escalate"}
    assert "**Decision:** passed to a person" in render(body, None)
    body["decision"] = {"outcome": "reject"}
    assert "**Decision:** reject" in render(body, None)
    # finish: an agent reject ends "declined"; a reviewer's REJECTED ends "rejected".
    assert "**Status:** Rejected by the agent" in render({**body, "status": "declined"}, None)
    assert "**Status:** Declined by a reviewer" in render({**body, "status": "rejected"}, None)


def test_is_final():
    assert FINAL == frozenset({"rejected", "declined", "escalated", "refunded", "refund_failed"})
    for status in FINAL:
        assert is_final({"status": status}) is True
    for status in ("awaiting_review", "approved", "running", "unknown"):
        assert is_final({"status": status}) is False
    assert is_final(None) is False


def test_build_ui_without_serving():
    def factory():
        return httpx.AsyncClient(base_url="http://agent.invalid", transport=httpx.MockTransport(lambda request: httpx.Response(404)))
    assert isinstance(build_ui(UiConfig.from_env({}), factory), gr.Blocks)
    assert os.environ["GRADIO_ANALYTICS_ENABLED"] == "False"


def test_main_launches_with_config():
    calls = []
    main(env={"UI_HOST": "0.0.0.0", "UI_PORT": "7861"}, launch=lambda **kwargs: calls.append(kwargs))
    assert calls == [{"server_name": "0.0.0.0", "server_port": 7861}]


def test_get_includes_a_decision_summary(database_url):
    complaint = make_input()
    with TestClient(app_for(database_url)) as client:
        response = client.post("/v1/complaints", json=complaint.model_dump(mode="json"))
        assert response.status_code == 201
        assert "decision" not in response.json()
        response = client.get("/v1/complaints/" + complaint.complaint_id)
        assert response.status_code == 200
        decision = response.json()["decision"]
        assert set(decision) == {"outcome", "decision", "amount_cents", "reason_code", "liability", "violations"}
        assert decision["outcome"] == "propose"
        assert "explanation" not in response.text and "evidence_refs" not in response.text
        assert complaint.text not in response.text


def test_summary_of_an_escalation_hides_its_detail(database_url):
    async def run():
        complete = MockCompletion(["DONE", "not json", "not json"])
        async with open_test_agent(database_url, complete=complete) as agent:
            complaint = make_input()
            await agent.start(complaint)
            assert await agent.summary(complaint.complaint_id) == {
                "outcome": "escalate", "stage": "decide", "reason": "decision_invalid",
            }
    asyncio.run(run())


def test_summary_is_none_for_unknown_cases(database_url):
    async def run():
        async with open_test_agent(database_url) as agent:
            assert await agent.summary("nope") is None
    asyncio.run(run())
