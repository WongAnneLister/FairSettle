package com.paymentsledger.liability.repository;

import com.paymentsledger.identity.TenantContext;
import com.paymentsledger.liability.LiabilityAllocation;
import com.paymentsledger.liability.LiabilitySplit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

public class LiabilityRepository {
    private final JdbcTemplate jdbc;

    public LiabilityRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The refund fields an allocation copies. */
    public record RefundScope(
            UUID organizationId,
            UUID environmentId,
            UUID applicationId,
            UUID providerAccountId,
            String currency,
            UUID paymentId,
            long amountMinor) {}

    /** One stored allocation; the allocation is rebuilt through the LiabilityAllocation constructor. */
    public record Liability(
            UUID id,
            UUID organizationId,
            UUID environmentId,
            UUID applicationId,
            UUID providerAccountId,
            String currency,
            UUID paymentId,
            UUID refundId,
            UUID proposalId,
            LiabilityAllocation allocation,
            String postingStatus,
            UUID journalId) {}

    private static final RowMapper<Liability> LIABILITY = (rs, row) -> {
        var split = new LiabilitySplit(rs.getInt("restaurant_bp"), rs.getInt("driver_bp"), rs.getInt("platform_bp"));
        var allocation = new LiabilityAllocation(
                rs.getLong("amount_minor"),
                split,
                rs.getLong("restaurant_minor"),
                rs.getLong("driver_minor"),
                rs.getLong("platform_minor"));
        return new Liability(
                rs.getObject("id", UUID.class),
                rs.getObject("organization_id", UUID.class),
                rs.getObject("environment_id", UUID.class),
                rs.getObject("application_id", UUID.class),
                rs.getObject("provider_account_id", UUID.class),
                rs.getString("currency"),
                rs.getObject("payment_id", UUID.class),
                rs.getObject("refund_id", UUID.class),
                rs.getObject("proposal_id", UUID.class),
                allocation,
                rs.getString("posting_status"),
                rs.getObject("journal_id", UUID.class));
    };

    public Optional<RefundScope> refund(UUID refundId) {
        return jdbc
                .query(
                        """
                SELECT organization_id,environment_id,application_id,provider_account_id,currency,payment_id,amount_minor
                FROM platform.refund WHERE id=?
                """,
                        (rs, row) -> new RefundScope(
                                rs.getObject("organization_id", UUID.class),
                                rs.getObject("environment_id", UUID.class),
                                rs.getObject("application_id", UUID.class),
                                rs.getObject("provider_account_id", UUID.class),
                                rs.getString("currency"),
                                rs.getObject("payment_id", UUID.class),
                                rs.getLong("amount_minor")),
                        refundId)
                .stream()
                .findFirst();
    }

    public Optional<UUID> insert(UUID refundId, RefundScope refund, UUID proposalId, LiabilityAllocation allocation) {
        var split = allocation.split();
        return jdbc
                .query(
                        """
                INSERT INTO platform.refund_liability(organization_id,environment_id,application_id,provider_account_id,currency,payment_id,refund_id,proposal_id,amount_minor,restaurant_bp,driver_bp,platform_bp,restaurant_minor,driver_minor,platform_minor)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (refund_id) DO NOTHING RETURNING id
                """,
                        (rs, row) -> rs.getObject("id", UUID.class),
                        refund.organizationId(),
                        refund.environmentId(),
                        refund.applicationId(),
                        refund.providerAccountId(),
                        refund.currency(),
                        refund.paymentId(),
                        refundId,
                        proposalId,
                        allocation.amountMinor(),
                        split.restaurantBp(),
                        split.driverBp(),
                        split.platformBp(),
                        allocation.restaurantMinor(),
                        allocation.driverMinor(),
                        allocation.platformMinor())
                .stream()
                .findFirst();
    }

    public Optional<Liability> findByRefund(UUID refundId) {
        return jdbc.query("SELECT * FROM platform.refund_liability WHERE refund_id=?", LIABILITY, refundId).stream()
                .findFirst();
    }

    public Optional<Liability> lock(UUID liabilityId) {
        return jdbc
                .query("SELECT * FROM platform.refund_liability WHERE id=? FOR UPDATE", LIABILITY, liabilityId)
                .stream()
                .findFirst();
    }

    public Map<String, UUID> provisionAccounts(
            UUID refundId, UUID organizationId, UUID environmentId, String currency) {
        jdbc.queryForObject("SELECT platform.ensure_liability_accounts(?)", Object.class, refundId);
        var accounts = new HashMap<String, UUID>();
        jdbc.query(
                """
                SELECT account_purpose,id FROM platform.ledger_account
                WHERE organization_id=? AND environment_id=? AND currency=? AND source_domain='INTERNAL'
                  AND provider_account_id IS NULL AND account_purpose IN ('REFUND_RECEIVABLE_RESTAURANT','REFUND_RECEIVABLE_DRIVER','REFUND_COST_PLATFORM','SALES_RETURNS')
                """,
                rs -> {
                    accounts.put(rs.getString("account_purpose"), rs.getObject("id", UUID.class));
                },
                organizationId,
                environmentId,
                currency);
        return accounts;
    }

    public void markPosted(UUID liabilityId, UUID journalId) {
        int changed = jdbc.update(
                "UPDATE platform.refund_liability SET posting_status='POSTED',journal_id=?,posted_at=now() WHERE id=? AND posting_status='PENDING'",
                journalId,
                liabilityId);
        if (changed != 1) throw new IllegalStateException("Expected one pending refund liability to be posted");
    }

    public long markAttempted(UUID liabilityId) {
        return jdbc.queryForObject("""
                INSERT INTO platform.refund_liability_attempt(liability_id) VALUES (?)
                ON CONFLICT (liability_id) DO UPDATE
                SET attempts=refund_liability_attempt.attempts+1, attempted_at=clock_timestamp()
                RETURNING attempts
                """, Long.class, liabilityId);
    }

    public List<UUID> readyCandidates(int limit) {
        return jdbc.query("""
                SELECT l.id FROM platform.refund_liability l JOIN platform.refund r ON r.id=l.refund_id
                LEFT JOIN platform.refund_liability_attempt a ON a.liability_id=l.id
                WHERE l.posting_status='PENDING' AND r.refund_status='SUCCEEDED'
                ORDER BY a.attempted_at NULLS FIRST,l.created_at,l.id LIMIT ?
                """, (rs, row) -> rs.getObject("id", UUID.class), limit);
    }

    public Optional<Liability> findScoped(UUID refundId, TenantContext tenant) {
        return jdbc
                .query(
                        "SELECT * FROM platform.refund_liability WHERE refund_id=? AND organization_id=? AND environment_id=? AND application_id=? AND provider_account_id=?",
                        LIABILITY,
                        refundId,
                        tenant.organizationId(),
                        tenant.environmentId(),
                        tenant.applicationId(),
                        tenant.allowedProviderAccountId())
                .stream()
                .findFirst();
    }
}
