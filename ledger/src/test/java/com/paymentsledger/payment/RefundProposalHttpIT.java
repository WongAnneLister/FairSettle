package com.paymentsledger.payment;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
class RefundProposalHttpIT {
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

    ObjectNode proposalBody() {
        var payment = refundBody(1).path("paymentId").asText();
        var b = json.createObjectNode()
                .put("complaintId", "complaint-missing-drink-001")
                .put("orderRef", "order-001")
                .put("paymentId", payment)
                .put("decision", "PARTIAL_REFUND")
                .put("amountMinor", 60)
                .put("currency", "USD")
                .put("reasonCode", "MISSING_ITEM")
                .put("explanation", "The ordered drink was missing.");
        var lines = b.putArray("liability");
        lines.addObject().put("party", "RESTAURANT").put("basisPoints", 10000);
        lines.addObject().put("party", "DRIVER").put("basisPoints", 0);
        lines.addObject().put("party", "PLATFORM").put("basisPoints", 0);
        b.putArray("evidenceRefs").add("evidence-order-receipt-001");
        b.putObject("agentRun").put("threadId", "refund-thread-001");
        return b;
    }

    ResponseEntity<JsonNode> sendOps(int credential, String path, HttpMethod method, JsonNode body, String key) {
        var headers = new HttpHeaders();
        if (credential > 0) headers.set("Authorization", "OpsBearer ops_" + id(60 + credential) + "." + SECRET);
        if (key != null) headers.set("Idempotency-Key", key);
        if (body != null) headers.setContentType(MediaType.APPLICATION_JSON);
        return http.exchange(path, method, new HttpEntity<>(body, headers), JsonNode.class);
    }

    @Test
    void agentProposesAndReviewerApprovesOverHttp() {
        var b = proposalBody();
        var created = send(1, "/v1/refund-proposals", HttpMethod.POST, b, "refund-proposal:http-1");
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(created.getHeaders().getFirst("X-Request-Id")).isNotBlank();
        String path = created.getHeaders().getLocation().toString();
        assertThat(path)
                .isEqualTo(
                        "/v1/refund-proposals/" + created.getBody().path("id").asText());
        assertThat(fields(created.getBody()))
                .containsExactly(
                        "complaintId",
                        "orderRef",
                        "paymentId",
                        "decision",
                        "amountMinor",
                        "currency",
                        "reasonCode",
                        "liability",
                        "explanation",
                        "evidenceRefs",
                        "agentRun",
                        "id",
                        "status",
                        "createdAt",
                        "reviewedAt",
                        "reviewer",
                        "rejectionReason",
                        "refundId",
                        "allocation");
        for (String field : List.of("reviewedAt", "reviewer", "rejectionReason", "refundId", "allocation"))
            nullField(created.getBody(), field);
        var replay = send(1, "/v1/refund-proposals", HttpMethod.POST, b, "refund-proposal:http-1");
        assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(replay.getHeaders().getFirst("Idempotent-Replay")).isEqualTo("true");
        var get = send(1, path, HttpMethod.GET, null, null);
        assertThat(get.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(get.getBody().path("id")).isEqualTo(created.getBody().path("id"));
        String refundable = "/v1/payments/" + b.path("paymentId").asText() + "/refundable";
        var amount = send(1, refundable, HttpMethod.GET, null, null);
        assertThat(amount.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(amount.getBody().path("refundableMinor").asLong()).isEqualTo(100);
        var page = sendOps(1, "/ops/refund-proposals", HttpMethod.GET, null, null);
        assertThat(page.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(page.getBody().path("items").size()).isEqualTo(1);
        assertThat(page.getBody().path("items").get(0).path("id"))
                .isEqualTo(created.getBody().path("id"));
        nullField(page.getBody(), "nextCursor");
        var decision = sendOps(
                2,
                "/ops/refund-proposals/" + created.getBody().path("id").asText() + "/decision",
                HttpMethod.POST,
                json.createObjectNode().put("action", "APPROVE"),
                "approve-http-1");
        assertThat(decision.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(decision.getBody().path("status").asText()).isEqualTo("APPROVED");
        assertThat(decision.getBody().path("refundId").asText()).startsWith("ref_");
        nullField(decision.getBody(), "rejectionReason");
        assertThat(fields(decision.getBody().path("allocation")))
                .containsExactly(
                        "refundId", "proposalId", "currency", "amountMinor", "lines", "postingStatus", "journalId");
        nullField(decision.getBody().path("allocation"), "journalId");
        var again = sendOps(
                2,
                "/ops/refund-proposals/" + created.getBody().path("id").asText() + "/decision",
                HttpMethod.POST,
                json.createObjectNode().put("action", "APPROVE"),
                "approve-http-2");
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(again.getHeaders().getFirst("Idempotent-Replay")).isEqualTo("true");
        assertThat(again.getBody()).isEqualTo(decision.getBody());
        var refund =
                send(1, "/v1/refunds/" + decision.getBody().path("refundId").asText(), HttpMethod.GET, null, null);
        assertThat(refund.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(refund.getBody().path("refundStatus").asText()).isEqualTo("RESERVED");
        var after = send(1, refundable, HttpMethod.GET, null, null);
        assertThat(after.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(after.getBody().path("reservedMinor").asLong()).isEqualTo(60);
        assertThat(after.getBody().path("refundableMinor").asLong()).isEqualTo(40);
    }

    @Test
    void errorsOverHttp() {
        var b = proposalBody();
        assertError(
                send(1, "/v1/refund-proposals", HttpMethod.POST, b, null),
                HttpStatus.BAD_REQUEST,
                "IDEMPOTENCY_KEY_REQUIRED");
        var invalid = b.deepCopy();
        for (var line : invalid.path("liability")) ((ObjectNode) line).put("basisPoints", 3333);
        assertError(
                send(1, "/v1/refund-proposals", HttpMethod.POST, invalid, "refund-proposal:split"),
                HttpStatus.UNPROCESSABLE_ENTITY,
                "LIABILITY_SPLIT_INVALID");
        var currency = send(
                1,
                "/v1/refund-proposals",
                HttpMethod.POST,
                b.deepCopy().put("currency", "JPY"),
                "refund-proposal:currency");
        assertError(currency, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR");
        assertThat(currency.getBody().path("details").get(0).path("field").asText())
                .isEqualTo("currency");
        assertError(
                send(4, "/v1/refund-proposals", HttpMethod.POST, b, "refund-proposal:scope"),
                HttpStatus.FORBIDDEN,
                "FORBIDDEN");
        var created = send(1, "/v1/refund-proposals", HttpMethod.POST, b, "refund-proposal:http-2");
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        String proposal = created.getBody().path("id").asText();
        String path = "/ops/refund-proposals/" + proposal + "/decision";
        var duplicate = send(1, "/v1/refund-proposals", HttpMethod.POST, b, "refund-proposal:other");
        assertError(duplicate, HttpStatus.CONFLICT, "PROPOSAL_EXISTS");
        assertThat(duplicate.getBody().path("details").get(0).path("field").asText())
                .isEqualTo("complaintId");
        assertThat(duplicate.getBody().path("details").get(0).path("issue").asText())
                .isEqualTo(proposal);
        assertError(
                send(2, "/v1/refund-proposals/" + proposal, HttpMethod.GET, null, null),
                HttpStatus.NOT_FOUND,
                "NOT_FOUND");
        var approve = json.createObjectNode().put("action", "APPROVE");
        assertError(sendOps(1, path, HttpMethod.POST, approve, "approve-viewer"), HttpStatus.FORBIDDEN, "FORBIDDEN");
        assertError(
                sendOps(2, path, HttpMethod.POST, json.createObjectNode().put("action", "REJECT"), "reject-no-reason"),
                HttpStatus.BAD_REQUEST,
                "VALIDATION_ERROR");
        var rejected = sendOps(
                2,
                path,
                HttpMethod.POST,
                json.createObjectNode().put("action", "REJECT").put("reason", "Photo shows the drink"),
                "reject-http-2");
        assertThat(rejected.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertError(
                sendOps(2, path, HttpMethod.POST, approve, "approve-rejected"),
                HttpStatus.CONFLICT,
                "PROPOSAL_NOT_PENDING");
        assertError(
                sendOps(
                        2,
                        "/ops/refund-proposals/" + PaymentIds.format("prop", UUID.randomUUID()) + "/decision",
                        HttpMethod.POST,
                        approve,
                        "approve-unknown"),
                HttpStatus.NOT_FOUND,
                "NOT_FOUND");
        assertError(
                sendOps(0, path, HttpMethod.POST, approve, "approve-no-auth"), HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }

    private List<String> fields(JsonNode body) {
        var names = new ArrayList<String>();
        body.fieldNames().forEachRemaining(names::add);
        return names;
    }

    private void nullField(JsonNode body, String field) {
        assertThat(body.has(field)).as(field + " is required").isTrue();
        assertThat(body.get(field).isNull()).as(field + " is null").isTrue();
    }

    private void assertError(ResponseEntity<JsonNode> response, HttpStatus status, String code) {
        assertThat(response.getStatusCode()).isEqualTo(status);
        assertThat(response.getBody().path("code").asText()).isEqualTo(code);
    }
}
