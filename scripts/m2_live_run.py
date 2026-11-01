#!/usr/bin/env python3
"""Drive the F24 live run through the local stack: dispatch, ledger, agent and Langfuse."""
from base64 import b64encode
from collections import Counter
from dataclasses import dataclass
import json
import os
import re
import secrets
import sys
import time
from typing import Mapping
import urllib.error
import urllib.request

LEDGER, WORKER = "http://localhost:8080", "http://localhost:8081"
DISPATCH, AGENT, LANGFUSE = "http://localhost:4000/graphql", "http://localhost:8000", "http://localhost:3000"
APP_CREDENTIAL = "10000000-0000-0000-0000-000000000041"
OPS_VIEWER_CREDENTIAL = "10000000-0000-0000-0000-000000000061"
OPS_REVIEWER_CREDENTIAL = "10000000-0000-0000-0000-000000000062"
LANGFUSE_PROJECT = "fairsettle-local"
DISHES = (("Margherita", 1200, "Tomato, mozzarella, basil"), ("Lemonade", 300, "Fresh lemonade, 330 ml"))
COMPLAINT_TEXT = "The lemonade was missing from my bag. The pizza arrived."
PARTY_ACCOUNTS = {"RESTAURANT": "REFUND_RECEIVABLE_RESTAURANT", "DRIVER": "REFUND_RECEIVABLE_DRIVER",
                  "PLATFORM": "REFUND_COST_PLATFORM"}
TRACE_NAMES = {"start", "gather", "count", "investigate", "decide", "submit", "resume_review", "await_review",
               "approved", "resume_refund", "await_refund", "finish"}
PAYPAL_ID = re.compile(r"^[A-Z0-9]{1,36}$")


@dataclass(frozen=True, repr=False)
class Config:
    app_token: str
    ops_token: str
    public_host: str
    langfuse_public_key: str
    langfuse_secret_key: str

    def __repr__(self):
        return f"Config(public_host={self.public_host!r}, langfuse_public_key={self.langfuse_public_key!r})"


def load_config(env: Mapping[str, str]) -> Config:
    names = ("LOCAL_APP_SECRET", "LOCAL_OPS_SECRET", "LOCAL_AGENT_SECRET")
    for name in names:
        if len(env.get(name, "")) != 43:
            raise ValueError(f"{name} must be a 43-character secret")
    if len({env[name] for name in names}) != 3:
        raise ValueError("LOCAL_* secrets must differ")
    host = env.get("PUBLIC_HOST", "")
    if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", host):
        raise ValueError("PUBLIC_HOST must be a bare host name")
    for name, prefix in (("LANGFUSE_PUBLIC_KEY", "pk-lf-"), ("LANGFUSE_SECRET_KEY", "sk-lf-")):
        if not env.get(name, "").startswith(prefix):
            raise ValueError(f"{name} must start with {prefix}")
    return Config(f"app_{APP_CREDENTIAL}." + env["LOCAL_APP_SECRET"],
                  f"ops_{OPS_VIEWER_CREDENTIAL}." + env["LOCAL_OPS_SECRET"], host,
                  env["LANGFUSE_PUBLIC_KEY"], env["LANGFUSE_SECRET_KEY"])


def complaint_body(run_id, order_id) -> dict:
    return {"complaint_id": "complaint-m2-" + run_id, "order_id": order_id,
            "complaint_type": "missing_item", "text": COMPLAINT_TEXT}


def checkout_url(order) -> str:
    url = order.get("checkoutUrl")
    if not isinstance(url, str) or not url.startswith("https://www.sandbox.paypal.com/"):
        raise RuntimeError("checkout URL must be a PayPal sandbox URL")
    return url


def payment_done(payment) -> bool:
    return payment.get("paymentStatus") == "SUCCEEDED" and payment.get("resolutionStatus") == "KNOWN"


def check_proposal(proposal, complaint_id, payment_id, trace_id) -> list[str]:
    checks = (
        (proposal.get("complaintId") == complaint_id, "proposal complaintId differs"),
        (proposal.get("paymentId") == payment_id, "proposal paymentId differs"),
        (proposal.get("amountMinor", 0) > 0, "proposal amountMinor must be positive"),
        (sum(line["basisPoints"] for line in proposal.get("liability", [])) == 10000, "proposal shares must sum to 10000"),
        (bool(proposal.get("evidenceRefs")), "proposal evidenceRefs are empty"),
        ((proposal.get("agentRun") or {}).get("traceId") == trace_id, "proposal traceId differs"),
    )
    return [message for passed, message in checks if not passed]


def check_refund(refund, proposal) -> list[str]:
    checks = (
        (refund.get("refundStatus") == "SUCCEEDED", "refund is not SUCCEEDED"),
        (refund.get("resolutionStatus") == "KNOWN", "refund resolution is not KNOWN"),
        (refund.get("financialStatus") == "POSTED", "refund financial status is not POSTED"),
        (refund.get("amountMinor") == proposal["amountMinor"], "refund amount differs"),
        (bool(PAYPAL_ID.fullmatch(refund.get("providerRefundId") or "")), "refund has an invalid PayPal id"),
    )
    return [message for passed, message in checks if not passed]


def check_liability(liability, proposal) -> list[str]:
    shares = {line["party"]: line["basisPoints"] for line in proposal["liability"]}
    lines = liability.get("lines", [])
    checks = (
        (liability.get("postingStatus") == "POSTED", "liability is not POSTED"),
        (liability.get("journalId") is not None, "liability journalId is missing"),
        (liability.get("refundId") == proposal["refundId"], "liability refundId differs"),
        (sum(line["amountMinor"] for line in lines) == liability["amountMinor"], "liability line amounts do not sum to amountMinor"),
    )
    failures = [message for passed, message in checks if not passed]
    failures.extend("liability share differs for " + line["party"] for line in lines
                    if line["basisPoints"] != shares.get(line["party"]))
    return failures


def check_journal(journal, liability) -> list[str]:
    currency = liability["currency"]
    expected = Counter(("DEBIT", PARTY_ACCOUNTS[line["party"]], line["amountMinor"], currency)
                       for line in liability["lines"] if line["amountMinor"] > 0)
    expected[("CREDIT", "SALES_RETURNS", liability["amountMinor"], currency)] += 1
    actual = Counter((entry.get("direction"), entry.get("accountPurpose"), entry.get("amountMinor"), entry.get("currency"))
                     for entry in journal.get("entries", []))
    return [] if actual == expected else ["liability journal entries differ"]


def check_balances(before, after, liability) -> list[str]:
    def amounts(items):
        totals = Counter()
        for item in items:
            totals[item["accountPurpose"]] += item["balanceMinor"]
        return totals
    old, new = amounts(before), amounts(after)
    lines = {line["party"]: line["amountMinor"] for line in liability["lines"]}
    return ["balance delta differs for " + party for party, account in PARTY_ACCOUNTS.items()
            if new[account] - old[account] != lines.get(party, 0)]


def check_trace(observations, proposal, complaint_id) -> list[str]:
    failures = []
    names = {item.get("name") for item in observations}
    if not TRACE_NAMES <= names or not names <= TRACE_NAMES | {"retry_submit"}:
        failures.append("trace observation names differ")
    if any(item.get("traceId") != proposal["agentRun"]["traceId"] for item in observations):
        failures.append("trace ids differ")
    if any(item.get("sessionId") != complaint_id for item in observations):
        failures.append("trace session ids differ")
    for item in observations:
        if item.get("name") == "decide" and (item.get("type") != "GENERATION" or
                item.get("metadata", {}).get("evidence_refs") != proposal["evidenceRefs"]):
            failures.append("trace decide evidence differs")
        if item.get("name") == "finish" and item.get("metadata", {}).get("final") != "refunded":
            failures.append("trace finish is not refunded")
    document = json.dumps(observations)
    if COMPLAINT_TEXT in document or (proposal.get("explanation") and proposal["explanation"] in document):
        failures.append("trace contains complaint text or explanation")
    return failures


def trace_url(trace_id) -> str:
    if not re.fullmatch(r"[0-9a-f]{32}", trace_id):
        raise ValueError("trace id must be 32 lowercase hexadecimal characters")
    return f"{LANGFUSE}/project/{LANGFUSE_PROJECT}/traces/{trace_id}"


def summary(ids, liability, failures) -> str:
    lines = ["F24 live run: " + ("FAIL" if failures else "PASS")]
    for label, key in (("dispatch order id", "order_id"), ("ledger payment id", "payment_id"),
                       ("paypal order id", "paypal_order_id"), ("paypal capture id", "paypal_capture_id"),
                       ("complaint id", "complaint_id"), ("proposal id", "proposal_id"),
                       ("ledger refund id", "refund_id"), ("paypal refund id", "paypal_refund_id")):
        lines.append(f"{label}: {ids.get(key, '')}")
    lines.append(f"refund amount: {liability.get('amountMinor', '')} {liability.get('currency', '')}")
    shares = {line["party"]: line for line in liability.get("lines", [])}
    for party in PARTY_ACCOUNTS:
        line = shares.get(party, {})
        lines.append(f"liability {party} {line.get('basisPoints', '')} bp = {line.get('amountMinor', '')}")
    lines.append("liability journal id: " + (liability.get("journalId") or ""))
    lines.append("trace: " + (trace_url(ids["trace_id"]) if ids.get("trace_id") else ""))
    lines.extend("failure: " + failure for failure in failures)
    return "\n".join(lines)


def request(method, url, headers=None, body=None, timeout=30) -> tuple[int, dict]:
    headers = dict(headers or {})
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        try:
            code = json.load(error).get("code", "UNKNOWN")
        except (ValueError, AttributeError):
            code = "UNKNOWN"
        raise RuntimeError(f"HTTP {error.code}: {code}") from None


def graphql(query, token=None):
    name = re.search(r"\{\s*(\w+)", query).group(1)
    _, result = request("POST", DISPATCH, {"Authorization": token} if token else {}, {"query": query})
    if result.get("errors"):
        raise RuntimeError(f"dispatch: {name} failed")
    data = result["data"][name]
    if data.get("ok") is False:
        raise RuntimeError(f"dispatch: {name} failed")
    return data


def wait_until(check, timeout_s, interval_s=3):
    deadline = time.monotonic() + timeout_s
    while True:
        result = check()
        if result:
            return result
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Timed out waiting for live run evidence")
        time.sleep(min(interval_s, remaining))


def main() -> int:
    ids, liability, failures = {}, {}, []
    try:
        config = load_config(os.environ)
        app_headers = {"Authorization": "Bearer " + config.app_token}
        ops_headers = {"Authorization": "OpsBearer " + config.ops_token}
        def ledger(path, ops=False):
            return request("GET", LEDGER + path, ops_headers if ops else app_headers)[1]
        for base in (LEDGER, WORKER):
            if request("GET", base + "/actuator/health")[1].get("status") != "UP":
                raise RuntimeError("ledger health is not UP")
        if request("GET", DISPATCH + "?query=%7B__typename%7D")[0] != 200:
            raise RuntimeError("dispatch health failed")
        if request("GET", AGENT + "/health")[1].get("status") != "UP":
            raise RuntimeError("agent health is not UP")
        if request("GET", LANGFUSE + "/api/public/health")[0] != 200:
            raise RuntimeError("Langfuse health failed")

        run_id = time.strftime("%Y%m%d%H%M%S")
        tokens = {}
        for name, role in (("owner", "Owner"), ("client", "Client"), ("driver", "Delivery")):
            email = json.dumps(f"m2-{run_id}-{name}@fairsettle.test")
            password = json.dumps(secrets.token_urlsafe(16))
            graphql(f"mutation {{ createAccount(input: {{email: {email}, password: {password}, role: {role}}}) {{ ok error }} }}")
            tokens[name] = graphql(f"mutation {{ login(input: {{email: {email}, password: {password}}}) {{ ok error token }} }}")["token"]
        restaurant_id = graphql('mutation { createRestaurant(input: {name: ' + json.dumps("M2 Kitchen " + run_id) +
                                ', coverImage: "https://example.com/m2.png", address: "1 Demo Street", categoryName: "Pizza"}) { ok error restaurantId } }', tokens["owner"])["restaurantId"]
        for name, cents, description in DISHES:
            graphql(f"mutation {{ createDish(input: {{restaurantId: {restaurant_id}, name: {json.dumps(name)}, priceCents: {cents}, description: {json.dumps(description)}}}) {{ ok error }} }}", tokens["owner"])
        menu = graphql(f"query {{ restaurant(input: {{restaurantId: {restaurant_id}}}) {{ ok restaurant {{ menu {{ id name priceCents }} }} }} }}", tokens["owner"])["restaurant"]["menu"]
        dishes = {dish["name"]: dish["id"] for dish in menu}
        ids["order_id"] = graphql(f"mutation {{ createOrder(input: {{restaurantId: {restaurant_id}, items: [{{dishId: {dishes['Margherita']}}}, {{dishId: {dishes['Lemonade']}}}]}}) {{ ok error orderId }} }}", tokens["client"])["orderId"]
        def order():
            return graphql(f"query {{ getOrder(input: {{id: {ids['order_id']}}}) {{ ok order {{ id totalCents paymentStatus ledgerPaymentId checkoutUrl }} }} }}", tokens["client"])["order"]
        def checkout():
            value = order()
            return value if value.get("ledgerPaymentId") and value.get("checkoutUrl") else None
        ready = wait_until(checkout, 120)
        if ready["totalCents"] != 1500:
            raise RuntimeError("dispatch order total must be 1500 cents")
        ids["payment_id"] = ready["ledgerPaymentId"]
        print(checkout_url(ready))
        input("Approve with the sandbox PERSONAL account, then press Enter")
        def paid():
            value = ledger("/v1/payments/" + ids["payment_id"])
            return value if payment_done(value) else None
        payment = wait_until(paid, 180)
        for key, field in (("paypal_order_id", "checkoutSessionId"), ("paypal_capture_id", "latestChargeId")):
            value = payment["provider"][field]
            if not PAYPAL_ID.fullmatch(value or ""):
                raise RuntimeError("invalid PayPal payment id")
            ids[key] = value
        wait_until(lambda: order()["paymentStatus"] == "Paid", 300)
        for status in ("Cooking", "Cooked"):
            graphql(f"mutation {{ editOrder(input: {{id: {ids['order_id']}, status: {status}}}) {{ ok error }} }}", tokens["owner"])
        graphql(f"mutation {{ takeOrder(input: {{id: {ids['order_id']}}}) {{ ok error }} }}", tokens["driver"])
        for status in ("PickedUp", "Delivered"):
            graphql(f"mutation {{ editOrder(input: {{id: {ids['order_id']}, status: {status}}}) {{ ok error }} }}", tokens["driver"])
        before = ledger("/ops/balances?currency=USD", ops=True)["items"]
        body = complaint_body(run_id, ids["order_id"])
        ids["complaint_id"] = body["complaint_id"]
        status, complaint = request("POST", AGENT + "/v1/complaints", body=body, timeout=180)
        if status != 201 or complaint.get("status") != "awaiting_review":
            raise RuntimeError("complaint did not await review: " + str(complaint.get("status")))
        ids["proposal_id"], ids["trace_id"] = complaint["proposal_id"], complaint["trace_id"]
        def read_proposal():
            return ledger("/v1/refund-proposals/" + ids["proposal_id"])
        proposal = read_proposal()
        failures.extend(check_proposal(proposal, ids["complaint_id"], ids["payment_id"], ids["trace_id"]))
        if failures:
            raise RuntimeError("proposal checks failed")
        print(LEDGER + "/refund-proposals.html")
        print("proposal id: " + ids["proposal_id"])
        print(f"sign in with ops_{OPS_REVIEWER_CREDENTIAL}.<LOCAL_OPS_SECRET>")
        def reviewed():
            value = read_proposal()
            return value if value["status"] != "PENDING_REVIEW" else None
        proposal = wait_until(reviewed, 1800)
        if proposal["status"] == "REJECTED":
            raise RuntimeError("proposal was rejected")
        def finished():
            value = request("GET", AGENT + "/v1/complaints/" + ids["complaint_id"])[1]
            return value if value["status"] in ("refunded", "refund_failed", "rejected", "declined", "escalated") else None
        final = wait_until(finished, 300)
        if final["status"] != "refunded":
            raise RuntimeError("complaint ended as " + final["status"])
        proposal = read_proposal()
        ids["refund_id"] = proposal["refundId"]
        refund = ledger("/v1/refunds/" + ids["refund_id"])
        ids["paypal_refund_id"] = refund.get("providerRefundId") or ""
        failures.extend(check_refund(refund, proposal))
        def posted():
            value = ledger("/v1/refunds/" + ids["refund_id"] + "/liability")
            return value if value["postingStatus"] == "POSTED" else None
        liability = wait_until(posted, 180)
        failures.extend(check_liability(liability, proposal))
        journal = ledger("/ops/ledger/journals/" + str(liability["journalId"]), ops=True)
        failures.extend(check_journal(journal, liability))
        failures.extend(check_balances(before, ledger("/ops/balances?currency=USD", ops=True)["items"], liability))
        basic = b64encode((config.langfuse_public_key + ":" + config.langfuse_secret_key).encode()).decode()
        def traced():
            values = request("GET", LANGFUSE + "/api/public/v2/observations?traceId=" + ids["trace_id"] + "&fields=core,basic,metadata", {"Authorization": "Basic " + basic})[1]["data"]
            return values if any(item["name"] == "finish" for item in values) else None
        failures.extend(check_trace(wait_until(traced, 60), proposal, ids["complaint_id"]))
        print(summary(ids, liability, failures))
        return 1 if failures else 0
    except (KeyboardInterrupt, TimeoutError) as error:
        print(summary(ids, liability, failures + [str(error) or type(error).__name__]))
        return 2
    except (ValueError, RuntimeError, OSError) as error:
        print(summary(ids, liability, failures + [str(error)]))
        return 1
    except Exception as error:
        detail = f": {error.args[0]!r}" if isinstance(error, KeyError) and error.args and isinstance(error.args[0], str) else ""
        print(summary(ids, liability, failures + [f"unexpected {type(error).__name__}{detail}"]))
        return 2


if __name__ == "__main__":
    sys.exit(main())
