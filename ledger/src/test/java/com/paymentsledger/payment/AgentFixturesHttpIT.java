package com.paymentsledger.payment;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.io.IOException;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

@Testcontainers
@ActiveProfiles({"api", "test"})
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AgentFixturesHttpIT {
    @Container
    static final PostgreSQLContainer<?> DB =
            new PostgreSQLContainer<>("postgres:16").withInitScript("db/pr02-runtime-role.sql");

    static final String SECRET = "b".repeat(43), HASH = new BCryptPasswordEncoder(10).encode(SECRET);
    static final Path FAKE_PATH = directory();

    static Path directory() {
        try {
            return Files.createTempDirectory("f19-agent-fixtures-");
        } catch (Exception e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", DB::getJdbcUrl);
        r.add("spring.datasource.username", () -> "payments_app");
        r.add("spring.datasource.password", () -> "pr02_test_only");
        r.add("spring.flyway.url", DB::getJdbcUrl);
        r.add("spring.flyway.user", DB::getUsername);
        r.add("spring.flyway.password", DB::getPassword);
        r.add("platform.provider.fake.enabled", () -> true);
        r.add("platform.provider.fake.directory", FAKE_PATH::toString);
        r.add("platform.provider.fake.seed", () -> 73);
        r.add("platform.provider.fake.initial-time", () -> Instant.now().toString());
        r.add("platform.provider.fake.retention", () -> "P1D");
    }

    @Autowired
    TestRestTemplate http;

    @Autowired
    ObjectMapper json;

    JdbcTemplate admin;

    static UUID id(int value) {
        return new UUID(1, value);
    }

    @BeforeEach
    void seed() {
        admin = new JdbcTemplate(new DriverManagerDataSource(DB.getJdbcUrl(), DB.getUsername(), DB.getPassword()));
        admin.execute("TRUNCATE platform.organization,platform.currency_config CASCADE");
        admin.update("""
                INSERT INTO platform.currency_config(code,minor_unit_exponent)
                VALUES ('USD',2),('JPY',0)""");
        for (int org : List.of(1, 2)) {
            admin.update("INSERT INTO platform.organization(id,code) VALUES (?,?)", id(org), "org-" + org);
            admin.update("""
                    INSERT INTO platform.environment_config(id,organization_id,code,livemode)
                    VALUES (?,?,'test',false)""", id(10 + org), id(org));
            admin.update("""
                    INSERT INTO platform.provider_account(id,organization_id,environment_id,provider,
                        provider_account_ref,livemode)
                    VALUES (?,?,?,'FAKE',?,false)""", id(20 + org), id(org), id(10 + org), "http-fixture-" + org);
            admin.update("""
                    INSERT INTO platform.org_currency_enabled(organization_id,environment_id,currency)
                    VALUES (?,?,'USD'),(?,?,'JPY')""", id(org), id(10 + org), id(org), id(10 + org));
            admin.update("""
                    INSERT INTO platform.share_policy_fixture(id,organization_id,environment_id,product_ref,
                        policy_version,partner_ref,share_basis_points)
                    VALUES (?,?,?,'demo',1,'partner',1000)""", id(70 + org), id(org), id(10 + org));
            admin.update("""
                    INSERT INTO platform.price_fixture(id,organization_id,environment_id,product_ref,price_version,
                        currency,amount_minor,share_policy_id)
                    VALUES (?,?,?,'demo',1,'USD',100,?)""", id(80 + org), id(org), id(10 + org), id(70 + org));
        }
        for (int app : List.of(1, 2, 3, 4)) {
            int org = app == 2 ? 2 : 1;
            admin.update("""
                    INSERT INTO platform.application(id,organization_id,environment_id,code)
                    VALUES (?,?,?,?)""", id(30 + app), id(org), id(10 + org), "app-" + app);
            String scopes = app == 4
                    ? "ARRAY['payments:read','refund-proposals:read']"
                    : "ARRAY['payments:read','payments:write','refunds:read','refunds:write','refund-proposals:read','refund-proposals:write']";
            admin.update("""
                    INSERT INTO platform.application_credential(id,key_id,organization_id,environment_id,application_id,
                        provider_account_id,secret_hash,not_before,expires_at,granted_scopes)
                    VALUES (?,'http',?,?,?,?,?,now()-interval '1 day',now()+interval '1 day',""" + scopes + ")", id(40 + app), id(org), id(10 + org), id(30 + app), id(20 + org), HASH);
            admin.update("""
                    INSERT INTO platform.credential_currency(credential_id,organization_id,environment_id,currency)
                    VALUES (?,?,?,'USD'),(?,?,?,'JPY')""", id(40 + app), id(org), id(10 + org), id(40 + app), id(org), id(10 + org));
        }
        for (int n : List.of(1, 2)) {
            admin.update(
                    "INSERT INTO platform.ops_identity(id,organization_id,subject,role) VALUES (?,?,?,?)",
                    id(50 + n),
                    id(1),
                    n == 1 ? "viewer" : "reviewer",
                    n == 1 ? "OPS_VIEWER" : "OPS_REVIEWER");
            admin.update(
                    "INSERT INTO platform.ops_credential(id,ops_identity_id,organization_id,environment_id,key_id,secret_hash,not_before,expires_at) VALUES (?,?,?,?,'ops',?,now()-interval '1 day',now()+interval '1 day')",
                    id(60 + n),
                    id(50 + n),
                    id(1),
                    id(11),
                    HASH);
        }
    }

    ObjectNode body(String order) {
        return json.createObjectNode()
                .put("orderKey", order)
                .put("productRef", "demo")
                .put("priceVersion", 1)
                .put("amountMinor", 100)
                .put("currency", "USD")
                .put("successUrl", "https://merchant.test/payment-test.html")
                .put("cancelUrl", "https://merchant.test/payment-test.html");
    }

    ResponseEntity<JsonNode> send(int app, String path, HttpMethod method, JsonNode body, String key) {
        HttpHeaders headers = new HttpHeaders();
        if (app != 0) headers.setBearerAuth("app_" + id(40 + app) + "." + SECRET);
        if (key != null) headers.set("Idempotency-Key", key);
        if (body != null) headers.setContentType(MediaType.APPLICATION_JSON);
        return http.exchange(path, method, new HttpEntity<>(body, headers), JsonNode.class);
    }

    ObjectNode refundBody(int app) {
        var created = send(app, "/v1/payments", HttpMethod.POST, body("refund-payment"), "payment-key");
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        String payment = created.getBody().path("id").asText();
        admin.update("""
                UPDATE platform.payment
                SET captured_amount_minor=100,payment_status='SUCCEEDED',latest_charge_id='ch_http_refund'
                WHERE id=?""", PaymentIds.payment(payment));
        return json.createObjectNode()
                .put("paymentId", payment)
                .put("amountMinor", 60)
                .put("currency", "USD")
                .put("clientRefundKey", "merchant-refund");
    }

    @Test
    void recordsPaymentAndRefundableAmounts() throws IOException {
        var refund = refundBody(1);
        String paymentPath = "/v1/payments/" + refund.path("paymentId").asText();
        var payment = send(1, paymentPath, HttpMethod.GET, null, null);
        assertThat(payment.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(payment.getBody().path("amountMinor").asLong()).isEqualTo(100);
        assertThat(payment.getBody().path("capturedAmountMinor").asLong()).isEqualTo(100);
        assertThat(payment.getBody().path("paymentStatus").asText()).isEqualTo("SUCCEEDED");
        fixture("ledger-payment-captured", paymentPath, payment);

        String refundablePath = paymentPath + "/refundable";
        var full = send(1, refundablePath, HttpMethod.GET, null, null);
        assertThat(full.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(full.getBody().path("capturedMinor").asLong()).isEqualTo(100);
        assertThat(full.getBody().path("refundedMinor").asLong()).isZero();
        assertThat(full.getBody().path("reservedMinor").asLong()).isZero();
        assertThat(full.getBody().path("refundableMinor").asLong()).isEqualTo(100);
        assertThat(full.getBody().path("controlState").asText()).isEqualTo("NORMAL");
        fixture("ledger-refundable-full", refundablePath, full);

        var reservation = send(1, "/v1/refunds", HttpMethod.POST, refund, "agent-fixture-refund");
        assertThat(reservation.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(reservation.getBody().path("refundStatus").asText()).isEqualTo("RESERVED");
        var partial = send(1, refundablePath, HttpMethod.GET, null, null);
        assertThat(partial.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(partial.getBody().path("reservedMinor").asLong()).isEqualTo(60);
        assertThat(partial.getBody().path("refundableMinor").asLong()).isEqualTo(40);
        fixture("ledger-refundable-partial", refundablePath, partial);
    }

    @Test
    void recordsErrors() throws IOException {
        var refund = refundBody(1);
        String path = "/v1/payments/" + refund.path("paymentId").asText();
        var notFound = send(3, path, HttpMethod.GET, null, null);
        assertThat(notFound.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(notFound.getBody().path("code").asText()).isEqualTo("NOT_FOUND");
        fixture("ledger-payment-not-found", path, notFound);
        var unauthorized = send(0, path, HttpMethod.GET, null, null);
        assertThat(unauthorized.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(unauthorized.getBody().path("code").asText()).isEqualTo("UNAUTHORIZED");
        fixture("ledger-unauthorized", path, unauthorized);
    }

    private void fixture(String name, String path, ResponseEntity<JsonNode> response) throws IOException {
        var live = json.createObjectNode()
                .put("name", name)
                .put("source", "ledger/src/test/java/com/paymentsledger/payment/AgentFixturesHttpIT.java");
        live.putObject("request")
                .put("method", "GET")
                .put("path", path)
                .putNull("operationName")
                .putNull("variables");
        live.putObject("response")
                .put("status", response.getStatusCode().value())
                .set("body", response.getBody());
        Path directory = Path.of("..", "contracts", "fixtures", "agent");
        Path file = directory.resolve(name + ".json");
        if ("1".equals(System.getenv("RECORD_AGENT_FIXTURES"))) {
            Files.createDirectories(directory);
            Files.writeString(file, json.writerWithDefaultPrettyPrinter().writeValueAsString(live) + "\n");
        } else {
            var committed = json.readTree(Files.readString(file));
            assertThat(live.at("/request/method")).isEqualTo(committed.at("/request/method"));
            assertThat(live.at("/request/operationName")).isEqualTo(committed.at("/request/operationName"));
            assertThat(shape(live.at("/request/variables"))).isEqualTo(shape(committed.at("/request/variables")));
            assertThat(live.at("/response/status")).isEqualTo(committed.at("/response/status"));
            assertThat(shape(live.at("/response/body"))).isEqualTo(shape(committed.at("/response/body")));
        }
    }

    private static JsonNode shape(JsonNode node) {
        var factory = JsonNodeFactory.instance;
        if (node.isObject()) {
            var result = factory.objectNode();
            var keys = new ArrayList<String>();
            node.fieldNames().forEachRemaining(keys::add);
            Collections.sort(keys);
            for (String key : keys) result.set(key, shape(node.get(key)));
            return result;
        }
        if (node.isArray()) {
            var result = factory.arrayNode();
            for (var item : node) result.add(shape(item));
            return result;
        }
        if (node.isNull()) return TextNode.valueOf("null");
        if (node.isBoolean()) return TextNode.valueOf("boolean");
        if (node.isTextual()) return TextNode.valueOf("string");
        return TextNode.valueOf(node.isIntegralNumber() ? "integer" : "float");
    }
}
