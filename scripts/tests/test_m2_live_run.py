import contextlib
from copy import deepcopy
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "m2_live_run.py"
SPEC = importlib.util.spec_from_file_location("m2_live_run", SCRIPT)
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)

COMPLAINT = "complaint-m2-20261030120000"
PAYMENT = "pay_10000000-0000-0000-0000-000000000071"
REFUND = "ref_10000000-0000-0000-0000-000000000072"
TRACE = "0" * 32
JOURNAL = "10000000-0000-0000-0000-000000000073"
PARTIES = ("RESTAURANT", "DRIVER", "PLATFORM")


def proposal():
    return dict(complaintId=COMPLAINT, paymentId=PAYMENT, amountMinor=300,
                currency="USD", liability=[
                    dict(party=party, basisPoints=bp)
                    for party, bp in zip(PARTIES, (10000, 0, 0))],
                evidenceRefs=["order:7", "order-item:21"],
                agentRun=dict(traceId=TRACE), refundId=REFUND,
                explanation="The lemonade line was not delivered.")


def liability():
    return dict(postingStatus="POSTED", journalId=JOURNAL, refundId=REFUND,
                amountMinor=300, currency="USD", lines=[
                    dict(party=party, basisPoints=bp, amountMinor=amount)
                    for party, bp, amount in zip(PARTIES, (10000, 0, 0), (300, 0, 0))])


def entries():
    return [dict(direction="DEBIT", accountPurpose="REFUND_RECEIVABLE_RESTAURANT",
                 amountMinor=300, currency="USD"),
            dict(direction="CREDIT", accountPurpose="SALES_RETURNS", amountMinor=300,
                 currency="USD")]


def observations():
    result = [dict(name=name, traceId=TRACE, sessionId=COMPLAINT,
                   type="GENERATION" if name == "decide" else "SPAN", metadata={})
              for name in sorted(runner.TRACE_NAMES)]
    next(item for item in result if item["name"] == "decide")["metadata"] = {
        "evidence_refs": proposal()["evidenceRefs"]}
    next(item for item in result if item["name"] == "finish")["metadata"] = {
        "final": "refunded"}
    return result


class M2LiveRunTest(unittest.TestCase):
    def env(self):
        return dict(LOCAL_APP_SECRET="a" * 43, LOCAL_OPS_SECRET="b" * 43,
                    LOCAL_AGENT_SECRET="c" * 43, PUBLIC_HOST="m2-test.ngrok-free.dev",
                    LANGFUSE_PUBLIC_KEY="pk-lf-test", LANGFUSE_SECRET_KEY="sk-lf-test")

    def test_config_requires_three_distinct_secrets(self):
        names = ("LOCAL_APP_SECRET", "LOCAL_OPS_SECRET", "LOCAL_AGENT_SECRET")
        for name in names:
            for value in (None, "x" * 42):
                env = self.env()
                if value is None:
                    del env[name]
                else:
                    env[name] = value
                with self.subTest(name=name, value=value), self.assertRaisesRegex(
                        ValueError, name + " must be a 43-character secret"):
                    runner.load_config(env)
        for first, second in ((names[0], names[1]), (names[0], names[2]), (names[1], names[2])):
            env = self.env()
            env[second] = env[first]
            with self.subTest(pair=(first, second)), self.assertRaisesRegex(
                    ValueError, r"LOCAL_\* secrets must differ"):
                runner.load_config(env)
        config = runner.load_config(self.env())
        self.assertEqual(config.app_token, "app_10000000-0000-0000-0000-000000000041." + "a" * 43)
        self.assertEqual(config.ops_token, "ops_10000000-0000-0000-0000-000000000061." + "b" * 43)

    def test_config_checks_public_host_and_langfuse_keys(self):
        for host in ("https://x.ngrok-free.dev", "x.ngrok-free.dev/", "localhost"):
            env = self.env()
            env["PUBLIC_HOST"] = host
            with self.subTest(host=host), self.assertRaisesRegex(
                    ValueError, "PUBLIC_HOST must be a bare host name"):
                runner.load_config(env)
        for name, prefix in (("LANGFUSE_PUBLIC_KEY", "pk-lf-"), ("LANGFUSE_SECRET_KEY", "sk-lf-")):
            env = self.env()
            env[name] = "wrong-key"
            with self.subTest(name=name), self.assertRaisesRegex(
                    ValueError, name + " must start with " + prefix):
                runner.load_config(env)

    def test_config_repr_hides_secrets(self):
        env = self.env()
        result = repr(runner.load_config(env))
        self.assertIn(env["PUBLIC_HOST"], result)
        self.assertIn(env["LANGFUSE_PUBLIC_KEY"], result)
        for name in ("LOCAL_APP_SECRET", "LOCAL_OPS_SECRET", "LOCAL_AGENT_SECRET", "LANGFUSE_SECRET_KEY"):
            self.assertNotIn(env[name], result)

    def test_complaint_body_is_fixed(self):
        self.assertEqual(runner.complaint_body("20261030120000", 7), {
            "complaint_id": COMPLAINT, "order_id": 7, "complaint_type": "missing_item",
            "text": "The lemonade was missing from my bag. The pizza arrived."})

    def test_checkout_url_must_be_paypal_sandbox(self):
        url = "https://www.sandbox.paypal.com/checkoutnow?token=X"
        self.assertEqual(runner.checkout_url({"checkoutUrl": url}), url)
        for value in ("http://www.sandbox.paypal.com/checkoutnow?token=X", "https://evil.test/checkoutnow", None):
            with self.subTest(value=value), self.assertRaisesRegex(
                    RuntimeError, "checkout URL must be a PayPal sandbox URL"):
                runner.checkout_url({"checkoutUrl": value})

    def test_payment_done(self):
        self.assertTrue(runner.payment_done(dict(paymentStatus="SUCCEEDED", resolutionStatus="KNOWN")))
        self.assertFalse(runner.payment_done(dict(paymentStatus="SUCCEEDED", resolutionStatus="UNKNOWN")))
        self.assertFalse(runner.payment_done(dict(paymentStatus="PROCESSING", resolutionStatus="KNOWN")))

    def test_check_proposal(self):
        good = proposal()
        self.assertEqual(runner.check_proposal(good, COMPLAINT, PAYMENT, TRACE), [])
        changes = [dict(complaintId="other"), dict(paymentId="other"), dict(amountMinor=0),
                   dict(liability=[dict(party=party, basisPoints=bp)
                                   for party, bp in zip(PARTIES, (9999, 0, 0))]),
                   dict(evidenceRefs=[]), dict(agentRun=dict(traceId="1" * 32))]
        for change in changes:
            with self.subTest(change=change):
                self.assertEqual(len(runner.check_proposal(dict(good, **change), COMPLAINT, PAYMENT, TRACE)), 1)

    def test_check_refund(self):
        good = dict(refundStatus="SUCCEEDED", resolutionStatus="KNOWN", financialStatus="POSTED",
                    amountMinor=300, providerRefundId="2EU12368F9867740A")
        self.assertEqual(runner.check_refund(good, proposal()), [])
        for change in (dict(refundStatus="SUBMITTED"), dict(resolutionStatus="UNKNOWN"),
                       dict(financialStatus="PENDING_EVIDENCE"), dict(amountMinor=299),
                       dict(providerRefundId="x'; DROP")):
            with self.subTest(change=change):
                self.assertEqual(len(runner.check_refund(dict(good, **change), proposal())), 1)

    def test_check_liability(self):
        self.assertEqual(runner.check_liability(liability(), proposal()), [])
        bad_total = liability()["lines"]
        bad_total[0]["amountMinor"] = 299
        bad_share = liability()["lines"]
        bad_share[0]["basisPoints"] = 9999
        for change in (dict(postingStatus="PENDING"), dict(journalId=None), dict(lines=bad_total),
                       dict(lines=bad_share), dict(refundId="ref_other")):
            with self.subTest(change=change):
                self.assertEqual(len(runner.check_liability(dict(liability(), **change), proposal())), 1)

    def test_check_journal(self):
        self.assertEqual(runner.check_journal(dict(entries=entries()), liability()), [])
        self.assertEqual(runner.check_journal(dict(entries=entries()[::-1]), liability()), [])
        wrong_amount = entries()
        wrong_amount[0]["amountMinor"] = 299
        wrong_currency = entries()
        wrong_currency[0]["currency"] = "EUR"
        zero_debit = dict(direction="DEBIT", accountPurpose="REFUND_COST_PLATFORM", amountMinor=0, currency="USD")
        for values in (entries()[1:], entries() + [zero_debit], wrong_amount, wrong_currency):
            with self.subTest(entries=values):
                self.assertTrue(runner.check_journal(dict(entries=values), liability()))
        split = liability()
        split["lines"] = [dict(party=party, basisPoints=bp, amountMinor=amount)
                          for party, bp, amount in zip(PARTIES, (5000, 3000, 2000), (150, 90, 60))]
        split_entries = [dict(direction="DEBIT", accountPurpose=purpose, amountMinor=amount, currency="USD")
                         for purpose, amount in zip(("REFUND_RECEIVABLE_RESTAURANT", "REFUND_RECEIVABLE_DRIVER",
                                                     "REFUND_COST_PLATFORM"), (150, 90, 60))]
        split_entries.append(entries()[1])
        self.assertEqual(runner.check_journal(dict(entries=split_entries), split), [])
        for index in range(3):
            self.assertTrue(runner.check_journal(dict(entries=split_entries[:index] + split_entries[index + 1:]), split))

    def test_check_balances(self):
        before = [dict(accountPurpose="SALES_RETURNS", balanceMinor=0)]
        after = [dict(accountPurpose="SALES_RETURNS", balanceMinor=300),
                 dict(accountPurpose="REFUND_RECEIVABLE_RESTAURANT", balanceMinor=300)]
        self.assertEqual(runner.check_balances(before, after, liability()), [])
        after[1]["balanceMinor"] = 299
        self.assertEqual(len(runner.check_balances(before, after, liability())), 1)

    def test_check_trace(self):
        good = observations()
        self.assertEqual(runner.check_trace(good, proposal(), COMPLAINT), [])
        self.assertEqual(runner.check_trace(good + [dict(name="retry_submit", traceId=TRACE,
                                                       sessionId=COMPLAINT, type="SPAN", metadata={})], proposal(), COMPLAINT), [])
        cases = [[item for item in good if item["name"] != "resume_refund"],
                 good + [dict(name="unknown", traceId=TRACE, sessionId=COMPLAINT, metadata={})]]
        for name, metadata in (("decide", {"evidence_refs": ["order:other"]}), ("finish", {"final": "escalated"})):
            changed = deepcopy(good)
            next(item for item in changed if item["name"] == name)["metadata"] = metadata
            cases.append(changed)
        changed = deepcopy(good)
        changed[0]["sessionId"] = "other"
        cases.append(changed)
        changed = deepcopy(good)
        changed[0]["metadata"]["text"] = runner.COMPLAINT_TEXT
        cases.append(changed)
        for index, values in enumerate(cases):
            with self.subTest(case=index):
                self.assertEqual(len(runner.check_trace(values, proposal(), COMPLAINT)), 1)

    def test_trace_url_and_summary(self):
        url = "http://localhost:3000/project/fairsettle-local/traces/" + TRACE
        self.assertEqual(runner.trace_url(TRACE), url)
        with self.assertRaises(ValueError):
            runner.trace_url("xyz")
        ids = dict(order_id=7, payment_id=PAYMENT, paypal_order_id="7CV2269518094610C",
                   paypal_capture_id="41995584GM234064G", complaint_id=COMPLAINT,
                   proposal_id="prop_10000000-0000-0000-0000-000000000074", refund_id=REFUND,
                   paypal_refund_id="2EU12368F9867740A", trace_id=TRACE)
        lines = ["dispatch order id: 7", "ledger payment id: " + PAYMENT,
                 "paypal order id: " + ids["paypal_order_id"], "paypal capture id: " + ids["paypal_capture_id"],
                 "complaint id: " + COMPLAINT, "proposal id: " + ids["proposal_id"],
                 "ledger refund id: " + REFUND, "paypal refund id: " + ids["paypal_refund_id"],
                 "refund amount: 300 USD", "liability RESTAURANT 10000 bp = 300",
                 "liability DRIVER 0 bp = 0", "liability PLATFORM 0 bp = 0",
                 "liability journal id: " + JOURNAL, "trace: " + url]
        for failures, status in (([], "PASS"), (["first failed check", "second failed check"], "FAIL")):
            self.assertEqual(runner.summary(ids, liability(), failures).splitlines(),
                             ["F24 live run: " + status] + lines + ["failure: " + value for value in failures])
        source = SCRIPT.read_text()
        self.assertNotIn("/decision", source)
        self.assertNotIn("subprocess", source)

    def test_main_prints_a_summary_for_every_error(self):
        cases = (
            ("a", KeyError("status"), 2, "failure: unexpected KeyError: 'status'"),
            ("b", lambda *args, **kwargs: (200, None), 2, "failure: unexpected AttributeError"),
            ("c", RuntimeError("HTTP 503: UNAVAILABLE"), 1, "failure: HTTP 503: UNAVAILABLE"),
            ("d", TimeoutError("Timed out waiting for live run evidence"), 2,
             "failure: Timed out waiting for live run evidence"),
        )
        for case, side_effect, expected_code, expected_line in cases:
            with self.subTest(case=case):
                output = io.StringIO()
                with mock.patch.dict(runner.os.environ, self.env(), clear=True), \
                        mock.patch.object(runner, "request", side_effect=side_effect), \
                        contextlib.redirect_stdout(output):
                    code = runner.main()
                self.assertEqual(code, expected_code)
                text = output.getvalue()
                self.assertTrue(text.startswith("F24 live run: FAIL"))
                self.assertEqual(text.splitlines()[-1], expected_line)
                for secret in ("a" * 43, "b" * 43, "c" * 43):
                    self.assertNotIn(secret, text)


if __name__ == "__main__":
    unittest.main()
