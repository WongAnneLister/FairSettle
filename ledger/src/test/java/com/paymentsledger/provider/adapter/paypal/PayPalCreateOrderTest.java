package com.paymentsledger.provider.adapter.paypal;

import static com.paymentsledger.provider.ProviderCallClassification.*;
import static com.paymentsledger.provider.ProviderModels.CheckoutSessionStatus.*;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.*;
import java.net.URI;
import java.net.http.HttpTimeoutException;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class PayPalCreateOrderTest {
    static final ObjectMapper JSON = new ObjectMapper();
    static final String KEY = "pay_create_00000000-0000-0000-0000-0000000000aa";
    static final String P = "00000000-0000-0000-0000-0000000000bb";
    static final String ID = "7CV2269518094610C";
    static final String HOSTED = "https://www.sandbox.paypal.com/checkoutnow?token=" + ID;
    static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-22T09:00:00Z"), ZoneOffset.UTC);
    static final Instant EXPIRY = Instant.parse("2026-10-22T10:00:00Z");
    static final ProviderScope SCOPE = new ProviderScope(new UUID(0, 1), new UUID(0, 2), new UUID(0, 4), false);

    @Test
    void createsOrderWithOperationKeyAsRequestId() throws Exception {
        var t = new PayPalTestTransport().token().reply(201, order("PAYER_ACTION_REQUIRED", P, true));
        var result = adapter(t).createSession(command(SCOPE, Map.of("payment_id", P, "merchant_note", "x")));
        assertThat(t.orderCalls()).hasSize(1);
        var sent = t.orderCalls().getFirst();
        assertThat(sent.method()).isEqualTo("POST");
        assertThat(sent.uri()).isEqualTo(URI.create("https://api-m.sandbox.paypal.com/v2/checkout/orders"));
        assertThat(sent.headers())
                .containsEntry("PayPal-Request-Id", KEY)
                .containsEntry("Prefer", "return=representation");
        assertThat(JSON.readTree(sent.body())).isEqualTo(JSON.readTree("""
                {"intent":"CAPTURE","purchase_units":[{
                  "reference_id":"00000000-0000-0000-0000-0000000000bb",
                  "custom_id":"00000000-0000-0000-0000-0000000000bb",
                  "amount":{"currency_code":"USD","value":"100.00"}}],
                  "payment_source":{"paypal":{"experience_context":{
                    "return_url":"https://merchant.test/ok","cancel_url":"https://merchant.test/cancel",
                    "user_action":"PAY_NOW","shipping_preference":"NO_SHIPPING"}}}}
                """));
        assertThat(sent.body()).doesNotContain("merchant_note");
        assertThat(result.classification()).isEqualTo(SUCCESS);
        assertThat(result.payload())
                .isEqualTo(new CheckoutSessionFact(
                        ID, OPEN, HOSTED, null, "PAYER_ACTION_REQUIRED", EXPIRY, Map.of("payment_id", P)));
        assertThat(result.evidence().idempotencyKeyUsed()).isEqualTo(KEY);
        assertThat(result.evidence().httpStatus()).isEqualTo(201);
        assertThat(result.evidence().providerRequestId()).isEqualTo("dbg-1");
        assertThat(result.evidence().apiVersion()).isEqualTo("paypal-orders-v2");
        assertThat(result.evidence().rawDigest()).matches("[a-f0-9]{64}");
        assertThat(result.evidence().requestedAt()).isEqualTo(CLOCK.instant());
        assertThat(result.evidence().respondedAt()).isEqualTo(CLOCK.instant());
    }

    @Test
    void sameCommandResendsSameRequestIdAndGetsSameOrder() {
        var body = order("PAYER_ACTION_REQUIRED", P, true);
        var t = new PayPalTestTransport().token().reply(201, body).reply(200, body);
        var adapter = adapter(t);
        var command = command(SCOPE, Map.of("payment_id", P));
        assertThat(adapter.createSession(command).payload().sessionId()).isEqualTo(ID);
        assertThat(adapter.createSession(command).payload().sessionId()).isEqualTo(ID);
        assertThat(t.orderCalls()).hasSize(2);
        assertThat(t.orderCalls().getFirst()).isEqualTo(t.orderCalls().get(1));
        assertThat(t.orderCalls().getFirst().headers()).containsEntry("PayPal-Request-Id", KEY);
    }

    @Test
    void approveLinkIsUsedWithoutPayerAction() {
        var t = new PayPalTestTransport().token().reply(201, order("CREATED", P, false));
        assertThat(adapter(t)
                        .createSession(command(SCOPE, Map.of("payment_id", P)))
                        .payload()
                        .hostedUrl())
                .isEqualTo(HOSTED);
    }

    @Test
    void orderStatusMapsToSessionStatus() {
        for (String status :
                List.of("CREATED", "PAYER_ACTION_REQUIRED", "APPROVED", "COMPLETED", "VOIDED", "SAVED", "PENDING_X")) {
            var t = new PayPalTestTransport().token().reply(201, order(status, P, true));
            var result = adapter(t).createSession(command(SCOPE, Map.of("payment_id", P)));
            if (status.equals("SAVED") || status.equals("PENDING_X")) {
                assertThat(result.classification()).isEqualTo(CONTRACT_MISMATCH);
                assertThat(result.payload()).isNull();
            } else {
                assertThat(result.classification()).isEqualTo(SUCCESS);
                var expected = switch (status) {
                    case "CREATED", "PAYER_ACTION_REQUIRED" -> OPEN;
                    case "APPROVED", "COMPLETED" -> COMPLETE;
                    default -> EXPIRED;
                };
                assertThat(result.payload().status()).isEqualTo(expected);
                assertThat(result.payload().paymentStatus()).isEqualTo(status);
            }
        }
    }

    @Test
    void openOrderWithoutSandboxLinkIsContractMismatch() throws Exception {
        for (String link : new String[] {
            null,
            "https://www.paypal.com/checkoutnow?token=" + ID,
            "http://www.sandbox.paypal.com/checkoutnow?token=" + ID
        }) {
            var body = tree(order("CREATED", P, true));
            body.remove("links");
            if (link != null)
                body.putArray("links").addObject().put("rel", "payer-action").put("href", link);
            var result = adapter(new PayPalTestTransport().token().reply(201, body.toString()))
                    .createSession(command(SCOPE, Map.of("payment_id", P)));
            assertThat(result.classification()).isEqualTo(CONTRACT_MISMATCH);
            assertThat(result.evidence().providerErrorCode()).isEqualTo("paypal_contract_mismatch");
        }
    }

    @Test
    void customIdIsRequiredAndReturnedUnchanged() throws Exception {
        var missing = tree(order("CREATED", P, true));
        ((ObjectNode) missing.path("purchase_units").path(0)).remove("custom_id");
        var t = new PayPalTestTransport().token().reply(201, missing.toString());
        var result = adapter(t).createSession(command(SCOPE, Map.of("payment_id", P)));
        assertThat(result.classification()).isEqualTo(CONTRACT_MISMATCH);
        assertThat(result.payload()).isNull();
        String other = new UUID(0, 99).toString();
        var otherResult = adapter(new PayPalTestTransport().token().reply(201, order("CREATED", other, true)))
                .createSession(command(SCOPE, Map.of("payment_id", P)));
        assertThat(otherResult.classification()).isEqualTo(SUCCESS);
        assertThat(otherResult.payload().metadata()).containsExactlyEntriesOf(Map.of("payment_id", other));
    }

    @Test
    void httpStatusesClassifyPerTable() {
        int[] statuses = {400, 422, 401, 403, 404, 409, 429, 500, 503, 302, 204, 200};
        ProviderCallClassification[] expected = {
            DEFINITIVE_REJECT,
            DEFINITIVE_REJECT,
            RETRYABLE_TRANSIENT,
            CAPABILITY_UNAVAILABLE,
            NOT_FOUND,
            RETRYABLE_TRANSIENT,
            RATE_LIMITED,
            RETRYABLE_TRANSIENT,
            RETRYABLE_TRANSIENT,
            CONTRACT_MISMATCH,
            CONTRACT_MISMATCH,
            CONTRACT_MISMATCH
        };
        for (int i = 0; i < statuses.length; i++) {
            int status = statuses[i];
            String body = status == 422
                    ? "{\"name\":\"UNPROCESSABLE_ENTITY\",\"details\":[{\"issue\":\"DUPLICATE_INVOICE_ID\"}]}"
                    : "not json";
            var t = new PayPalTestTransport().token().reply(status, body);
            // A returned 401 is the response after the auth client's one refresh and retry.
            if (status == 401) t.token().reply(401, body);
            var result = adapter(t).createSession(command(SCOPE, Map.of("payment_id", P)));
            assertThat(result.classification()).as("status %s", status).isEqualTo(expected[i]);
            assertThat(result.payload()).isNull();
            assertThat(result.evidence().httpStatus()).isEqualTo(status);
            assertThat(result.evidence().idempotencyKeyUsed()).isEqualTo(KEY);
            if (status == 422) assertThat(result.evidence().providerErrorCode()).isEqualTo("DUPLICATE_INVOICE_ID");
        }
    }

    @Test
    void noResponseIsTimeoutUnknownWithKeyRecorded() {
        var t = new PayPalTestTransport().token().fail(new HttpTimeoutException("x"));
        var result = adapter(t).createSession(command(SCOPE, Map.of("payment_id", P)));
        assertThat(result.classification()).isEqualTo(TIMEOUT_UNKNOWN);
        assertThat(result.evidence().httpStatus()).isNull();
        assertThat(result.evidence().respondedAt()).isNull();
        assertThat(result.evidence().idempotencyKeyUsed()).isEqualTo(KEY);
    }

    @Test
    void tokenFailureIsRetryableAndNothingSent() {
        var t = new PayPalTestTransport().reply(503, "{}");
        var result = adapter(t).createSession(command(SCOPE, Map.of("payment_id", P)));
        assertThat(result.classification()).isEqualTo(RETRYABLE_TRANSIENT);
        assertThat(result.evidence().idempotencyKeyUsed()).isNull();
        assertThat(result.evidence().providerErrorCode()).isEqualTo("TOKEN_UNAVAILABLE");
        assertThat(t.orderCalls()).isEmpty();
    }

    @Test
    void amountsAreExactDecimals() {
        assertThat(PayPalOrderMapping.value(1, "USD")).isEqualTo("0.01");
        assertThat(PayPalOrderMapping.value(10000, "USD")).isEqualTo("100.00");
        assertThat(PayPalOrderMapping.value(123456789, "USD")).isEqualTo("1234567.89");
        assertThat(PayPalOrderMapping.value(500, "JPY")).isEqualTo("500");
        assertThatThrownBy(() -> PayPalOrderMapping.value(1, "XXX")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void otherScopeIsRefusedBeforeSending() {
        var t = new PayPalTestTransport();
        var adapter = adapter(t);
        var other = new ProviderScope(new UUID(0, 1), new UUID(0, 2), new UUID(0, 9), false);
        assertThatThrownBy(() -> adapter.createSession(command(other, Map.of("payment_id", P))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> adapter.querySession(other, ID)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> adapter.expireSession(other, ID)).isInstanceOf(IllegalArgumentException.class);
        assertThat(t.calls()).isEmpty();
    }

    @Test
    void paymentIdMetadataIsRequired() {
        for (var metadata : List.of(Map.<String, String>of(), Map.of("payment_id", "abc"))) {
            var t = new PayPalTestTransport();
            assertThatThrownBy(() -> adapter(t).createSession(command(SCOPE, metadata)))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThat(t.calls()).isEmpty();
        }
    }

    @Test
    void querySessionReadsOrderWithoutRequestId() {
        var t = new PayPalTestTransport().token().reply(200, order("APPROVED", P, false));
        var result = adapter(t).querySession(SCOPE, ID);
        assertThat(t.orderCalls()).hasSize(1);
        var sent = t.orderCalls().getFirst();
        assertThat(sent.method()).isEqualTo("GET");
        assertThat(sent.uri()).isEqualTo(URI.create("https://api-m.sandbox.paypal.com/v2/checkout/orders/" + ID));
        assertThat(sent.headers()).doesNotContainKey("PayPal-Request-Id");
        assertThat(result.classification()).isEqualTo(SUCCESS);
        assertThat(result.payload().status()).isEqualTo(COMPLETE);
        assertThat(result.payload().paymentStatus()).isEqualTo("APPROVED");
        assertThat(result.payload().expiresAt()).isEqualTo(EXPIRY);
        assertThat(result.evidence().idempotencyKeyUsed()).isNull();
    }

    @Test
    void querySessionFailures() throws Exception {
        var missing = tree(order("APPROVED", P, false));
        missing.remove("create_time");
        var result = adapter(new PayPalTestTransport().token().reply(200, missing.toString()))
                .querySession(SCOPE, ID);
        assertThat(result.classification()).isEqualTo(CONTRACT_MISMATCH);
        assertThat(adapter(new PayPalTestTransport().token().reply(404, "{}"))
                        .querySession(SCOPE, ID)
                        .classification())
                .isEqualTo(NOT_FOUND);
        for (String id : List.of("../x", "abc")) {
            var t = new PayPalTestTransport();
            assertThatThrownBy(() -> adapter(t).querySession(SCOPE, id)).isInstanceOf(IllegalArgumentException.class);
            assertThat(t.calls()).isEmpty();
        }
    }

    @Test
    void expireIsUnsupportedWithoutCall() {
        var t = new PayPalTestTransport();
        var result = adapter(t).expireSession(SCOPE, ID);
        assertThat(result.classification()).isEqualTo(CAPABILITY_UNAVAILABLE);
        assertThat(result.evidence().providerErrorCode()).isEqualTo("paypal_order_void_unsupported");
        assertThat(t.calls()).isEmpty();
    }

    @Test
    void noPayerDataInResults() {
        var t = new PayPalTestTransport().token().reply(201, order("PAYER_ACTION_REQUIRED", P, true));
        var result = adapter(t).createSession(command(SCOPE, Map.of("payment_id", P)));
        assertThat(result.toString())
                .doesNotContain("sb-buyer@personal.example.com", "payer", "secret-fixture-do-not-log");
        assertThat(result.evidence().toString())
                .doesNotContain("sb-buyer@personal.example.com", "payer", "secret-fixture-do-not-log");
    }

    @Test
    void checkoutConfiguration() {
        configured().run(c -> {
            assertThat(c).hasNotFailed().hasSingleBean(CheckoutPort.class);
            assertThat(c.getBean(CheckoutPort.class)).isInstanceOf(PayPalCheckoutAdapter.class);
        });
        for (String property : List.of(
                "platform.paypal.organization-id=",
                "platform.stripe.enabled=true",
                "platform.provider.fake.enabled=true")) {
            configured().withPropertyValues(property).run(c -> assertThat(c).hasFailed());
        }
        runner().run(c -> assertThat(c).hasNotFailed().doesNotHaveBean(CheckoutPort.class));
    }

    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner()
                .withUserConfiguration(PayPalAdapterConfiguration.class, PayPalCheckoutConfiguration.class);
    }

    private ApplicationContextRunner configured() {
        return runner().withPropertyValues(
                        "platform.paypal.enabled=true",
                        "platform.paypal.client-id=client-fixture",
                        "platform.paypal.client-secret=secret-fixture-do-not-log",
                        "platform.paypal.organization-id=" + SCOPE.organizationId(),
                        "platform.paypal.environment-id=" + SCOPE.environmentId(),
                        "platform.paypal.provider-account-id=" + SCOPE.providerAccountId());
    }

    private static PayPalCheckoutAdapter adapter(PayPalTestTransport t) {
        return new PayPalCheckoutAdapter(t.client(CLOCK), SCOPE, CLOCK);
    }

    private static CreateCheckoutSessionCommand command(ProviderScope scope, Map<String, String> metadata) {
        return new CreateCheckoutSessionCommand(
                scope,
                KEY,
                10000,
                "USD",
                "https://merchant.test/ok",
                "https://merchant.test/cancel",
                metadata,
                Map.of(),
                EXPIRY);
    }

    private static String order(String status, String paymentId, boolean payerAction) {
        return PayPalTestTransport.order(ID, status, paymentId, payerAction);
    }

    private static ObjectNode tree(String body) throws Exception {
        return (ObjectNode) JSON.readTree(body);
    }
}
