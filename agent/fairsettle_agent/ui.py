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

CUSTOM_CSS = """
/* Container & Layout */
.gradio-container {
    max-width: 920px !important;
    margin: 0 auto !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
}

/* Header branding card */
.fs-hero {
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.95) 100%);
    border: 1px solid rgba(226, 232, 240, 0.9);
    border-radius: 20px;
    padding: 22px 26px;
    margin-bottom: 20px;
    box-shadow: 0 10px 28px -6px rgba(15, 23, 42, 0.05);
}
.fs-hero-title {
    font-size: 24px;
    font-weight: 900;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 6px;
    letter-spacing: -0.02em;
}
.fs-hero-badge {
    font-size: 11px;
    font-weight: 700;
    background: #ecfdf5;
    color: #059669;
    border: 1px solid #a7f3d0;
    padding: 3px 10px;
    border-radius: 9999px;
    letter-spacing: 0.02em;
}
.fs-hero-desc {
    color: #64748b;
    font-size: 13px;
    line-height: 1.5;
    margin: 0;
}

/* Preset scenarios */
.fs-presets-box {
    margin-bottom: 12px;
}
.fs-preset-btn {
    border-radius: 10px !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    background: #f8fafc !important;
    border: 1px solid #e2e8f0 !important;
    transition: all 0.2s ease !important;
}
.fs-preset-btn:hover {
    transform: translateY(-1px) !important;
    background: #fff7ed !important;
    border-color: #fdba74 !important;
    color: #ea580c !important;
    box-shadow: 0 4px 12px rgba(245, 99, 17, 0.12) !important;
}

/* Primary Action Button */
button.primary {
    background: linear-gradient(135deg, #f56311 0%, #ea580c 100%) !important;
    border: none !important;
    font-weight: 700 !important;
    letter-spacing: 0.01em !important;
    box-shadow: 0 4px 14px rgba(245, 99, 17, 0.28) !important;
    border-radius: 12px !important;
    padding: 10px 20px !important;
}
button.primary:hover {
    box-shadow: 0 6px 20px rgba(245, 99, 17, 0.38) !important;
    transform: translateY(-1px) !important;
}

/* Liability Split Visualizer */
.fs-liability-box {
    margin-top: 18px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 16px 20px;
    box-shadow: 0 4px 16px rgba(15, 23, 42, 0.03);
}
.fs-box-title {
    font-size: 12px;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 10px;
}
.fs-split-bar {
    height: 18px;
    border-radius: 9999px;
    overflow: hidden;
    display: flex;
    background: #f1f5f9;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);
    margin-bottom: 12px;
}
.fs-split-seg {
    height: 100%;
    transition: width 0.4s ease;
}
.fs-party-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
}
.fs-party-card {
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    padding: 10px;
    text-align: center;
}
.fs-party-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    margin-bottom: 2px;
}
.fs-party-title {
    font-size: 12px;
    font-weight: 700;
}
.fs-party-pct {
    font-size: 20px;
    font-weight: 900;
    line-height: 1.1;
    margin-bottom: 2px;
}
.fs-party-bp {
    font-size: 11px;
    color: #64748b;
    font-weight: 500;
}

/* Timeline Pipeline */
.fs-timeline-box {
    margin-top: 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 16px 20px;
}
.fs-timeline-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
}
.fs-step-col {
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 10px 8px;
    text-align: center;
}
.fs-step-icon {
    font-size: 13px;
    font-weight: 800;
    margin-bottom: 4px;
}
.fs-step-name {
    font-size: 12px;
    font-weight: 700;
    color: #1e293b;
    margin-bottom: 2px;
}
.fs-step-desc {
    font-size: 10px;
    color: #64748b;
    line-height: 1.3;
}
.fs-step-done {
    border-color: #a7f3d0;
    background: #f0fdf4;
}
.fs-step-done .fs-step-icon {
    color: #059669;
}
.fs-step-active {
    border-color: #fde68a;
    background: #fffbeb;
}
.fs-step-active .fs-step-icon {
    color: #d97706;
}
.fs-step-todo {
    opacity: 0.55;
}
.fs-step-halted {
    border-color: #fecdd3;
    background: #fff1f2;
}
.fs-step-halted .fs-step-icon {
    color: #e11d48;
}

/* Trace link button styling */
a[href*="/traces/"] {
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%) !important;
    color: #38bdf8 !important;
    padding: 6px 14px !important;
    border-radius: 9999px !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    text-decoration: none !important;
    margin-top: 8px !important;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.15) !important;
}
a[href*="/traces/"]:hover {
    color: #7dd3fc !important;
    box-shadow: 0 4px 14px rgba(56, 189, 248, 0.25) !important;
}
"""


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


def render_liability_html(liability: list[dict]) -> str:
    meta = {
        "restaurant": {"name": "Restaurant", "icon": "🍽️", "color": "#f56311", "bg": "#fff7ed", "border": "#fed7aa"},
        "driver": {"name": "Driver", "icon": "🛵", "color": "#2563eb", "bg": "#eff6ff", "border": "#bfdbfe"},
        "platform": {"name": "Platform", "icon": "🛡️", "color": "#059669", "bg": "#ecfdf5", "border": "#a7f3d0"},
    }
    segments = []
    cards = []
    for split in liability:
        party = split.get("party", "")
        bp = split.get("basis_points", 0)
        pct = bp / 100.0
        m = meta.get(party, {"name": party.capitalize(), "icon": "📌", "color": "#64748b", "bg": "#f8fafc", "border": "#e2e8f0"})
        if pct > 0:
            segments.append(
                f'<div style="width: {pct}%; background-color: {m["color"]};" class="fs-split-seg" title="{m["name"]}: {pct:.0f}%"></div>'
            )
        cards.append(
            f'<div class="fs-party-card" style="border-color: {m["border"]}; background-color: {m["bg"]};">'
            f'  <div class="fs-party-header">'
            f'    <span class="fs-party-icon">{m["icon"]}</span>'
            f'    <span class="fs-party-title" style="color: {m["color"]};">{m["name"]}</span>'
            f'  </div>'
            f'  <div class="fs-party-pct" style="color: {m["color"]};">{pct:.0f}%</div>'
            f'  <div class="fs-party-bp">{bp:,} bp</div>'
            f'</div>'
        )
    seg_html = "".join(segments) if segments else '<div style="width: 100%; background: #e2e8f0;" class="fs-split-seg"></div>'
    cards_html = "".join(cards)
    return (
        '\n\n<div class="fs-liability-box">'
        '  <div class="fs-box-title">⚖️ Visual Liability Allocation</div>'
        f'  <div class="fs-split-bar">{seg_html}</div>'
        f'  <div class="fs-party-grid">{cards_html}</div>'
        '</div>'
    )


def render_timeline_html(status: str) -> str:
    if status in ("running", "submitting", "submit_retry"):
        s1, s2, s3, s4 = "done", "active", "todo", "todo"
    elif status == "awaiting_review":
        s1, s2, s3, s4 = "done", "done", "done", "active"
    elif status in ("approved", "refunded"):
        s1, s2, s3, s4 = "done", "done", "done", "done"
    elif status in ("declined", "rejected", "escalated", "refund_failed"):
        s1, s2, s3, s4 = "done", "done", "done", "halted"
    else:
        s1, s2, s3, s4 = "done", "todo", "todo", "todo"

    steps = [
        ("1. Order Intake", "Claim & context", s1),
        ("2. Telemetry Audit", "Fulfillment & ledger", s2),
        ("3. AI Fault Attribution", "Liability split & safety", s3),
        ("4. Ledger Settlement", "Ops review & PayPal", s4),
    ]

    items = []
    for title, desc, st in steps:
        icon = "✓" if st == "done" else ("●" if st == "active" else ("✕" if st == "halted" else "○"))
        items.append(
            f'<div class="fs-step-col fs-step-{st}">'
            f'  <div class="fs-step-icon">{icon}</div>'
            f'  <div class="fs-step-name">{title}</div>'
            f'  <div class="fs-step-desc">{desc}</div>'
            f'</div>'
        )
    return (
        '\n\n<div class="fs-timeline-box">'
        '  <div class="fs-box-title">🤖 Agent Settlement Pipeline</div>'
        f'  <div class="fs-timeline-row">{"".join(items)}</div>'
        '</div>'
    )


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

    # Rich visual enhancements appended after standard markdown
    if decision is not None and decision.get("outcome") == "propose" and decision.get("liability"):
        parts.append(render_liability_html(decision["liability"]))
    parts.append(render_timeline_html(status))

    return "\n\n".join(parts)


def is_final(body: dict | None) -> bool:
    return body is not None and body.get("status") in FINAL


def sending_state() -> tuple[str, gr.Button]:
    return SENDING, gr.Button(interactive=False)


def ready_state() -> gr.Button:
    return gr.Button(interactive=True)


def build_ui(config: UiConfig, client_factory: Callable[[], httpx.AsyncClient]) -> gr.Blocks:
    with gr.Blocks(title="FairSettle complaints") as demo:
        gr.HTML(f"<style>{CUSTOM_CSS}</style>")
        gr.HTML("""
        <div class="fs-hero">
          <div class="fs-hero-title">
            <span>⚖️ FairSettle Dispute Center</span>
            <span class="fs-hero-badge">AI Settlement · Live</span>
          </div>
          <p class="fs-hero-desc">AI proposes the refund and liability split; a person approves it before the ledger refunds on PayPal.</p>
        </div>
        """)

        with gr.Row(elem_classes=["fs-presets-box"]):
            btn_missing = gr.Button("🍋 Scenario 1: Missing Lemonade", variant="secondary", size="sm", elem_classes=["fs-preset-btn"])
            btn_late = gr.Button("❄️ Scenario 2: Severe Late Delivery", variant="secondary", size="sm", elem_classes=["fs-preset-btn"])
            btn_failed = gr.Button("❌ Scenario 3: Delivery Failed", variant="secondary", size="sm", elem_classes=["fs-preset-btn"])

        gr.Markdown("# Report a problem with an order")
        order = gr.Number(label="Order number", precision=0)
        kind = gr.Dropdown(choices=list(COMPLAINT_TYPES), label="What went wrong", value="missing_item")
        text = gr.Textbox(label="Describe the problem", lines=4, max_length=4000)
        send = gr.Button("Send complaint", variant="primary")
        notice = gr.Markdown("")
        status = gr.Markdown(render(None, config.trace_base_url))
        case = gr.State(None)
        timer = gr.Timer(config.poll_seconds, active=False)

        def set_missing():
            return 1, "missing_item", "The order arrived, but the Lemonade ($2.50) was missing from the bag. The pizza was intact."

        def set_late():
            return 1, "late_delivery", "The courier took over 75 minutes to deliver the food. The pizza was completely cold and inedible."

        def set_failed():
            return 1, "other", "The courier marked the order as delivered, but neither the front desk nor my apartment received any package."

        btn_missing.click(set_missing, outputs=[order, kind, text])
        btn_late.click(set_late, outputs=[order, kind, text])
        btn_failed.click(set_failed, outputs=[order, kind, text])

        def init_order_from_query(request: gr.Request):
            if request:
                try:
                    val = request.query_params.get("order_id")
                    if val:
                        return int(val)
                except (ValueError, TypeError):
                    pass
            return gr.skip()

        demo.load(init_order_from_query, outputs=[order])

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
