package com.paymentsledger.provider.adapter.paypal;

import com.fasterxml.jackson.databind.JsonNode;
import com.paymentsledger.provider.ProviderModels.*;
import java.time.DateTimeException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Ledger facts from stored PayPal webhook snapshots; the same values and digests as the API mappings (ADR D4, D9). */
public final class PayPalWebhookFacts {
    /** @param updatedAt update_time, else create_time, else null */
    public record Capture(
            String orderId, UUID paymentId, ChargeFact charge, BalanceTransactionFact settlement, Instant updatedAt) {}

    /** @param customId the ledger refund id from custom_id, or null */
    public record Refund(UUID customId, RefundFact fact, Instant updatedAt) {}

    private PayPalWebhookFacts() {}

    public static Optional<Capture> capture(JsonNode snapshot) {
        if (!matches(snapshot, "paypal.capture", "PAYMENT.CAPTURE.COMPLETED")) return Optional.empty();
        String id = text(snapshot, "id"), orderId = text(snapshot, "order_id");
        UUID paymentId = uuid(text(snapshot, "custom_id"));
        String currency = text(snapshot.path("amount"), "currency_code");
        var amount = PayPalOrderMapping.minor(text(snapshot.path("amount"), "value"), currency);
        if (orderId == null || paymentId == null || amount.isEmpty() || amount.get() <= 0) return Optional.empty();
        Instant created = time(text(snapshot, "create_time"));
        var settlement = settlement(snapshot, id, "charge", amount.get(), currency, created);
        if (snapshot.has("breakdown") && settlement.isEmpty()) return Optional.empty();
        var charge = new ChargeFact(
                id,
                orderId,
                "succeeded",
                true,
                amount.get(),
                amount.get(),
                currency,
                settlement.isEmpty() ? null : id,
                null,
                "COMPLETED",
                created);
        return Optional.of(
                new Capture(orderId, paymentId, charge, settlement.orElse(null), updatedAt(snapshot, created)));
    }

    public static Optional<Refund> refund(JsonNode snapshot) {
        if (!matches(snapshot, "paypal.refund", "PAYMENT.CAPTURE.REFUNDED")) return Optional.empty();
        String id = text(snapshot, "id"), captureId = text(snapshot, "capture_id");
        String currency = text(snapshot.path("amount"), "currency_code");
        var amount = PayPalOrderMapping.minor(text(snapshot.path("amount"), "value"), currency);
        if (captureId == null || amount.isEmpty() || amount.get() <= 0) return Optional.empty();
        Instant created = time(text(snapshot, "create_time"));
        var settlement = settlement(snapshot, id, "refund", amount.get(), currency, created);
        if (snapshot.has("breakdown") && settlement.isEmpty()) return Optional.empty();
        var fact = new RefundFact(
                id,
                captureId,
                "COMPLETED",
                amount.get(),
                currency,
                settlement.isEmpty() ? null : id,
                null,
                null,
                created,
                settlement.orElse(null));
        return Optional.of(new Refund(uuid(text(snapshot, "custom_id")), fact, updatedAt(snapshot, created)));
    }

    private static boolean matches(JsonNode snapshot, String object, String eventType) {
        if (snapshot == null) return false;
        String id = text(snapshot, "id");
        return object.equals(text(snapshot, "object"))
                && eventType.equals(text(snapshot, "event_type"))
                && "COMPLETED".equals(text(snapshot, "status"))
                && id != null
                && id.matches("[A-Z0-9]{1,36}");
    }

    private static Optional<BalanceTransactionFact> settlement(
            JsonNode snapshot, String id, String kind, long amount, String currency, Instant created) {
        if (!snapshot.has("breakdown")) return Optional.empty();
        var breakdown = snapshot.path("breakdown");
        var gross = PayPalOrderMapping.minor(text(breakdown, "gross"), currency);
        var fee = breakdown.has("fee") ? PayPalOrderMapping.minor(text(breakdown, "fee"), currency) : Optional.of(0L);
        var net = PayPalOrderMapping.minor(text(breakdown, "net"), currency);
        if (created == null
                || gross.isEmpty()
                || fee.isEmpty()
                || net.isEmpty()
                || gross.get() != amount
                || gross.get() - fee.get() != net.get()) return Optional.empty();
        long sign = "refund".equals(kind) ? -1 : 1;
        return Optional.of(new BalanceTransactionFact(
                id,
                kind,
                sign * gross.get(),
                sign * fee.get(),
                sign * net.get(),
                currency,
                "PAYMENTS",
                id,
                kind,
                "available",
                created,
                null,
                fee.get() > 0 ? List.of(new FeeDetail(sign * fee.get(), currency, "paypal_fee", null)) : List.of(),
                PayPalOrderMapping.digest("paypal-" + ("refund".equals(kind) ? "refund" : "capture") + "|" + id + "|"
                        + gross.get() + "|" + fee.get() + "|" + net.get())));
    }

    private static Instant updatedAt(JsonNode snapshot, Instant created) {
        Instant updated = time(text(snapshot, "update_time"));
        return updated == null ? created : updated;
    }

    private static Instant time(String value) {
        try {
            return value == null ? null : Instant.parse(value);
        } catch (DateTimeException invalid) {
            return null;
        }
    }

    private static UUID uuid(String value) {
        try {
            return value == null ? null : UUID.fromString(value);
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    private static String text(JsonNode object, String field) {
        return object.path(field).textValue();
    }
}
