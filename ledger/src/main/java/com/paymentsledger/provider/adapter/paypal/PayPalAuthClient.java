package com.paymentsledger.provider.adapter.paypal;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import org.springframework.transaction.support.TransactionSynchronizationManager;

public final class PayPalAuthClient {
    public static final String SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";
    static final Duration MAX_REFRESH_MARGIN = Duration.ofMinutes(5);
    static final String TOKEN_REJECTED = "TOKEN_REJECTED";
    static final String TOKEN_UNAVAILABLE = "TOKEN_UNAVAILABLE";
    static final String TOKEN_CONTRACT_MISMATCH = "TOKEN_CONTRACT_MISMATCH";
    static final String NO_RESPONSE = "NO_RESPONSE";
    static final String INTERRUPTED = "INTERRUPTED";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final URI base;
    private final String basicAuth;
    private final Clock clock;
    private final PayPalTransport transport;
    private CachedToken token;

    private record CachedToken(String value, Instant refreshAt) {}

    public PayPalAuthClient(String baseUrl, String clientId, String clientSecret, Clock clock) {
        this(baseUrl, clientId, clientSecret, clock, new JdkPayPalTransport());
    }

    // Only tests inject a transport; production always uses JdkPayPalTransport.
    PayPalAuthClient(String baseUrl, String clientId, String clientSecret, Clock clock, PayPalTransport transport) {
        base = URI.create(sandboxBaseUrl(baseUrl));
        if (clientId == null || clientId.isBlank() || clientSecret == null || clientSecret.isBlank())
            throw new IllegalArgumentException("PayPal sandbox client id and secret are required");
        basicAuth = "Basic "
                + Base64.getEncoder().encodeToString((clientId + ":" + clientSecret).getBytes(StandardCharsets.UTF_8));
        this.clock = Objects.requireNonNull(clock);
        this.transport = Objects.requireNonNull(transport);
    }

    static String sandboxBaseUrl(String configured) {
        if (configured == null || configured.isBlank()) return SANDBOX_BASE_URL;
        String normalized = configured.endsWith("/") ? configured.substring(0, configured.length() - 1) : configured;
        if (!SANDBOX_BASE_URL.equals(normalized))
            throw new IllegalArgumentException("PayPal base URL must be the sandbox " + SANDBOX_BASE_URL);
        return normalized;
    }

    public PayPalExchange exchange(PayPalHttpRequest request) {
        if (TransactionSynchronizationManager.isActualTransactionActive()
                || TransactionSynchronizationManager.isSynchronizationActive())
            throw new IllegalStateException("PayPal calls must execute outside local transactions and business locks");
        validate(request);
        CachedToken used;
        try {
            used = token();
        } catch (TokenFailure failure) {
            return new PayPalExchange.NotSent(failure.reason);
        }
        try {
            var response = send(request, used.value());
            if (response.status() != 401) return responded(response, false);
            invalidate(used.value());
            CachedToken refreshed;
            try {
                refreshed = token();
            } catch (TokenFailure failure) {
                return responded(response, false);
            }
            return responded(send(request, refreshed.value()), true);
        } catch (IOException unavailable) {
            return new PayPalExchange.NoResponse(NO_RESPONSE);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return new PayPalExchange.NoResponse(INTERRUPTED);
        }
    }

    private void validate(PayPalHttpRequest request) {
        if (request == null
                || !("GET".equals(request.method())
                        || "POST".equals(request.method())
                        || "PATCH".equals(request.method())))
            throw new IllegalArgumentException("Invalid PayPal request method");
        String path = request.path();
        if (path == null
                || !path.startsWith("/")
                || path.startsWith("//")
                || path.contains("://")
                || path.contains("@")
                || path.contains("\\")
                || path.codePoints()
                        .anyMatch(c ->
                                Character.isWhitespace(c) || Character.isSpaceChar(c) || Character.isISOControl(c)))
            throw new IllegalArgumentException("Invalid PayPal request path");
        if (request.headers().keySet().stream().anyMatch("Authorization"::equalsIgnoreCase))
            throw new IllegalArgumentException("PayPal request Authorization is managed by the client");
        try {
            URI.create(base + path);
        } catch (IllegalArgumentException invalid) {
            throw new IllegalArgumentException("Invalid PayPal request path");
        }
    }

    private PayPalHttpResponse send(PayPalHttpRequest request, String bearer) throws IOException, InterruptedException {
        var headers = new LinkedHashMap<>(request.headers());
        headers.put("Authorization", "Bearer " + bearer);
        headers.keySet().removeIf("Accept"::equalsIgnoreCase);
        headers.put("Accept", "application/json");
        if (request.body() != null && headers.keySet().stream().noneMatch("Content-Type"::equalsIgnoreCase))
            headers.put("Content-Type", "application/json");
        return transport.send(request.method(), URI.create(base + request.path()), headers, request.body());
    }

    private static PayPalExchange.Responded responded(PayPalHttpResponse response, boolean authRetried) {
        return new PayPalExchange.Responded(
                response.status(), response.body(), response.header("PayPal-Debug-Id"), authRetried);
    }

    private synchronized void invalidate(String value) {
        if (token != null && token.value().equals(value)) token = null;
    }

    private synchronized CachedToken token() {
        if (token != null && clock.instant().isBefore(token.refreshAt())) return token;
        token = null;
        Instant sentAt = clock.instant();
        PayPalHttpResponse response;
        try {
            response = transport.send(
                    "POST",
                    URI.create(base + "/v1/oauth2/token"),
                    Map.of(
                            "Authorization", basicAuth,
                            "Content-Type", "application/x-www-form-urlencoded",
                            "Accept", "application/json"),
                    "grant_type=client_credentials");
        } catch (IOException unavailable) {
            throw new TokenFailure(TOKEN_UNAVAILABLE);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new TokenFailure(TOKEN_UNAVAILABLE);
        }
        if (response.status() == 400 || response.status() == 401) throw new TokenFailure(TOKEN_REJECTED);
        if (response.status() != 200) throw new TokenFailure(TOKEN_UNAVAILABLE);
        try {
            var json = JSON.readTree(response.body());
            if (json == null || !json.isObject()) throw new TokenFailure(TOKEN_CONTRACT_MISMATCH);
            var accessToken = json.path("access_token");
            var type = json.path("token_type");
            var expires = json.path("expires_in");
            if (!accessToken.isTextual()
                    || accessToken.textValue().isBlank()
                    || !type.isTextual()
                    || !"Bearer".equalsIgnoreCase(type.textValue())
                    || !expires.isIntegralNumber()
                    || !expires.canConvertToLong()
                    || expires.longValue() < 1) throw new TokenFailure(TOKEN_CONTRACT_MISMATCH);
            Duration lifetime = Duration.ofSeconds(expires.longValue());
            Duration half = lifetime.dividedBy(2);
            Duration margin = half.compareTo(MAX_REFRESH_MARGIN) < 0 ? half : MAX_REFRESH_MARGIN;
            token = new CachedToken(accessToken.textValue(), sentAt.plus(lifetime.minus(margin)));
            return token;
        } catch (IOException | DateTimeException | ArithmeticException mismatch) {
            throw new TokenFailure(TOKEN_CONTRACT_MISMATCH);
        }
    }

    @Override
    public String toString() {
        return "PayPalAuthClient[" + SANDBOX_BASE_URL + "]";
    }

    private static final class TokenFailure extends RuntimeException {
        private final String reason;

        private TokenFailure(String reason) {
            super(null, null, false, false);
            this.reason = reason;
        }
    }
}
