package com.paymentsledger.payment;

import static com.paymentsledger.provider.adapter.paypal.PayPalTestTransport.*;
import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.financialingestion.CaptureSettlementService;
import com.paymentsledger.provider.*;
import com.paymentsledger.provider.adapter.paypal.*;
import com.paymentsledger.provider.adapter.stripe.StripeCheckoutAdapter;
import com.paymentsledger.webhook.*;
import java.nio.file.*;
import java.time.Clock;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.ApplicationContext;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.convention.TestBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

@Testcontainers
@ActiveProfiles({"api", "local"})
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PayPalSandboxFlowIT {
    @Container
    static final PostgreSQLContainer<?> DB =
            new PostgreSQLContainer<>("postgres:16").withInitScript("db/pr02-runtime-role.sql");

    static final PayPalTestTransport TRANSPORT = new PayPalTestTransport();
    static final String ORDER = "7CV2269518094610C", CAPTURE = "41995584GM234064G", REFUND = "2EU12368F9867740A";
    static final String APP_SECRET = "f".repeat(43), OPS_SECRET = "g".repeat(43);
    static final Map<String, String> HEADERS = PayPalWebhookIT.H;

    @TestBean(name = "payPalAuthClient")
    PayPalAuthClient payPalAuthClient;

    static PayPalAuthClient payPalAuthClient() {
        return TRANSPORT.client(Clock.systemUTC());
    }

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", DB::getJdbcUrl);
        r.add("spring.datasource.username", () -> "payments_app");
        r.add("spring.datasource.password", () -> "pr02_test_only");
        r.add("spring.flyway.url", DB::getJdbcUrl);
        r.add("spring.flyway.user", DB::getUsername);
        r.add("spring.flyway.password", DB::getPassword);
        r.add("platform.fixtures.enabled", () -> true);
        r.add("platform.fixtures.app-secret", () -> APP_SECRET);
        r.add("platform.fixtures.ops-secret", () -> OPS_SECRET);
        r.add("platform.paypal.enabled", () -> true);
        r.add("platform.paypal.client-id", () -> "client-fixture");
        r.add("platform.paypal.client-secret", () -> "secret-fixture-do-not-log");
        r.add("platform.paypal.organization-id", () -> id(1).toString());
        r.add("platform.paypal.environment-id", () -> id(11).toString());
        r.add("platform.paypal.provider-account-id", () -> id(21).toString());
        r.add("platform.paypal.webhook-id", () -> "WH0F12FIXTURE");
        r.add("platform.webhooks.paypal.enabled", () -> true);
    }

    @Autowired
    TestRestTemplate http;

    @Autowired
    ObjectMapper json;

    @Autowired
    RefundExecutor refunds;

    @Autowired
    WebhookProcessor processor;

    @Autowired
    ApplicationContext context;

    JdbcTemplate admin;

    @BeforeEach
    void database() {
        admin = new JdbcTemplate(new DriverManagerDataSource(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword()));
    }

    @AfterEach
    void reportCallsOnFailure() {
        // Fixture credentials only; keep authorization headers and request bodies out of diagnostics.
        System.out.println("F12 TRANSPORT.calls(): "
                + TRANSPORT.calls().stream()
                        .map(call -> call.method() + " " + call.uri().getPath())
                        .toList());
    }

    static UUID id(int n) {
        return UUID.fromString("10000000-0000-0000-0000-" + "%012d".formatted(n));
    }

    ResponseEntity<JsonNode> app(HttpMethod method, String path, JsonNode body, String key) {
        var headers = new HttpHeaders();
        headers.setBearerAuth("app_" + id(41) + "." + APP_SECRET);
        if (body != null) headers.setContentType(MediaType.APPLICATION_JSON);
        if (key != null) headers.set("Idempotency-Key", key);
        return http.exchange(path, method, new HttpEntity<>(body, headers), JsonNode.class);
    }

    ResponseEntity<JsonNode> ops(String path) {
        var headers = new HttpHeaders();
        headers.set(HttpHeaders.AUTHORIZATION, "OpsBearer ops_" + id(61) + "." + OPS_SECRET);
        return http.exchange(path, HttpMethod.GET, new HttpEntity<>(headers), JsonNode.class);
    }

    ResponseEntity<JsonNode> webhook(ObjectNode event) throws Exception {
        var headers = new HttpHeaders();
        HEADERS.forEach(headers::set);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return http.exchange(
                "/webhooks/paypal",
                HttpMethod.POST,
                new HttpEntity<>(json.writeValueAsBytes(event), headers),
                JsonNode.class);
    }

    ObjectNode captureEvent(String eventId, String paymentId) throws Exception {
        var event = (ObjectNode)
                json.readTree(Files.readAllBytes(Path.of("src/test/resources/paypal/webhook-capture-completed.json")));
        event.put("id", eventId);
        ((ObjectNode) event.path("resource")).put("custom_id", paymentId).put("update_time", "2026-10-22T09:05:08Z");
        return event;
    }

    ObjectNode refundEvent(String eventId, String refundId) throws Exception {
        var event = (ObjectNode)
                json.readTree(Files.readAllBytes(Path.of("src/test/resources/paypal/webhook-refund-completed.json")));
        event.put("id", eventId);
        var resource = (ObjectNode) event.path("resource");
        resource.put("id", REFUND)
                .put("custom_id", refundId)
                .put("create_time", "2026-10-22T10:00:00Z")
                .put("update_time", "2026-10-22T10:00:00Z");
        ((ObjectNode) resource.path("amount")).put("value", "25.00");
        var breakdown = resource.path("seller_payable_breakdown");
        ((ObjectNode) breakdown.path("gross_amount")).put("value", "25.00");
        ((ObjectNode) breakdown.path("paypal_fee")).put("value", "0.87");
        ((ObjectNode) breakdown.path("net_amount")).put("value", "24.13");
        return event;
    }

    long count(String sql, Object... args) {
        return admin.queryForObject(sql, Long.class, args);
    }

    Map<String, Long> balances() {
        var response = ops("/ops/balances?currency=USD");
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Long> balances = new HashMap<>();
        for (var item : response.getBody().path("items")) {
            assertThat(item.path("rebuildMatches").asBoolean()).isTrue();
            balances.put(
                    item.path("accountPurpose").asText(),
                    item.path("balanceMinor").asLong());
        }
        return balances;
    }

    @Test
    void contextSelectsPayPalEverywhere() {
        var checkout = context.getBean(CheckoutPort.class);
        assertThat(checkout).isInstanceOf(PayPalCheckoutAdapter.class);
        assertThat(context.getBean(OrderCapturePort.class)).isSameAs(checkout);
        assertThat(context.getBean(RefundPort.class)).isInstanceOf(PayPalRefundAdapter.class);
        assertThat(context.getBeansOfType(CaptureSettlementService.class)).hasSize(1);
        assertThat(context.getBean(PayPalWebhookEndpoint.class)).isNotNull();
        assertThat(refunds.providerName()).isEqualTo("PAYPAL");
        assertThat(context.getBeansOfType(StripeCheckoutAdapter.class)).isEmpty();
        assertThat(admin.queryForMap(
                        "SELECT provider,provider_account_ref FROM platform.provider_account WHERE id=?", id(21)))
                .containsEntry("provider", "PAYPAL")
                .containsEntry("provider_account_ref", "client-fixture");
    }

    @Test
    void createApproveCaptureRefundAndWebhooksPostOnce() throws Exception {
        TRANSPORT.token().reply(201, order(ORDER, "PAYER_ACTION_REQUIRED", "$CUSTOM_ID", true));
        var body = json.createObjectNode()
                .put("orderKey", "f12-20261024120000")
                .put("productRef", "demo-product")
                .put("priceVersion", 1)
                .put("amountMinor", 10000)
                .put("currency", "USD")
                .put("successUrl", "https://example.com/f12/return")
                .put("cancelUrl", "https://example.com/f12/cancel");
        var created = app(HttpMethod.POST, "/v1/payments", body, "f12-it-pay-0001");
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(created.getBody().path("nextAction").path("type").asText()).isEqualTo("REDIRECT_TO_HOSTED_CHECKOUT");
        assertThat(created.getBody().path("nextAction").path("hostedUrl").asText())
                .isEqualTo("https://www.sandbox.paypal.com/checkoutnow?token=" + ORDER);
        String paymentId = created.getBody().path("id").asText();

        TRANSPORT
                .reply(
                        200,
                        order(ORDER, "APPROVED", PaymentIds.payment(paymentId).toString(), false))
                .reply(201, captureResponse(ORDER, CAPTURE))
                .reply(200, capturedOrder(ORDER, PaymentIds.payment(paymentId).toString(), CAPTURE, "COMPLETED", true));
        var paid = app(HttpMethod.GET, "/v1/payments/" + paymentId, null, null);
        assertThat(paid.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(paid.getBody().path("paymentStatus").asText()).isEqualTo("SUCCEEDED");
        assertThat(paid.getBody().path("financialStatus").asText()).isEqualTo("POSTED");
        assertThat(paid.getBody().path("provider").path("latestChargeId").asText())
                .isEqualTo(CAPTURE);
        var captures = TRANSPORT.calls().stream()
                .filter(c -> c.uri().getPath().endsWith("/capture"))
                .toList();
        assertThat(captures).hasSize(1);
        assertThat(captures.getFirst().headers()).containsKey("PayPal-Request-Id");

        var refundBody = json.createObjectNode()
                .put("paymentId", paymentId)
                .put("amountMinor", 2500)
                .put("currency", "USD")
                .put("reason", "REQUESTED_BY_CUSTOMER");
        var reserved = app(HttpMethod.POST, "/v1/refunds", refundBody, "f12-it-refund-0001");
        assertThat(reserved.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        String refundId = reserved.getBody().path("id").asText();
        TRANSPORT.reply(
                201,
                refund(
                        REFUND,
                        CAPTURE,
                        "COMPLETED",
                        "25.00",
                        "0.87",
                        PaymentIds.parse("ref", refundId).toString()));
        UUID operation = admin.queryForObject(
                "SELECT id FROM platform.provider_operation WHERE operation_type='CREATE_REFUND' AND refund_id=?",
                UUID.class,
                PaymentIds.parse("ref", refundId));
        refunds.execute(operation);
        var refunded = app(HttpMethod.GET, "/v1/refunds/" + refundId, null, null);
        assertThat(refunded.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(refunded.getBody().path("refundStatus").asText()).isEqualTo("SUCCEEDED");
        assertThat(refunded.getBody().path("financialStatus").asText()).isEqualTo("POSTED");
        assertThat(refunded.getBody().path("providerRefundId").asText()).isEqualTo(REFUND);
        assertThat(TRANSPORT.calls().stream()
                        .filter(c -> c.uri().getPath().equals("/v2/payments/captures/" + CAPTURE + "/refund"))
                        .toList())
                .hasSize(1);

        long journals = count("SELECT count(*) FROM platform.journal");
        var paymentBefore = admin.queryForMap(
                "SELECT payment_status,provider_status,resolution_status,financial_status,captured_amount_minor,latest_charge_id FROM platform.payment WHERE id=?",
                PaymentIds.payment(paymentId));
        var refundBefore = admin.queryForMap(
                "SELECT refund_status,resolution_status,provider_status,provider_refund_id,provider_charge_id,balance_transaction_id,amount_minor FROM platform.refund WHERE id=?",
                PaymentIds.parse("ref", refundId));
        var controlBefore = admin.queryForMap(
                "SELECT captured_minor,refunded_minor,reserved_minor,control_state FROM platform.refund_control WHERE payment_id=?",
                PaymentIds.payment(paymentId));
        TRANSPORT
                .reply(200, "{\"verification_status\":\"SUCCESS\"}")
                .reply(200, "{\"verification_status\":\"SUCCESS\"}");
        var captureEvent =
                captureEvent("WH-F12-CAP-1", PaymentIds.payment(paymentId).toString());
        for (var event : List.of(
                captureEvent,
                refundEvent("WH-F12-REF-1", PaymentIds.parse("ref", refundId).toString()))) {
            var received = webhook(event);
            assertThat(received.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(received.getBody().path("received").asBoolean()).isTrue();
            assertThat(received.getBody().path("duplicate").asBoolean()).isFalse();
        }
        assertThat(TRANSPORT.calls().stream()
                        .filter(c -> c.uri().getPath().equals("/v1/notifications/verify-webhook-signature"))
                        .toList())
                .hasSize(2);
        assertThat(processor.processDue(10)).isEqualTo(2);
        assertThat(admin.queryForList(
                        "SELECT status FROM platform.webhook_inbox WHERE event_id IN ('WH-F12-CAP-1','WH-F12-REF-1')",
                        String.class))
                .containsExactlyInAnyOrder("DONE", "DONE");
        assertThat(admin.queryForMap(
                        "SELECT payment_status,provider_status,resolution_status,financial_status,captured_amount_minor,latest_charge_id FROM platform.payment WHERE id=?",
                        PaymentIds.payment(paymentId)))
                .isEqualTo(paymentBefore);
        assertThat(admin.queryForMap(
                        "SELECT refund_status,resolution_status,provider_status,provider_refund_id,provider_charge_id,balance_transaction_id,amount_minor FROM platform.refund WHERE id=?",
                        PaymentIds.parse("ref", refundId)))
                .isEqualTo(refundBefore);
        assertThat(admin.queryForMap(
                        "SELECT captured_minor,refunded_minor,reserved_minor,control_state FROM platform.refund_control WHERE payment_id=?",
                        PaymentIds.payment(paymentId)))
                .isEqualTo(controlBefore);
        assertThat(count("SELECT count(*) FROM platform.journal")).isEqualTo(journals);
        var bts =
                admin.queryForList("SELECT * FROM platform.balance_transaction WHERE bt_id IN (?,?)", CAPTURE, REFUND);
        assertThat(bts).hasSize(2);
        for (var bt : bts) {
            assertThat(bt).containsEntry("state", "POSTED");
            assertThat(bt.get("journal_id")).isNotNull();
            boolean capture = CAPTURE.equals(bt.get("bt_id"));
            assertThat(bt)
                    .containsEntry("amount_minor", capture ? 10000L : -2500L)
                    .containsEntry("fee_minor", capture ? 349L : -87L)
                    .containsEntry("net_minor", capture ? 9651L : -2413L);
        }
        assertThat(count("""
                SELECT count(*) FROM platform.journal_entry e JOIN platform.ledger_account a
                ON a.id=e.ledger_account_id WHERE a.account_purpose='PSP_FUNDS' AND a.provider_account_id=?
                """, id(21))).isEqualTo(2);
        var balances = balances();
        assertThat(balances)
                .containsExactlyInAnyOrderEntriesOf(Map.of(
                        "PSP_FUNDS",
                        7238L,
                        "PSP_FEE_EXPENSE",
                        262L,
                        "SALES_REVENUE",
                        -10000L,
                        "SALES_RETURNS",
                        2500L,
                        "PARTNER_SHARE_EXPENSE",
                        1125L,
                        "PARTNER_PAYABLE",
                        -1125L,
                        "SUSPENSE",
                        0L));
        assertThat(balances.values().stream().mapToLong(Long::longValue).sum()).isZero();
        TRANSPORT.reply(200, "{\"verification_status\":\"SUCCESS\"}");
        var redelivered = webhook(captureEvent);
        assertThat(redelivered.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(redelivered.getBody().path("duplicate").asBoolean()).isTrue();
        assertThat(processor.processDue(10)).isZero();
        assertThat(count("SELECT count(*) FROM platform.journal")).isEqualTo(journals);
    }
}
