package com.paymentsledger.provider.adapter.paypal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.payment.domain.PaymentIntentRules;
import com.paymentsledger.provider.ProviderCallClassification;
import com.paymentsledger.provider.ProviderModels.*;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

final class PayPalOrderMapping {
    static final String API_VERSION = "paypal-orders-v2";
    static final String SANDBOX_CHECKOUT_PREFIX = "https://www.sandbox.paypal.com/";
    static final Set<String> ORDER_STATUSES =
            Set.of("CREATED", "SAVED", "APPROVED", "VOIDED", "COMPLETED", "PAYER_ACTION_REQUIRED");
    private static final ObjectMapper JSON = new ObjectMapper();

    /** Exact decimal string for PayPal; 0 or 2 fraction digits, without floating point. */
    static String value(long amountMinor, String currency) {
        int digits = Currency.getInstance(currency).getDefaultFractionDigits();
        if (digits != 0 && digits != 2) throw new IllegalArgumentException("Unsupported PayPal currency precision");
        return BigDecimal.valueOf(amountMinor, digits).toPlainString();
    }

    static String createBody(CreateCheckoutSessionCommand command, String paymentId) {
        var body = JSON.createObjectNode();
        body.put("intent", "CAPTURE");
        var unit = body.putArray("purchase_units").addObject();
        unit.put("reference_id", paymentId);
        unit.put("custom_id", paymentId);
        unit.putObject("amount")
                .put("currency_code", command.currency())
                .put("value", value(command.amountMinor(), command.currency()));
        body.putObject("payment_source")
                .putObject("paypal")
                .putObject("experience_context")
                .put("return_url", command.successUrl())
                .put("cancel_url", command.cancelUrl())
                .put("user_action", "PAY_NOW")
                .put("shipping_preference", "NO_SHIPPING");
        return body.toString();
    }

    static Optional<CheckoutSessionFact> fact(JsonNode order, Instant expiresAt) {
        if (order == null || !order.isObject()) return Optional.empty();
        String id = order.path("id").textValue();
        String status = order.path("status").textValue();
        String customId = order.path("purchase_units").path(0).path("custom_id").textValue();
        if (id == null
                || id.isBlank()
                || status == null
                || !ORDER_STATUSES.contains(status)
                || status.equals("SAVED")
                || customId == null
                || customId.isBlank()) return Optional.empty();
        CheckoutSessionStatus sessionStatus = switch (status) {
            case "CREATED", "PAYER_ACTION_REQUIRED" -> CheckoutSessionStatus.OPEN;
            case "APPROVED", "COMPLETED" -> CheckoutSessionStatus.COMPLETE;
            default -> CheckoutSessionStatus.EXPIRED;
        };
        String hostedUrl = link(order, "payer-action");
        if (hostedUrl == null) hostedUrl = link(order, "approve");
        if (hostedUrl != null && !hostedUrl.startsWith(SANDBOX_CHECKOUT_PREFIX)) return Optional.empty();
        if (sessionStatus == CheckoutSessionStatus.OPEN && hostedUrl == null) return Optional.empty();
        return Optional.of(new CheckoutSessionFact(
                id, sessionStatus, hostedUrl, null, status, expiresAt, Map.of("payment_id", customId)));
    }

    private static String link(JsonNode order, String rel) {
        for (JsonNode link : order.path("links")) {
            if (rel.equals(link.path("rel").textValue()))
                return link.path("href").textValue();
        }
        return null;
    }

    static Optional<Instant> queryExpiry(JsonNode order) {
        if (order == null) return Optional.empty();
        String created = order.path("create_time").textValue();
        if (created == null) return Optional.empty();
        try {
            return Optional.of(Instant.parse(created)
                    .plusSeconds(PaymentIntentRules.CHECKOUT_LIFETIME_SECONDS)
                    .truncatedTo(ChronoUnit.SECONDS));
        } catch (DateTimeException | ArithmeticException invalid) {
            return Optional.empty();
        }
    }

    static ProviderCallClassification classify(int status) {
        return switch (status) {
            case 200, 201 -> ProviderCallClassification.SUCCESS;
            case 400, 422 -> ProviderCallClassification.DEFINITIVE_REJECT;
            case 401, 409 -> ProviderCallClassification.RETRYABLE_TRANSIENT;
            case 403 -> ProviderCallClassification.CAPABILITY_UNAVAILABLE;
            case 404 -> ProviderCallClassification.NOT_FOUND;
            case 429 -> ProviderCallClassification.RATE_LIMITED;
            default ->
                status >= 500 && status <= 599
                        ? ProviderCallClassification.RETRYABLE_TRANSIENT
                        : ProviderCallClassification.CONTRACT_MISMATCH;
        };
    }

    static String errorCode(String body) {
        try {
            var error = JSON.readTree(body);
            if (error == null || !error.isObject()) return null;
            String code = null;
            for (var detail : error.path("details")) {
                code = detail.path("issue").textValue();
                if (code != null) break;
            }
            if (code == null) code = error.path("name").textValue();
            return code != null && code.matches("[A-Z0-9_]{1,64}") ? code : null;
        } catch (IOException invalid) {
            return null;
        }
    }

    static String digest(String text) {
        try {
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("SHA-256 is unavailable");
        }
    }
}
