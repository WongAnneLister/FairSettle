import importlib.util
from pathlib import Path
import sys
import unittest

SPEC = importlib.util.spec_from_file_location(
    "paypal_sandbox_run", Path(__file__).parents[1] / "paypal_sandbox_run.py")
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)

ORDER = "7CV2269518094610C"
CAPTURE = "41995584GM234064G"
REFUND = "2EU12368F9867740A"
PROVIDER = "10000000-0000-0000-0000-000000000021"
CAPTURE_BT = dict(bt_id=CAPTURE, state="POSTED", journal_id="j1",
                  amount_minor=10000, fee_minor=349, net_minor=9651)
REFUND_BT = dict(bt_id=REFUND, state="POSTED", journal_id="j2",
                 amount_minor=-2500, fee_minor=-87, net_minor=-2413)
BALANCES = dict(PSP_FUNDS=7238, PSP_FEE_EXPENSE=262, SALES_REVENUE=-10000,
                SALES_RETURNS=2500, PARTNER_SHARE_EXPENSE=1125,
                PARTNER_PAYABLE=-1125, SUSPENSE=0)


def good_items():
    return [dict(accountPurpose=purpose, balanceMinor=balance, rebuildMatches=True,
                 providerAccountId=PROVIDER if purpose.startswith("PSP_") or purpose == "SUSPENSE" else None,
                 sourceDomain="PROVIDER" if purpose.startswith("PSP_") or purpose == "SUSPENSE" else "INTERNAL")
            for purpose, balance in BALANCES.items()]


def events():
    return [dict(event_id="WH-CAP", event_type="PAYMENT.CAPTURE.COMPLETED", object_id=CAPTURE,
                 status="DONE", reason=None),
            dict(event_id="WH-REF", event_type="PAYMENT.CAPTURE.REFUNDED", object_id=REFUND,
                 status="DONE", reason=None)]


class PayPalSandboxRunTest(unittest.TestCase):
    def env(self):
        return dict(LOCAL_APP_SECRET="s" * 43, LOCAL_OPS_SECRET="o" * 43, PAYPAL_ENABLED="true")

    def test_config_requires_secrets_and_paypal(self):
        for changes in [dict(LOCAL_OPS_SECRET=""), dict(LOCAL_APP_SECRET="s" * 42),
                        dict(LOCAL_OPS_SECRET="o" * 42), dict(PAYPAL_ENABLED="false")]:
            env = self.env()
            env.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                runner.load_config(env)
        env = self.env()
        del env["LOCAL_OPS_SECRET"]
        with self.assertRaises(ValueError):
            runner.load_config(env)
        config = runner.load_config(self.env())
        self.assertEqual(config.app_token, "app_10000000-0000-0000-0000-000000000041." + "s" * 43)
        self.assertEqual(config.ops_token, "ops_10000000-0000-0000-0000-000000000061." + "o" * 43)
        self.assertEqual(config.api_url, "http://localhost:8080")
        self.assertEqual(config.worker_url, "http://localhost:8081")
        self.assertEqual(config.db_container, "pl-postgres")
        self.assertEqual(config.db_name, "payments_ledger")
        self.assertEqual(config.db_user, "postgres")

    def test_config_repr_hides_tokens(self):
        config = runner.load_config(self.env())
        self.assertNotIn("s" * 43, repr(config))
        self.assertNotIn("o" * 43, repr(config))
        self.assertNotIn(config.app_token, repr(config))
        self.assertNotIn(config.ops_token, repr(config))

    def test_request_bodies_are_fixed(self):
        run_id = "20261024120000"
        self.assertEqual(runner.payment_body(run_id), {
            "orderKey": "f12-20261024120000", "productRef": "demo-product", "priceVersion": 1,
            "amountMinor": 10000, "currency": "USD", "successUrl": "https://example.com/f12/return",
            "cancelUrl": "https://example.com/f12/cancel"})
        self.assertEqual(runner.refund_body("payment-id", run_id), {
            "paymentId": "payment-id", "amountMinor": 2500, "currency": "USD",
            "reason": "REQUESTED_BY_CUSTOMER", "clientRefundKey": "f12-refund-20261024120000"})

    def test_hosted_url_requires_sandbox_redirect(self):
        url = "https://www.sandbox.paypal.com/checkoutnow?token=" + ORDER
        self.assertEqual(runner.hosted_url({"nextAction": {
            "type": "REDIRECT_TO_HOSTED_CHECKOUT", "hostedUrl": url}}), url)
        for action in [{"type": "NONE", "hostedUrl": url}, {
                "type": "REDIRECT_TO_HOSTED_CHECKOUT", "hostedUrl": "https://www.paypal.com/checkoutnow"}]:
            with self.subTest(action=action), self.assertRaises(ValueError):
                runner.hosted_url({"nextAction": action})

    def test_payment_and_refund_done(self):
        for check, field in [(runner.payment_done, "paymentStatus"), (runner.refund_done, "refundStatus")]:
            self.assertTrue(check({field: "SUCCEEDED", "financialStatus": "POSTED"}))
            self.assertFalse(check({field: "SUCCEEDED", "financialStatus": "PENDING_EVIDENCE"}))
        for value in ["CANCELED", "FAILED"]:
            with self.assertRaises(RuntimeError):
                runner.payment_done({"paymentStatus": value})
        with self.assertRaises(RuntimeError):
            runner.refund_done({"refundStatus": "FAILED"})
        with self.assertRaises(RuntimeError):
            runner.refund_done({"refundStatus": "SUCCEEDED", "financialStatus": "POSTED", "controlState": "FROZEN"})

    def test_paypal_id_rejects_sql(self):
        self.assertEqual(runner.paypal_id(CAPTURE), CAPTURE)
        for value in ["x' OR '1'='1", ""]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                runner.paypal_id(value)

    def test_webhooks_need_both_events_done(self):
        self.assertEqual(runner.check_webhooks(events(), CAPTURE, REFUND), [])
        rows = events()
        rows.append(dict(rows[0], event_id="WH-CAP-2"))
        self.assertEqual(runner.check_webhooks(rows, CAPTURE, REFUND), [])
        failures = runner.check_webhooks(events()[:1], CAPTURE, REFUND)
        self.assertEqual(len(failures), 1)
        self.assertIn("PAYMENT.CAPTURE.REFUNDED", failures[0])
        rows = events()
        rows[1].update(status="WAITING", reason="INCOMPLETE_REFUND_FACT")
        failures = runner.check_webhooks(rows, CAPTURE, REFUND)
        self.assertEqual(len(failures), 1)
        self.assertIn("WAITING", failures[0])
        self.assertIn("INCOMPLETE_REFUND_FACT", failures[0])

    def test_postings_once_each(self):
        bts = [CAPTURE_BT, REFUND_BT]
        self.assertEqual(runner.check_postings(bts, 2, CAPTURE, REFUND), [])
        for rows, entries in [([CAPTURE_BT, dict(REFUND_BT, state="PENDING_EVIDENCE")], 2),
                              (bts, 3), ([REFUND_BT], 2)]:
            with self.subTest(rows=rows, entries=entries):
                self.assertEqual(len(runner.check_postings(rows, entries, CAPTURE, REFUND)), 1)

    def test_balances_match_ledger_and_paypal_amounts(self):
        self.assertEqual(runner.check_balances(good_items(), CAPTURE_BT, REFUND_BT), [])
        items = good_items()
        items[0]["rebuildMatches"] = False
        self.assertTrue(runner.check_balances(items, CAPTURE_BT, REFUND_BT))
        items = good_items()
        items[0]["balanceMinor"] = 7237
        failures = runner.check_balances(items, CAPTURE_BT, REFUND_BT)
        self.assertTrue(any("PSP_FUNDS" in failure for failure in failures))
        self.assertTrue(any("sum" in failure for failure in failures))
        items = [item for item in good_items() if item["accountPurpose"] != "PARTNER_PAYABLE"]
        self.assertTrue(any("PARTNER_PAYABLE" in failure
                            for failure in runner.check_balances(items, CAPTURE_BT, REFUND_BT)))

    def test_summary_is_pasteable(self):
        for failures, status in [([], "PASS"), (["PSP_FUNDS mismatch"], "FAIL")]:
            result = runner.summary(ORDER, CAPTURE, REFUND, ["WH-CAP", "WH-REF"], BALANCES, failures)
            self.assertEqual(result.splitlines()[0], "F12 live run: " + status)
            for value in [ORDER, CAPTURE, REFUND, "WH-CAP", "WH-REF", "balance PSP_FUNDS = 7238"] + failures:
                self.assertIn(value, result)
            self.assertNotIn("app_", result)
            self.assertNotIn("ops_", result)


if __name__ == "__main__":
    unittest.main()
