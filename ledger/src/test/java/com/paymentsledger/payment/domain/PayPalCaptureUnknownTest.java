package com.paymentsledger.payment.domain;

import static com.paymentsledger.payment.domain.CaptureRecoveryRules.Next.*;
import static com.paymentsledger.payment.domain.FinancialStatus.NOT_APPLICABLE;
import static com.paymentsledger.payment.domain.PaymentStatus.*;
import static com.paymentsledger.payment.domain.ResolutionStatus.*;
import static com.paymentsledger.provider.ProviderCallClassification.*;
import static com.paymentsledger.provider.ProviderModels.CheckoutSessionStatus.*;
import static org.assertj.core.api.Assertions.*;

import com.paymentsledger.provider.ProviderModels.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;

class PayPalCaptureUnknownTest {
    static final String ORDER = "7CV2269518094610C", CAPTURE = "41995584GM234064G";
    static final UUID P = UUID.fromString("00000000-0000-0000-0000-0000000000bb");
    static final Instant T0 = Instant.parse("2026-10-22T09:00:00Z");
    static final Instant NOW = T0.plusSeconds(60);
    static final PaymentProgress APPROVED_KNOWN = progress(PROCESSING, "APPROVED", KNOWN, 0);

    @Test
    void capturedPaymentResolves() {
        var captured = progress(SUCCEEDED, "COMPLETED", KNOWN, 10000);
        assertThat(CaptureRecoveryRules.next(captured, false, NOW.plusSeconds(1), NOW, false))
                .isEqualTo(RESOLVE);
        assertThat(CaptureRecoveryRules.next(captured, true, NOW.plusSeconds(1), NOW, false))
                .isEqualTo(RESOLVE);
        assertThat(CaptureRecoveryRules.next(captured, false, NOW.plusSeconds(1), NOW, true))
                .isEqualTo(RESOLVE);
    }

    @Test
    void canceledPaymentResolves() {
        assertThat(CaptureRecoveryRules.next(progress(CANCELED, "VOIDED", KNOWN, 0), false, null, NOW, true))
                .isEqualTo(RESOLVE);
    }

    @Test
    void approvedWithinWindowResends() {
        assertThat(CaptureRecoveryRules.next(APPROVED_KNOWN, true, NOW.plusSeconds(1), NOW, false))
                .isEqualTo(RESEND);
        assertThat(CaptureRecoveryRules.next(APPROVED_KNOWN, true, NOW.plusSeconds(1), NOW, true))
                .isEqualTo(RESEND);
    }

    @Test
    void approvedAtOrAfterWindowEscalates() {
        assertThat(CaptureRecoveryRules.next(APPROVED_KNOWN, true, NOW, NOW, false))
                .isEqualTo(ESCALATE_WINDOW);
        assertThat(CaptureRecoveryRules.next(APPROVED_KNOWN, true, NOW.minusSeconds(1), NOW, false))
                .isEqualTo(ESCALATE_WINDOW);
        assertThat(CaptureRecoveryRules.next(APPROVED_KNOWN, true, null, NOW, false))
                .isEqualTo(ESCALATE_WINDOW);
    }

    @Test
    void approvedButNotCapturableNeverResends() {
        for (var payment : List.of(
                progress(PROCESSING, "APPROVED", CONFLICT, 0),
                progress(PROCESSING, "APPROVED", UNKNOWN, 0),
                progress(AWAITING_CUSTOMER, "PAYER_ACTION_REQUIRED", KNOWN, 0))) {
            assertThat(CaptureRecoveryRules.next(payment, true, NOW.plusSeconds(1), NOW, false))
                    .isEqualTo(WAIT);
            assertThat(CaptureRecoveryRules.next(payment, true, NOW.plusSeconds(1), NOW, true))
                    .isEqualTo(ESCALATE_AGE);
        }
    }

    @Test
    void failedQueryWaitsThenEscalatesAtAgeLimit() {
        var payment = progress(PROCESSING, "APPROVED", UNKNOWN, 0);
        assertThat(CaptureRecoveryRules.next(payment, false, NOW.plusSeconds(1), NOW, false))
                .isEqualTo(WAIT);
        assertThat(CaptureRecoveryRules.next(payment, false, NOW.plusSeconds(1), NOW, true))
                .isEqualTo(ESCALATE_AGE);
    }

    @Test
    void alreadyCapturedIsQueriedImmediately() {
        assertThat(CaptureOutcomeRules.queriesAfter(TIMEOUT_UNKNOWN, "ORDER_ALREADY_CAPTURED"))
                .isTrue();
        assertThat(CaptureOutcomeRules.queriesAfter(TIMEOUT_UNKNOWN, null)).isFalse();
        assertThat(CaptureOutcomeRules.queriesAfter(RETRYABLE_TRANSIENT, "ORDER_ALREADY_CAPTURED"))
                .isFalse();
        assertThat(CaptureOutcomeRules.queriesAfter(TIMEOUT_UNKNOWN, "NO_RESPONSE"))
                .isFalse();
    }

    @Test
    void voidedOrderCancelsFromQuery() {
        var decision = decide(facts(order(EXPIRED, "VOIDED"), List.of(), true), true, false, 0);
        assertThat(decision.status()).isEqualTo(CANCELED);
        assertThat(decision.providerStatus()).isEqualTo("VOIDED");
        assertThat(decision.resolution()).isEqualTo(KNOWN);
    }

    @Test
    void completedWithDeclinedCaptureCancelsFromQuery() {
        var decision = decide(declined(true), true, false, 0);
        assertThat(decision.status()).isEqualTo(CANCELED);
        assertThat(decision.providerStatus()).isEqualTo("COMPLETED");
        assertThat(decision.resolution()).isEqualTo(KNOWN);
    }

    @Test
    void declinedCaptureNeverCancelsFromWebhookOrIncompleteEvidence() {
        var webhook = decide(declined(true), false, false, 0);
        var incomplete = decide(declined(false), true, false, 0);
        var conflict = decide(
                new PaymentFacts(
                        order(COMPLETE, "COMPLETED"),
                        null,
                        List.of(capture("failed", false)),
                        true,
                        true,
                        T0.plusSeconds(1),
                        5L),
                true,
                true,
                0);
        assertThat(webhook.status()).isEqualTo(PROCESSING);
        assertThat(webhook.resolution()).isEqualTo(KNOWN);
        assertThat(incomplete.status()).isEqualTo(PROCESSING);
        assertThat(incomplete.resolution()).isEqualTo(UNKNOWN);
        assertThat(conflict.status()).isEqualTo(PROCESSING);
        assertThat(conflict.resolution()).isEqualTo(CONFLICT);
    }

    @Test
    void captureDeclinedRule() {
        assertThat(PaymentEvidenceRules.captureDeclined(declined(true))).isTrue();
        assertThat(PaymentEvidenceRules.captureDeclined(facts(order(COMPLETE, "COMPLETED"), List.of(), true)))
                .isFalse();
        assertThat(PaymentEvidenceRules.captureDeclined(
                        facts(order(COMPLETE, "COMPLETED"), List.of(capture("pending", false)), true)))
                .isFalse();
        assertThat(PaymentEvidenceRules.captureDeclined(
                        facts(order(COMPLETE, "COMPLETED"), List.of(capture("succeeded", true)), true)))
                .isFalse();
        assertThat(PaymentEvidenceRules.captureDeclined(
                        facts(order(COMPLETE, "APPROVED"), List.of(capture("failed", false)), true)))
                .isFalse();
        var stripe =
                new CheckoutSessionFact("cs_1", COMPLETE, null, "pi_1", "paid", T0, Map.of("payment_id", P.toString()));
        assertThat(PaymentEvidenceRules.captureDeclined(facts(stripe, List.of(capture("failed", false)), true)))
                .isFalse();
    }

    @Test
    void capturedMoneyIsNeverCanceled() {
        assertThat(decide(declined(true), true, false, 10000).status()).isEqualTo(SUCCEEDED);
    }

    private static PaymentProgress progress(
            PaymentStatus status, String provider, ResolutionStatus resolution, long captured) {
        return new PaymentProgress(5, status, provider, resolution, ORDER, null, captured, T0);
    }

    private static PaymentSnapshot snapshot() {
        return new PaymentSnapshot(
                P,
                new UUID(0, 1),
                new UUID(0, 2),
                new UUID(0, 3),
                new UUID(0, 4),
                "USD",
                10000,
                5,
                PROCESSING,
                "APPROVED",
                UNKNOWN,
                NOT_APPLICABLE,
                ORDER,
                null,
                T0,
                null,
                null);
    }

    private static CheckoutSessionFact order(CheckoutSessionStatus status, String provider) {
        return new CheckoutSessionFact(ORDER, status, null, null, provider, T0, Map.of("payment_id", P.toString()));
    }

    private static ChargeFact capture(String status, boolean captured) {
        return new ChargeFact(
                CAPTURE,
                ORDER,
                status,
                captured,
                10000,
                captured ? 10000L : null,
                "USD",
                captured ? CAPTURE : null,
                null,
                "COMPLETED",
                T0);
    }

    private static PaymentFacts facts(CheckoutSessionFact session, List<ChargeFact> charges, boolean complete) {
        return new PaymentFacts(session, null, charges, complete, false, T0.plusSeconds(1), 5L);
    }

    private static PaymentFacts declined(boolean complete) {
        return facts(order(COMPLETE, "COMPLETED"), List.of(capture("failed", false)), complete);
    }

    private static PaymentEvidenceRules.StateDecision decide(
            PaymentFacts facts, boolean query, boolean conflict, long captured) {
        return PaymentEvidenceRules.decide(
                snapshot(), facts, query, false, conflict, captured, captured > 0 ? 0L : null);
    }
}
