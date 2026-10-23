package com.paymentsledger.provider.adapter.paypal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.VerifiedWebhook;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.*;

/** Verifies PayPal webhooks through PayPal's verification API with the deployment's configured webhook id. */
public final class PayPalWebhookVerifier {
    public static final List<String> HEADERS = List.of(
            "PAYPAL-AUTH-ALGO",
            "PAYPAL-CERT-URL",
            "PAYPAL-TRANSMISSION-ID",
            "PAYPAL-TRANSMISSION-SIG",
            "PAYPAL-TRANSMISSION-TIME");
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String API_VERSION = "paypal-notifications-v1";
    private final PayPalAuthClient client;
    private final String webhookId;
    private final Clock clock;

    public PayPalWebhookVerifier(PayPalAuthClient client, String webhookId, Clock clock) {
        this.client = Objects.requireNonNull(client);
        this.webhookId = Objects.requireNonNull(webhookId);
        this.clock = Objects.requireNonNull(clock);
        if (!webhookId.matches("[A-Z0-9]{8,64}"))
            throw new IllegalArgumentException("Valid PayPal webhook id is required");
    }

    /** headers: exactly the five HEADERS keys, single values; raw: the request body bytes. */
    public ProviderCallResult<VerifiedWebhook> verify(byte[] raw, Map<String, String> headers) {
        Instant requested = clock.instant();
        VerifiedWebhook event;
        try {
            JsonNode root = JSON.readTree(raw);
            if (root == null || !root.isObject()) throw new IllegalArgumentException();
            String id = root.path("id").textValue(),
                    type = root.path("event_type").textValue();
            String objectId = root.path("resource").path("id").textValue();
            if (id == null
                    || !id.matches("[A-Za-z0-9-]{1,64}")
                    || type == null
                    || !type.matches("[A-Z0-9._-]{1,128}")
                    || objectId == null
                    || !objectId.matches("[A-Za-z0-9-]{1,64}")) throw new IllegalArgumentException();
            event = new VerifiedWebhook(
                    id, type, objectId, Instant.parse(root.path("create_time").textValue()), false);
        } catch (IOException | RuntimeException invalid) {
            return result(
                    ProviderCallClassification.CONTRACT_MISMATCH,
                    null,
                    null,
                    requested,
                    null,
                    null,
                    null,
                    "paypal_event_invalid",
                    null);
        }
        if (headers == null
                || headers.size() != HEADERS.size()
                || HEADERS.stream().anyMatch(name -> !validHeader(headers.get(name))))
            return result(
                    ProviderCallClassification.CONTRACT_MISMATCH,
                    null,
                    event.eventId(),
                    requested,
                    null,
                    null,
                    null,
                    "paypal_headers_invalid",
                    null);
        String cert = headers.get("PAYPAL-CERT-URL");
        if (!cert.startsWith("https://api.sandbox.paypal.com/")
                && !cert.startsWith("https://api-m.sandbox.paypal.com/"))
            return result(
                    ProviderCallClassification.CONTRACT_MISMATCH,
                    null,
                    event.eventId(),
                    requested,
                    null,
                    null,
                    null,
                    "paypal_cert_url_not_sandbox",
                    null);
        String body = "{\"auth_algo\":" + literal(headers.get("PAYPAL-AUTH-ALGO"))
                + ",\"cert_url\":" + literal(cert)
                + ",\"transmission_id\":" + literal(headers.get("PAYPAL-TRANSMISSION-ID"))
                + ",\"transmission_sig\":" + literal(headers.get("PAYPAL-TRANSMISSION-SIG"))
                + ",\"transmission_time\":" + literal(headers.get("PAYPAL-TRANSMISSION-TIME"))
                + ",\"webhook_id\":" + literal(webhookId)
                + ",\"webhook_event\":" + new String(raw, StandardCharsets.UTF_8) + "}";
        var exchange =
                client.exchange(PayPalHttpRequest.post("/v1/notifications/verify-webhook-signature", Map.of(), body));
        if (exchange instanceof PayPalExchange.NotSent failure)
            return result(
                    ProviderCallClassification.RETRYABLE_TRANSIENT,
                    null,
                    event.eventId(),
                    requested,
                    null,
                    null,
                    null,
                    failure.reason(),
                    null);
        if (exchange instanceof PayPalExchange.NoResponse failure)
            return result(
                    ProviderCallClassification.TIMEOUT_UNKNOWN,
                    null,
                    event.eventId(),
                    requested,
                    null,
                    null,
                    null,
                    failure.reason(),
                    null);
        var response = (PayPalExchange.Responded) exchange;
        Instant responded = clock.instant();
        String error = PayPalOrderMapping.errorCode(response.body()), verification = null;
        var classification = PayPalOrderMapping.classify(response.status());
        VerifiedWebhook payload = null;
        if (response.status() == 200) {
            try {
                verification = JSON.readTree(response.body())
                        .path("verification_status")
                        .textValue();
            } catch (IOException | RuntimeException invalid) {
                /* Only fixed errors leave the adapter. */
            }
            if ("SUCCESS".equals(verification)) {
                classification = ProviderCallClassification.SUCCESS;
                payload = event;
                error = null;
            } else if ("FAILURE".equals(verification)) {
                classification = ProviderCallClassification.DEFINITIVE_REJECT;
                error = "paypal_signature_invalid";
            } else {
                classification = ProviderCallClassification.CONTRACT_MISMATCH;
                error = "paypal_contract_mismatch";
            }
        }
        return result(
                classification,
                payload,
                event.eventId(),
                requested,
                responded,
                response.debugId(),
                response.status(),
                error,
                verification);
    }

    private static boolean validHeader(String value) {
        return value != null
                && !value.isEmpty()
                && value.length() <= 2048
                && value.chars().allMatch(c -> c >= 33 && c <= 126);
    }

    private static String literal(String value) {
        try {
            return JSON.writeValueAsString(value);
        } catch (JsonProcessingException invalid) {
            throw new IllegalArgumentException("Invalid webhook verification field");
        }
    }

    private static ProviderCallResult<VerifiedWebhook> result(
            ProviderCallClassification classification,
            VerifiedWebhook payload,
            String eventId,
            Instant requested,
            Instant responded,
            String debugId,
            Integer status,
            String error,
            String verification) {
        return new ProviderCallResult<>(
                classification,
                payload,
                new ProviderEvidence(
                        debugId,
                        null,
                        requested,
                        responded,
                        status,
                        error,
                        PayPalOrderMapping.digest(
                                "paypal-webhook|" + eventId + "|" + (verification == null ? error : verification)),
                        API_VERSION));
    }
}
