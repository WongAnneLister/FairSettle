package com.paymentsledger.payment;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.common.error.*;
import com.paymentsledger.provider.adapter.paypal.*;
import com.paymentsledger.webhook.*;
import com.paymentsledger.webhook.repository.PayPalWebhookInboxRepository;
import java.io.IOException;
import java.net.http.HttpTimeoutException;
import java.nio.file.*;
import java.security.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.mock.web.*;

class PayPalWebhookIT extends PaymentCoreFixture {
    static final String EVENT = "WH-58D329510W468432D-8HN650336L201105X";
    static final String CAPTURE = "41995584GM234064G";
    static final byte[] RAW = fixture();
    static final Map<String, String> H = Map.of(
            "PAYPAL-AUTH-ALGO", "SHA256withRSA",
            "PAYPAL-CERT-URL", "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
            "PAYPAL-TRANSMISSION-ID", "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
            "PAYPAL-TRANSMISSION-SIG",
                    "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==",
            "PAYPAL-TRANSMISSION-TIME", "2026-10-22T09:05:11Z");
    final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    PayPalTestTransport transport;
    PayPalWebhookVerifier verifier;
    PayPalWebhookReceiver receiver;
    PayPalWebhookController controller;

    @BeforeEach
    void configurePayPalWebhook() {
        admin.update(
                "UPDATE platform.provider_account SET provider='PAYPAL',provider_account_ref='client-fixture' WHERE id=?",
                id(4));
        transport = new PayPalTestTransport();
        verifier = new PayPalWebhookVerifier(transport.client(fake.clock()), "WEBHOOK1FIXTURE", fake.clock());
        receiver = new PayPalWebhookReceiver(new PayPalWebhookInboxRepository(jdbc), tx, json, fake.clock());
        controller = new PayPalWebhookController(
                new PayPalWebhookEndpoint(scope, "client-fixture", 262144, verifier), receiver);
    }

    @Test
    void verifiedEventIsStoredOnceAndRedeliveryIsDuplicate() throws Exception {
        transport.token().reply(200, success()).reply(200, success());
        var first = new MockHttpServletResponse();
        var second = new MockHttpServletResponse();
        assertThat(controller.receive(request(RAW), first)).isEqualTo(Map.of("received", true, "duplicate", false));
        assertThat(controller.receive(request(RAW), second)).isEqualTo(Map.of("received", true, "duplicate", true));
        assertThat(first.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(second.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(calls()).hasSize(2);
        assertThat(count("webhook_inbox")).isEqualTo(1);
        var row = jdbc.queryForMap("SELECT * FROM platform.webhook_inbox");
        assertThat(row)
                .containsEntry("provider_account_ref", "client-fixture")
                .containsEntry("event_id", EVENT)
                .containsEntry("event_type", "PAYMENT.CAPTURE.COMPLETED")
                .containsEntry("object_type", "paypal.capture")
                .containsEntry("object_id", CAPTURE)
                .containsEntry("api_version", "paypal-notifications-v1")
                .containsEntry("status", "READY")
                .containsEntry(
                        "raw_digest",
                        HexFormat.of()
                                .formatHex(MessageDigest.getInstance("SHA-256").digest(RAW)));
        assertThat(((Timestamp) row.get("event_created_at")).toInstant())
                .isEqualTo(Instant.parse("2026-10-22T09:05:10.123Z"));
        assertThat(json.readTree(row.get("object_snapshot").toString())).isEqualTo(json.readTree("""
                {"object":"paypal.capture","id":"41995584GM234064G","event_type":"PAYMENT.CAPTURE.COMPLETED",
                 "resource_version":"2.0","status":"COMPLETED","custom_id":"00000000-0000-0000-0000-0000000000bb",
                 "order_id":"7CV2269518094610C","amount":{"currency_code":"USD","value":"100.00"},
                 "breakdown":{"gross":"100.00","fee":"3.49","net":"96.51"},
                 "create_time":"2026-10-22T09:05:08Z","update_time":"2026-10-22T09:05:08Z"}
                """));
    }

    @Test
    void sameEventIdWithOtherBytesIsConflict() throws Exception {
        transport.token().reply(200, success()).reply(200, success());
        controller.receive(request(RAW), new MockHttpServletResponse());
        var other = (ObjectNode) json.readTree(RAW);
        other.put("summary", "Changed summary");
        assertError(
                () -> controller.receive(request(json.writeValueAsBytes(other)), new MockHttpServletResponse()),
                ErrorCode.EVIDENCE_CONFLICT);
        assertThat(count("webhook_inbox")).isEqualTo(1);
    }

    @Test
    void failedVerificationStoresNothing() {
        transport.token().reply(200, "{\"verification_status\":\"FAILURE\"}");
        assertError(
                () -> controller.receive(request(RAW), new MockHttpServletResponse()),
                ErrorCode.SIGNATURE_VERIFICATION_FAILED);
        assertThat(count("webhook_inbox")).isZero();
        assertThat(count("journal")).isZero();
    }

    @Test
    void timedOutVerificationStoresNothingAndRetrySucceeds() {
        transport.token().fail(new HttpTimeoutException("x"));
        assertError(
                () -> controller.receive(request(RAW), new MockHttpServletResponse()), ErrorCode.SERVICE_UNAVAILABLE);
        assertThat(count("webhook_inbox")).isZero();
        transport.reply(200, success());
        assertThat(controller.receive(request(RAW), new MockHttpServletResponse()))
                .isEqualTo(Map.of("received", true, "duplicate", false));
        assertThat(count("webhook_inbox")).isEqualTo(1);
    }

    @Test
    void missingOrRepeatedHeaderIsRejectedWithoutCall() {
        var missing = request(RAW);
        missing.removeHeader("PAYPAL-TRANSMISSION-SIG");
        var repeated = request(RAW);
        repeated.addHeader("PAYPAL-TRANSMISSION-ID", "second");
        assertError(
                () -> controller.receive(missing, new MockHttpServletResponse()),
                ErrorCode.SIGNATURE_VERIFICATION_FAILED);
        assertError(
                () -> controller.receive(repeated, new MockHttpServletResponse()),
                ErrorCode.SIGNATURE_VERIFICATION_FAILED);
        assertThat(calls()).isEmpty();
        assertThat(count("webhook_inbox")).isZero();
    }

    @Test
    void oversizedBodyIsRejectedWithoutCall() {
        controller = new PayPalWebhookController(
                new PayPalWebhookEndpoint(scope, "client-fixture", RAW.length - 1, verifier), receiver);
        assertError(() -> controller.receive(request(RAW), new MockHttpServletResponse()), ErrorCode.VALIDATION_ERROR);
        assertThat(calls()).isEmpty();
        assertThat(count("webhook_inbox")).isZero();
        controller = new PayPalWebhookController(
                new PayPalWebhookEndpoint(scope, "client-fixture", RAW.length, verifier), receiver);
        transport.token().reply(200, success());
        assertThat(controller.receive(request(RAW), new MockHttpServletResponse()))
                .isEqualTo(Map.of("received", true, "duplicate", false));
    }

    @Test
    void unboundAccountStoresNothing() {
        admin.update("UPDATE platform.provider_account SET provider_account_ref='other-client' WHERE id=?", id(4));
        transport.token().reply(200, success());
        assertError(
                () -> controller.receive(request(RAW), new MockHttpServletResponse()), ErrorCode.SERVICE_UNAVAILABLE);
        assertThat(calls()).hasSize(1);
        assertThat(count("webhook_inbox")).isZero();
    }

    @Test
    void storedPayPalEventIsNotProcessed() {
        long payments = count("payment");
        transport.token().reply(200, success());
        controller.receive(request(RAW), new MockHttpServletResponse());
        assertThat(new WebhookProcessor(
                                new WebhookInboxRepository(jdbc, tx, json, fake.clock()),
                                repository,
                                json,
                                fake.clock())
                        .processDue(10))
                .isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT status,reason FROM platform.webhook_inbox"))
                .containsEntry("status", "WAITING")
                .containsEntry("reason", "FUTURE_RESOURCE_HANDLER");
        assertThat(count("dependency_wait")).isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT dependency_type,dependency_id FROM platform.dependency_wait"))
                .containsEntry("dependency_type", "FUTURE_RESOURCE")
                .containsEntry("dependency_id", CAPTURE);
        assertThat(count("journal")).isZero();
        assertThat(count("payment")).isEqualTo(payments);
        assertThat(count("outbox_event")).isZero();
    }

    private MockHttpServletRequest request(byte[] raw) {
        var request = new MockHttpServletRequest("POST", "/webhooks/paypal");
        request.setContentType("application/json");
        H.forEach(request::addHeader);
        request.setContent(raw);
        return request;
    }

    private List<PayPalTestTransport.Sent> calls() {
        return transport.calls().stream()
                .filter(c -> c.uri().getPath().equals("/v1/notifications/verify-webhook-signature"))
                .toList();
    }

    private void assertError(org.assertj.core.api.ThrowableAssert.ThrowingCallable action, ErrorCode code) {
        assertThatThrownBy(action)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.errorCode()).isEqualTo(code));
    }

    private static String success() {
        return "{\"verification_status\":\"SUCCESS\"}";
    }

    private static byte[] fixture() {
        try {
            return Files.readAllBytes(Path.of("src/test/resources/paypal/webhook-capture-completed.json"));
        } catch (IOException unavailable) {
            throw new AssertionError(unavailable);
        }
    }
}
