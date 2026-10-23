package com.paymentsledger.webhook;

import static com.paymentsledger.provider.ProviderCallClassification.*;
import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.provider.ProviderModels.VerifiedWebhook;
import com.paymentsledger.provider.adapter.paypal.*;
import java.io.IOException;
import java.net.http.HttpTimeoutException;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class PayPalWebhookVerificationTest {
    static final ObjectMapper JSON = new ObjectMapper();
    static final Instant TIME = Instant.parse("2026-10-22T09:05:10.123Z");
    static final Clock CLOCK = Clock.fixed(TIME.plusSeconds(1), ZoneOffset.UTC);
    static final String EVENT = "WH-58D329510W468432D-8HN650336L201105X";
    static final String CAPTURE = "41995584GM234064G";
    static final String SIGNATURE =
            "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==";
    static final Map<String, String> H = Map.of(
            "PAYPAL-AUTH-ALGO", "SHA256withRSA",
            "PAYPAL-CERT-URL", "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
            "PAYPAL-TRANSMISSION-ID", "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
            "PAYPAL-TRANSMISSION-SIG", SIGNATURE,
            "PAYPAL-TRANSMISSION-TIME", "2026-10-22T09:05:11Z");
    static final byte[] RAW = fixture("webhook-capture-completed.json");
    static final byte[] REFUND = fixture("webhook-refund-completed.json");

    @Test
    void verifySendsHeadersConfiguredIdAndRawEvent() throws Exception {
        var t = success();
        var result = verifier(t).verify(RAW, H);
        var calls = verificationCalls(t);
        assertThat(calls).hasSize(1);
        var call = calls.getFirst();
        assertThat(call.method()).isEqualTo("POST");
        assertThat(call.uri().toString())
                .isEqualTo("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
        assertThat(call.headers()).doesNotContainKey("PayPal-Request-Id");
        var body = JSON.readTree(call.body());
        assertThat(body.path("auth_algo").asText()).isEqualTo(H.get("PAYPAL-AUTH-ALGO"));
        assertThat(body.path("cert_url").asText()).isEqualTo(H.get("PAYPAL-CERT-URL"));
        assertThat(body.path("transmission_id").asText()).isEqualTo(H.get("PAYPAL-TRANSMISSION-ID"));
        assertThat(body.path("transmission_sig").asText()).isEqualTo(SIGNATURE);
        assertThat(body.path("transmission_time").asText()).isEqualTo(H.get("PAYPAL-TRANSMISSION-TIME"));
        assertThat(body.path("webhook_id").asText()).isEqualTo("WEBHOOK1FIXTURE");
        assertThat(body.path("webhook_event")).isEqualTo(JSON.readTree(RAW));
        assertThat(call.body()).contains(new String(RAW, UTF_8));
        assertThat(result.classification()).isEqualTo(SUCCESS);
        assertThat(result.payload()).isEqualTo(verified());
        assertThat(result.evidence().apiVersion()).isEqualTo("paypal-notifications-v1");
        assertThat(result.evidence().idempotencyKeyUsed()).isNull();
        assertThat(result.evidence().providerRequestId()).startsWith("dbg-");
    }

    @Test
    void failureStatusIsRejected() {
        var result = verifier(new PayPalTestTransport().token().reply(200, "{\"verification_status\":\"FAILURE\"}"))
                .verify(RAW, H);
        assertThat(result.classification()).isEqualTo(DEFINITIVE_REJECT);
        assertThat(result.evidence().providerErrorCode()).isEqualTo("paypal_signature_invalid");
        assertThat(result.payload()).isNull();
    }

    @Test
    void verificationResponsesClassify() {
        var statuses = List.of(200, 200, 400, 401, 403, 404, 429, 500);
        var expected = List.of(
                CONTRACT_MISMATCH,
                CONTRACT_MISMATCH,
                DEFINITIVE_REJECT,
                RETRYABLE_TRANSIENT,
                CAPABILITY_UNAVAILABLE,
                NOT_FOUND,
                RATE_LIMITED,
                RETRYABLE_TRANSIENT);
        for (int i = 0; i < statuses.size(); i++) {
            String body = i == 0 ? "{\"verification_status\":\"MAYBE\"}" : i == 1 ? "not json" : "{}";
            var t = new PayPalTestTransport().token();
            if (statuses.get(i) == 401) t.reply(401, body).token();
            t.reply(statuses.get(i), body);
            var result = verifier(t).verify(RAW, H);
            assertThat(result.classification()).isEqualTo(expected.get(i));
            assertThat(result.payload()).isNull();
            if (i < 2) assertThat(result.evidence().providerErrorCode()).isEqualTo("paypal_contract_mismatch");
        }
    }

    @Test
    void timeoutAndTokenFailure() {
        var timedOut = verifier(new PayPalTestTransport().token().fail(new HttpTimeoutException("x")))
                .verify(RAW, H);
        assertThat(timedOut.classification()).isEqualTo(TIMEOUT_UNKNOWN);
        assertThat(timedOut.evidence().httpStatus()).isNull();
        var t = new PayPalTestTransport().reply(503, "{}");
        var unavailable = verifier(t).verify(RAW, H);
        assertThat(unavailable.classification()).isEqualTo(RETRYABLE_TRANSIENT);
        assertThat(unavailable.evidence().providerErrorCode()).isEqualTo("TOKEN_UNAVAILABLE");
        assertThat(verificationCalls(t)).isEmpty();
    }

    @Test
    void invalidEventIsRefusedWithoutCall() throws Exception {
        var noId = tree(RAW);
        noId.remove("id");
        var noType = tree(RAW);
        noType.remove("event_type");
        var noResourceId = tree(RAW);
        ((ObjectNode) noResourceId.path("resource")).remove("id");
        var invalidTime = tree(RAW).put("create_time", "yesterday");
        for (var raw : List.of(
                "not json".getBytes(UTF_8),
                "[]".getBytes(UTF_8),
                JSON.writeValueAsBytes(noId),
                JSON.writeValueAsBytes(noType),
                JSON.writeValueAsBytes(noResourceId),
                JSON.writeValueAsBytes(invalidTime))) {
            var t = new PayPalTestTransport();
            var result = verifier(t).verify(raw, H);
            assertThat(result.classification()).isEqualTo(CONTRACT_MISMATCH);
            assertThat(result.evidence().providerErrorCode()).isEqualTo("paypal_event_invalid");
            assertThat(t.calls()).isEmpty();
        }
    }

    @Test
    void certUrlMustBeSandbox() {
        for (String url : List.of(
                "https://api.paypal.com/v1/notifications/certs/X",
                "http://api.sandbox.paypal.com/x",
                "https://api.sandbox.paypal.com.evil.test/x")) {
            var t = new PayPalTestTransport();
            var h = new HashMap<>(H);
            h.put("PAYPAL-CERT-URL", url);
            var result = verifier(t).verify(RAW, h);
            assertThat(result.classification()).isEqualTo(CONTRACT_MISMATCH);
            assertThat(result.evidence().providerErrorCode()).isEqualTo("paypal_cert_url_not_sandbox");
            assertThat(t.calls()).isEmpty();
        }
        var h = new HashMap<>(H);
        h.put("PAYPAL-CERT-URL", "https://api-m.sandbox.paypal.com/v1/notifications/certs/X");
        assertThat(verifier(success()).verify(RAW, h).classification()).isEqualTo(SUCCESS);
    }

    @Test
    void headerValuesAreValidated() {
        var missing = new HashMap<>(H);
        missing.remove("PAYPAL-TRANSMISSION-SIG");
        var space = new HashMap<>(H);
        space.put("PAYPAL-TRANSMISSION-ID", "has space");
        var longValue = new HashMap<>(H);
        longValue.put("PAYPAL-TRANSMISSION-SIG", "x".repeat(2049));
        for (var headers : List.of(missing, space, longValue)) {
            var t = new PayPalTestTransport();
            var result = verifier(t).verify(RAW, headers);
            assertThat(result.classification()).isEqualTo(CONTRACT_MISMATCH);
            assertThat(result.evidence().providerErrorCode()).isEqualTo("paypal_headers_invalid");
            assertThat(t.calls()).isEmpty();
        }
    }

    @Test
    void webhookIdMustBeConfigured() {
        var client = new PayPalTestTransport().client(CLOCK);
        assertThatThrownBy(() -> new PayPalWebhookVerifier(client, null, CLOCK))
                .isInstanceOf(NullPointerException.class);
        for (String id : List.of("", "bad id", "short", "webhook1fixture")) {
            assertThatThrownBy(() -> new PayPalWebhookVerifier(client, id, CLOCK))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("Valid PayPal webhook id is required")
                    .hasNoCause();
        }
    }

    @Test
    void captureSnapshotKeepsOnlyWhitelistedFields() throws Exception {
        var snapshot = PayPalWebhookEvents.snapshot(tree(RAW), JSON);
        assertThat(snapshot).isEqualTo(JSON.readTree("""
                {"object":"paypal.capture","id":"41995584GM234064G","event_type":"PAYMENT.CAPTURE.COMPLETED",
                 "resource_version":"2.0","status":"COMPLETED","custom_id":"00000000-0000-0000-0000-0000000000bb",
                 "order_id":"7CV2269518094610C","amount":{"currency_code":"USD","value":"100.00"},
                 "breakdown":{"gross":"100.00","fee":"3.49","net":"96.51"},
                 "create_time":"2026-10-22T09:05:08Z","update_time":"2026-10-22T09:05:08Z"}
                """));
        assertThat(snapshot.toString()).doesNotContain("sb-seller@business.example.com", "links");
    }

    @Test
    void refundSnapshotTakesCaptureFromUpLink() throws Exception {
        var snapshot = PayPalWebhookEvents.snapshot(tree(REFUND), JSON);
        assertThat(snapshot.path("object").asText()).isEqualTo("paypal.refund");
        assertThat(snapshot.path("id").asText()).isEqualTo("2EU12368F9867740A");
        assertThat(snapshot.path("capture_id").asText()).isEqualTo(CAPTURE);
        assertThat(snapshot.path("custom_id").asText()).isEqualTo("00000000-0000-0000-0000-0000000000dd");
        assertThat(snapshot.path("amount")).isEqualTo(JSON.readTree("{\"currency_code\":\"USD\",\"value\":\"40.00\"}"));
        assertThat(snapshot.path("breakdown"))
                .isEqualTo(JSON.readTree("{\"gross\":\"40.00\",\"fee\":\"1.40\",\"net\":\"38.60\"}"));
        assertThat(snapshot.has("order_id")).isFalse();
    }

    @Test
    void snapshotRejectsUnsupportedShapesAndDropsInvalidOptionals() throws Exception {
        var noType = tree(RAW);
        noType.remove("resource_type");
        var badId = tree(RAW);
        ((ObjectNode) badId.path("resource")).put("id", "bad id!");
        for (var event : List.of(noType, badId))
            assertThatThrownBy(() -> PayPalWebhookEvents.snapshot(event, JSON))
                    .isInstanceOf(IllegalArgumentException.class);
        var custom = tree(RAW);
        ((ObjectNode) custom.path("resource")).put("custom_id", "abc");
        assertThat(PayPalWebhookEvents.snapshot(custom, JSON).has("custom_id")).isFalse();
        var amount = tree(RAW);
        ((ObjectNode) amount.path("resource").path("amount")).put("value", "1e3");
        assertThat(PayPalWebhookEvents.snapshot(amount, JSON).has("amount")).isFalse();
    }

    @Test
    void matchesComparesVerifiedIdentity() throws Exception {
        var event = tree(RAW);
        assertThat(PayPalWebhookEvents.matches(event, verified())).isTrue();
        for (var v : List.of(
                new VerifiedWebhook("OTHER", "PAYMENT.CAPTURE.COMPLETED", CAPTURE, TIME, false),
                new VerifiedWebhook(EVENT, "OTHER", CAPTURE, TIME, false),
                new VerifiedWebhook(EVENT, "PAYMENT.CAPTURE.COMPLETED", "OTHER", TIME, false),
                new VerifiedWebhook(EVENT, "PAYMENT.CAPTURE.COMPLETED", CAPTURE, TIME.plusSeconds(1), false)))
            assertThat(PayPalWebhookEvents.matches(event, v)).isFalse();
    }

    @Test
    void noSecretsInResults() {
        var result = verifier(success()).verify(RAW, H);
        assertThat(result.toString()).doesNotContain("secret-fixture-do-not-log", SIGNATURE);
        assertThat(result.evidence().toString()).doesNotContain("secret-fixture-do-not-log", SIGNATURE);
    }

    @Test
    void endpointConfiguration() {
        configured(true, true).run(c -> {
            assertThat(c).hasNotFailed().hasSingleBean(PayPalWebhookEndpoint.class);
            assertThat(c.getBean(PayPalWebhookEndpoint.class).maximumBytes()).isEqualTo(262144);
            assertThat(c.getBean(PayPalWebhookEndpoint.class).accountRef()).isEqualTo("client-fixture");
        });
        configured(false, true).run(c -> assertThat(c).hasFailed());
        configured(true, true)
                .withPropertyValues("platform.webhooks.paypal.max-body-bytes=0")
                .run(c -> assertThat(c).hasFailed());
        configured(true, false).run(c -> assertThat(c).hasNotFailed().doesNotHaveBean(PayPalWebhookEndpoint.class));
    }

    private ApplicationContextRunner configured(boolean webhookId, boolean enabled) {
        var runner = new ApplicationContextRunner()
                .withInitializer(c -> c.getEnvironment().setActiveProfiles("api"))
                .withUserConfiguration(PayPalAdapterConfiguration.class, PayPalWebhookEndpoint.class)
                .withBean(Clock.class, () -> CLOCK)
                .withPropertyValues(
                        "platform.paypal.enabled=true",
                        "platform.paypal.client-id=client-fixture",
                        "platform.paypal.client-secret=secret-fixture-do-not-log",
                        "platform.paypal.organization-id=" + new UUID(0, 1),
                        "platform.paypal.environment-id=" + new UUID(0, 2),
                        "platform.paypal.provider-account-id=" + new UUID(0, 4));
        if (webhookId) runner = runner.withPropertyValues("platform.paypal.webhook-id=WEBHOOK1FIXTURE");
        if (enabled) runner = runner.withPropertyValues("platform.webhooks.paypal.enabled=true");
        return runner;
    }

    private static PayPalWebhookVerifier verifier(PayPalTestTransport t) {
        return new PayPalWebhookVerifier(t.client(CLOCK), "WEBHOOK1FIXTURE", CLOCK);
    }

    private static PayPalTestTransport success() {
        return new PayPalTestTransport().token().reply(200, "{\"verification_status\":\"SUCCESS\"}");
    }

    private static VerifiedWebhook verified() {
        return new VerifiedWebhook(EVENT, "PAYMENT.CAPTURE.COMPLETED", CAPTURE, TIME, false);
    }

    private static ObjectNode tree(byte[] raw) throws IOException {
        return (ObjectNode) JSON.readTree(raw);
    }

    private static List<PayPalTestTransport.Sent> verificationCalls(PayPalTestTransport t) {
        return t.calls().stream()
                .filter(c -> c.uri().getPath().equals("/v1/notifications/verify-webhook-signature"))
                .toList();
    }

    private static byte[] fixture(String name) {
        try {
            return Files.readAllBytes(Path.of("src/test/resources/paypal", name));
        } catch (IOException unavailable) {
            throw new AssertionError(unavailable);
        }
    }
}
