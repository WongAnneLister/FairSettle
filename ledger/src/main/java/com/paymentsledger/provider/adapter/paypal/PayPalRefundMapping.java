package com.paymentsledger.provider.adapter.paypal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.provider.ProviderCallClassification;
import com.paymentsledger.provider.ProviderModels.*;
import java.net.URI;
import java.time.DateTimeException;
import java.time.Instant;
import java.util.*;

final class PayPalRefundMapping {
    static final String API_VERSION = "paypal-payments-v2";
    static final Set<String> REFUND_STATUSES = Set.of("COMPLETED", "PENDING", "FAILED", "CANCELLED");
    private static final ObjectMapper JSON = new ObjectMapper();

    private PayPalRefundMapping() {}

    /** The request body of the refund table; Jackson, field order as shown. */
    static String createBody(CreateRefundCommand command) {
        var body = JSON.createObjectNode();
        body.putObject("amount")
                .put("currency_code", command.currency())
                .put("value", PayPalOrderMapping.value(command.amountMinor(), command.currency()));
        body.put("custom_id", command.localRefundId().toString());
        return body.toString();
    }

    /** A valid refund body; expectedChargeId null means the up link is required. */
    static Optional<RefundFact> refund(JsonNode body, String expectedChargeId) {
        if (body == null) return Optional.empty();
        String id = body.path("id").textValue(), status = body.path("status").textValue();
        String currency = body.path("amount").path("currency_code").textValue();
        var amount = PayPalOrderMapping.minor(body.path("amount").path("value").textValue(), currency);
        if (id == null
                || !id.matches("[A-Z0-9]{1,36}")
                || status == null
                || !REFUND_STATUSES.contains(status)
                || amount.isEmpty()
                || amount.get() <= 0) return Optional.empty();
        String charge = expectedChargeId;
        for (var link : body.path("links")) {
            if (!"up".equals(link.path("rel").textValue())) continue;
            String href = link.path("href").textValue();
            if (href == null) return Optional.empty();
            String path;
            try {
                path = URI.create(href).getPath();
            } catch (IllegalArgumentException invalid) {
                return Optional.empty();
            }
            if (path == null || !path.matches("/v2/payments/captures/[A-Z0-9]{1,36}")) return Optional.empty();
            String linked = path.substring(path.lastIndexOf('/') + 1);
            if (charge != null && !charge.equals(linked)) return Optional.empty();
            charge = linked;
        }
        if (charge == null) return Optional.empty();
        Instant created = null;
        try {
            String value = body.path("create_time").textValue();
            if (value != null) created = Instant.parse(value);
        } catch (DateTimeException invalid) {
            /* Optional unless a settlement is present. */
        }
        String reason = body.path("status_details").path("reason").textValue();
        if (reason != null && !reason.matches("[A-Z0-9_]{1,64}")) reason = null;
        BalanceTransactionFact settlement = null;
        if (status.equals("COMPLETED") && body.has("seller_payable_breakdown")) {
            var breakdown = body.path("seller_payable_breakdown");
            var gross = money(breakdown.path("gross_amount"), currency);
            var fee = breakdown.has("paypal_fee") ? money(breakdown.path("paypal_fee"), currency) : Optional.of(0L);
            var net = money(breakdown.path("net_amount"), currency);
            if (created == null
                    || gross.isEmpty()
                    || fee.isEmpty()
                    || net.isEmpty()
                    || !gross.get().equals(amount.get())
                    || gross.get() - fee.get() != net.get()) return Optional.empty();
            settlement = new BalanceTransactionFact(
                    id,
                    "refund",
                    -gross.get(),
                    -fee.get(),
                    -net.get(),
                    currency,
                    "PAYMENTS",
                    id,
                    "refund",
                    "available",
                    created,
                    null,
                    fee.get() > 0 ? List.of(new FeeDetail(-fee.get(), currency, "paypal_fee", null)) : List.of(),
                    PayPalOrderMapping.digest(
                            "paypal-refund|" + id + "|" + gross.get() + "|" + fee.get() + "|" + net.get()));
        }
        return Optional.of(new RefundFact(
                id,
                charge,
                status,
                amount.get(),
                currency,
                settlement == null ? null : id,
                reason,
                null,
                created,
                settlement));
    }

    private static Optional<Long> money(JsonNode value, String currency) {
        return currency.equals(value.path("currency_code").textValue())
                ? PayPalOrderMapping.minor(value.path("value").textValue(), currency)
                : Optional.empty();
    }

    /** The create checks on top of refund(): amount, currency, custom_id. */
    static boolean matches(RefundFact fact, JsonNode body, CreateRefundCommand command) {
        return fact.amountMinor() == command.amountMinor()
                && fact.currency().equals(command.currency())
                && (!body.has("custom_id")
                        || command.localRefundId()
                                .toString()
                                .equals(body.path("custom_id").textValue()));
    }

    /** Order refunds; empty Optional means CONTRACT_MISMATCH. */
    static Optional<List<OrderRefundFact>> orderRefunds(JsonNode order) {
        if (order == null) return Optional.empty();
        var units = order.path("purchase_units");
        if (!units.isArray() || units.size() != 1) return Optional.empty();
        var payments = units.path(0).path("payments");
        var refunds = payments.path("refunds");
        if (refunds.isMissingNode()) return Optional.of(List.of());
        if (!refunds.isArray()) return Optional.empty();
        if (refunds.isEmpty()) return Optional.of(List.of());
        var captures = payments.path("captures");
        if (!captures.isArray() || captures.size() != 1) return Optional.empty();
        String capture = captures.path(0).path("id").textValue();
        if (capture == null || !capture.matches("[A-Z0-9]{1,36}")) return Optional.empty();
        var result = new ArrayList<OrderRefundFact>();
        for (var raw : refunds) {
            var fact = refund(raw, capture);
            if (fact.isEmpty()) return Optional.empty();
            result.add(new OrderRefundFact(raw.path("custom_id").textValue(), fact.get()));
        }
        return Optional.of(List.copyOf(result));
    }

    /** The refund classification table. */
    static ProviderCallClassification classify(int status, String errorCode) {
        if (status == 422)
            return "REFUND_AMOUNT_EXCEEDED".equals(errorCode) || "CAPTURE_FULLY_REFUNDED".equals(errorCode)
                    ? ProviderCallClassification.DEFINITIVE_REJECT
                    : ProviderCallClassification.CONTRACT_MISMATCH;
        if (status == 400) return ProviderCallClassification.CONTRACT_MISMATCH;
        return PayPalOrderMapping.classify(status);
    }
}
