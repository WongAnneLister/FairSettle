package com.paymentsledger.financialingestion.repository;

import com.paymentsledger.provider.ProviderModels.BalanceTransactionFact;
import com.paymentsledger.provider.ProviderScope;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** Data access for capture settlements; every method runs inside the caller's transaction. */
public class CaptureSettlementRepository {
    /** A stored balance transaction: its row id and its immutable fact JSON. */
    public record Stored(UUID id, String immutableFact) {}

    private final JdbcTemplate jdbc;

    public CaptureSettlementRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean lockPolicy(ProviderScope scope) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT platform.lock_ingestion_policy(?,?,?,?)",
                Boolean.class,
                scope.organizationId(),
                scope.environmentId(),
                scope.providerAccountId(),
                scope.livemode()));
    }

    public Optional<Stored> lockBalanceTransaction(ProviderScope scope, String btId) {
        return jdbc
                .query(
                        """
                        SELECT id, immutable_fact FROM platform.balance_transaction
                        WHERE organization_id=? AND environment_id=? AND provider_account_id=? AND livemode=? AND bt_id=?
                        FOR UPDATE
                        """,
                        (rs, row) -> new Stored(rs.getObject("id", UUID.class), rs.getString("immutable_fact")),
                        scope.organizationId(),
                        scope.environmentId(),
                        scope.providerAccountId(),
                        scope.livemode(),
                        btId)
                .stream()
                .findFirst();
    }

    public UUID insertObservation(
            ProviderScope scope, String btId, String evidenceJson, String factJson, Instant fetchedAt) {
        UUID observation = UUID.randomUUID();
        jdbc.update(
                """
                INSERT INTO platform.provider_observation(id,organization_id,environment_id,provider_account_id,
                    observation_domain,livemode,import_window_id,call_type,classification,external_object_id,
                    evidence,fact,fetched_at)
                VALUES (?,?,?,?,'FINANCIAL',?,null,'CAPTURE_SETTLEMENT','SUCCESS',?,?::jsonb,?::jsonb,?)
                """,
                observation,
                scope.organizationId(),
                scope.environmentId(),
                scope.providerAccountId(),
                scope.livemode(),
                btId,
                evidenceJson,
                factJson,
                ts(fetchedAt));
        return observation;
    }

    public void insertBalanceTransaction(
            ProviderScope scope,
            BalanceTransactionFact fact,
            String apiVersion,
            String immutableJson,
            String factJson,
            UUID observationId,
            Instant fetchedAt) {
        jdbc.update(
                """
                INSERT INTO platform.balance_transaction(organization_id,environment_id,provider_account_id,livemode,bt_id,amount_minor,fee_minor,net_minor,currency,source_object_id,source_object_type,business_type,balance_domain,provider_created_at,available_on,provider_status,raw_digest,api_version,fetched_at,immutable_fact,fact,first_observation_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?)
                ON CONFLICT(organization_id,provider_account_id,livemode,bt_id) DO NOTHING
                """,
                scope.organizationId(),
                scope.environmentId(),
                scope.providerAccountId(),
                scope.livemode(),
                fact.btId(),
                fact.amountMinor(),
                fact.feeMinor(),
                fact.netMinor(),
                fact.currency().toUpperCase(Locale.ROOT),
                fact.sourceObjectId(),
                fact.sourceObjectType(),
                fact.type(),
                fact.balanceDomain(),
                ts(fact.createdAt()),
                ts(fact.availableOn()),
                fact.status(),
                fact.rawDigest(),
                apiVersion,
                ts(fetchedAt),
                immutableJson,
                factJson,
                observationId);
    }

    public void insertConflict(
            ProviderScope scope,
            UUID balanceTransactionId,
            UUID observationId,
            String existingJson,
            String incomingJson) {
        jdbc.update(
                """
                INSERT INTO platform.bt_evidence_conflict(organization_id,environment_id,provider_account_id,
                    livemode,balance_transaction_id,observation_id,existing_fact,incoming_fact)
                VALUES (?,?,?,?,?,?,?::jsonb,?::jsonb)
                """,
                scope.organizationId(),
                scope.environmentId(),
                scope.providerAccountId(),
                scope.livemode(),
                balanceTransactionId,
                observationId,
                existingJson,
                incomingJson);
    }

    private static Timestamp ts(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }
}
