package com.paymentsledger.provider.adapter.paypal;

import static com.paymentsledger.provider.ProviderCallClassification.*;
import static com.paymentsledger.provider.adapter.paypal.PayPalTestTransport.*;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.payment.domain.*;
import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.*;
import java.net.http.HttpTimeoutException;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class PayPalRefundTest {
    static final ObjectMapper JSON = new ObjectMapper();
    static final String CAPTURE = "41995584GM234064G", ORDER = "7CV2269518094610C";
    static final String R1 = "2EU12368F9867740A", R2 = "3FV23479G0978851B";
    static final UUID L = new UUID(0, 0xdd), P = new UUID(0, 0xbb);
    static final String KEY = "refund_create_00000000-0000-0000-0000-0000000000ee";
    static final ProviderScope SCOPE = new ProviderScope(new UUID(0, 1), new UUID(0, 2), new UUID(0, 4), false);
    static final Instant TIME = Instant.parse("2026-10-22T10:00:00Z");
    static final Clock CLOCK = Clock.fixed(TIME, ZoneOffset.UTC);

    @Test
    void refundPostsToCaptureWithOperationKey() throws Exception {
        var t = new PayPalTestTransport().token().reply(201, body());
        var result = adapter(t).createRefund(command());
        var sent = refundCalls(t).getFirst();
        assertThat(sent.method()).isEqualTo("POST");
        assertThat(sent.uri().toString())
                .isEqualTo("https://api-m.sandbox.paypal.com/v2/payments/captures/" + CAPTURE + "/refund");
        assertThat(sent.headers())
                .containsEntry("PayPal-Request-Id", KEY)
                .containsEntry("Prefer", "return=representation");
        assertThat(JSON.readTree(sent.body()))
                .isEqualTo(JSON.readTree(
                        "{\"amount\":{\"currency_code\":\"USD\",\"value\":\"40.00\"},\"custom_id\":\"" + L + "\"}"));
        assertThat(result.classification()).isEqualTo(SUCCESS);
        var fact = result.payload();
        assertThat(fact.refundId()).isEqualTo(R1);
        assertThat(fact.chargeId()).isEqualTo(CAPTURE);
        assertThat(fact.status()).isEqualTo("COMPLETED");
        assertThat(fact.amountMinor()).isEqualTo(4000);
        assertThat(fact.currency()).isEqualTo("USD");
        assertThat(fact.balanceTransactionId()).isEqualTo(R1);
        assertThat(fact.createdAt()).isEqualTo(TIME);
        assertThat(result.evidence().idempotencyKeyUsed()).isEqualTo(KEY);
        assertThat(result.evidence().httpStatus()).isEqualTo(201);
        assertThat(result.evidence().apiVersion()).isEqualTo("paypal-payments-v2");
    }

    @Test
    void sameKeyReplayReturnsSameRefund() {
        var t = new PayPalTestTransport().token().reply(201, body()).reply(200, body());
        var adapter = adapter(t);
        assertThat(adapter.createRefund(command()).payload().refundId()).isEqualTo(R1);
        assertThat(adapter.createRefund(command()).payload().refundId()).isEqualTo(R1);
        var calls = refundCalls(t);
        assertThat(calls).hasSize(2);
        assertThat(calls.get(1).uri()).isEqualTo(calls.getFirst().uri());
        assertThat(calls.get(1).body()).isEqualTo(calls.getFirst().body());
        assertThat(calls).allSatisfy(c -> assertThat(c.headers()).containsEntry("PayPal-Request-Id", KEY));
    }

    @Test
    void refundStatusesStayRaw() {
        for (String status : List.of("COMPLETED", "PENDING", "FAILED", "CANCELLED", "CANCELED", "X")) {
            var t = new PayPalTestTransport()
                    .token()
                    .reply(201, refund(R1, CAPTURE, status, "40.00", null, L.toString()));
            var result = adapter(t).createRefund(command());
            if (Set.of("CANCELED", "X").contains(status))
                assertThat(result.classification()).isEqualTo(CONTRACT_MISMATCH);
            else {
                assertThat(result.classification()).isEqualTo(SUCCESS);
                assertThat(result.payload().status()).isEqualTo(status);
            }
        }
    }

    @Test
    void createResponseMustMatchCommand() throws Exception {
        var wrongAmount = tree(body());
        ((ObjectNode) wrongAmount.path("amount")).put("value", "41.00");
        var wrongCurrency = tree(body());
        ((ObjectNode) wrongCurrency.path("amount")).put("currency_code", "EUR");
        var wrongCustom = tree(body()).put("custom_id", new UUID(0, 9).toString());
        var wrongCapture = tree(refund(R1, "OTHERCAPTURE1", "COMPLETED", "40.00", "1.40", L.toString()));
        var missingAmount = tree(body());
        missingAmount.remove("amount");
        var badId = tree(body()).put("id", "bad-id");
        for (var variant : List.of(wrongAmount, wrongCurrency, wrongCustom, wrongCapture, missingAmount, badId)) {
            var result = adapter(new PayPalTestTransport().token().reply(201, variant.toString()))
                    .createRefund(command());
            assertThat(result.classification()).isEqualTo(CONTRACT_MISMATCH);
            assertThat(result.evidence().providerErrorCode()).isEqualTo("paypal_contract_mismatch");
        }
        var absent = tree(body());
        absent.remove("custom_id");
        assertThat(adapter(new PayPalTestTransport().token().reply(201, absent.toString()))
                        .createRefund(command())
                        .classification())
                .isEqualTo(SUCCESS);
    }

    @Test
    void refundStatusesClassifyPerTable() throws Exception {
        var statuses = List.of(422, 422, 422, 400, 401, 403, 404, 409, 429, 500, 302);
        var expected = List.of(
                DEFINITIVE_REJECT,
                DEFINITIVE_REJECT,
                CONTRACT_MISMATCH,
                CONTRACT_MISMATCH,
                RETRYABLE_TRANSIENT,
                CAPABILITY_UNAVAILABLE,
                NOT_FOUND,
                RETRYABLE_TRANSIENT,
                RATE_LIMITED,
                RETRYABLE_TRANSIENT,
                CONTRACT_MISMATCH);
        for (int i = 0; i < statuses.size(); i++) {
            String response = i == 0
                    ? Files.readString(Path.of("../docs/adr/paypal-samples/10-over-refund.json"))
                    : i == 1 ? error("CAPTURE_FULLY_REFUNDED") : i == 2 ? error("OTHER_ISSUE") : "{}";
            var t = new PayPalTestTransport().token();
            if (statuses.get(i) == 401) t.reply(401, response).token();
            t.reply(statuses.get(i), response);
            var result = adapter(t).createRefund(command());
            assertThat(result.classification()).isEqualTo(expected.get(i));
            assertThat(result.payload()).isNull();
            assertThat(result.evidence().idempotencyKeyUsed()).isEqualTo(KEY);
            if (i < 3)
                assertThat(result.evidence().providerErrorCode())
                        .isEqualTo(List.of("REFUND_AMOUNT_EXCEEDED", "CAPTURE_FULLY_REFUNDED", "OTHER_ISSUE")
                                .get(i));
        }
    }

    @Test
    void timeoutIsUnknownWithKey() {
        var result = adapter(new PayPalTestTransport().token().fail(new HttpTimeoutException("x")))
                .createRefund(command());
        assertThat(result.classification()).isEqualTo(TIMEOUT_UNKNOWN);
        assertThat(result.evidence().httpStatus()).isNull();
        assertThat(result.evidence().idempotencyKeyUsed()).isEqualTo(KEY);
    }

    @Test
    void tokenFailureSendsNothing() {
        var t = new PayPalTestTransport().reply(503, "{}");
        var result = adapter(t).createRefund(command());
        assertThat(result.classification()).isEqualTo(RETRYABLE_TRANSIENT);
        assertThat(result.evidence().idempotencyKeyUsed()).isNull();
        assertThat(refundCalls(t)).isEmpty();
    }

    @Test
    void completedRefundCarriesSettlement() {
        var bt = adapter(new PayPalTestTransport().token().reply(201, body()))
                .createRefund(command())
                .payload()
                .settlement();
        assertThat(bt.btId()).isEqualTo(R1);
        assertThat(bt.type()).isEqualTo("refund");
        assertThat(bt.amountMinor()).isEqualTo(-4000);
        assertThat(bt.feeMinor()).isEqualTo(-140);
        assertThat(bt.netMinor()).isEqualTo(-3860);
        assertThat(bt.currency()).isEqualTo("USD");
        assertThat(bt.balanceDomain()).isEqualTo("PAYMENTS");
        assertThat(bt.sourceObjectId()).isEqualTo(R1);
        assertThat(bt.sourceObjectType()).isEqualTo("refund");
        assertThat(bt.status()).isEqualTo("available");
        assertThat(bt.createdAt()).isEqualTo(TIME);
        assertThat(bt.availableOn()).isNull();
        assertThat(bt.feeDetails()).containsExactly(new FeeDetail(-140, "USD", "paypal_fee", null));
        assertThat(bt.rawDigest()).matches("[a-f0-9]{64}");
    }

    @Test
    void settlementOnlyForConsistentCompletedRefund() throws Exception {
        for (var body : List.of(
                refund(R1, CAPTURE, "PENDING", "40.00", "1.40", L.toString()),
                refund(R1, CAPTURE, "COMPLETED", "40.00", null, L.toString()))) {
            var fact = adapter(new PayPalTestTransport().token().reply(201, body))
                    .createRefund(command())
                    .payload();
            assertThat(fact.settlement()).isNull();
            assertThat(fact.balanceTransactionId()).isNull();
        }
        var zero = adapter(new PayPalTestTransport()
                        .token()
                        .reply(201, refund(R1, CAPTURE, "COMPLETED", "40.00", "0.00", L.toString())))
                .createRefund(command())
                .payload()
                .settlement();
        assertThat(zero.amountMinor()).isEqualTo(-4000);
        assertThat(zero.feeMinor()).isZero();
        assertThat(zero.netMinor()).isEqualTo(-4000);
        assertThat(zero.feeDetails()).isEmpty();
        var net = tree(body());
        ((ObjectNode) net.path("seller_payable_breakdown").path("net_amount")).put("value", "38.59");
        var gross = tree(body());
        ((ObjectNode) gross.path("seller_payable_breakdown").path("gross_amount")).put("value", "39.00");
        var fee = tree(body());
        ((ObjectNode) fee.path("seller_payable_breakdown").path("paypal_fee")).put("currency_code", "EUR");
        var time = tree(body());
        time.remove("create_time");
        for (var variant : List.of(net, gross, fee, time))
            assertThat(adapter(new PayPalTestTransport().token().reply(201, variant.toString()))
                            .createRefund(command())
                            .classification())
                    .isEqualTo(CONTRACT_MISMATCH);
    }

    @Test
    void queryRefundReadsUpLink() throws Exception {
        var absent = tree(body());
        absent.putArray("links");
        var t = new PayPalTestTransport().token().reply(200, body()).reply(200, absent.toString());
        var a = adapter(t);
        var result = a.queryRefund(SCOPE, R1);
        assertThat(result.classification()).isEqualTo(SUCCESS);
        assertThat(result.payload().chargeId()).isEqualTo(CAPTURE);
        assertThat(result.evidence().idempotencyKeyUsed()).isNull();
        assertThat(t.calls().get(1).method()).isEqualTo("GET");
        assertThat(t.calls().get(1).uri().getPath()).isEqualTo("/v2/payments/refunds/" + R1);
        assertThat(t.calls().get(1).headers()).doesNotContainKey("PayPal-Request-Id");
        assertThat(a.queryRefund(SCOPE, R1).classification()).isEqualTo(CONTRACT_MISMATCH);
    }

    @Test
    void orderRefundsListByCustomId() throws Exception {
        String listed = orderWithRefunds(
                ORDER, P.toString(), CAPTURE, body(), refund(R2, CAPTURE, "COMPLETED", "40.00", null, null));
        var noCapture = tree(listed);
        ((ObjectNode) noCapture.path("purchase_units").path(0).path("payments")).remove("captures");
        var t = new PayPalTestTransport()
                .token()
                .reply(200, listed)
                .reply(200, capturedOrder(ORDER, P.toString(), CAPTURE, "COMPLETED", true))
                .reply(200, noCapture.toString());
        var a = adapter(t);
        var result = a.queryOrderRefunds(SCOPE, ORDER);
        assertThat(result.classification()).isEqualTo(SUCCESS);
        assertThat(result.payload()).hasSize(2);
        assertThat(result.payload().getFirst().customId()).isEqualTo(L.toString());
        assertThat(result.payload().getFirst().refund().refundId()).isEqualTo(R1);
        assertThat(result.payload().getFirst().refund().chargeId()).isEqualTo(CAPTURE);
        assertThat(result.payload().get(1).customId()).isNull();
        assertThat(result.payload().get(1).refund().refundId()).isEqualTo(R2);
        assertThat(result.payload().get(1).refund().chargeId()).isEqualTo(CAPTURE);
        var empty = a.queryOrderRefunds(SCOPE, ORDER);
        assertThat(empty.classification()).isEqualTo(SUCCESS);
        assertThat(empty.payload()).isEmpty();
        assertThat(a.queryOrderRefunds(SCOPE, ORDER).classification()).isEqualTo(CONTRACT_MISMATCH);
    }

    @Test
    void invalidInputIsRefusedBeforeSending() {
        var t = new PayPalTestTransport();
        var a = adapter(t);
        var foreign = new ProviderScope(SCOPE.organizationId(), SCOPE.environmentId(), new UUID(0, 9), false);
        for (var command : List.of(
                new CreateRefundCommand(foreign, KEY, CAPTURE, null, 4000, null, "USD", L),
                new CreateRefundCommand(SCOPE, KEY, null, "pi_1", 4000, null, "USD", L),
                new CreateRefundCommand(SCOPE, KEY, CAPTURE, null, 4000, null, null, L),
                new CreateRefundCommand(SCOPE, KEY, CAPTURE, null, 4000, null, "USD", null),
                new CreateRefundCommand(SCOPE, KEY, "../x", null, 4000, null, "USD", L)))
            assertThatThrownBy(() -> a.createRefund(command)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> a.queryRefund(SCOPE, "../x")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> a.queryOrderRefunds(foreign, ORDER)).isInstanceOf(IllegalArgumentException.class);
        assertThat(t.calls()).isEmpty();
    }

    @Test
    void noPayerDataInResults() throws Exception {
        var body = tree(body());
        body.putObject("payer").put("email_address", "sb-buyer@personal.example.com");
        var result = adapter(new PayPalTestTransport().token().reply(201, body.toString()))
                .createRefund(command());
        assertThat(result.toString())
                .doesNotContain("sb-buyer@personal.example.com", "payer", "secret-fixture-do-not-log");
        assertThat(result.evidence().toString())
                .doesNotContain("sb-buyer@personal.example.com", "payer", "secret-fixture-do-not-log");
    }

    @Test
    void paypalRefundStatusesMergeAndSettle() {
        var local = new LocalRefund(
                L,
                P,
                SCOPE.organizationId(),
                SCOPE.environmentId(),
                new UUID(0, 3),
                SCOPE.providerAccountId(),
                "USD",
                4000,
                "LOCAL",
                "SUBMITTED",
                ResolutionStatus.KNOWN,
                null,
                null,
                CAPTURE,
                null,
                null,
                null);
        for (var entry : Map.of(
                        "COMPLETED", "SUCCEEDED", "CANCELLED", "CANCELED", "FAILED", "FAILED", "PENDING", "PENDING")
                .entrySet()) {
            var merged = RefundFactRules.merge(
                    local, new RefundFact(R1, CAPTURE, entry.getKey(), 4000, "USD", null, null, null, TIME));
            assertThat(merged.status()).isEqualTo(entry.getValue());
            assertThat(merged.recognized()).isTrue();
            assertThat(merged.providerStatus()).isEqualTo(entry.getKey());
            assertThat(merged.settlement())
                    .isEqualTo(
                            entry.getKey().equals("PENDING")
                                    ? null
                                    : new RefundFactRules.Settlement(
                                            4000, entry.getKey().equals("COMPLETED") ? 4000 : 0));
        }
        var unknown = RefundFactRules.merge(
                local, new RefundFact(R1, CAPTURE, "CANCELED", 4000, "USD", null, null, null, TIME));
        assertThat(unknown.status()).isEqualTo("SUBMITTED");
        assertThat(unknown.recognized()).isFalse();
    }

    @Test
    void overRefundRejectionRevealsExternalRefund() {
        assertThat(RefundFactRules.rejectionRevealsExternalRefund("REFUND_AMOUNT_EXCEEDED"))
                .isTrue();
        assertThat(RefundFactRules.rejectionRevealsExternalRefund("CAPTURE_FULLY_REFUNDED"))
                .isTrue();
        assertThat(RefundFactRules.rejectionRevealsExternalRefund("charge_already_refunded"))
                .isFalse();
        assertThat(RefundFactRules.rejectionRevealsExternalRefund(null)).isFalse();
    }

    @Test
    void latestChargeIsTheCaptureAndBeansAreWired() {
        var charge = new ChargeFact(
                CAPTURE, ORDER, "succeeded", true, 10000, 10000L, "USD", CAPTURE, null, "COMPLETED", TIME);
        var session =
                new CheckoutSessionFact(ORDER, CheckoutSessionStatus.COMPLETE, null, null, "COMPLETED", TIME, Map.of());
        var facts = new PaymentFacts(session, null, List.of(charge), true, false, TIME, 5L);
        assertThat(PaymentEvidenceRules.latestChargeId(facts, false)).isEqualTo(CAPTURE);
        assertThat(PaymentEvidenceRules.latestChargeId(facts, true)).isNull();
        var pending = new ChargeFact(CAPTURE, ORDER, "pending", false, 10000, null, "USD", null, null, "PENDING", TIME);
        assertThat(PaymentEvidenceRules.latestChargeId(
                        new PaymentFacts(session, null, List.of(pending), false, false, TIME, 5L), false))
                .isNull();
        var intent = new PaymentIntentFact(
                "pi_1", "succeeded", 10000, 10000L, "USD", List.of("ch_1"), "ch_1", null, Map.of(), TIME);
        assertThat(PaymentEvidenceRules.latestChargeId(
                        new PaymentFacts(null, intent, List.of(), true, false, TIME, 5L), false))
                .isEqualTo("ch_1");
        new ApplicationContextRunner()
                .withUserConfiguration(PayPalAdapterConfiguration.class, PayPalCheckoutConfiguration.class)
                .withPropertyValues(
                        "platform.paypal.enabled=true",
                        "platform.paypal.client-id=client-fixture",
                        "platform.paypal.client-secret=secret-fixture-do-not-log",
                        "platform.paypal.organization-id=" + SCOPE.organizationId(),
                        "platform.paypal.environment-id=" + SCOPE.environmentId(),
                        "platform.paypal.provider-account-id=" + SCOPE.providerAccountId())
                .run(c -> {
                    assertThat(c).hasNotFailed().hasSingleBean(RefundPort.class).hasSingleBean(RefundSearchPort.class);
                    assertThat(c.getBean(RefundPort.class))
                            .isInstanceOf(PayPalRefundAdapter.class)
                            .isSameAs(c.getBean(RefundSearchPort.class));
                });
    }

    static CreateRefundCommand command() {
        return new CreateRefundCommand(SCOPE, KEY, CAPTURE, null, 4000, null, "USD", L);
    }

    static PayPalRefundAdapter adapter(PayPalTestTransport t) {
        return new PayPalRefundAdapter(t.client(CLOCK), SCOPE, CLOCK);
    }

    static String body() {
        return refund(R1, CAPTURE, "COMPLETED", "40.00", "1.40", L.toString());
    }

    static ObjectNode tree(String body) throws Exception {
        return (ObjectNode) JSON.readTree(body);
    }

    static String error(String issue) {
        return "{\"details\":[{\"issue\":\"" + issue + "\"}]}";
    }

    static List<PayPalTestTransport.Sent> refundCalls(PayPalTestTransport t) {
        return t.calls().stream()
                .filter(c -> c.uri().getPath().endsWith("/refund"))
                .toList();
    }
}
