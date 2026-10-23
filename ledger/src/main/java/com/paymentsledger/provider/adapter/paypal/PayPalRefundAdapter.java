package com.paymentsledger.provider.adapter.paypal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.*;
import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.function.BiFunction;
import java.util.function.Function;

public final class PayPalRefundAdapter implements RefundPort, RefundSearchPort {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final PayPalAuthClient client;
    private final ProviderScope scope;
    private final Clock clock;

    public PayPalRefundAdapter(PayPalAuthClient client, ProviderScope scope, Clock clock) {
        this.client = Objects.requireNonNull(client);
        this.scope = Objects.requireNonNull(scope);
        this.clock = Objects.requireNonNull(clock);
        if (scope.livemode()) throw new IllegalArgumentException("Live scope is unsupported");
    }

    @Override
    public ProviderCallResult<RefundFact> createRefund(CreateRefundCommand command) {
        requireScope(command.scope());
        requireId(command.chargeId());
        if (command.paymentIntentId() != null || command.currency() == null || command.localRefundId() == null)
            throw new IllegalArgumentException("PayPal refund currency, local id and capture target are required");
        String key = command.operationIdempotencyKey();
        return call(
                PayPalHttpRequest.post(
                        "/v2/payments/captures/" + command.chargeId() + "/refund",
                        Map.of("PayPal-Request-Id", key, "Prefer", "return=representation"),
                        PayPalRefundMapping.createBody(command)),
                key,
                body -> PayPalRefundMapping.refund(body, command.chargeId())
                        .filter(fact -> PayPalRefundMapping.matches(fact, body, command)),
                PayPalRefundMapping::classify);
    }

    @Override
    public ProviderCallResult<RefundFact> queryRefund(ProviderScope requested, String refundId) {
        requireScope(requested);
        requireId(refundId);
        return call(
                PayPalHttpRequest.get("/v2/payments/refunds/" + refundId, Map.of()),
                null,
                body -> PayPalRefundMapping.refund(body, null),
                (status, code) -> PayPalOrderMapping.classify(status));
    }

    @Override
    public ProviderCallResult<List<OrderRefundFact>> queryOrderRefunds(ProviderScope requested, String orderId) {
        requireScope(requested);
        requireId(orderId);
        return call(
                PayPalHttpRequest.get("/v2/checkout/orders/" + orderId, Map.of()),
                null,
                PayPalRefundMapping::orderRefunds,
                (status, code) -> PayPalOrderMapping.classify(status));
    }

    private void requireScope(ProviderScope requested) {
        if (!scope.equals(requested))
            throw new IllegalArgumentException("Provider scope differs from credential binding");
    }

    private static void requireId(String id) {
        if (id == null || !id.matches("[A-Z0-9]{1,36}")) throw new IllegalArgumentException("Invalid PayPal id");
    }

    private <T> ProviderCallResult<T> call(
            PayPalHttpRequest request,
            String key,
            Function<JsonNode, Optional<T>> mapping,
            BiFunction<Integer, String, ProviderCallClassification> classify) {
        Instant requested = clock.instant();
        var exchange = client.exchange(request);
        if (exchange instanceof PayPalExchange.NotSent failure)
            return result(
                    ProviderCallClassification.RETRYABLE_TRANSIENT,
                    null,
                    null,
                    null,
                    requested,
                    null,
                    null,
                    failure.reason());
        if (exchange instanceof PayPalExchange.NoResponse failure)
            return result(
                    ProviderCallClassification.TIMEOUT_UNKNOWN,
                    null,
                    null,
                    key,
                    requested,
                    null,
                    null,
                    failure.reason());
        var response = (PayPalExchange.Responded) exchange;
        Instant responded = clock.instant();
        String code = PayPalOrderMapping.errorCode(response.body());
        var classification = classify.apply(response.status(), code);
        T fact = null;
        if (classification == ProviderCallClassification.SUCCESS) {
            try {
                fact = mapping.apply(JSON.readTree(response.body())).orElse(null);
            } catch (IOException | IllegalArgumentException invalid) {
                /* Keep only a fixed contract code. */
            }
            if (fact == null) {
                classification = ProviderCallClassification.CONTRACT_MISMATCH;
                code = "paypal_contract_mismatch";
            } else code = null;
        }
        return result(classification, fact, response.debugId(), key, requested, responded, response.status(), code);
    }

    private static <T> ProviderCallResult<T> result(
            ProviderCallClassification classification,
            T fact,
            String debugId,
            String key,
            Instant requested,
            Instant responded,
            Integer status,
            String code) {
        String text = fact instanceof RefundFact refund
                ? "paypal-refund|" + refund.refundId() + "|" + refund.status()
                : "paypal-error|" + status + "|" + code;
        return new ProviderCallResult<>(
                classification,
                fact,
                new ProviderEvidence(
                        debugId,
                        key,
                        requested,
                        responded,
                        status,
                        code,
                        PayPalOrderMapping.digest(text),
                        PayPalRefundMapping.API_VERSION));
    }
}
