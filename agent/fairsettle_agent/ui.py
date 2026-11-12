"""English complaint page (Gradio) over the agent's HTTP API (F28)."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
import os
from uuid import uuid4

os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")

import gradio as gr
import httpx

COMPLAINT_TYPES = ("late_delivery", "missing_item", "wrong_item", "quality", "food_safety", "other")
FINAL = frozenset({"rejected", "declined", "escalated", "refunded", "refund_failed"})
SUBMIT_TIMEOUT_S = 660.0
SENDING = "Sending your complaint. This can take a few minutes."
LABELS = {
    "running": "Working on it", "submitting": "Sending the proposal", "submit_retry": "Sending the proposal",
    "awaiting_review": "Waiting for a reviewer", "approved": "Approved, refund in progress",
    "declined": "Rejected by the agent", "rejected": "Declined by a reviewer", "escalated": "Passed to a person",
    "refunded": "Refunded", "refund_failed": "Refund failed, a person will follow up",
}


@dataclass(frozen=True)
class UiConfig:
    agent_base_url: str
    trace_base_url: str | None
    host: str
    port: int
    poll_seconds: float

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "UiConfig":
        agent_base_url = env.get("AGENT_BASE_URL", "http://127.0.0.1:8000")
        if not agent_base_url.startswith(("http://", "https://")):
            raise ValueError("AGENT_BASE_URL must be an http(s) URL")
        trace_base_url = env.get("TRACE_BASE_URL")
        if trace_base_url is not None:
            if not trace_base_url.startswith(("http://", "https://")):
                raise ValueError("TRACE_BASE_URL must be an http(s) URL")
            if not trace_base_url.endswith("/"):
                trace_base_url += "/"
        try:
            port = int(env.get("UI_PORT", "7860"))
            if not 1 <= port <= 65535:
                raise ValueError()
        except ValueError:
            raise ValueError("UI_PORT must be an integer from 1 to 65535") from None
        try:
            poll_seconds = float(env.get("UI_POLL_SECONDS", "3"))
            if not 1 <= poll_seconds <= 60:
                raise ValueError()
        except ValueError:
            raise ValueError("UI_POLL_SECONDS must be a number from 1 to 60") from None
        return cls(agent_base_url, trace_base_url, env.get("UI_HOST", "127.0.0.1"), port, poll_seconds)


def new_complaint_id() -> str:
    return "ui-" + uuid4().hex[:16]


async def submit(http: httpx.AsyncClient, order_id: int, complaint_type: str, text: str) -> tuple[str | None, str]:
    if type(order_id) is float and order_id.is_integer():
        order_id = int(order_id)
    if type(order_id) is not int or order_id < 1:
        return None, "Enter an order number."
    if complaint_type not in COMPLAINT_TYPES:
        return None, "Choose what went wrong."
    if not 1 <= len(text.strip()) <= 4000:
        return None, "Describe the problem in up to 4000 characters."
    complaint_id = new_complaint_id()
    try:
        response = await http.post("/v1/complaints", json={
            "complaint_id": complaint_id, "order_id": order_id,
            "complaint_type": complaint_type, "text": text.strip(),
        }, timeout=SUBMIT_TIMEOUT_S)
    except httpx.HTTPError:
        return None, "The agent is not reachable. Try again later."
    if response.status_code == 201:
        return complaint_id, ""
    if response.status_code == 409:
        return None, "This complaint was already sent."
    if response.status_code == 422:
        return None, "The agent could not accept this complaint. Check the order number."
    return None, f"The agent answered {response.status_code}. Try again later."


async def read_status(http: httpx.AsyncClient, complaint_id: str) -> dict | None:
    try:
        response = await http.get("/v1/complaints/" + complaint_id, timeout=10.0)
    except httpx.HTTPError:
        return {"status": "unknown"}
    if response.status_code == 200:
        return response.json()
    if response.status_code == 404:
        return None
    return {"status": "unknown"}


def render(body: dict | None, trace_base_url: str | None) -> str:
    if body is None:
        return "No complaint yet."
    status = body.get("status", "unknown")
    parts = [f"**Status:** {LABELS.get(status, status)}"]
    case = f"**Case:** `{body.get('complaint_id', '')}`"
    if body.get("proposal_id"):
        case += f" · **Proposal:** `{body['proposal_id']}`"
    parts.append(case)
    decision = body.get("decision")
    if decision is not None:
        outcome = decision["outcome"]
        if outcome == "propose":
            parts.append(
                f"**Decision:** {decision['decision'].replace('_', ' ')} "
                f"of ${decision['amount_cents'] / 100:.2f} for {decision['reason_code'].replace('_', ' ')}"
            )
            parties = ", ".join(
                f"{split['party']} {split['basis_points'] / 100:.0f}%"
                for split in decision["liability"] if split["basis_points"] != 0
            )
            parts.append("**Who pays:** " + parties)
        elif outcome == "reject":
            parts.append("**Decision:** reject")
        elif outcome == "escalate":
            line = "**Decision:** passed to a person"
            if decision.get("stage"):
                line += f" ({decision['stage']}: {decision['reason'].replace('_', ' ')})"
            elif decision.get("violations"):
                line += f" ({', '.join(rule.replace('_', ' ') for rule in decision['violations'])})"
            parts.append(line)
    if trace_base_url and body.get("trace_id"):
        parts.append(f"[Open the trace]({trace_base_url}{body['trace_id']})")
    return "\n\n".join(parts)


def is_final(body: dict | None) -> bool:
    return body is not None and body.get("status") in FINAL


def sending_state() -> tuple[str, gr.Button]:
    return SENDING, gr.Button(interactive=False)


def ready_state() -> gr.Button:
    return gr.Button(interactive=True)


def build_ui(config: UiConfig, client_factory: Callable[[], httpx.AsyncClient]) -> gr.Blocks:
    with gr.Blocks(title="FairSettle complaints") as demo:
        gr.Markdown("# Report a problem with an order")
        order = gr.Number(label="Order number", precision=0)
        kind = gr.Dropdown(choices=list(COMPLAINT_TYPES), label="What went wrong", value="missing_item")
        text = gr.Textbox(label="Describe the problem", lines=4, max_length=4000)
        send = gr.Button("Send complaint", variant="primary")
        notice = gr.Markdown("")
        status = gr.Markdown(render(None, config.trace_base_url))
        case = gr.State(None)
        timer = gr.Timer(config.poll_seconds, active=False)

        async def send_complaint(order_id, complaint_type, description):
            async with client_factory() as http:
                complaint_id, message = await submit(http, order_id, complaint_type, description)
                if complaint_id is None:
                    return gr.skip(), message, gr.skip(), gr.Timer(config.poll_seconds, active=False)
                body = await read_status(http, complaint_id)
            return complaint_id, "", render(body, config.trace_base_url), gr.Timer(config.poll_seconds, active=not is_final(body))

        async def refresh(complaint_id):
            if complaint_id is None:
                return gr.skip(), gr.Timer(config.poll_seconds, active=False)
            async with client_factory() as http:
                body = await read_status(http, complaint_id)
            return render(body, config.trace_base_url), gr.Timer(config.poll_seconds, active=not is_final(body))

        send.click(sending_state, outputs=[notice, send]).then(
            send_complaint, inputs=[order, kind, text], outputs=[case, notice, status, timer],
        ).then(ready_state, outputs=[send])
        timer.tick(refresh, inputs=[case], outputs=[status, timer])
    return demo


def main(env: Mapping[str, str] = os.environ, launch: Callable[..., object] | None = None) -> None:
    config = UiConfig.from_env(env)
    demo = build_ui(config, lambda: httpx.AsyncClient(base_url=config.agent_base_url))
    demo.queue()
    (launch or demo.launch)(server_name=config.host, server_port=config.port)


if __name__ == "__main__":
    main()
