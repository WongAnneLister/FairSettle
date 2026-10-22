package com.paymentsledger.provider.adapter.paypal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.*;
import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.util.*;

public final class PayPalCheckoutAdapter implements CheckoutPort {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final PayPalAuthClient client;
    private final ProviderScope scope;
    private final Clock clock;

    public PayPalCheckoutAdapter(PayPalAuthClient client, ProviderScope scope, Clock clock) {
        this.client = Objects.requireNonNull(client);
        this.scope = Objects.requireNonNull(scope);
        this.clock = Objects.requireNonNull(clock);
        if (scope.livemode()) throw new IllegalArgumentException("Live scope is unsupported");
    }

    @Override
    public ProviderCallResult<CheckoutSessionFact> createSession(CreateCheckoutSessionCommand command) {
        requireScope(command.scope());
        String paymentId = command.sessionMetadata().get("payment_id");
        try {
            if (paymentId == null || !UUID.fromString(paymentId).toString().equalsIgnoreCase(paymentId))
                throw new IllegalArgumentException();
        } catch (IllegalArgumentException invalid) {
            throw new IllegalArgumentException("payment_id metadata is required");
        }
        String body = PayPalOrderMapping.createBody(command, paymentId);
        String key = command.operationIdempotencyKey();
        return call(
                PayPalHttpRequest.post(
                        "/v2/checkout/orders",
                        Map.of("PayPal-Request-Id", key, "Prefer", "return=representation"),
                        body),
                key,
                command.expiresAt());
    }

    @Override
    public ProviderCallResult<CheckoutSessionFact> querySession(ProviderScope requested, String sessionId) {
        requireScope(requested);
        if (sessionId == null || !sessionId.matches("[A-Z0-9]{1,36}"))
            throw new IllegalArgumentException("Invalid PayPal order id");
        return call(PayPalHttpRequest.get("/v2/checkout/orders/" + sessionId, Map.of()), null, null);
    }

    @Override
    public ProviderCallResult<CheckoutSessionFact> expireSession(ProviderScope requested, String sessionId) {
        requireScope(requested);
        return result(
                ProviderCallClassification.CAPABILITY_UNAVAILABLE,
                null,
                null,
                null,
                clock.instant(),
                null,
                null,
                "paypal_order_void_unsupported");
    }

    private void requireScope(ProviderScope requested) {
        if (!scope.equals(requested))
            throw new IllegalArgumentException("Provider scope differs from credential binding");
    }

    private ProviderCallResult<CheckoutSessionFact> call(PayPalHttpRequest request, String key, Instant expiresAt) {
        Instant requestedAt = clock.instant();
        var exchange = client.exchange(request);
        if (exchange instanceof PayPalExchange.NotSent failure)
            return result(
                    ProviderCallClassification.RETRYABLE_TRANSIENT,
                    null,
                    null,
                    null,
                    requestedAt,
                    null,
                    null,
                    failure.reason());
        if (exchange instanceof PayPalExchange.NoResponse failure)
            return result(
                    ProviderCallClassification.TIMEOUT_UNKNOWN,
                    null,
                    null,
                    key,
                    requestedAt,
                    null,
                    null,
                    failure.reason());
        var response = (PayPalExchange.Responded) exchange;
        Instant respondedAt = clock.instant();
        var classification = PayPalOrderMapping.classify(response.status());
        CheckoutSessionFact fact = null;
        String errorCode = null;
        if (classification == ProviderCallClassification.SUCCESS) {
            try {
                var order = JSON.readTree(response.body());
                Instant expiry = expiresAt == null
                        ? PayPalOrderMapping.queryExpiry(order).orElse(null)
                        : expiresAt;
                if (expiry != null)
                    fact = PayPalOrderMapping.fact(order, expiry).orElse(null);
            } catch (IOException invalid) {
                // Return only the fixed contract code, never the raw response or parser message.
            }
            if (fact == null) {
                classification = ProviderCallClassification.CONTRACT_MISMATCH;
                errorCode = "paypal_contract_mismatch";
            }
        } else errorCode = PayPalOrderMapping.errorCode(response.body());
        return result(
                classification, fact, response.debugId(), key, requestedAt, respondedAt, response.status(), errorCode);
    }

    private static ProviderCallResult<CheckoutSessionFact> result(
            ProviderCallClassification classification,
            CheckoutSessionFact fact,
            String debugId,
            String key,
            Instant requestedAt,
            Instant respondedAt,
            Integer status,
            String errorCode) {
        String digest = PayPalOrderMapping.digest(
                fact == null
                        ? "paypal-error|" + status + "|" + errorCode
                        : "paypal-order|" + fact.sessionId() + "|" + fact.paymentStatus());
        return new ProviderCallResult<>(
                classification,
                fact,
                new ProviderEvidence(
                        debugId,
                        key,
                        requestedAt,
                        respondedAt,
                        status,
                        errorCode,
                        digest,
                        PayPalOrderMapping.API_VERSION));
    }
}
