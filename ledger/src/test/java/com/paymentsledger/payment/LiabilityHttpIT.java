package com.paymentsledger.payment;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.liability.LiabilityService;
import com.paymentsledger.liability.LiabilitySplit;
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
class LiabilityHttpIT {
    @Container
    static final PostgreSQLContainer<?> DB =
            new PostgreSQLContainer<>("postgres:16").withInitScript("db/pr02-runtime-role.sql");

    static final String SECRET = "b".repeat(43), HASH = new BCryptPasswordEncoder(10).encode(SECRET);
    static final Path FAKE_PATH = directory();

    static Path directory() {
        try {
            return Files.createTempDirectory("pr11-http-fake-");
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
        r.add("platform.provider.fake.seed", () -> 72);
        r.add("platform.provider.fake.initial-time", () -> Instant.now().toString());
        r.add("platform.provider.fake.retention", () -> "P1D");
    }

    @Autowired
    TestRestTemplate http;

    @Autowired
    ObjectMapper json;

    @Autowired
    OperationRecoveryCoordinator recovery;

    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    com.paymentsledger.provider.fake.FakeStripeProvider fake;

    @Autowired
    LiabilityService liability;

    JdbcTemplate admin;
    String paymentId;

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
                    ? "ARRAY['payments:write','refunds:write']"
                    : "ARRAY['payments:read','payments:write','refunds:read','refunds:write']";
            admin.update("""
                    INSERT INTO platform.application_credential(id,key_id,organization_id,environment_id,application_id,
                        provider_account_id,secret_hash,not_before,expires_at,granted_scopes)
                    VALUES (?,'http',?,?,?,?,?,now()-interval '1 day',now()+interval '1 day',""" + scopes + ")", id(40 + app), id(org), id(10 + org), id(30 + app), id(20 + org), HASH);
            admin.update("""
                    INSERT INTO platform.credential_currency(credential_id,organization_id,environment_id,currency)
                    VALUES (?,?,?,'USD'),(?,?,?,'JPY')""", id(40 + app), id(org), id(10 + org), id(40 + app), id(org), id(10 + org));
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
        if (paymentId == null) {
            var created = send(app, "/v1/payments", HttpMethod.POST, body("refund-payment"), "payment-key");
            assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            paymentId = created.getBody().path("id").asText();
            admin.update("""
                    UPDATE platform.payment
                    SET captured_amount_minor=100,payment_status='SUCCEEDED',latest_charge_id='ch_http_refund'
                    WHERE id=?""", PaymentIds.payment(paymentId));
        }
        return json.createObjectNode()
                .put("paymentId", paymentId)
                .put("amountMinor", 60)
                .put("currency", "USD")
                .put("clientRefundKey", "merchant-refund");
    }

    String refund(int app, String key, long amount) {
        var request = refundBody(app).put("amountMinor", amount).put("clientRefundKey", key);
        var response = send(app, "/v1/refunds", HttpMethod.POST, request, key);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(response.getBody().path("refundStatus").asText()).isEqualTo("RESERVED");
        return response.getBody().path("id").asText();
    }

    @Test
    void getReturnsTheStoredAllocation() throws Exception {
        String refund = refund(1, "liability-http-01", 60);
        liability.record(PaymentIds.parse("ref", refund), new UUID(9, 1), new LiabilitySplit(3333, 3333, 3334));
        var response = send(1, "/v1/refunds/" + refund + "/liability", HttpMethod.GET, null, null);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getFirst("X-Request-Id")).isNotBlank();
        var resource = response.getBody();
        assertThat(resource.path("refundId").asText()).isEqualTo(refund);
        assertThat(resource.path("proposalId").asText()).isEqualTo(PaymentIds.format("prop", new UUID(9, 1)));
        assertThat(resource.path("currency").asText()).isEqualTo("USD");
        assertThat(resource.path("amountMinor").asLong()).isEqualTo(60);
        assertThat(resource.path("lines")).isEqualTo(json.readTree("""
                [{"party":"RESTAURANT","basisPoints":3333,"amountMinor":19},
                 {"party":"DRIVER","basisPoints":3333,"amountMinor":19},
                 {"party":"PLATFORM","basisPoints":3334,"amountMinor":22}]
                """));
        assertThat(resource.path("postingStatus").asText()).isEqualTo("PENDING");
        assertThat(resource.path("journalId").isNull()).isTrue();
    }

    @Test
    void getIsScopedAndAuthenticated() {
        String refund = refund(1, "liability-http-02", 60);
        liability.record(PaymentIds.parse("ref", refund), new UUID(9, 1), new LiabilitySplit(3333, 3333, 3334));
        String path = "/v1/refunds/" + refund + "/liability";
        for (int app : List.of(2, 3))
            assertError(send(app, path, HttpMethod.GET, null, null), HttpStatus.NOT_FOUND, "NOT_FOUND");
        assertError(send(4, path, HttpMethod.GET, null, null), HttpStatus.FORBIDDEN, "FORBIDDEN");
        assertError(send(0, path, HttpMethod.GET, null, null), HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }

    @Test
    void getRejectsUnknownAndMalformedIds() {
        String refund = refund(1, "liability-http-03", 60);
        liability.record(PaymentIds.parse("ref", refund), new UUID(9, 1), new LiabilitySplit(3333, 3333, 3334));
        String unallocated = refund(1, "liability-http-03b", 30);
        assertError(
                send(1, "/v1/refunds/" + unallocated + "/liability", HttpMethod.GET, null, null),
                HttpStatus.NOT_FOUND,
                "NOT_FOUND");
        assertError(
                send(1, "/v1/refunds/ref_bad/liability", HttpMethod.GET, null, null),
                HttpStatus.BAD_REQUEST,
                "VALIDATION_ERROR");
    }

    private void assertError(ResponseEntity<JsonNode> response, HttpStatus status, String code) {
        assertThat(response.getStatusCode()).isEqualTo(status);
        assertThat(response.getBody().path("code").asText()).isEqualTo(code);
    }
}
