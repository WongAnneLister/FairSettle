package com.paymentsledger.webhook;

import com.fasterxml.jackson.databind.JsonNode;
import com.paymentsledger.financialingestion.CaptureSettlementService;
import com.paymentsledger.payment.PaymentRepository;
import com.paymentsledger.payment.RefundRepository;
import com.paymentsledger.payment.domain.PaymentFacts;
import com.paymentsledger.provider.ProviderEvidence;
import com.paymentsledger.provider.ProviderScope;
import com.paymentsledger.provider.adapter.paypal.PayPalWebhookFacts;
import com.paymentsledger.webhook.repository.PayPalWebhookPaymentRepository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Applies verified PayPal capture-completed and refund-completed snapshots; posts after the state commit; no provider I/O. */
@Component
public final class PayPalWebhookHandler {
    public enum Route {
        CAPTURE,
        REFUND,
        UNSUPPORTED
    }

    private final WebhookInboxRepository inbox;
    private final PaymentRepository payments;
    private final RefundRepository refunds;
    private final PayPalWebhookPaymentRepository paymentRefs;
    private final CaptureSettlementService settlements;

    @Autowired
    public PayPalWebhookHandler(
            WebhookInboxRepository inbox,
            PaymentRepository payments,
            RefundRepository refunds,
            PayPalWebhookPaymentRepository paymentRefs,
            ObjectProvider<CaptureSettlementService> settlements) {
        this(inbox, payments, refunds, paymentRefs, settlements.getIfAvailable());
    }

    /** For tests and wiring without Spring; settlements may be null. */
    public PayPalWebhookHandler(
            WebhookInboxRepository inbox,
            PaymentRepository payments,
            RefundRepository refunds,
            PayPalWebhookPaymentRepository paymentRefs,
            CaptureSettlementService settlements) {
        this.inbox = inbox;
        this.payments = payments;
        this.refunds = refunds;
        this.paymentRefs = paymentRefs;
        this.settlements = settlements;
    }

    public static Route route(String object, String eventType) {
        if ("paypal.capture".equals(object) && "PAYMENT.CAPTURE.COMPLETED".equals(eventType)) return Route.CAPTURE;
        if ("paypal.refund".equals(object) && "PAYMENT.CAPTURE.REFUNDED".equals(eventType)) return Route.REFUND;
        return Route.UNSUPPORTED;
    }

    /** Called by WebhookProcessor for every paypal.* snapshot, outside transactions. */
    public void process(WebhookInboxRepository.Claim claim, JsonNode object) {
        switch (route(text(object, "object"), (String) claim.row().get("event_type"))) {
            case UNSUPPORTED -> waitOwned(claim, "FUTURE_RESOURCE", text(object, "id"), "FUTURE_RESOURCE_HANDLER");
            case CAPTURE -> capture(claim, object);
            case REFUND -> refund(claim, object);
        }
    }

    private void capture(WebhookInboxRepository.Claim claim, JsonNode object) {
        var mapped = PayPalWebhookFacts.capture(object);
        if (mapped.isEmpty()) {
            waitOwned(claim, "EVIDENCE", text(object, "id"), "INCOMPLETE_CAPTURE");
            return;
        }
        var capture = mapped.get();
        var scope = scope(claim.row());
        var ids = paymentRefs.paymentsForOrder(scope, capture.orderId());
        if (ids.isEmpty()) {
            waitOwned(claim, "PAYMENT", capture.orderId(), "MISSING_PAYMENT_DEPENDENCY");
            return;
        }
        if (ids.size() > 1) {
            waitOwned(claim, "EVIDENCE", capture.charge().chargeId(), "AMBIGUOUS_RELATIONSHIP");
            return;
        }
        UUID payment = ids.getFirst();
        Instant eventTime = capture.updatedAt() == null ? eventTime(claim.row()) : capture.updatedAt();
        Boolean post = inbox.transaction(() -> {
            var p = payments.lockWebhookPayment(payment);
            if (!inbox.owns(claim)) return null;
            String error = null;
            if (!capture.paymentId().equals(payment)) error = "RELATIONSHIP_CONFLICT";
            else if (capture.charge().amountMinor() != ((Number) p.get("amount_minor")).longValue()
                    || !capture.charge()
                            .currency()
                            .equalsIgnoreCase(p.get("currency").toString())) error = "AMOUNT_CURRENCY_CONFLICT";
            if (error != null) {
                payments.mergeWebhook(payment, new PaymentFacts(null, null, List.of(), false, true, eventTime));
                inbox.waitFor(claim, "EVIDENCE", capture.charge().chargeId(), error);
                return null;
            }
            boolean applicable = payments.mergeWebhook(
                    payment, new PaymentFacts(null, null, List.of(capture.charge()), true, false, eventTime));
            return applicable && capture.settlement() != null;
        });
        if (post == null) return;
        if (post && settlements != null) settlements.record(scope, capture.settlement(), evidence(claim.row()));
        doneOwned(claim);
    }

    private void refund(WebhookInboxRepository.Claim claim, JsonNode object) {
        var mapped = PayPalWebhookFacts.refund(object);
        if (mapped.isEmpty()) {
            waitOwned(claim, "EVIDENCE", text(object, "id"), "INCOMPLETE_REFUND_FACT");
            return;
        }
        var refund = mapped.get();
        var fact = refund.fact();
        var scope = scope(claim.row());
        var existing = refunds.lookup(scope, fact.refundId());
        UUID local, payment;
        if (existing != null) {
            local = (UUID) existing.get("id");
            payment = (UUID) existing.get("payment_id");
        } else {
            UUID charged = refunds.paymentForCharge(scope, fact.chargeId());
            UUID custom = refund.customId() == null
                    ? null
                    : paymentRefs.refundPayment(scope, refund.customId()).orElse(null);
            if (custom != null && charged != null && !custom.equals(charged)) {
                waitOwned(claim, "EVIDENCE", fact.refundId(), "RELATIONSHIP_CONFLICT");
                return;
            }
            local = custom == null ? null : refund.customId();
            payment = charged == null ? custom : charged;
        }
        Boolean post = inbox.transaction(() -> {
            if (payment != null) payments.lockWebhookPayment(payment);
            if (!inbox.owns(claim)) return null;
            UUID accepted = refunds.accept(scope, fact, evidence(claim.row()), local);
            if (accepted == null) {
                inbox.waitFor(claim, "CHARGE", fact.chargeId(), "MISSING_REFUND_PAYMENT_DEPENDENCY");
                return null;
            }
            if (fact.settlement() == null) return false;
            var row = refunds.lookup(scope, fact.refundId());
            return row != null
                    && accepted.equals(row.get("id"))
                    && "SUCCEEDED".equals(row.get("refund_status"))
                    && !"CONFLICT".equals(row.get("resolution_status"));
        });
        if (post == null) return;
        if (post && settlements != null) settlements.record(scope, fact.settlement(), evidence(claim.row()));
        doneOwned(claim);
    }

    private static ProviderScope scope(Map<String, Object> row) {
        return new ProviderScope(
                (UUID) row.get("organization_id"),
                (UUID) row.get("environment_id"),
                (UUID) row.get("provider_account_id"),
                false);
    }

    private static Instant eventTime(Map<String, Object> row) {
        return ((Timestamp) row.get("event_created_at")).toInstant();
    }

    private static ProviderEvidence evidence(Map<String, Object> row) {
        Instant t = eventTime(row);
        return new ProviderEvidence(
                null, null, t, t, 200, null, (String) row.get("raw_digest"), (String) row.get("api_version"));
    }

    private void waitOwned(WebhookInboxRepository.Claim claim, String type, String id, String reason) {
        inbox.transaction(() -> {
            if (inbox.owns(claim)) inbox.waitFor(claim, type, id, reason);
            return null;
        });
    }

    private void doneOwned(WebhookInboxRepository.Claim claim) {
        inbox.transaction(() -> {
            if (inbox.owns(claim)) inbox.done(claim);
            return null;
        });
    }

    private static String text(JsonNode object, String field) {
        return object.path(field).textValue();
    }
}
