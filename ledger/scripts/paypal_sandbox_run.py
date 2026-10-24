#!/usr/bin/env python3
"""Drive the F12 sandbox run through the local ledger and read-only database checks."""
from dataclasses import dataclass
import json
import os
import re
import subprocess
import sys
import time
from typing import Any, Mapping
import urllib.error
import urllib.request

APP_CREDENTIAL = "10000000-0000-0000-0000-000000000041"
OPS_CREDENTIAL = "10000000-0000-0000-0000-000000000061"
PROVIDER_ACCOUNT = "10000000-0000-0000-0000-000000000021"
PAYMENT_MINOR = 10000
REFUND_MINOR = 2500
SHARE_EFFECTIVE_MINOR = 1125
PAYPAL_ID = re.compile(r"[A-Z0-9]{1,36}")


@dataclass(frozen=True)
class Config:
    api_url: str
    worker_url: str
    app_token: str
    ops_token: str
    db_container: str
    db_name: str
    db_user: str

    def __repr__(self):
        return (f"Config(api_url={self.api_url!r}, worker_url={self.worker_url!r}, "
                f"db_container={self.db_container!r}, db_name={self.db_name!r})")


def load_config(env: Mapping[str, str]) -> Config:
    for name in ("LOCAL_APP_SECRET", "LOCAL_OPS_SECRET"):
        if len(env.get(name, "")) != 43:
            raise ValueError(f"{name} must be a 43-character secret")
    if env.get("PAYPAL_ENABLED") != "true":
        raise ValueError("PAYPAL_ENABLED must be true")
    return Config(
        "http://localhost:" + env.get("API_PORT", "8080"),
        "http://localhost:" + env.get("WORKER_PORT", "8081"),
        f"app_{APP_CREDENTIAL}." + env["LOCAL_APP_SECRET"],
        f"ops_{OPS_CREDENTIAL}." + env["LOCAL_OPS_SECRET"],
        env.get("F12_DB_CONTAINER") or "pl-postgres",
        env.get("DB_NAME") or "payments_ledger",
        env.get("DB_SUPERUSER") or "postgres")


def payment_body(run_id: str) -> dict:
    return {"orderKey": f"f12-{run_id}", "productRef": "demo-product", "priceVersion": 1,
            "amountMinor": PAYMENT_MINOR, "currency": "USD",
            "successUrl": "https://example.com/f12/return", "cancelUrl": "https://example.com/f12/cancel"}


def refund_body(payment_id: str, run_id: str) -> dict:
    return {"paymentId": payment_id, "amountMinor": REFUND_MINOR, "currency": "USD",
            "reason": "REQUESTED_BY_CUSTOMER", "clientRefundKey": f"f12-refund-{run_id}"}


def hosted_url(resource: dict) -> str:
    action = resource.get("nextAction", {})
    if action.get("type") != "REDIRECT_TO_HOSTED_CHECKOUT":
        raise ValueError("nextAction.type must be REDIRECT_TO_HOSTED_CHECKOUT")
    url = action.get("hostedUrl", "")
    if not url.startswith("https://www.sandbox.paypal.com/"):
        raise ValueError("nextAction.hostedUrl must use the PayPal sandbox")
    return url


def payment_done(resource: dict) -> bool:
    if resource.get("paymentStatus") in ("CANCELED", "FAILED"):
        raise RuntimeError("Payment ended as " + resource["paymentStatus"])
    return resource.get("paymentStatus") == "SUCCEEDED" and resource.get("financialStatus") == "POSTED"


def refund_done(resource: dict) -> bool:
    if resource.get("refundStatus") == "FAILED":
        raise RuntimeError("Refund ended as FAILED")
    if "controlState" in resource and resource["controlState"] != "NORMAL":
        raise RuntimeError("Refund controlState is " + str(resource["controlState"]))
    return resource.get("refundStatus") == "SUCCEEDED" and resource.get("financialStatus") == "POSTED"


def paypal_id(value: str) -> str:
    if not PAYPAL_ID.fullmatch(value):
        raise ValueError("Invalid PayPal id")
    return value


def check_webhooks(rows: list[dict], capture_id: str, refund_id: str) -> list[str]:
    failures = []
    for event_type, object_id in [("PAYMENT.CAPTURE.COMPLETED", capture_id),
                                  ("PAYMENT.CAPTURE.REFUNDED", refund_id)]:
        matches = [row for row in rows if row["event_type"] == event_type and row["object_id"] == object_id]
        if not matches:
            failures.append(f"Missing {event_type} for {object_id}")
        for row in matches:
            if row["status"] != "DONE":
                failures.append(f"{event_type} {row['event_id']}: {row['status']} reason={row.get('reason')}")
    return failures


def check_postings(bts: list[dict], psp_entries: int, capture_id: str, refund_id: str) -> list[str]:
    failures = []
    for object_id in (capture_id, refund_id):
        matches = [bt for bt in bts if bt["bt_id"] == object_id]
        if len(matches) != 1:
            failures.append(f"Expected one balance_transaction for {object_id}; got {len(matches)}")
        elif matches[0]["state"] != "POSTED" or not matches[0].get("journal_id"):
            failures.append(f"Balance transaction {object_id} must be POSTED with a journal")
    if psp_entries != 2:
        failures.append(f"Expected 2 PSP_FUNDS journal entries; got {psp_entries}")
    return failures


def scoped_items(items: list[dict]) -> list[dict]:
    return [item for item in items if item.get("providerAccountId") == PROVIDER_ACCOUNT
            or item.get("sourceDomain") == "INTERNAL"]


def check_balances(items: list[dict], capture_bt: dict, refund_bt: dict) -> list[str]:
    items = scoped_items(items)
    failures = []
    for item in items:
        if item.get("rebuildMatches") is not True:
            failures.append(f"{item['accountPurpose']} rebuildMatches is not true")
    total = sum(item["balanceMinor"] for item in items)
    if total != 0:
        failures.append(f"Signed balance sum must be 0; got {total}")
    expected = {
        "PSP_FUNDS": capture_bt["net_minor"] + refund_bt["net_minor"],
        "PSP_FEE_EXPENSE": capture_bt["fee_minor"] + refund_bt["fee_minor"],
        "SALES_REVENUE": -PAYMENT_MINOR, "SALES_RETURNS": REFUND_MINOR,
        "PARTNER_SHARE_EXPENSE": SHARE_EFFECTIVE_MINOR, "PARTNER_PAYABLE": -SHARE_EFFECTIVE_MINOR,
        "SUSPENSE": 0}
    balances = {item["accountPurpose"]: item["balanceMinor"] for item in items}
    for purpose, amount in expected.items():
        if purpose not in balances:
            failures.append(f"Missing account {purpose}")
        elif balances[purpose] != amount:
            failures.append(f"{purpose}: expected {amount}, got {balances[purpose]}")
    return failures


def summary(order_id, capture_id, refund_id, event_ids: list[str],
            balances: dict[str, int], failures: list[str]) -> str:
    lines = ["F12 live run: " + ("FAIL" if failures else "PASS"),
             f"order id: {order_id}", f"capture id: {capture_id}", f"refund id: {refund_id}",
             "webhook event ids: " + ", ".join(event_ids)]
    lines.extend(f"balance {purpose} = {amount}" for purpose, amount in balances.items())
    lines.extend("failure: " + failure for failure in failures)
    return "\n".join(lines)


def request(method, url, auth_header, body=None, key=None) -> tuple[int, dict]:
    headers = {}
    if auth_header:
        headers["Authorization"] = auth_header
    if key:
        headers["Idempotency-Key"] = key
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        try:
            code = json.load(error).get("code", "UNKNOWN")
        except (ValueError, AttributeError):
            code = "UNKNOWN"
        raise RuntimeError(f"Ledger HTTP {error.code}: {code}") from None


def query(config, sql) -> list[dict]:
    result = subprocess.run([
        "docker", "exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on",
        config.db_container, "psql", "-U", config.db_user, "-d", config.db_name,
        "-At", "-v", "ON_ERROR_STOP=1", "-c",
        "SELECT coalesce(json_agg(t),'[]') FROM (" + sql + ") t"],
        capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(f"Read-only database query failed (exit {result.returncode})")
    return json.loads(result.stdout.strip())


def wait_until(check, timeout_s, interval_s=3) -> Any:
    deadline = time.monotonic() + timeout_s
    while True:
        result = check()
        if result:
            return result
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Timed out waiting for ledger evidence")
        time.sleep(min(interval_s, remaining))


def main() -> int:
    order_id = capture_id = refund_id = ""
    payment_id = ledger_refund_id = ""
    event_ids = []
    balances = {}
    try:
        config = load_config(os.environ)
        app_auth = "Bearer " + config.app_token
        ops_auth = "OpsBearer " + config.ops_token

        def ledger(method, path, body=None, key=None, expected=200, auth=app_auth):
            status, resource = request(method, config.api_url + path, auth, body, key)
            if status != expected:
                raise RuntimeError(f"Ledger HTTP status must be {expected}; got {status}")
            return resource

        for url in (config.api_url, config.worker_url):
            status, health = request("GET", url + "/actuator/health", None)
            if status != 200 or health.get("status") != "UP":
                raise RuntimeError("Ledger health must be UP")
        ledger("GET", "/v1/identity")
        run_id = time.strftime("%Y%m%d%H%M%S")
        payment = ledger("POST", "/v1/payments", payment_body(run_id), f"f12-pay-{run_id}", expected=201)
        payment_id = payment["id"]
        print("payment id: " + payment_id)
        print(hosted_url(payment))
        input("Open the URL, sign in with the sandbox PERSONAL account, approve, then press Enter")

        def paid():
            resource = ledger("GET", "/v1/payments/" + payment_id)
            return resource if payment_done(resource) else None

        payment = wait_until(paid, 120)
        order_id = paypal_id(payment["provider"]["checkoutSessionId"])
        capture_id = paypal_id(payment["provider"]["latestChargeId"])
        refund = ledger("POST", "/v1/refunds", refund_body(payment_id, run_id),
                        f"f12-refund-{run_id}", expected=201)
        ledger_refund_id = refund["id"]

        def refunded():
            resource = ledger("GET", "/v1/refunds/" + ledger_refund_id)
            return resource if refund_done(resource) else None

        refund = wait_until(refunded, 180)
        refund_id = paypal_id(refund["providerRefundId"])
        webhook_rows = []

        def webhooks():
            nonlocal webhook_rows
            webhook_rows = query(config,
                "SELECT event_id,event_type,object_id,status,reason FROM platform.webhook_inbox "
                f"WHERE object_id IN ('{capture_id}','{refund_id}')")
            return not check_webhooks(webhook_rows, capture_id, refund_id)

        wait_until(webhooks, 600)
        event_ids = [row["event_id"] for row in webhook_rows]
        bts = query(config,
            "SELECT bt_id,state,journal_id,amount_minor,fee_minor,net_minor FROM platform.balance_transaction "
            f"WHERE bt_id IN ('{capture_id}','{refund_id}')")
        psp_entries = query(config,
            "SELECT count(*) AS entries FROM platform.journal_entry e JOIN platform.ledger_account a "
            "ON a.id=e.ledger_account_id WHERE a.account_purpose='PSP_FUNDS' "
            f"AND a.provider_account_id='{PROVIDER_ACCOUNT}'")[0]["entries"]
        items = ledger("GET", "/ops/balances?currency=USD", auth=ops_auth)["items"]
        failures = check_webhooks(webhook_rows, capture_id, refund_id)
        failures.extend(check_postings(bts, psp_entries, capture_id, refund_id))
        captures = [bt for bt in bts if bt["bt_id"] == capture_id]
        refunds = [bt for bt in bts if bt["bt_id"] == refund_id]
        if len(captures) == len(refunds) == 1:
            failures.extend(check_balances(items, captures[0], refunds[0]))
        balances = {item["accountPurpose"]: item["balanceMinor"] for item in scoped_items(items)}
        print(summary(order_id, capture_id, refund_id, event_ids, balances, failures))
        return 1 if failures else 0
    except (KeyboardInterrupt, TimeoutError) as error:
        print(summary(order_id, capture_id, refund_id, event_ids, balances,
                      [type(error).__name__]))
        print(f"ledger payment id: {payment_id}\nledger refund id: {ledger_refund_id}")
        return 2
    except (ValueError, RuntimeError, OSError) as error:
        print(summary(order_id, capture_id, refund_id, event_ids, balances, [str(error)]))
        return 1


if __name__ == "__main__":
    sys.exit(main())
