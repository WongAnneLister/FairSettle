package com.paymentsledger.provider.adapter.paypal;

import static org.assertj.core.api.Assertions.*;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class PayPalAuthClientTest {
    static final String ID = "client-fixture";
    static final String SECRET = "secret-fixture-do-not-log";
    static final String ORDER = "/v2/checkout/orders/7CV2269518094610C";
    static final String BASE = "https://api-m.sandbox.paypal.com";

    @Test
    void fetchesClientCredentialsTokenThenCallsWithBearer() {
        var t = new Transport().token("tok-1", 32400).reply(200, "{\"id\":\"7CV2269518094610C\"}");
        var result = client(t, new MutableClock()).exchange(PayPalHttpRequest.get(ORDER, Map.of()));

        assertThat(t.calls).hasSize(2);
        var auth = t.calls.getFirst();
        assertThat(auth.method()).isEqualTo("POST");
        assertThat(auth.uri()).isEqualTo(URI.create(BASE + "/v1/oauth2/token"));
        assertThat(auth.headers())
                .containsEntry("Authorization", basicAuth())
                .containsEntry("Content-Type", "application/x-www-form-urlencoded")
                .containsEntry("Accept", "application/json");
        assertThat(auth.body()).isEqualTo("grant_type=client_credentials");
        var target = t.calls.get(1);
        assertThat(target.method()).isEqualTo("GET");
        assertThat(target.uri()).isEqualTo(URI.create(BASE + ORDER));
        assertThat(target.headers())
                .containsEntry("Authorization", "Bearer tok-1")
                .containsEntry("Accept", "application/json");
        assertThat(target.body()).isNull();
        assertThat(result)
                .isEqualTo(new PayPalExchange.Responded(200, "{\"id\":\"7CV2269518094610C\"}", "dbg-1", false));
    }

    @Test
    void reusesCachedToken() {
        var t = new Transport().token("tok-1", 32400).reply(200, "{}").reply(200, "{}");
        var client = client(t, new MutableClock());
        assertThat(client.exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                .isEqualTo(new PayPalExchange.Responded(200, "{}", "dbg-1", false));
        assertThat(client.exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                .isEqualTo(new PayPalExchange.Responded(200, "{}", "dbg-2", false));
        assertThat(t.tokenCalls()).hasSize(1);
        assertThat(t.targetCalls())
                .hasSize(2)
                .extracting(s -> s.headers().get("Authorization"))
                .containsExactly("Bearer tok-1", "Bearer tok-1");
    }

    @Test
    void refreshesFiveMinutesBeforeExpiry() {
        assertRefreshBoundary(32400, 32099);
    }

    @Test
    void shortLivedTokenUsesHalfItsLifetimeAsMargin() {
        assertRefreshBoundary(60, 29);
    }

    private void assertRefreshBoundary(long lifetime, long beforeRefresh) {
        var clock = new MutableClock();
        var t = new Transport()
                .token("tok-1", lifetime)
                .reply(200, "{}")
                .reply(200, "{}")
                .token("tok-2", lifetime)
                .reply(200, "{}");
        var client = client(t, clock);
        assertThat(client.exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                .isEqualTo(new PayPalExchange.Responded(200, "{}", "dbg-1", false));
        clock.advance(Duration.ofSeconds(beforeRefresh));
        assertThat(client.exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                .isEqualTo(new PayPalExchange.Responded(200, "{}", "dbg-2", false));
        assertThat(t.tokenCalls()).hasSize(1);
        clock.advance(Duration.ofSeconds(1));
        assertThat(client.exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                .isEqualTo(new PayPalExchange.Responded(200, "{}", "dbg-3", false));
        assertThat(t.tokenCalls()).hasSize(2);
        assertThat(t.targetCalls())
                .extracting(s -> s.headers().get("Authorization"))
                .containsExactly("Bearer tok-1", "Bearer tok-1", "Bearer tok-2");
    }

    @Test
    void unauthorizedRefreshesTokenAndRetriesSameRequestOnce() {
        var t = new Transport()
                .token("tok-1", 32400)
                .reply(401, "{}")
                .token("tok-2", 32400)
                .reply(201, "{\"status\":\"COMPLETED\"}");
        var request = PayPalHttpRequest.post(ORDER + "/capture", Map.of("PayPal-Request-Id", "op-key-1"), "{}");
        var result = client(t, new MutableClock()).exchange(request);
        assertThat(t.tokenCalls()).hasSize(2);
        assertThat(t.targetCalls()).hasSize(2);
        var first = t.targetCalls().getFirst();
        var second = t.targetCalls().get(1);
        assertThat(first.method()).isEqualTo("POST").isEqualTo(second.method());
        assertThat(first.uri()).isEqualTo(URI.create(BASE + ORDER + "/capture")).isEqualTo(second.uri());
        assertThat(first.body()).isEqualTo("{}").isEqualTo(second.body());
        assertThat(first.headers())
                .containsEntry("PayPal-Request-Id", "op-key-1")
                .containsEntry("Authorization", "Bearer tok-1");
        var expectedHeaders = new HashMap<>(first.headers());
        expectedHeaders.put("Authorization", "Bearer tok-2");
        assertThat(second.headers()).containsExactlyInAnyOrderEntriesOf(expectedHeaders);
        assertThat(result).isEqualTo(new PayPalExchange.Responded(201, "{\"status\":\"COMPLETED\"}", "dbg-2", true));
    }

    @Test
    void secondUnauthorizedIsReturnedWithoutThirdAttempt() {
        var t = new Transport()
                .token("tok-1", 32400)
                .reply(401, "first")
                .token("tok-2", 32400)
                .reply(401, "second");
        var result = client(t, new MutableClock())
                .exchange(PayPalHttpRequest.post(ORDER + "/capture", Map.of("PayPal-Request-Id", "op-key-1"), "{}"));
        assertThat(result).isEqualTo(new PayPalExchange.Responded(401, "second", "dbg-2", true));
        assertThat(t.tokenCalls()).hasSize(2);
        assertThat(t.targetCalls()).hasSize(2);
    }

    @Test
    void refreshFailureAfterUnauthorizedReturnsFirstResponse() {
        var t = new Transport().token("tok-1", 32400).reply(401, "first").reply(500, "unavailable");
        var result = client(t, new MutableClock()).exchange(PayPalHttpRequest.get(ORDER, Map.of()));
        assertThat(result).isEqualTo(new PayPalExchange.Responded(401, "first", "dbg-1", false));
        assertThat(t.tokenCalls()).hasSize(2);
        assertThat(t.targetCalls()).hasSize(1);
    }

    @Test
    void retryAfterUnauthorizedTimesOutIsNoResponse() {
        var t = new Transport()
                .token("tok-1", 32400)
                .reply(401, "{}")
                .token("tok-2", 32400)
                .fail(new HttpTimeoutException("fixture timeout"));
        assertThat(client(t, new MutableClock()).exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                .isEqualTo(new PayPalExchange.NoResponse("NO_RESPONSE"));
        assertThat(t.tokenCalls()).hasSize(2);
        assertThat(t.targetCalls()).hasSize(2);
    }

    @Test
    void tokenFailureIsNotSentAndNotCached() {
        var t = new Transport().reply(503, "unavailable").token("tok-1", 32400).reply(200, "{}");
        var client = client(t, new MutableClock());
        assertThat(client.exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                .isEqualTo(new PayPalExchange.NotSent("TOKEN_UNAVAILABLE"));
        assertThat(t.targetCalls()).isEmpty();
        assertThat(client.exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                .isEqualTo(new PayPalExchange.Responded(200, "{}", "dbg-2", false));
        assertThat(t.tokenCalls()).hasSize(2);
        assertThat(t.targetCalls()).hasSize(1);
    }

    @Test
    void rejectedCredentialsAreTokenRejected() {
        for (int status : new int[] {401, 400}) {
            var t = new Transport().reply(status, "rejected");
            assertThat(client(t, new MutableClock()).exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                    .isEqualTo(new PayPalExchange.NotSent("TOKEN_REJECTED"));
            assertThat(t.tokenCalls()).hasSize(1);
            assertThat(t.targetCalls()).isEmpty();
        }
    }

    @Test
    void tokenTimeoutIsNotSent() {
        var t = new Transport().fail(new HttpTimeoutException("fixture timeout"));
        assertThat(client(t, new MutableClock()).exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                .isEqualTo(new PayPalExchange.NotSent("TOKEN_UNAVAILABLE"));
        assertThat(t.tokenCalls()).hasSize(1);
        assertThat(t.targetCalls()).isEmpty();
    }

    @Test
    void malformedTokenResponsesAreContractMismatch() {
        for (String body : List.of(
                "not json",
                "[]",
                "{}",
                "{\"access_token\":\"\",\"token_type\":\"Bearer\",\"expires_in\":100}",
                "{\"access_token\":\"t\",\"token_type\":\"Basic\",\"expires_in\":100}",
                "{\"access_token\":\"t\",\"token_type\":\"Bearer\",\"expires_in\":0}",
                "{\"access_token\":\"t\",\"token_type\":\"Bearer\",\"expires_in\":\"100\"}",
                "{\"access_token\":\"t\",\"token_type\":\"Bearer\"}",
                "{\"access_token\":12,\"token_type\":\"Bearer\",\"expires_in\":100}",
                "{\"access_token\":\"  \",\"token_type\":\"Bearer\",\"expires_in\":100}",
                "{\"access_token\":\"t\",\"token_type\":\"Bearer\",\"expires_in\":1.5}")) {
            var t = new Transport().reply(200, body);
            assertThat(client(t, new MutableClock()).exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                    .as("token body %s", body)
                    .isEqualTo(new PayPalExchange.NotSent("TOKEN_CONTRACT_MISMATCH"));
            assertThat(t.targetCalls()).isEmpty();
        }
    }

    @Test
    void targetTimeoutIsNoResponseAndNotRetried() {
        var t = new Transport().token("tok-1", 32400).fail(new HttpTimeoutException("fixture timeout"));
        assertThat(client(t, new MutableClock()).exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                .isEqualTo(new PayPalExchange.NoResponse("NO_RESPONSE"));
        assertThat(t.tokenCalls()).hasSize(1);
        assertThat(t.targetCalls()).hasSize(1);
    }

    @Test
    void interruptedTargetCallKeepsInterruptFlag() {
        var t = new Transport().token("tok-1", 32400).fail(new InterruptedException("fixture interrupt"));
        try {
            assertThat(client(t, new MutableClock()).exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                    .isEqualTo(new PayPalExchange.NoResponse("INTERRUPTED"));
            assertThat(Thread.interrupted()).isTrue();
            assertThat(t.targetCalls()).hasSize(1);
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void otherStatusesAreReturnedWithoutRetry() {
        for (int status : new int[] {302, 400, 403, 404, 422, 429, 500, 503}) {
            var t = new Transport().token("tok-1", 32400).reply(status, "response");
            assertThat(client(t, new MutableClock()).exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                    .isEqualTo(new PayPalExchange.Responded(status, "response", "dbg-1", false));
            assertThat(t.targetCalls()).hasSize(1);
            assertThat(t.tokenCalls()).hasSize(1);
        }
    }

    @Test
    void acceptsOnlyTheSandboxBaseUrl() {
        for (String baseUrl : new String[] {null, "", "  ", BASE, BASE + "/"}) {
            var t = new Transport().token("tok-1", 32400).reply(200, "{}");
            var client = new PayPalAuthClient(baseUrl, ID, SECRET, new MutableClock(), t);
            assertThat(client.exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                    .isEqualTo(new PayPalExchange.Responded(200, "{}", "dbg-1", false));
            assertThat(t.calls)
                    .extracting(Sent::uri)
                    .containsExactly(URI.create(BASE + "/v1/oauth2/token"), URI.create(BASE + ORDER));
        }
    }

    @Test
    void refusesAnyOtherBaseUrl() {
        for (String baseUrl : unsafeBaseUrls()) {
            var t = new Transport();
            assertThatThrownBy(() -> new PayPalAuthClient(baseUrl, ID, SECRET, new MutableClock(), t))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageNotContaining(baseUrl);
            assertThat(t.calls).isEmpty();
        }
    }

    @Test
    void requiresCredentials() {
        for (String empty : new String[] {null, "", " "}) {
            assertThatThrownBy(() -> new PayPalAuthClient(null, empty, SECRET, new MutableClock(), new Transport()))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> new PayPalAuthClient(null, ID, empty, new MutableClock(), new Transport()))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void refusesUnsafeRequestsBeforeSending() {
        for (PayPalHttpRequest request : unsafeRequests()) {
            var t = new Transport().token("tok-1", 32400).reply(200, "{}");
            assertThatThrownBy(() -> client(t, new MutableClock()).exchange(request))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThat(t.calls).isEmpty();
        }
    }

    @Test
    void refusesCallsInsideTransaction() {
        var t = new Transport();
        TransactionSynchronizationManager.initSynchronization();
        try {
            assertThatThrownBy(() -> client(t, new MutableClock()).exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("PayPal calls must execute outside local transactions and business locks");
            assertThat(t.calls).isEmpty();
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void secretAndTokenNeverAppearInMessages() {
        List<String> messages = new ArrayList<>();
        var t = new Transport()
                .token("tok-secret-value", 32400)
                .reply(401, "first")
                .reply(500, "unavailable");
        var client = client(t, new MutableClock());
        assertThat(client.toString()).isEqualTo("PayPalAuthClient[" + BASE + "]");
        messages.add(client.toString());
        for (String baseUrl : unsafeBaseUrls()) {
            messages.add(catchThrowable(() -> new PayPalAuthClient(baseUrl, ID, SECRET, new MutableClock(), t))
                    .getMessage());
        }
        for (String empty : new String[] {null, "", " "}) {
            messages.add(catchThrowable(() -> new PayPalAuthClient(null, empty, SECRET, new MutableClock(), t))
                    .getMessage());
            messages.add(catchThrowable(() -> new PayPalAuthClient(null, ID, empty, new MutableClock(), t))
                    .getMessage());
        }
        for (PayPalHttpRequest request : unsafeRequests()) {
            messages.add(catchThrowable(() -> client.exchange(request)).getMessage());
        }
        TransactionSynchronizationManager.initSynchronization();
        try {
            messages.add(catchThrowable(() -> client.exchange(PayPalHttpRequest.get(ORDER, Map.of())))
                    .getMessage());
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
        var result = client.exchange(PayPalHttpRequest.get(ORDER, Map.of()));
        assertThat(result).isEqualTo(new PayPalExchange.Responded(401, "first", "dbg-1", false));
        messages.add(result.toString());
        for (String message : messages) {
            assertThat(message).doesNotContain(SECRET, "tok-secret-value", basicAuth());
        }
    }

    @Test
    void concurrentCallersShareOneTokenRequest() throws Exception {
        var t = new Transport().token("tok-1", 32400);
        t.tokenDelayMillis = 200;
        for (int i = 0; i < 8; i++) t.reply(200, "{}");
        var client = client(t, new MutableClock());
        var ready = new CountDownLatch(8);
        var start = new CountDownLatch(1);
        var executor = Executors.newFixedThreadPool(8);
        try {
            List<Future<PayPalExchange>> results = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                results.add(executor.submit(() -> {
                    ready.countDown();
                    if (!start.await(5, TimeUnit.SECONDS)) throw new AssertionError("Start latch timed out");
                    return client.exchange(PayPalHttpRequest.get(ORDER, Map.of()));
                }));
            }
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            for (var result : results) {
                assertThat(result.get(5, TimeUnit.SECONDS))
                        .isInstanceOfSatisfying(PayPalExchange.Responded.class, r -> {
                            assertThat(r.status()).isEqualTo(200);
                            assertThat(r.authRetried()).isFalse();
                        });
            }
            assertThat(t.tokenCalls()).hasSize(1);
            assertThat(t.targetCalls())
                    .hasSize(8)
                    .allSatisfy(s -> assertThat(s.headers()).containsEntry("Authorization", "Bearer tok-1"));
        } finally {
            start.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void addsJsonContentTypeOnlyWhenBodyAndNoneGiven() {
        var t = new Transport().token("tok-1", 32400).reply(200, "{}").reply(200, "{}");
        var client = client(t, new MutableClock());
        client.exchange(PayPalHttpRequest.post(ORDER, Map.of(), "{}"));
        client.exchange(PayPalHttpRequest.post(ORDER, Map.of("Content-Type", "application/json; charset=UTF-8"), "{}"));
        assertThat(t.targetCalls().getFirst().headers()).containsEntry("Content-Type", "application/json");
        var headers = t.targetCalls().get(1).headers();
        assertThat(headers).containsEntry("Content-Type", "application/json; charset=UTF-8");
        assertThat(headers.keySet().stream().filter("Content-Type"::equalsIgnoreCase))
                .hasSize(1);
    }

    @Test
    void startupDisabledByDefault() {
        runner().run(c -> assertThat(c).hasNotFailed().doesNotHaveBean(PayPalAuthClient.class));
    }

    @Test
    void startupWithSandboxAndCredentials() {
        configured().run(c -> assertThat(c).hasNotFailed().hasSingleBean(PayPalAuthClient.class));
        for (String baseUrl : List.of(BASE, "")) {
            configured()
                    .withPropertyValues("platform.paypal.base-url=" + baseUrl)
                    .run(c -> assertThat(c).hasNotFailed().hasSingleBean(PayPalAuthClient.class));
        }
    }

    @Test
    void startupFailsOnNonSandboxBaseUrl() {
        configured()
                .withPropertyValues("platform.paypal.base-url=https://api-m.paypal.com")
                .run(c -> assertThat(c).hasFailed());
    }

    @Test
    void startupFailsWithoutCredentials() {
        configured()
                .withPropertyValues("platform.paypal.client-secret=")
                .run(c -> assertThat(c).hasFailed());
    }

    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner().withUserConfiguration(PayPalAdapterConfiguration.class);
    }

    private ApplicationContextRunner configured() {
        return runner().withPropertyValues(
                        "platform.paypal.enabled=true",
                        "platform.paypal.client-id=" + ID,
                        "platform.paypal.client-secret=" + SECRET);
    }

    private static PayPalAuthClient client(Transport t, Clock c) {
        return new PayPalAuthClient(null, ID, SECRET, c, t);
    }

    private static String basicAuth() {
        return "Basic " + Base64.getEncoder().encodeToString((ID + ":" + SECRET).getBytes(StandardCharsets.UTF_8));
    }

    private static List<String> unsafeBaseUrls() {
        return List.of(
                "https://api-m.paypal.com",
                "https://api.paypal.com",
                "https://api.sandbox.paypal.com",
                "http://api-m.sandbox.paypal.com",
                BASE + ".evil.example",
                "https://user@api-m.sandbox.paypal.com",
                BASE + ":8443",
                BASE + "/v1",
                BASE + "//");
    }

    private static List<PayPalHttpRequest> unsafeRequests() {
        var requests = new ArrayList<PayPalHttpRequest>();
        for (String path : List.of(
                "https://evil.example/x",
                "//evil.example/x",
                "v2/x",
                "/v2/x@evil.example",
                "/v2/x y",
                "/v2\\x",
                "/v2/https://evil.example",
                "/v2/\tx",
                "/v2/\u0001x")) {
            requests.add(PayPalHttpRequest.get(path, Map.of()));
        }
        requests.add(PayPalHttpRequest.get(ORDER, Map.of("authorization", "Bearer x")));
        requests.add(new PayPalHttpRequest("DELETE", ORDER, Map.of(), null));
        return requests;
    }

    static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-10-22T00:00:00Z");

        void advance(Duration duration) {
            now = now.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return Clock.fixed(now, zone);
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    record Sent(String method, URI uri, Map<String, String> headers, String body) {}

    static final class Transport implements PayPalTransport {
        final List<Sent> calls = Collections.synchronizedList(new ArrayList<>());
        final Deque<Object> replies = new ArrayDeque<>();
        long tokenDelayMillis;
        private int replyNumber;

        Transport token(String value, long expiresIn) {
            replies.add(new PayPalHttpResponse(
                    200,
                    Map.of(),
                    "{\"access_token\":\"" + value + "\",\"token_type\":\"Bearer\",\"expires_in\":" + expiresIn
                            + ",\"app_id\":\"APP-fixture\"}"));
            return this;
        }

        Transport reply(int status, String body) {
            replies.add(
                    new PayPalHttpResponse(status, Map.of("PayPal-Debug-Id", List.of("dbg-" + ++replyNumber)), body));
            return this;
        }

        Transport fail(Exception error) {
            replies.add(error);
            return this;
        }

        List<Sent> tokenCalls() {
            return matchingCalls(true);
        }

        List<Sent> targetCalls() {
            return matchingCalls(false);
        }

        private List<Sent> matchingCalls(boolean token) {
            synchronized (calls) {
                return calls.stream()
                        .filter(s -> s.uri().getPath().equals("/v1/oauth2/token") == token)
                        .toList();
            }
        }

        @Override
        public PayPalHttpResponse send(String method, URI uri, Map<String, String> headers, String body)
                throws IOException, InterruptedException {
            Object next;
            synchronized (replies) {
                calls.add(new Sent(method, uri, Map.copyOf(headers), body));
                next = replies.removeFirst();
            }
            if (uri.getPath().equals("/v1/oauth2/token") && tokenDelayMillis > 0) Thread.sleep(tokenDelayMillis);
            if (next instanceof IOException error) throw error;
            if (next instanceof InterruptedException error) throw error;
            return (PayPalHttpResponse) next;
        }
    }
}
