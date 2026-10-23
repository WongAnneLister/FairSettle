package com.paymentsledger.provider.adapter.paypal;

import static com.paymentsledger.provider.ProviderCallClassification.*;
import static com.paymentsledger.provider.adapter.paypal.PayPalTestTransport.*;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.*;
import com.paymentsledger.financialingestion.*;
import com.paymentsledger.ledger.LedgerPostingService;
import com.paymentsledger.payment.CaptureSettlementConfiguration;
import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.*;
import java.net.URI;
import java.net.http.HttpTimeoutException;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.PlatformTransactionManager;

class PayPalCaptureTest {
    static final String ORDER = "7CV2269518094610C", CAPTURE = "41995584GM234064G";
    static final String P = "00000000-0000-0000-0000-0000000000bb";
    static final String KEY = "pay_capture_00000000-0000-0000-0000-0000000000cc";
    static final ProviderScope SCOPE = new ProviderScope(new UUID(0, 1), new UUID(0, 2), new UUID(0, 4), false);
    static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-22T09:00:00Z"), ZoneOffset.UTC);
    static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void capturePostsWithOperationKey() {
        var t = new PayPalTestTransport().token().reply(201, captureResponse(ORDER, CAPTURE));
        var result = adapter(t).captureOrder(command());
        assertThat(t.orderCalls()).hasSize(1);
        var sent = t.orderCalls().getFirst();
        assertThat(sent.method()).isEqualTo("POST");
        assertThat(sent.uri())
                .isEqualTo(URI.create("https://api-m.sandbox.paypal.com/v2/checkout/orders/" + ORDER + "/capture"));
        assertThat(sent.headers())
                .containsEntry("PayPal-Request-Id", KEY)
                .containsEntry("Prefer", "return=representation");
        assertThat(sent.body()).isEqualTo("{}");
        assertThat(result.classification()).isEqualTo(SUCCESS);
        assertThat(result.payload()).isEqualTo(new CaptureOrderFact(ORDER, "COMPLETED", List.of(CAPTURE)));
        assertThat(result.evidence().idempotencyKeyUsed()).isEqualTo(KEY);
        assertThat(result.evidence().httpStatus()).isEqualTo(201);
        assertThat(result.evidence().apiVersion()).isEqualTo("paypal-orders-v2");
        assertThat(result.evidence().rawDigest()).matches("[a-f0-9]{64}");
    }

    @Test
    void captureReplayWithSameRequestIdIsSameCapture() {
        var body = captureResponse(ORDER, CAPTURE);
        var t = new PayPalTestTransport().token().reply(201, body).reply(200, body);
        var adapter = adapter(t);
        var first = adapter.captureOrder(command());
        var second = adapter.captureOrder(command());
        assertThat(first.classification()).isEqualTo(SUCCESS);
        assertThat(second.classification()).isEqualTo(SUCCESS);
        assertThat(first.payload().captureIds()).containsExactly(CAPTURE);
        assertThat(second.payload().captureIds()).containsExactly(CAPTURE);
        assertThat(t.orderCalls()).hasSize(2);
        assertThat(t.orderCalls().getFirst()).isEqualTo(t.orderCalls().get(1));
        assertThat(t.orderCalls().getFirst().headers()).containsEntry("PayPal-Request-Id", KEY);
    }

    @Test
    void captureStatusesClassifyPerTable() throws Exception {
        int[] statuses = {422, 422, 422, 422, 400, 401, 403, 404, 409, 429, 500, 200, 200};
        String[] codes = {
            "ORDER_NOT_APPROVED",
            "INSTRUMENT_DECLINED",
            "ORDER_ALREADY_CAPTURED",
            "OTHER_ISSUE",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "paypal_contract_mismatch",
            "paypal_contract_mismatch"
        };
        ProviderCallClassification[] expected = {
            DEFINITIVE_REJECT,
            DEFINITIVE_REJECT,
            TIMEOUT_UNKNOWN,
            CONTRACT_MISMATCH,
            DEFINITIVE_REJECT,
            RETRYABLE_TRANSIENT,
            CAPABILITY_UNAVAILABLE,
            NOT_FOUND,
            RETRYABLE_TRANSIENT,
            RATE_LIMITED,
            RETRYABLE_TRANSIENT,
            CONTRACT_MISMATCH,
            CONTRACT_MISMATCH
        };
        for (int i = 0; i < statuses.length; i++) {
            String body = codes[i] == null ? "{}" : "{\"details\":[{\"issue\":\"" + codes[i] + "\"}]}";
            if (i == 0) body = Files.readString(Path.of("../docs/adr/paypal-samples/03-capture-before-approval.json"));
            if (i == 2)
                body = Files.readString(Path.of("../docs/adr/paypal-samples/07-capture-again-new-request-id.json"));
            if (i == 11) body = captureResponse("OTHERORDER1", CAPTURE);
            if (i == 12) body = "not json";
            var t = new PayPalTestTransport().token().reply(statuses[i], body);
            if (statuses[i] == 401) t.token().reply(401, body);
            var result = adapter(t).captureOrder(command());
            assertThat(result.classification()).as("case %s", i).isEqualTo(expected[i]);
            assertThat(result.payload()).isNull();
            assertThat(result.evidence().httpStatus()).isEqualTo(statuses[i]);
            assertThat(result.evidence().idempotencyKeyUsed()).isEqualTo(KEY);
            assertThat(result.evidence().providerErrorCode()).isEqualTo(codes[i]);
        }
    }

    @Test
    void captureTimeoutIsUnknownWithKey() {
        var result = adapter(new PayPalTestTransport().token().fail(new HttpTimeoutException("x")))
                .captureOrder(command());
        assertThat(result.classification()).isEqualTo(TIMEOUT_UNKNOWN);
        assertThat(result.evidence().httpStatus()).isNull();
        assertThat(result.evidence().respondedAt()).isNull();
        assertThat(result.evidence().idempotencyKeyUsed()).isEqualTo(KEY);
    }

    @Test
    void captureTokenFailureSendsNothing() {
        var t = new PayPalTestTransport().reply(503, "{}");
        var result = adapter(t).captureOrder(command());
        assertThat(result.classification()).isEqualTo(RETRYABLE_TRANSIENT);
        assertThat(result.evidence().idempotencyKeyUsed()).isNull();
        assertThat(result.evidence().providerErrorCode()).isEqualTo("TOKEN_UNAVAILABLE");
        assertThat(t.orderCalls()).isEmpty();
    }

    @Test
    void otherScopeAndBadOrderIdAreRefused() {
        var t = new PayPalTestTransport();
        var adapter = adapter(t);
        var other = new ProviderScope(new UUID(0, 1), new UUID(0, 2), new UUID(0, 9), false);
        assertThatThrownBy(() -> adapter.captureOrder(new CaptureOrderCommand(other, KEY, ORDER)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> adapter.captureOrder(new CaptureOrderCommand(SCOPE, KEY, "../x")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> adapter.queryOrder(other, ORDER)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> adapter.queryOrder(SCOPE, "../x")).isInstanceOf(IllegalArgumentException.class);
        assertThat(t.calls()).isEmpty();
    }

    @Test
    void queryApprovedOrderHasNoCaptures() {
        var t = new PayPalTestTransport().token().reply(200, order(ORDER, "APPROVED", P, false));
        var result = adapter(t).queryOrder(SCOPE, ORDER);
        assertThat(t.orderCalls()).hasSize(1);
        assertThat(t.orderCalls().getFirst().method()).isEqualTo("GET");
        assertThat(t.orderCalls().getFirst().uri())
                .isEqualTo(URI.create("https://api-m.sandbox.paypal.com/v2/checkout/orders/" + ORDER));
        assertThat(t.orderCalls().getFirst().headers()).doesNotContainKey("PayPal-Request-Id");
        assertThat(result.classification()).isEqualTo(SUCCESS);
        var fact = result.payload();
        assertThat(fact.session().status()).isEqualTo(CheckoutSessionStatus.COMPLETE);
        assertThat(fact.session().paymentStatus()).isEqualTo("APPROVED");
        assertThat(fact.session().metadata()).containsExactlyEntriesOf(Map.of("payment_id", P));
        assertThat(fact.amountMinor()).isEqualTo(10000);
        assertThat(fact.currency()).isEqualTo("USD");
        assertThat(fact.captures()).isEmpty();
        assertThat(fact.settlements()).isEmpty();
        assertThat(result.evidence().idempotencyKeyUsed()).isNull();
    }

    @Test
    void queryCompletedOrderMapsCaptureAndSettlement() {
        var result = query(capturedOrder(ORDER, P, CAPTURE, "COMPLETED", true));
        assertThat(result.classification()).isEqualTo(SUCCESS);
        var fact = result.payload();
        assertThat(fact.captures())
                .containsExactly(new ChargeFact(
                        CAPTURE,
                        ORDER,
                        "succeeded",
                        true,
                        10000,
                        10000L,
                        "USD",
                        CAPTURE,
                        null,
                        "COMPLETED",
                        Instant.parse("2026-10-22T09:05:08Z")));
        assertThat(fact.settlements()).hasSize(1);
        var bt = fact.settlements().getFirst();
        assertThat(bt.btId()).isEqualTo(CAPTURE);
        assertThat(bt.type()).isEqualTo("charge");
        assertThat(bt.amountMinor()).isEqualTo(10000);
        assertThat(bt.feeMinor()).isEqualTo(349);
        assertThat(bt.netMinor()).isEqualTo(9651);
        assertThat(bt.currency()).isEqualTo("USD");
        assertThat(bt.balanceDomain()).isEqualTo("PAYMENTS");
        assertThat(bt.sourceObjectId()).isEqualTo(CAPTURE);
        assertThat(bt.sourceObjectType()).isEqualTo("charge");
        assertThat(bt.status()).isEqualTo("available");
        assertThat(bt.createdAt()).isEqualTo(Instant.parse("2026-10-22T09:05:08Z"));
        assertThat(bt.availableOn()).isNull();
        assertThat(bt.feeDetails()).containsExactly(new FeeDetail(349, "USD", "paypal_fee", null));
        assertThat(bt.rawDigest()).matches("[a-f0-9]{64}");
    }

    @Test
    void captureStatusesNormalize() {
        for (String status : List.of("PENDING", "DECLINED", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED", "UNKNOWN_X")) {
            var result = query(capturedOrder(ORDER, P, CAPTURE, status, true));
            if (status.equals("UNKNOWN_X")) {
                assertThat(result.classification()).isEqualTo(CONTRACT_MISMATCH);
                continue;
            }
            assertThat(result.classification()).isEqualTo(SUCCESS);
            var capture = result.payload().captures().getFirst();
            boolean captured = status.equals("PARTIALLY_REFUNDED") || status.equals("REFUNDED");
            assertThat(capture.status())
                    .isEqualTo(captured ? "succeeded" : status.equals("PENDING") ? "pending" : "failed");
            assertThat(capture.captured()).isEqualTo(captured);
            assertThat(capture.amountCapturedMinor()).isEqualTo(captured ? 10000L : null);
            assertThat(capture.balanceTransactionId()).isNull();
            assertThat(capture.outcomeType()).isEqualTo(status);
            assertThat(capture.failureCode()).isEqualTo(status.equals("PENDING") ? "PENDING_REVIEW" : null);
            assertThat(result.payload().settlements()).isEmpty();
        }
    }

    @Test
    void completedWithoutBreakdownHasNoSettlement() {
        var result = query(capturedOrder(ORDER, P, CAPTURE, "COMPLETED", false));
        assertThat(result.classification()).isEqualTo(SUCCESS);
        assertThat(result.payload().captures().getFirst().status()).isEqualTo("succeeded");
        assertThat(result.payload().captures().getFirst().balanceTransactionId())
                .isNull();
        assertThat(result.payload().settlements()).isEmpty();
    }

    @Test
    void inconsistentBreakdownIsContractMismatch() throws Exception {
        List<Consumer<ObjectNode>> edits = List.of(
                c -> amount(c, "net_amount").put("value", "96.50"),
                c -> {
                    amount(c, "gross_amount").put("value", "99.00");
                    amount(c, "net_amount").put("value", "95.51");
                },
                c -> amount(c, "paypal_fee").put("currency_code", "EUR"),
                c -> amount(c, "paypal_fee").put("value", "3.491"),
                c -> c.remove("create_time"));
        for (var edit : edits) {
            var body = (ObjectNode) JSON.readTree(capturedOrder(ORDER, P, CAPTURE, "COMPLETED", true));
            edit.accept(capture(body));
            var result = query(body.toString());
            assertThat(result.classification()).isEqualTo(CONTRACT_MISMATCH);
            assertThat(result.evidence().providerErrorCode()).isEqualTo("paypal_contract_mismatch");
        }
    }

    @Test
    void orderShapeMismatches() throws Exception {
        List<Consumer<ObjectNode>> edits = List.of(
                o -> ((ArrayNode) o.path("purchase_units"))
                        .add(o.path("purchase_units").path(0).deepCopy()),
                o -> ((ArrayNode) o.path("purchase_units")
                                .path(0)
                                .path("payments")
                                .path("captures"))
                        .add(capture(o).deepCopy()),
                o -> ((ObjectNode) capture(o).path("amount")).put("value", "100.001"),
                o -> capture(o).remove("id"),
                o -> ((ObjectNode) o.path("purchase_units").path(0).path("amount")).put("value", "abc"));
        for (var edit : edits) {
            var body = (ObjectNode) JSON.readTree(capturedOrder(ORDER, P, CAPTURE, "COMPLETED", true));
            edit.accept(body);
            assertThat(query(body.toString()).classification()).isEqualTo(CONTRACT_MISMATCH);
        }
    }

    @Test
    void noPayerDataInOrderResults() {
        var result = query(capturedOrder(ORDER, P, CAPTURE, "COMPLETED", true));
        assertThat(result.toString())
                .doesNotContain("sb-buyer@personal.example.com", "payer", "secret-fixture-do-not-log");
        assertThat(result.evidence().toString())
                .doesNotContain("sb-buyer@personal.example.com", "payer", "secret-fixture-do-not-log");
    }

    @Test
    void minorUnitsAreExact() {
        assertThat(PayPalOrderMapping.minor("100.00", "USD")).contains(10000L);
        assertThat(PayPalOrderMapping.minor("0.01", "USD")).contains(1L);
        assertThat(PayPalOrderMapping.minor("1.5", "USD")).contains(150L);
        assertThat(PayPalOrderMapping.minor("500", "JPY")).contains(500L);
        for (String value : new String[] {"3.491", "-1.00", "1e3", null, "92233720368547758.08"})
            assertThat(PayPalOrderMapping.minor(value, "USD")).isEmpty();
        assertThat(PayPalOrderMapping.minor("1.00", "XXX")).isEmpty();
    }

    @Test
    void orderCapturePortIsTheCheckoutBean() {
        new ApplicationContextRunner()
                .withUserConfiguration(PayPalAdapterConfiguration.class, PayPalCheckoutConfiguration.class)
                .withPropertyValues(
                        "platform.paypal.enabled=true",
                        "platform.paypal.client-id=client-fixture",
                        "platform.paypal.client-secret=secret-fixture-do-not-log",
                        "platform.paypal.organization-id=" + SCOPE.organizationId(),
                        "platform.paypal.environment-id=" + SCOPE.environmentId(),
                        "platform.paypal.provider-account-id=" + SCOPE.providerAccountId())
                .run(c -> {
                    assertThat(c).hasNotFailed();
                    assertThat(c.getBean(OrderCapturePort.class)).isSameAs(c.getBean(CheckoutPort.class));
                });
    }

    @Test
    void settlementConfiguration() {
        var runner = new ApplicationContextRunner()
                .withUserConfiguration(CaptureSettlementConfiguration.class)
                .withBean(JdbcTemplate.class, () -> new JdbcTemplate(new DriverManagerDataSource()))
                .withBean(
                        PlatformTransactionManager.class,
                        () -> new DataSourceTransactionManager(new DriverManagerDataSource()))
                .withBean(ObjectMapper.class, ObjectMapper::new)
                .withBean(Clock.class, () -> CLOCK)
                .withBean(
                        LedgerPostingService.class,
                        () -> new LedgerPostingService(new JdbcTemplate(new DriverManagerDataSource()), JSON));
        runner.withPropertyValues("platform.paypal.enabled=true")
                .run(c -> assertThat(c)
                        .hasNotFailed()
                        .hasSingleBean(CaptureSettlementService.class)
                        .doesNotHaveBean(FinancialReplayService.class));
        runner.run(c -> assertThat(c).hasNotFailed().doesNotHaveBean(CaptureSettlementService.class));
    }

    private static CaptureOrderCommand command() {
        return new CaptureOrderCommand(SCOPE, KEY, ORDER);
    }

    private static PayPalCheckoutAdapter adapter(PayPalTestTransport t) {
        return new PayPalCheckoutAdapter(t.client(CLOCK), SCOPE, CLOCK);
    }

    private static ProviderCallResult<OrderFact> query(String body) {
        return adapter(new PayPalTestTransport().token().reply(200, body)).queryOrder(SCOPE, ORDER);
    }

    private static ObjectNode capture(ObjectNode o) {
        return (ObjectNode) o.path("purchase_units")
                .path(0)
                .path("payments")
                .path("captures")
                .path(0);
    }

    private static ObjectNode amount(ObjectNode c, String name) {
        return (ObjectNode) c.path("seller_receivable_breakdown").path(name);
    }
}
