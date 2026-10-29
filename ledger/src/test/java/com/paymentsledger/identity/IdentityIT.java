package com.paymentsledger.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
@ActiveProfiles("api")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class IdentityIT {
    @Container
    static final PostgreSQLContainer<?> DB = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("pr02_isolated_identity")
            .withInitScript("db/pr02-runtime-role.sql");

    static final String SECRET = "a".repeat(43);
    static final String HASH = new BCryptPasswordEncoder(10).encode(SECRET);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", DB::getJdbcUrl);
        r.add("spring.datasource.username", () -> "payments_app");
        r.add("spring.datasource.password", () -> "pr02_test_only");
        r.add("spring.flyway.url", DB::getJdbcUrl);
        r.add("spring.flyway.user", DB::getUsername);
        r.add("spring.flyway.password", DB::getPassword);
    }

    @Autowired
    JdbcTemplate runtimeJdbc;

    JdbcTemplate jdbc;

    @Autowired
    TestRestTemplate http;

    PlatformTransactionManager transactions;

    @Autowired
    org.flywaydb.core.Flyway flyway;

    @Autowired
    CredentialTokens tokens;

    @Autowired
    IdentityRepository repository;

    static UUID id(int n) {
        return UUID.fromString("00000000-0000-0000-0000-" + "%012d".formatted(n));
    }

    void write(Runnable work) {
        new TransactionTemplate(transactions).executeWithoutResult(s -> work.run());
    }

    ResponseEntity<String> get(String path, String auth) {
        HttpHeaders h = new HttpHeaders();
        if (auth != null) h.set(HttpHeaders.AUTHORIZATION, auth);
        return http.exchange(path, HttpMethod.GET, new HttpEntity<>(h), String.class);
    }

    String appToken(int credential) {
        return "Bearer app_" + id(credential) + "." + SECRET;
    }

    @BeforeEach
    void seed() {
        var source = new org.springframework.jdbc.datasource.DriverManagerDataSource(
                DB.getJdbcUrl(), DB.getUsername(), DB.getPassword());
        jdbc = new JdbcTemplate(source);
        transactions = new org.springframework.jdbc.datasource.DataSourceTransactionManager(source);
        write(() -> {
            jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE");
            jdbc.update("""
                    INSERT INTO platform.currency_config(code,minor_unit_exponent)
                    VALUES ('USD',2),('JPY',0)""");
            for (int n : new int[] {1, 2}) {
                jdbc.update("INSERT INTO platform.organization(id,code) VALUES (?,?)", id(n), "org" + n);
                jdbc.update("""
                        INSERT INTO platform.environment_config(id,organization_id,code,livemode)
                        VALUES (?,?,'test',false)""", id(10 + n), id(n));
                jdbc.update("""
                        INSERT INTO platform.provider_account(id,organization_id,environment_id,provider,
                            provider_account_ref,livemode)
                        VALUES (?,?,?,'FAKE',?,false)""", id(20 + n), id(n), id(10 + n), "fixture_account_" + n);
                jdbc.update("""
                        INSERT INTO platform.org_currency_enabled(organization_id,environment_id,currency)
                        VALUES (?,?,'USD'),(?,?,'JPY')""", id(n), id(10 + n), id(n), id(10 + n));
            }
            for (int n : new int[] {1, 2, 3}) {
                int org = n == 2 ? 2 : 1;
                jdbc.update("""
                        INSERT INTO platform.application(id,organization_id,environment_id,code)
                        VALUES (?,?,?,?)""", id(30 + n), id(org), id(10 + org), "app" + n);
                jdbc.update("""
                        INSERT INTO platform.application_credential(id,key_id,organization_id,environment_id,application_id,
                            provider_account_id,secret_hash,not_before,expires_at,granted_scopes)
                        VALUES (?,?,?,?,?,?,?,now()-interval '1 day',now()+interval '1 day',ARRAY['payments:read'])""", id(40 + n), "key" + n, id(org), id(10 + org), id(30 + n), id(20 + org), HASH);
                jdbc.update("""
                        INSERT INTO platform.credential_currency(credential_id,organization_id,environment_id,currency)
                        VALUES (?,?,?,'USD')""", id(40 + n), id(org), id(10 + org));
            }
            jdbc.update("""
                    INSERT INTO platform.ops_identity(id,organization_id,subject,role)
                    VALUES (?,?,'viewer','OPS_VIEWER')""", id(51), id(1));
            jdbc.update("""
                    INSERT INTO platform.ops_credential(id,ops_identity_id,organization_id,environment_id,key_id,
                        secret_hash,not_before,expires_at)
                    VALUES (?,?,?,?,'ops-key',?,now()-interval '1 day',now()+interval '1 day')""", id(61), id(51), id(1), id(11), HASH);
            jdbc.update("""
                    INSERT INTO platform.share_policy_fixture(id,organization_id,environment_id,product_ref,
                        policy_version,partner_ref,share_basis_points)
                    VALUES (?, ?, ?, 'demo',1,'fixture_partner',1500)""", id(71), id(1), id(11));
            jdbc.update("""
                    INSERT INTO platform.price_fixture(id,organization_id,environment_id,product_ref,price_version,
                        currency,amount_minor,share_policy_id)
                    VALUES (?,?,?,'demo',1,'USD',10000,?)""", id(81), id(1), id(11), id(71));
        });
    }

    @Test
    void authenticatesFromStoredBindingAndHidesSecrets() {
        var response = get("/v1/identity", appToken(41));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody())
                .contains(id(1).toString(), id(31).toString(), id(21).toString(), "USD", "payments:read")
                .doesNotContain(SECRET, HASH);
        assertThat(response.getHeaders().getFirst("X-Request-Id")).isNotBlank();
    }

    @Test
    void rejectsAbsentMalformedWrongAndUnknownCredentials() {
        for (String auth : new String[] {
            null, "Bearer garbage", appToken(41) + "x", appToken(99), "OpsBearer app_" + id(41) + "." + SECRET
        }) {
            var response = get("/v1/identity", auth);
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
            assertThat(response.getBody()).contains("UNAUTHORIZED", "requestId").doesNotContain(SECRET);
        }
    }

    @Test
    void validityRevocationAndParentStateAreCheckedEveryRequest() {
        for (String mutation : new String[] {
            "UPDATE platform.application_credential SET expires_at=now()-interval '1 hour'",
            "UPDATE platform.application_credential SET not_before=now()+interval '1 hour'",
            "UPDATE platform.application_credential SET status='REVOKED'",
            "UPDATE platform.application SET status='DISABLED'",
            "UPDATE platform.organization SET status='DISABLED'",
            "UPDATE platform.environment_config SET status='DISABLED'",
            "UPDATE platform.provider_account SET status='DISABLED'",
            "UPDATE platform.org_currency_enabled SET status='DISABLED'"
        }) {
            seed();
            write(() -> jdbc.update(mutation));
            assertThat(get("/v1/identity", appToken(41)).getStatusCode())
                    .as(mutation)
                    .isEqualTo(HttpStatus.UNAUTHORIZED);
        }
    }

    @Test
    void foreignOrganizationAndSiblingApplicationAreNotEnumerable() {
        assertThat(get("/v1/applications/" + id(31), appToken(41)).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        for (int resource : new int[] {32, 33, 999})
            assertThat(get("/v1/applications/" + id(resource), appToken(41)).getStatusCode())
                    .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(get("/v1/prices/" + id(81), appToken(42)).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void rejectsForgedQueryAndHeadersButAcceptsMatchingAssertions() {
        for (String field : new String[] {
            "organization_id", "organizationId", "X-Organization-Id", "provider_account_id", "account_id", "livemode"
        }) {
            String value = field.equals("livemode") ? "true" : id(2).toString();
            HttpHeaders h = new HttpHeaders();
            h.setBearerAuth("app_" + id(41) + "." + SECRET);
            h.set(field, value);
            assertThat(http.exchange("/v1/identity", HttpMethod.GET, new HttpEntity<>(h), String.class)
                            .getStatusCode())
                    .as(field)
                    .isEqualTo(HttpStatus.FORBIDDEN);
        }
        assertThat(get("/v1/identity?organization_id=" + id(2), appToken(41)).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(get("/v1/identity?organization_id=" + id(1), appToken(41)).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    void separatesOpsAndApplicationCredentials() {
        String ops = "OpsBearer ops_" + id(61) + "." + SECRET;
        assertThat(get("/ops/identity", ops).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(get("/ops/identity", appToken(41)).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(get("/v1/identity", ops).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(get("/ops/identity?organization_id=" + id(2), ops).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void controlledPriceRequiresPermissionAndEnabledCurrency() {
        var price = get("/v1/prices/" + id(81), appToken(41));
        assertThat(price.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(price.getBody()).contains("10000", "USD", "1500");
        write(() -> jdbc.update("UPDATE platform.application_credential SET granted_scopes=ARRAY[]::text[]"));
        assertThat(get("/v1/prices/" + id(81), appToken(41)).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void databaseRejectsCrossScopeWritesAndInvalidConfiguration() {
        for (String sql : new String[] {
            "UPDATE platform.application SET organization_id='" + id(2) + "' WHERE id='" + id(31) + "'",
            "UPDATE platform.application_credential SET provider_account_id='" + id(22) + "' WHERE id='" + id(41) + "'",
            "UPDATE platform.provider_account SET livemode=true",
            """
            UPDATE platform.provider_account
            SET provider_account_ref='fixture_account_1'
            WHERE id='""" + id(22) + "'",
            "UPDATE platform.price_fixture SET amount_minor=-1",
            "UPDATE platform.price_fixture SET currency='EUR'",
            "UPDATE platform.currency_config SET minor_unit_exponent=1 WHERE code='JPY'",
            "UPDATE platform.currency_config SET minor_unit_exponent=5",
            "UPDATE platform.share_policy_fixture SET share_basis_points=10001",
            "UPDATE platform.application_credential SET granted_scopes=ARRAY['ops:approve']"
        })
            assertThatThrownBy(() -> write(() -> jdbc.update(sql)))
                    .as(sql)
                    .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void healthIsPublicAndWebhookIsNotFalselyAcknowledged() {
        assertThat(get("/actuator/health", null).getStatusCode()).isEqualTo(HttpStatus.OK);
        var headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        assertThat(http.postForEntity("/webhooks/stripe", new HttpEntity<>("{}", headers), String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    }

    @Test
    void refusesLiveDatabaseOnStartupCheck() {
        write(() -> jdbc.update("""
                INSERT INTO platform.environment_config(organization_id,code,livemode)
                VALUES (?,'live',true)""", id(1)));
        assertThatThrownBy(repository::assertTestOnly).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void localFixturesAreExplicitHashedAndIdempotent() throws Exception {
        write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        var env = new org.springframework.mock.env.MockEnvironment()
                .withProperty("platform.fixtures.app-secret", SECRET)
                .withProperty("platform.fixtures.ops-secret", "b".repeat(43));
        env.setActiveProfiles("local");
        var initializer = new LocalFixtureInitializer(flyway, tokens, java.time.Clock.systemUTC(), env);
        initializer.afterPropertiesSet();
        initializer.afterPropertiesSet();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM platform.organization", Integer.class))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT secret_hash FROM platform.application_credential", String.class))
                .startsWith("$2")
                .doesNotContain(SECRET);
        assertThat(get("/v1/identity", "Bearer app_" + LocalFixtureInitializer.APP_CREDENTIAL + "." + SECRET)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        env.setProperty("platform.fixtures.app-secret", "c".repeat(43));
        assertThatThrownBy(initializer::afterPropertiesSet).isInstanceOf(IllegalStateException.class);
        env.setActiveProfiles("api");
        assertThatThrownBy(initializer::afterPropertiesSet).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void jpyFixtureAndCurrencyPermissionAreIndependent() {
        write(() -> {
            jdbc.update("""
                    INSERT INTO platform.share_policy_fixture(id,organization_id,environment_id,product_ref,
                        policy_version,partner_ref,share_basis_points)
                    VALUES (?,?,?,'jpy-demo',1,'fixture_partner',0)""", id(72), id(2), id(12));
            jdbc.update("""
                    INSERT INTO platform.price_fixture(id,organization_id,environment_id,product_ref,price_version,
                        currency,amount_minor,share_policy_id)
                    VALUES (?,?,?,'jpy-demo',1,'JPY',100,?)""", id(82), id(2), id(12), id(72));
        });
        assertThat(get("/v1/prices/" + id(82), appToken(42)).getStatusCode())
                .isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
        write(() -> jdbc.update("""
                INSERT INTO platform.credential_currency(credential_id,organization_id,environment_id,currency)
                VALUES (?,?,?,'JPY')""", id(42), id(2), id(12)));
        assertThat(get("/v1/prices/" + id(82), appToken(42)).getBody())
                .contains("\"minorUnitExponent\":0", "\"amountMinor\":100");
    }

    @Test
    void runtimeRoleCannotRewriteOrCreateConfiguration() {
        assertThat(runtimeJdbc.queryForObject("SELECT current_user", String.class))
                .isEqualTo("payments_app");
        for (String sql : new String[] {
            """
            UPDATE platform.application_credential
            SET granted_scopes=ARRAY['payments:write']""", "DELETE FROM platform.organization", "INSERT INTO platform.organization(code) VALUES ('injected')"
        })
            assertThatThrownBy(() -> runtimeJdbc.update(sql))
                    .isInstanceOf(org.springframework.dao.DataAccessException.class);
    }

    @Test
    void malformedResourceIdIsClientError() {
        assertThat(get("/v1/applications/not-a-uuid", appToken(41)).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(get("/v1/prices/not-a-uuid", appToken(41)).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    private static UUID fixtureId(int n) {
        return UUID.fromString("10000000-0000-0000-0000-" + "%012d".formatted(n));
    }

    private org.springframework.mock.env.MockEnvironment fixtureEnvironment(boolean paypal) {
        var env = new org.springframework.mock.env.MockEnvironment()
                .withProperty("platform.fixtures.app-secret", SECRET)
                .withProperty("platform.fixtures.ops-secret", "b".repeat(43));
        env.setActiveProfiles("local");
        if (paypal) {
            env.withProperty("platform.paypal.enabled", "true")
                    .withProperty("platform.paypal.client-id", "client-fixture")
                    .withProperty(
                            "platform.paypal.organization-id", fixtureId(1).toString())
                    .withProperty(
                            "platform.paypal.environment-id", fixtureId(11).toString())
                    .withProperty(
                            "platform.paypal.provider-account-id", fixtureId(21).toString());
        }
        return env;
    }

    private LocalFixtureInitializer initializer(org.springframework.mock.env.MockEnvironment env) {
        return new LocalFixtureInitializer(flyway, tokens, java.time.Clock.systemUTC(), env);
    }

    private java.util.Map<String, Object> fixtureProvider() {
        return jdbc.queryForMap(
                "SELECT provider,provider_account_ref,livemode FROM platform.provider_account WHERE id=?",
                fixtureId(21));
    }

    @Test
    void paypalFixturesProvisionAccountPolicyAndLedgerAccounts() {
        write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        var initializer = initializer(fixtureEnvironment(true));
        initializer.afterPropertiesSet();
        assertThat(fixtureProvider())
                .containsEntry("provider", "PAYPAL")
                .containsEntry("provider_account_ref", "client-fixture")
                .containsEntry("livemode", false);
        var policies = jdbc.queryForList(
                "SELECT organization_id,environment_id,provider_account_id,livemode,opening_mode,business_zone FROM platform.ingestion_policy");
        assertThat(policies)
                .containsExactly(java.util.Map.of(
                        "organization_id",
                        fixtureId(1),
                        "environment_id",
                        fixtureId(11),
                        "provider_account_id",
                        fixtureId(21),
                        "livemode",
                        false,
                        "opening_mode",
                        "ZERO",
                        "business_zone",
                        "UTC"));
        var accounts = jdbc.queryForList(
                "SELECT currency,account_purpose,source_domain,provider_account_id,balance_domain FROM platform.ledger_account ORDER BY account_purpose");
        assertThat(accounts).hasSize(7);
        assertThat(accounts)
                .extracting(row -> row.get("account_purpose"))
                .containsExactly(
                        "PARTNER_PAYABLE",
                        "PARTNER_SHARE_EXPENSE",
                        "PSP_FEE_EXPENSE",
                        "PSP_FUNDS",
                        "SALES_RETURNS",
                        "SALES_REVENUE",
                        "SUSPENSE");
        for (var row : accounts) {
            boolean provider =
                    java.util.Set.of("PSP_FUNDS", "PSP_FEE_EXPENSE", "SUSPENSE").contains(row.get("account_purpose"));
            assertThat(row)
                    .containsEntry("currency", "USD")
                    .containsEntry("source_domain", provider ? "PROVIDER" : "INTERNAL")
                    .containsEntry("provider_account_id", provider ? fixtureId(21) : null)
                    .containsEntry("balance_domain", provider ? "PAYMENTS" : null);
        }
        initializer.afterPropertiesSet();
        assertThat(
                        jdbc.queryForList(
                                "SELECT organization_id,environment_id,provider_account_id,livemode,opening_mode,business_zone FROM platform.ingestion_policy"))
                .isEqualTo(policies);
        assertThat(
                        jdbc.queryForList(
                                "SELECT currency,account_purpose,source_domain,provider_account_id,balance_domain FROM platform.ledger_account ORDER BY account_purpose"))
                .isEqualTo(accounts);
    }

    @Test
    void paypalFixturesRequireClientId() {
        write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        var env = fixtureEnvironment(true);
        ((org.springframework.mock.env.MockPropertySource)
                        env.getPropertySources().get("mockProperties"))
                .getSource()
                .remove("platform.paypal.client-id");
        var initializer = initializer(env);
        assertThatThrownBy(initializer::afterPropertiesSet)
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("PayPal fixtures require PAYPAL_CLIENT_ID");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM platform.organization", Long.class))
                .isZero();
    }

    @Test
    void paypalFixturesRequireFixtureScope() {
        write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        var env = fixtureEnvironment(true)
                .withProperty(
                        "platform.paypal.provider-account-id", fixtureId(99).toString());
        var initializer = initializer(env);
        assertThatThrownBy(initializer::afterPropertiesSet)
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("PayPal fixtures require the local fixture scope ids");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM platform.organization", Long.class))
                .isZero();
    }

    @Test
    void existingFixtureProviderMustMatchMode() {
        write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        for (boolean paypal : new boolean[] {false, true}) {
            initializer(fixtureEnvironment(paypal)).afterPropertiesSet();
            var before = fixtureProvider();
            var other = initializer(fixtureEnvironment(!paypal));
            assertThatThrownBy(other::afterPropertiesSet)
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("Existing fixture provider differs; recreate the local database");
            assertThat(fixtureProvider()).isEqualTo(before);
            write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        }
    }

    @Test
    void fakeFixturesUnchanged() {
        write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        initializer(fixtureEnvironment(false)).afterPropertiesSet();
        assertThat(fixtureProvider())
                .containsEntry("provider", "FAKE")
                .containsEntry("provider_account_ref", "fixture_local_account");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM platform.ingestion_policy", Long.class))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM platform.ledger_account", Long.class))
                .isZero();
    }

    @Test
    void fixturesProvisionDispatchOrderPrice() {
        write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        initializer(fixtureEnvironment(false)).afterPropertiesSet();
        assertThat(LocalFixtureInitializer.DISPATCH_ORDER_PRICE).isEqualTo(fixtureId(82));
        assertThat(jdbc.queryForMap("""
                SELECT product_ref,price_version,currency,amount_minor,share_policy_id
                FROM platform.price_fixture WHERE id=?""", LocalFixtureInitializer.DISPATCH_ORDER_PRICE))
                .containsEntry("product_ref", "dispatch-order")
                .containsEntry("price_version", 1)
                .containsEntry("currency", "USD")
                .containsEntry("amount_minor", 1L)
                .containsEntry("share_policy_id", fixtureId(72));
        assertThat(jdbc.queryForMap("""
                SELECT product_ref,policy_version,partner_ref,share_basis_points
                FROM platform.share_policy_fixture WHERE id=?""", fixtureId(72)))
                .containsEntry("product_ref", "dispatch-order")
                .containsEntry("policy_version", 1)
                .containsEntry("partner_ref", "fixture-partner")
                .containsEntry("share_basis_points", 0);
        var response = get(
                "/v1/prices/" + LocalFixtureInitializer.DISPATCH_ORDER_PRICE,
                "Bearer app_" + LocalFixtureInitializer.APP_CREDENTIAL + "." + SECRET);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).contains("\"amountMinor\":1", "dispatch-order");
    }

    @Test
    void existingFixturesGainDispatchOrderPriceOnce() {
        write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        var initializer = initializer(fixtureEnvironment(false));
        initializer.afterPropertiesSet();
        var counts = fixtureTableCounts();
        write(() -> {
            jdbc.update("DELETE FROM platform.price_fixture WHERE id=?", LocalFixtureInitializer.DISPATCH_ORDER_PRICE);
            jdbc.update("DELETE FROM platform.share_policy_fixture WHERE id=?", fixtureId(72));
        });
        initializer.afterPropertiesSet();
        initializer.afterPropertiesSet();
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM platform.price_fixture WHERE id=?",
                        Long.class,
                        LocalFixtureInitializer.DISPATCH_ORDER_PRICE))
                .isEqualTo(1L);
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM platform.share_policy_fixture WHERE id=?", Long.class, fixtureId(72)))
                .isEqualTo(1L);
        assertThat(fixtureTableCounts()).isEqualTo(counts);
    }

    @Test
    void existingFixturesGainProposalReviewOnce() {
        write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        var initializer = initializer(fixtureEnvironment(false));
        initializer.afterPropertiesSet();
        write(() -> {
            jdbc.update("""
                    UPDATE platform.application_credential
                    SET granted_scopes=ARRAY['payments:read','payments:write','refunds:read','refunds:write']::text[]
                    WHERE id=?""", LocalFixtureInitializer.APP_CREDENTIAL);
            jdbc.update(
                    "DELETE FROM platform.ops_credential WHERE id=?", LocalFixtureInitializer.OPS_REVIEWER_CREDENTIAL);
            jdbc.update("DELETE FROM platform.ops_identity WHERE id=?", fixtureId(52));
        });

        initializer.afterPropertiesSet();
        String scopes = jdbc.queryForObject(
                "SELECT granted_scopes::text FROM platform.application_credential WHERE id=?",
                String.class,
                LocalFixtureInitializer.APP_CREDENTIAL);
        assertThat(scopes)
                .isEqualTo(
                        "{payments:read,payments:write,refunds:read,refunds:write,refund-proposals:read,refund-proposals:write}");
        var identity = get("/v1/identity", "Bearer app_" + LocalFixtureInitializer.APP_CREDENTIAL + "." + SECRET);
        assertThat(identity.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(identity.getBody())
                .contains(
                        "payments:read",
                        "payments:write",
                        "refunds:read",
                        "refunds:write",
                        "refund-proposals:read",
                        "refund-proposals:write");
        assertThat(jdbc.queryForMap("SELECT subject,role FROM platform.ops_identity WHERE id=?", fixtureId(52)))
                .containsEntry("subject", "local-reviewer")
                .containsEntry("role", "OPS_REVIEWER");
        var reviewer = get(
                "/ops/identity",
                "OpsBearer ops_" + LocalFixtureInitializer.OPS_REVIEWER_CREDENTIAL + "." + "b".repeat(43));
        assertThat(reviewer.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(reviewer.getBody()).contains("OPS_REVIEWER", fixtureId(52).toString());
        var counts = fixtureTableCounts();
        String credential = jdbc.queryForObject(
                "SELECT md5(to_jsonb(c)::text) FROM platform.ops_credential c WHERE id=?",
                String.class,
                LocalFixtureInitializer.OPS_REVIEWER_CREDENTIAL);

        initializer.afterPropertiesSet();
        assertThat(jdbc.queryForObject(
                        "SELECT granted_scopes::text FROM platform.application_credential WHERE id=?",
                        String.class,
                        LocalFixtureInitializer.APP_CREDENTIAL))
                .isEqualTo(scopes);
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM platform.ops_identity WHERE id=?", Long.class, fixtureId(52)))
                .isEqualTo(1L);
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM platform.ops_credential WHERE id=?",
                        Long.class,
                        LocalFixtureInitializer.OPS_REVIEWER_CREDENTIAL))
                .isEqualTo(1L);
        assertThat(jdbc.queryForObject(
                        "SELECT md5(to_jsonb(c)::text) FROM platform.ops_credential c WHERE id=?",
                        String.class,
                        LocalFixtureInitializer.OPS_REVIEWER_CREDENTIAL))
                .isEqualTo(credential);
        assertThat(fixtureTableCounts()).isEqualTo(counts);
    }

    @Test
    void agentFixtureCredentialReadsWithinTheDemoApplication() {
        write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        String secret = "d".repeat(43);
        var fixture = initializer(fixtureEnvironment(false).withProperty("platform.fixtures.agent-secret", secret));
        fixture.afterPropertiesSet();
        var counts = fixtureTableCounts();
        fixture.afterPropertiesSet();
        assertThat(LocalFixtureInitializer.AGENT_CREDENTIAL).isEqualTo(fixtureId(42));
        var row = jdbc.queryForMap("""
                SELECT key_id,application_id,provider_account_id,granted_scopes::text AS scopes,secret_hash
                FROM platform.application_credential WHERE id=?""", fixtureId(42));
        assertThat(row)
                .containsEntry("key_id", "agent")
                .containsEntry("application_id", fixtureId(31))
                .containsEntry("provider_account_id", fixtureId(21))
                .containsEntry("scopes", "{payments:read,refunds:read,refund-proposals:read,refund-proposals:write}");
        assertThat((String) row.get("secret_hash")).startsWith("$2").doesNotContain(secret);
        assertThat(jdbc.queryForList(
                        "SELECT currency FROM platform.credential_currency WHERE credential_id=?",
                        String.class,
                        fixtureId(42)))
                .containsExactly("USD");
        var response = get("/v1/identity", "Bearer app_" + fixtureId(42) + "." + secret);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody())
                .contains("\"applicationId\":\"10000000-0000-0000-0000-000000000031\"", "refund-proposals:write")
                .doesNotContain("payments:write", "refunds:write");
        var app = get("/v1/identity", "Bearer app_" + LocalFixtureInitializer.APP_CREDENTIAL + "." + SECRET);
        assertThat(response.getBody()).contains("\"allowedProviderAccountId\":\"" + fixtureId(21) + "\"");
        assertThat(app.getBody()).contains("\"allowedProviderAccountId\":\"" + row.get("provider_account_id") + "\"");
        assertThat(fixtureTableCounts()).isEqualTo(counts);
    }

    @Test
    void agentFixtureSecretIsOptionalAndValidated() {
        write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        initializer(fixtureEnvironment(false)).afterPropertiesSet();
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM platform.application_credential WHERE id=?", Long.class, fixtureId(42)))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM platform.application_credential", Long.class))
                .isEqualTo(1L);
        for (String secret : java.util.List.of("short", SECRET)) {
            write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
            var fixture = initializer(fixtureEnvironment(false).withProperty("platform.fixtures.agent-secret", secret));
            assertThatThrownBy(fixture::afterPropertiesSet)
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage(
                            secret.equals(SECRET)
                                    ? "Agent fixture secret must differ from the application and ops secrets"
                                    : "The agent fixture secret must be a random 43-character secret");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM platform.organization", Long.class))
                    .isZero();
        }
    }

    @Test
    void existingFixturesGainAgentCredentialOnce() {
        write(() -> jdbc.execute("TRUNCATE platform.organization, platform.currency_config CASCADE"));
        initializer(fixtureEnvironment(false)).afterPropertiesSet();
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM platform.application_credential WHERE id=?", Long.class, fixtureId(42)))
                .isZero();
        var fixture =
                initializer(fixtureEnvironment(false).withProperty("platform.fixtures.agent-secret", "d".repeat(43)));
        fixture.afterPropertiesSet();
        var counts = fixtureTableCounts();
        String hash = jdbc.queryForObject(
                "SELECT md5(to_jsonb(c)::text) FROM platform.application_credential c WHERE id=?",
                String.class,
                fixtureId(42));
        fixture.afterPropertiesSet();
        assertThat(fixtureTableCounts()).isEqualTo(counts);
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM platform.application_credential WHERE id=?", Long.class, fixtureId(42)))
                .isEqualTo(1L);
        var changed =
                initializer(fixtureEnvironment(false).withProperty("platform.fixtures.agent-secret", "e".repeat(43)));
        assertThatThrownBy(changed::afterPropertiesSet)
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Existing fixture credentials differ; provisioning never rotates or overwrites them");
        assertThat(jdbc.queryForObject(
                        "SELECT md5(to_jsonb(c)::text) FROM platform.application_credential c WHERE id=?",
                        String.class,
                        fixtureId(42)))
                .isEqualTo(hash);
    }

    private java.util.Map<String, Long> fixtureTableCounts() {
        var counts = new java.util.LinkedHashMap<String, Long>();
        for (String table : jdbc.queryForList(
                "SELECT tablename FROM pg_tables WHERE schemaname='platform' ORDER BY tablename", String.class)) {
            counts.put(table, jdbc.queryForObject("SELECT count(*) FROM platform.\"" + table + "\"", Long.class));
        }
        return counts;
    }
}
