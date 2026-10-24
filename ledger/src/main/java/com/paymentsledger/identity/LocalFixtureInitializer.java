package com.paymentsledger.identity;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.DependsOn;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** Explicit local-only FAKE or PayPal provisioning using the migration role, never the runtime role. */
@Component
@DependsOn("testModeGuard")
@ConditionalOnProperty(name = "platform.fixtures.enabled", havingValue = "true")
public class LocalFixtureInitializer implements InitializingBean {
    public static final UUID APP_CREDENTIAL = id(41), OPS_CREDENTIAL = id(61), PRICE = id(81);
    public static final UUID DISPATCH_ORDER_PRICE = id(82);
    private static final List<String> PROVIDER_ACCOUNTS = List.of("PSP_FUNDS", "PSP_FEE_EXPENSE", "SUSPENSE");
    private static final List<String> INTERNAL_ACCOUNTS =
            List.of("SALES_REVENUE", "SALES_RETURNS", "PARTNER_SHARE_EXPENSE", "PARTNER_PAYABLE");

    private record Provider(String provider, String accountRef, boolean paypal) {}

    private Provider provider() {
        if (!environment.getProperty("platform.paypal.enabled", Boolean.class, false))
            return new Provider("FAKE", "fixture_local_account", false);
        String clientId = value("client-id", "PAYPAL_CLIENT_ID");
        if (clientId == null || clientId.isBlank())
            throw new IllegalStateException("PayPal fixtures require PAYPAL_CLIENT_ID");
        if (!id(1).toString().equals(value("organization-id", "PAYPAL_ORGANIZATION_ID"))
                || !id(11).toString().equals(value("environment-id", "PAYPAL_ENVIRONMENT_ID"))
                || !id(21).toString().equals(value("provider-account-id", "PAYPAL_PROVIDER_ACCOUNT_ID")))
            throw new IllegalStateException("PayPal fixtures require the local fixture scope ids");
        return new Provider("PAYPAL", clientId, true);
    }

    private String value(String key, String fallback) {
        return environment.getProperty("platform.paypal." + key, environment.getProperty(fallback));
    }

    private final Flyway flyway;
    private final CredentialTokens tokens;
    private final Clock clock;
    private final Environment environment;

    public LocalFixtureInitializer(Flyway flyway, CredentialTokens tokens, Clock clock, Environment environment) {
        this.flyway = flyway;
        this.tokens = tokens;
        this.clock = clock;
        this.environment = environment;
    }

    private static UUID id(int n) {
        return UUID.fromString("10000000-0000-0000-0000-" + "%012d".formatted(n));
    }

    @Override
    public void afterPropertiesSet() {
        if (!environment.acceptsProfiles(Profiles.of("local")))
            throw new IllegalStateException("Fixture initialization requires local profile");
        var provider = provider();
        CredentialTokens.Parsed app, ops;
        try {
            app = tokens.parse(
                    "app_" + APP_CREDENTIAL + "." + environment.getRequiredProperty("platform.fixtures.app-secret"),
                    "app_");
            ops = tokens.parse(
                    "ops_" + OPS_CREDENTIAL + "." + environment.getRequiredProperty("platform.fixtures.ops-secret"),
                    "ops_");
        } catch (RuntimeException ex) {
            throw new IllegalStateException("Two random 43-character local fixture secrets are required");
        }
        if (app.secret().equals(ops.secret()))
            throw new IllegalStateException("Application and ops fixture secrets must differ");
        var source = flyway.getConfiguration().getDataSource();
        var jdbc = new JdbcTemplate(source);
        new TransactionTemplate(new DataSourceTransactionManager(source)).executeWithoutResult(status -> {
            jdbc.execute("SELECT pg_advisory_xact_lock(20002)");
            if (Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT EXISTS(SELECT 1 FROM platform.environment_config WHERE livemode)", Boolean.class)))
                throw new IllegalStateException("Cannot provision fixtures with live configuration");
            var existing = jdbc.queryForList("SELECT id FROM platform.organization", UUID.class);
            if (!existing.isEmpty()) {
                if (existing.size() != 1 || !existing.getFirst().equals(id(1)))
                    throw new IllegalStateException(
                            "Fixture initialization requires an empty or matching fixture database");
                var providers = jdbc.queryForList(
                        "SELECT provider,provider_account_ref FROM platform.provider_account WHERE id=?", id(21));
                if (providers.size() != 1
                        || !provider.provider().equals(providers.getFirst().get("provider"))
                        || !provider.accountRef().equals(providers.getFirst().get("provider_account_ref")))
                    throw new IllegalStateException("Existing fixture provider differs; recreate the local database");
                verifyExisting(jdbc, "application_credential", app);
                verifyExisting(jdbc, "ops_credential", ops);
                provisionDispatchOrderPrice(jdbc);
                return;
            }
            jdbc.update("INSERT INTO platform.organization(id,code) VALUES (?,'local-fixture')", id(1));
            jdbc.update("""
                    INSERT INTO platform.environment_config(id,organization_id,code,livemode)
                    VALUES (?,?,'local',false)""", id(11), id(1));
            jdbc.update("""
                    INSERT INTO platform.application(id,organization_id,environment_id,code)
                    VALUES (?,?,?,'demo')""", id(31), id(1), id(11));
            jdbc.update("""
                    INSERT INTO platform.provider_account(id,organization_id,environment_id,provider,
                        provider_account_ref,livemode)
                    VALUES (?,?,?,?,?,false)""", id(21), id(1), id(11), provider.provider(), provider.accountRef());
            jdbc.update("""
                    INSERT INTO platform.currency_config(code,minor_unit_exponent)
                    VALUES ('USD',2)
                    ON CONFLICT (code)
                    DO NOTHING""");
            jdbc.update("""
                    INSERT INTO platform.org_currency_enabled(organization_id,environment_id,currency)
                    VALUES (?,?,'USD')""", id(1), id(11));
            var start = Timestamp.from(clock.instant());
            var end = Timestamp.from(clock.instant().plus(365, ChronoUnit.DAYS));
            jdbc.update("""
                    INSERT INTO platform.application_credential(id,key_id,organization_id,environment_id,application_id,provider_account_id,secret_hash,not_before,expires_at,granted_scopes)
                    VALUES (?,'local',?,?,?,?,?,?,?,ARRAY['payments:read','payments:write','refunds:read','refunds:write'])
                    """, APP_CREDENTIAL, id(1), id(11), id(31), id(21), tokens.hash(app), start, end);
            jdbc.update("""
                    INSERT INTO platform.credential_currency(credential_id,organization_id,environment_id,currency)
                    VALUES (?,?,?,'USD')""", APP_CREDENTIAL, id(1), id(11));
            jdbc.update("""
                    INSERT INTO platform.ops_identity(id,organization_id,subject,role)
                    VALUES (?,?,'local-viewer','OPS_VIEWER')""", id(51), id(1));
            jdbc.update("""
                    INSERT INTO platform.ops_credential(id,ops_identity_id,organization_id,environment_id,key_id,
                        secret_hash,not_before,expires_at)
                    VALUES (?,?,?,?,'local',?,?,?)""", OPS_CREDENTIAL, id(51), id(1), id(11), tokens.hash(ops), start, end);
            jdbc.update("""
                    INSERT INTO platform.share_policy_fixture(id,organization_id,environment_id,product_ref,
                        policy_version,partner_ref,share_basis_points)
                    VALUES (?,?,?,'demo-product',1,'fixture-partner',1500)""", id(71), id(1), id(11));
            jdbc.update("""
                    INSERT INTO platform.price_fixture(id,organization_id,environment_id,product_ref,price_version,
                        currency,amount_minor,share_policy_id)
                    VALUES (?,?,?,'demo-product',1,'USD',10000,?)""", PRICE, id(1), id(11), id(71));
            provisionDispatchOrderPrice(jdbc);
            if (provider.paypal()) {
                jdbc.update("""
                        INSERT INTO platform.ingestion_policy
                        (organization_id,environment_id,provider_account_id,livemode,opening_mode,business_zone)
                        VALUES (?,?,?,false,'ZERO','UTC')
                        """, id(1), id(11), id(21));
                for (String purpose : PROVIDER_ACCOUNTS) jdbc.update("""
                            INSERT INTO platform.ledger_account
                            (organization_id,environment_id,currency,account_purpose,source_domain,provider_account_id,balance_domain)
                            VALUES (?,?,'USD',?,'PROVIDER',?,'PAYMENTS')
                            """, id(1), id(11), purpose, id(21));
                for (String purpose : INTERNAL_ACCOUNTS) jdbc.update("""
                            INSERT INTO platform.ledger_account
                            (organization_id,environment_id,currency,account_purpose,source_domain,provider_account_id,balance_domain)
                            VALUES (?,?,'USD',?,'INTERNAL',NULL,NULL)
                            """, id(1), id(11), purpose);
            }
        });
    }

    private void provisionDispatchOrderPrice(JdbcTemplate jdbc) {
        jdbc.update("""
                INSERT INTO platform.share_policy_fixture(id,organization_id,environment_id,product_ref,
                    policy_version,partner_ref,share_basis_points)
                VALUES (?,?,?,'dispatch-order',1,'fixture-partner',0)
                ON CONFLICT (id) DO NOTHING""", id(72), id(1), id(11));
        jdbc.update("""
                INSERT INTO platform.price_fixture(id,organization_id,environment_id,product_ref,price_version,
                    currency,amount_minor,share_policy_id)
                VALUES (?,?,?,'dispatch-order',1,'USD',1,?)
                ON CONFLICT (id) DO NOTHING""", DISPATCH_ORDER_PRICE, id(1), id(11), id(72));
    }

    private void verifyExisting(JdbcTemplate jdbc, String table, CredentialTokens.Parsed token) {
        // table is a private constant chosen above, never request data.
        var hashes = jdbc.queryForList(
                "SELECT secret_hash FROM platform." + table + " WHERE id=?", String.class, token.id());
        if (hashes.size() != 1 || !tokens.matches(token, hashes.getFirst()))
            throw new IllegalStateException(
                    "Existing fixture credentials differ; provisioning never rotates or overwrites them");
    }
}
