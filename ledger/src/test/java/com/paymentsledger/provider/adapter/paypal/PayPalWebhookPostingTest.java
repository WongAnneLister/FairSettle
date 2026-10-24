package com.paymentsledger.provider.adapter.paypal;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.payment.domain.*;
import com.paymentsledger.provider.ProviderModels.*;
import com.paymentsledger.webhook.PayPalWebhookEvents;
import com.paymentsledger.webhook.PayPalWebhookHandler;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

class PayPalWebhookPostingTest {
    static final String ORDER = "7CV2269518094610C", CAPTURE = "41995584GM234064G", R1 = "2EU12368F9867740A";
    static final Instant T = Instant.parse("2026-10-22T09:05:08Z");
    static final UUID PAYMENT = UUID.fromString("00000000-0000-0000-0000-0000000000bb");
    static final UUID REFUND = UUID.fromString("00000000-0000-0000-0000-0000000000dd");
    final ObjectMapper json = new ObjectMapper();

    @Test
    void captureSnapshotEqualsOrderQueryFacts() throws Exception {
        var capture = PayPalWebhookFacts.capture(capSnap()).orElseThrow();
        var order = PayPalOrderMapping.orderFact(json.readTree(
                        PayPalTestTransport.capturedOrder(ORDER, PAYMENT.toString(), CAPTURE, "COMPLETED", true)))
                .orElseThrow();
        assertThat(capture.orderId()).isEqualTo(ORDER);
        assertThat(capture.paymentId()).isEqualTo(PAYMENT);
        assertThat(capture.updatedAt()).isEqualTo(T);
        assertThat(capture.charge()).isEqualTo(order.captures().getFirst());
        assertThat(capture.settlement()).isEqualTo(order.settlements().getFirst());
        assertThat(capture.settlement().amountMinor()).isEqualTo(10000);
        assertThat(capture.settlement().feeMinor()).isEqualTo(349);
        assertThat(capture.settlement().netMinor()).isEqualTo(9651);
        assertThat(capture.settlement().createdAt()).isEqualTo(T);
        assertThat(capture.settlement().feeDetails()).containsExactly(new FeeDetail(349, "USD", "paypal_fee", null));
    }

    @Test
    void lateCaptureSnapshotEqualsOrderQueryFacts() throws Exception {
        // PayPal can deliver PAYMENT.CAPTURE.COMPLETED after a refund, with the capture's status at send time
        // (sandbox, 2026-10-25). It is still a captured payment, mapped exactly as a GET order would map it.
        for (var status : List.of("PARTIALLY_REFUNDED", "REFUNDED")) {
            var late = capSnap();
            late.put("status", status);
            var capture = PayPalWebhookFacts.capture(late).orElseThrow();
            var order = PayPalOrderMapping.orderFact(json.readTree(
                            PayPalTestTransport.capturedOrder(ORDER, PAYMENT.toString(), CAPTURE, status, true)))
                    .orElseThrow();
            assertThat(capture.orderId()).isEqualTo(ORDER);
            assertThat(capture.paymentId()).isEqualTo(PAYMENT);
            assertThat(capture.charge()).isEqualTo(order.captures().getFirst());
            assertThat(capture.charge().captured()).isTrue();
            assertThat(capture.charge().amountMinor()).isEqualTo(10000);
            assertThat(capture.settlement()).isNull();
            assertThat(order.settlements()).isEmpty();
        }
    }

    @Test
    void refundSnapshotEqualsRefundResponseFact() throws Exception {
        var refund = PayPalWebhookFacts.refund(refSnap()).orElseThrow();
        var response = PayPalRefundMapping.refund(
                        json.readTree(PayPalTestTransport.refund(
                                R1, CAPTURE, "COMPLETED", "40.00", "1.40", REFUND.toString())),
                        CAPTURE)
                .orElseThrow();
        assertThat(refund.customId()).isEqualTo(REFUND);
        assertThat(refund.updatedAt()).isEqualTo(Instant.parse("2026-10-22T10:00:00Z"));
        assertThat(refund.fact()).isEqualTo(response);
        assertThat(refund.fact().settlement().amountMinor()).isEqualTo(-4000);
        assertThat(refund.fact().settlement().feeMinor()).isEqualTo(-140);
        assertThat(refund.fact().settlement().netMinor()).isEqualTo(-3860);
    }

    @Test
    void captureFactsRejectUnsupportedSnapshots() throws Exception {
        List<Consumer<ObjectNode>> variants = List.of(
                n -> n.put("status", "PENDING"),
                n -> n.put("status", "DECLINED"),
                n -> n.put("status", "FAILED"),
                n -> n.put("event_type", "PAYMENT.CAPTURE.PENDING"),
                n -> n.put("object", "paypal.refund"),
                n -> n.put("id", "41995584gm234064g"),
                n -> n.remove("order_id"),
                n -> n.remove("custom_id"),
                n -> ((ObjectNode) n.path("amount")).put("value", "100.001"),
                n -> n.remove("amount"),
                n -> ((ObjectNode) n.path("breakdown")).put("gross", "90.00"),
                n -> ((ObjectNode) n.path("breakdown")).put("net", "96.50"),
                n -> n.remove("create_time"));
        for (var variant : variants) {
            var snapshot = capSnap();
            variant.accept(snapshot);
            assertThat(PayPalWebhookFacts.capture(snapshot)).isEmpty();
        }
    }

    @Test
    void captureBreakdownIsOptionalAndFeeDefaultsToZero() throws Exception {
        var absent = capSnap();
        absent.remove("breakdown");
        var capture = PayPalWebhookFacts.capture(absent).orElseThrow();
        assertThat(capture.settlement()).isNull();
        assertThat(capture.charge().balanceTransactionId()).isNull();
        var noFee = capSnap();
        ((ObjectNode) noFee.path("breakdown")).remove("fee");
        ((ObjectNode) noFee.path("breakdown")).put("net", "100.00");
        var settlement = PayPalWebhookFacts.capture(noFee).orElseThrow().settlement();
        assertThat(settlement.feeMinor()).isZero();
        assertThat(settlement.netMinor()).isEqualTo(10000);
        assertThat(settlement.feeDetails()).isEmpty();
        assertThat(settlement.rawDigest())
                .isEqualTo(PayPalOrderMapping.digest("paypal-capture|41995584GM234064G|10000|0|10000"));
    }

    @Test
    void refundFactsRejectUnsupportedSnapshots() throws Exception {
        List<Consumer<ObjectNode>> variants = List.of(
                n -> n.put("status", "PENDING"),
                n -> n.put("event_type", "PAYMENT.REFUND.PENDING"),
                n -> n.remove("capture_id"),
                n -> ((ObjectNode) n.path("amount")).put("value", "0.00"),
                n -> ((ObjectNode) n.path("breakdown")).put("gross", "39.00"));
        for (var variant : variants) {
            var snapshot = refSnap();
            variant.accept(snapshot);
            assertThat(PayPalWebhookFacts.refund(snapshot)).isEmpty();
        }
        assertThat(PayPalWebhookFacts.refund(
                        PayPalWebhookEvents.snapshot(event("webhook-refund-completed.json"), json)))
                .isEmpty();
    }

    @Test
    void refundWithoutBreakdownOrCustomId() throws Exception {
        var absent = refSnap();
        absent.remove(List.of("breakdown", "create_time", "update_time"));
        var refund = PayPalWebhookFacts.refund(absent).orElseThrow();
        assertThat(refund.fact().settlement()).isNull();
        assertThat(refund.fact().balanceTransactionId()).isNull();
        assertThat(refund.fact().createdAt()).isNull();
        assertThat(refund.updatedAt()).isNull();
        var noCustom = refSnap();
        noCustom.remove("custom_id");
        assertThat(PayPalWebhookFacts.refund(noCustom).orElseThrow().customId()).isNull();
        var badCustom = refSnap();
        badCustom.put("custom_id", "abc");
        assertThat(PayPalWebhookFacts.refund(badCustom).orElseThrow().customId())
                .isNull();
    }

    @Test
    void updatedAtFallsBackToCreateTime() throws Exception {
        var absent = capSnap();
        absent.remove("update_time");
        assertThat(PayPalWebhookFacts.capture(absent).orElseThrow().updatedAt()).isEqualTo(T);
        var invalid = capSnap();
        invalid.put("update_time", "yesterday");
        assertThat(PayPalWebhookFacts.capture(invalid).orElseThrow().updatedAt())
                .isEqualTo(T);
    }

    @Test
    void latestChargeFromCaptureWebhookOnly() throws Exception {
        var charge = PayPalWebhookFacts.capture(capSnap()).orElseThrow().charge();
        assertThat(PaymentEvidenceRules.latestChargeId(facts(charge), false)).isEqualTo(CAPTURE);
        assertThat(PaymentEvidenceRules.latestChargeId(facts(charge), true)).isNull();
        assertThat(PaymentEvidenceRules.latestChargeId(facts(copy(charge, CAPTURE, null)), false))
                .isNull();
        assertThat(PaymentEvidenceRules.latestChargeId(facts(copy(charge, CAPTURE, "authorized")), false))
                .isNull();
        var two = new PaymentFacts(
                null, null, List.of(charge, copy(charge, "5AB1234567890123C", "COMPLETED")), true, false, T);
        assertThat(PaymentEvidenceRules.latestChargeId(two, false)).isNull();
    }

    @Test
    void staleDuplicateCaptureMovesNothing() throws Exception {
        var payment = snapshot(
                PaymentStatus.SUCCEEDED, "COMPLETED", FinancialStatus.POSTED, Instant.parse("2026-10-23T00:00:00Z"));
        var facts = facts(PayPalWebhookFacts.capture(capSnap()).orElseThrow().charge());
        assertThat(PaymentEvidenceRules.isStale(payment, facts, false)).isTrue();
        var decision = PaymentEvidenceRules.decide(payment, facts, false, true, false, 10000, 10000L);
        assertThat(decision.status()).isEqualTo(PaymentStatus.SUCCEEDED);
        assertThat(decision.providerStatus()).isEqualTo("COMPLETED");
        assertThat(decision.resolution()).isEqualTo(ResolutionStatus.KNOWN);
        assertThat(decision.financial()).isEqualTo(FinancialStatus.POSTED);
    }

    @Test
    void captureSkipsAheadButNeverRevivesCanceled() throws Exception {
        var facts = facts(PayPalWebhookFacts.capture(capSnap()).orElseThrow().charge());
        var decision = PaymentEvidenceRules.decide(
                snapshot(PaymentStatus.AWAITING_CUSTOMER, null, FinancialStatus.NOT_APPLICABLE, null),
                facts,
                false,
                false,
                false,
                10000,
                0L);
        assertThat(decision.status()).isEqualTo(PaymentStatus.SUCCEEDED);
        assertThat(decision.financial()).isEqualTo(FinancialStatus.PENDING_EVIDENCE);
        assertThat(decision.resolution()).isEqualTo(ResolutionStatus.KNOWN);
        var canceled = PaymentEvidenceRules.decide(
                snapshot(PaymentStatus.CANCELED, null, FinancialStatus.NOT_APPLICABLE, null),
                facts,
                false,
                false,
                false,
                10000,
                0L);
        assertThat(canceled.status()).isEqualTo(PaymentStatus.CANCELED);
        assertThat(canceled.resolution()).isEqualTo(ResolutionStatus.CONFLICT);
    }

    @Test
    void refundEventStateRules() throws Exception {
        var fact = PayPalWebhookFacts.refund(refSnap()).orElseThrow().fact();
        var submitted = RefundFactRules.merge(local("SUBMITTED", ResolutionStatus.UNKNOWN, null, 4000), fact);
        assertThat(submitted.conflict()).isFalse();
        assertThat(submitted.status()).isEqualTo("SUCCEEDED");
        assertThat(submitted.settlement()).isEqualTo(new RefundFactRules.Settlement(4000, 4000));
        var succeeded = RefundFactRules.merge(local("SUCCEEDED", ResolutionStatus.KNOWN, R1, 4000), fact);
        assertThat(succeeded.conflict()).isFalse();
        assertThat(succeeded.status()).isEqualTo("SUCCEEDED");
        assertThat(succeeded.settlement()).isNull();
        assertThat(RefundFactRules.merge(local("FAILED", ResolutionStatus.KNOWN, null, 4000), fact)
                        .conflict())
                .isTrue();
        assertThat(RefundFactRules.merge(local("SUBMITTED", ResolutionStatus.UNKNOWN, null, 5000), fact)
                        .conflict())
                .isTrue();
    }

    @Test
    void routeHandlesOnlyCompletedCaptureAndRefund() {
        assertThat(PayPalWebhookHandler.route("paypal.capture", "PAYMENT.CAPTURE.COMPLETED"))
                .isEqualTo(PayPalWebhookHandler.Route.CAPTURE);
        assertThat(PayPalWebhookHandler.route("paypal.refund", "PAYMENT.CAPTURE.REFUNDED"))
                .isEqualTo(PayPalWebhookHandler.Route.REFUND);
        String[][] unsupported = {
            {"paypal.capture", "PAYMENT.CAPTURE.PENDING"},
            {"paypal.capture", "PAYMENT.CAPTURE.DECLINED"},
            {"paypal.capture", "PAYMENT.CAPTURE.REVERSED"},
            {"paypal.refund", "PAYMENT.REFUND.PENDING"},
            {"paypal.refund", "PAYMENT.REFUND.FAILED"},
            {"paypal.order", "CHECKOUT.ORDER.APPROVED"},
            {"paypal.capture", "PAYMENT.CAPTURE.REFUNDED"},
            {null, "PAYMENT.CAPTURE.COMPLETED"},
            {"paypal.capture", null}
        };
        for (var pair : unsupported)
            assertThat(PayPalWebhookHandler.route(pair[0], pair[1])).isEqualTo(PayPalWebhookHandler.Route.UNSUPPORTED);
    }

    private ObjectNode capSnap() throws Exception {
        return PayPalWebhookEvents.snapshot(event("webhook-capture-completed.json"), json);
    }

    private ObjectNode refSnap() throws Exception {
        var event = event("webhook-refund-completed.json");
        ((ObjectNode) event.path("resource"))
                .put("create_time", "2026-10-22T10:00:00Z")
                .put("update_time", "2026-10-22T10:00:00Z");
        return PayPalWebhookEvents.snapshot(event, json);
    }

    private ObjectNode event(String file) throws Exception {
        return (ObjectNode) json.readTree(Files.readAllBytes(Path.of("src/test/resources/paypal/" + file)));
    }

    private PaymentFacts facts(ChargeFact charge) {
        return new PaymentFacts(null, null, List.of(charge), true, false, T);
    }

    private ChargeFact copy(ChargeFact charge, String id, String outcome) {
        return new ChargeFact(
                id,
                charge.paymentIntentId(),
                charge.status(),
                charge.captured(),
                charge.amountMinor(),
                charge.amountCapturedMinor(),
                charge.currency(),
                charge.balanceTransactionId(),
                charge.failureCode(),
                outcome,
                charge.createdAt());
    }

    private PaymentSnapshot snapshot(
            PaymentStatus status, String providerStatus, FinancialStatus financial, Instant lastQuery) {
        return new PaymentSnapshot(
                PAYMENT,
                null,
                null,
                null,
                null,
                "USD",
                10000,
                0,
                status,
                providerStatus,
                ResolutionStatus.KNOWN,
                financial,
                ORDER,
                null,
                null,
                null,
                lastQuery);
    }

    private LocalRefund local(String status, ResolutionStatus resolution, String providerId, long amount) {
        return new LocalRefund(
                REFUND,
                PAYMENT,
                null,
                null,
                null,
                null,
                "USD",
                amount,
                "LOCAL",
                status,
                resolution,
                null,
                providerId,
                CAPTURE,
                null,
                null,
                null);
    }
}
