package com.paymentsledger.payment.domain;

import static com.paymentsledger.payment.domain.FinancialStatus.*;
import static com.paymentsledger.payment.domain.PaymentStatus.*;
import static com.paymentsledger.payment.domain.ResolutionStatus.*;
import static com.paymentsledger.provider.ProviderCallClassification.*;
import static com.paymentsledger.provider.ProviderModels.CheckoutSessionStatus.*;
import static org.assertj.core.api.Assertions.*;

import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;

class PaymentStateMachinePayPalTest {
    static final String ORDER = "7CV2269518094610C", CAPTURE = "41995584GM234064G";
    static final UUID P = UUID.fromString("00000000-0000-0000-0000-0000000000bb");
    static final Instant T0 = Instant.parse("2026-10-22T09:00:00Z");

    @Test
    void approvedOrderIsApprovedNotCaptured() {
        var decision = decide(
                payment(AWAITING_CUSTOMER, "PAYER_ACTION_REQUIRED", KNOWN, NOT_APPLICABLE),
                facts(order(COMPLETE, "APPROVED"), List.of(), true),
                true,
                false,
                false,
                0,
                null);
        state(decision, PROCESSING, "APPROVED", KNOWN, NOT_APPLICABLE);
    }

    @Test
    void completedCaptureSucceedsPendingEvidence() {
        state(completed(0L, true), SUCCEEDED, "COMPLETED", KNOWN, PENDING_EVIDENCE);
    }

    @Test
    void postedCaptureIsPosted() {
        state(completed(10000L, true), SUCCEEDED, "COMPLETED", KNOWN, POSTED);
    }

    @Test
    void webhookMaySkipToSucceeded() {
        var decision = decide(
                payment(AWAITING_CUSTOMER, "PAYER_ACTION_REQUIRED", KNOWN, NOT_APPLICABLE),
                facts(order(COMPLETE, "COMPLETED"), List.of(capture("succeeded", true)), true),
                false,
                false,
                false,
                10000,
                0L);
        assertThat(decision.status()).isEqualTo(SUCCEEDED);
        assertThat(decision.providerStatus()).isEqualTo("COMPLETED");
    }

    @Test
    void pendingCaptureStaysProcessingUnknown() {
        var decision = decide(
                payment(PROCESSING, "APPROVED", KNOWN, NOT_APPLICABLE),
                facts(order(COMPLETE, "COMPLETED"), List.of(capture("pending", false)), false),
                true,
                false,
                false,
                0,
                null);
        state(decision, PROCESSING, "COMPLETED", UNKNOWN, NOT_APPLICABLE);
    }

    @Test
    void staleOrderAfterSuccessChangesNothing() {
        var decision = decide(
                payment(SUCCEEDED, "COMPLETED", KNOWN, POSTED),
                facts(order(COMPLETE, "APPROVED"), List.of(), true),
                true,
                true,
                false,
                10000,
                10000L);
        state(decision, SUCCEEDED, "COMPLETED", KNOWN, POSTED);
    }

    @Test
    void captureAfterCancelIsConflict() {
        var decision = decide(
                payment(CANCELED, "VOIDED", KNOWN, NOT_APPLICABLE),
                facts(order(COMPLETE, "COMPLETED"), List.of(capture("succeeded", true)), true),
                true,
                false,
                false,
                10000,
                0L);
        assertThat(decision.status()).isEqualTo(CANCELED);
        assertThat(decision.resolution()).isEqualTo(ResolutionStatus.CONFLICT);
    }

    @Test
    void stripeProviderStatusUnchanged() {
        var session =
                new CheckoutSessionFact("cs_1", COMPLETE, null, "pi_1", "paid", T0, Map.of("payment_id", P.toString()));
        var intent = new PaymentIntentFact("pi_1", "processing", 10000, 0L, "USD", List.of(), null, null, Map.of(), T0);
        var facts = new PaymentFacts(session, intent, List.of(), true, false, T0.plusSeconds(1), 5L);
        var payment = payment(PROCESSING, "open", KNOWN, NOT_APPLICABLE);
        assertThat(decide(payment, facts, true, false, false, 0, null).providerStatus())
                .isEqualTo("processing");
        assertThat(decide(payment, facts(session, List.of(), true), true, false, false, 0, null)
                        .providerStatus())
                .isEqualTo("complete");
    }

    @Test
    void preparesCaptureOnlyForApprovedQuery() {
        var approved = order(COMPLETE, "APPROVED");
        var facts = facts(approved, List.of(), true);
        assertThat(PaymentEvidenceRules.preparesCapture(facts, true)).isTrue();
        assertThat(PaymentEvidenceRules.preparesCapture(facts, false)).isFalse();
        assertThat(PaymentEvidenceRules.preparesCapture(facts(approved, List.of(), false), true))
                .isFalse();
        assertThat(PaymentEvidenceRules.preparesCapture(
                        new PaymentFacts(approved, null, List.of(), true, true, T0, 5L), true))
                .isFalse();
        assertThat(PaymentEvidenceRules.preparesCapture(facts(order(COMPLETE, "COMPLETED"), List.of(), true), true))
                .isFalse();
        assertThat(PaymentEvidenceRules.preparesCapture(
                        facts(approved, List.of(capture("pending", false)), true), true))
                .isFalse();
        var intent = new PaymentIntentFact("pi_1", "processing", 10000, 0L, "USD", List.of(), null, null, Map.of(), T0);
        assertThat(PaymentEvidenceRules.preparesCapture(
                        new PaymentFacts(approved, intent, List.of(), true, false, T0, 5L), true))
                .isFalse();
        assertThat(PaymentEvidenceRules.preparesCapture(facts(order(COMPLETE, "paid"), List.of(), true), true))
                .isFalse();
    }

    @Test
    void capturableIsApprovedNotCaptured() {
        assertThat(PaymentEvidenceRules.capturable(progress(PROCESSING, "APPROVED", KNOWN, 0, ORDER, null)))
                .isTrue();
        for (var progress : List.of(
                progress(AWAITING_CUSTOMER, "APPROVED", KNOWN, 0, ORDER, null),
                progress(PROCESSING, "COMPLETED", KNOWN, 0, ORDER, null),
                progress(PROCESSING, "APPROVED", UNKNOWN, 0, ORDER, null),
                progress(PROCESSING, "APPROVED", KNOWN, 1, ORDER, null),
                progress(PROCESSING, "APPROVED", KNOWN, 0, null, null),
                progress(PROCESSING, "APPROVED", KNOWN, 0, ORDER, "pi_1")))
            assertThat(PaymentEvidenceRules.capturable(progress)).isFalse();
    }

    @Test
    void captureOutcomeTable() {
        var pending = progress(PROCESSING, "APPROVED", KNOWN, 0, ORDER, null);
        assertThat(CaptureOutcomeRules.decide(
                        TIMEOUT_UNKNOWN, null, false, progress(SUCCEEDED, "COMPLETED", KNOWN, 10000, ORDER, null)))
                .isEqualTo(new CaptureOutcomeRules.Outcome("RESOLVED", "KNOWN", false, false));
        assertThat(CaptureOutcomeRules.decide(SUCCESS, null, true, pending))
                .isEqualTo(new CaptureOutcomeRules.Outcome("UNKNOWN", "UNKNOWN", true, false));
        assertThat(CaptureOutcomeRules.decide(SUCCESS, null, false, pending))
                .isEqualTo(new CaptureOutcomeRules.Outcome("UNKNOWN", "CONFLICT", true, true));
        assertThat(CaptureOutcomeRules.decide(CONTRACT_MISMATCH, null, true, pending))
                .isEqualTo(new CaptureOutcomeRules.Outcome("UNKNOWN", "CONFLICT", true, true));
        for (String code : List.of("ORDER_NOT_APPROVED", "INSTRUMENT_DECLINED"))
            assertThat(CaptureOutcomeRules.decide(DEFINITIVE_REJECT, code, true, pending))
                    .isEqualTo(new CaptureOutcomeRules.Outcome("ACKNOWLEDGED", "KNOWN", false, false));
        assertThat(CaptureOutcomeRules.decide(DEFINITIVE_REJECT, "OTHER", true, pending))
                .isEqualTo(new CaptureOutcomeRules.Outcome("ACKNOWLEDGED", "CONFLICT", true, true));
        assertThat(CaptureOutcomeRules.decide(CAPABILITY_UNAVAILABLE, null, true, pending))
                .isEqualTo(new CaptureOutcomeRules.Outcome("ACKNOWLEDGED", "KNOWN", false, false));
        for (var classification : List.of(
                TIMEOUT_UNKNOWN,
                RETRYABLE_TRANSIENT,
                RATE_LIMITED,
                NOT_FOUND,
                AUTH_REQUIRED,
                TRANSIENT_EMPTY,
                IDEMPOTENCY_CONFLICT))
            assertThat(CaptureOutcomeRules.decide(classification, null, true, pending))
                    .isEqualTo(new CaptureOutcomeRules.Outcome("UNKNOWN", "UNKNOWN", true, false));
        assertThat(CaptureOutcomeRules.queriesAfter(SUCCESS, null)).isTrue();
        assertThat(CaptureOutcomeRules.queriesAfter(DEFINITIVE_REJECT, "ORDER_NOT_APPROVED"))
                .isTrue();
        assertThat(CaptureOutcomeRules.queriesAfter(DEFINITIVE_REJECT, "INSTRUMENT_DECLINED"))
                .isTrue();
        assertThat(CaptureOutcomeRules.queriesAfter(DEFINITIVE_REJECT, "OTHER")).isFalse();
        assertThat(CaptureOutcomeRules.queriesAfter(TIMEOUT_UNKNOWN, null)).isFalse();
    }

    @Test
    void captureTaskDone() {
        assertThat(OperationLeaseRules.paymentTaskDone("RESOLVED", "CAPTURE_ORDER", "SUCCEEDED", "KNOWN"))
                .isTrue();
        assertThat(OperationLeaseRules.paymentTaskDone("UNKNOWN", "CAPTURE_ORDER", "PROCESSING", "UNKNOWN"))
                .isFalse();
        assertThat(OperationLeaseRules.paymentTaskDone("RESOLVED", "CAPTURE_ORDER", "PROCESSING", "KNOWN"))
                .isFalse();
        assertThat(OperationLeaseRules.paymentTaskDone("RESOLVED", "CREATE_CHECKOUT", "SUCCEEDED", "KNOWN"))
                .isFalse();
    }

    @Test
    void captureIdentityAndRedaction() {
        assertThat(PaymentEvidenceRules.captureFactKey(capture("succeeded", true)))
                .isEqualTo("CAPTURE:" + CAPTURE);
        var session = new CheckoutSessionFact(
                ORDER,
                COMPLETE,
                "https://www.sandbox.paypal.com/x",
                null,
                "COMPLETED",
                T0,
                Map.of("payment_id", P.toString()));
        assertThat(ProviderResultRules.redacted(
                                new OrderFact(session, 10000, "USD", List.of(capture("succeeded", true)), List.of()))
                        .toString())
                .doesNotContain("sandbox.paypal.com/x");
    }

    private static PaymentSnapshot payment(
            PaymentStatus status, String provider, ResolutionStatus resolution, FinancialStatus financial) {
        return new PaymentSnapshot(
                P,
                new UUID(0, 1),
                new UUID(0, 2),
                new UUID(0, 3),
                new UUID(0, 4),
                "USD",
                10000,
                5,
                status,
                provider,
                resolution,
                financial,
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

    private static PaymentProgress progress(
            PaymentStatus status,
            String provider,
            ResolutionStatus resolution,
            long amount,
            String session,
            String intent) {
        return new PaymentProgress(5, status, provider, resolution, session, intent, amount, null);
    }

    private static PaymentEvidenceRules.StateDecision decide(
            PaymentSnapshot payment,
            PaymentFacts facts,
            boolean query,
            boolean stale,
            boolean conflict,
            long captured,
            Long posted) {
        return PaymentEvidenceRules.decide(payment, facts, query, stale, conflict, captured, posted);
    }

    private static PaymentEvidenceRules.StateDecision completed(Long posted, boolean query) {
        return decide(
                payment(PROCESSING, "APPROVED", KNOWN, NOT_APPLICABLE),
                facts(order(COMPLETE, "COMPLETED"), List.of(capture("succeeded", true)), true),
                query,
                false,
                false,
                10000,
                posted);
    }

    private static void state(
            PaymentEvidenceRules.StateDecision d,
            PaymentStatus s,
            String provider,
            ResolutionStatus r,
            FinancialStatus f) {
        assertThat(d.status()).isEqualTo(s);
        assertThat(d.providerStatus()).isEqualTo(provider);
        assertThat(d.resolution()).isEqualTo(r);
        assertThat(d.financial()).isEqualTo(f);
    }
}
