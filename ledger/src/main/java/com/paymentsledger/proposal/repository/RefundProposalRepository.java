package com.paymentsledger.proposal.repository;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.identity.OpsContext;
import com.paymentsledger.identity.TenantContext;
import com.paymentsledger.liability.LiabilitySplit;
import com.paymentsledger.payment.domain.RefundablePayment;
import com.paymentsledger.payment.domain.ResolutionStatus;
import com.paymentsledger.proposal.ProposalRequests;
import com.paymentsledger.proposal.domain.ProposalRules;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.*;

/** Scoped persistence for immutable submissions, conditional review decisions and queue reads. */
public class RefundProposalRepository {
    public record Proposal(
            UUID id,
            UUID organizationId,
            UUID environmentId,
            UUID applicationId,
            UUID providerAccountId,
            String currency,
            UUID paymentId,
            String complaintId,
            String orderRef,
            String decision,
            long amountMinor,
            String reasonCode,
            LiabilitySplit split,
            String explanation,
            List<String> evidenceRefs,
            String threadId,
            String traceId,
            String idempotencyKey,
            String requestFingerprint,
            String status,
            String reviewerSubject,
            String reviewerRole,
            Instant reviewedAt,
            String rejectionReason,
            UUID refundId,
            String decisionIdempotencyKey,
            String decisionFingerprint,
            Instant createdAt,
            UUID refundKey) {}

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final RowMapper<Proposal> PROPOSAL = (rs, n) -> new Proposal(
            rs.getObject("id", UUID.class),
            rs.getObject("organization_id", UUID.class),
            rs.getObject("environment_id", UUID.class),
            rs.getObject("application_id", UUID.class),
            rs.getObject("provider_account_id", UUID.class),
            rs.getString("currency"),
            rs.getObject("payment_id", UUID.class),
            rs.getString("complaint_id"),
            rs.getString("order_ref"),
            rs.getString("decision"),
            rs.getLong("amount_minor"),
            rs.getString("reason_code"),
            new LiabilitySplit(rs.getInt("restaurant_bp"), rs.getInt("driver_bp"), rs.getInt("platform_bp")),
            rs.getString("explanation"),
            decode(rs.getString("evidence_refs")),
            rs.getString("agent_thread_id"),
            rs.getString("agent_trace_id"),
            rs.getString("idempotency_key"),
            rs.getString("request_fingerprint"),
            rs.getString("status"),
            rs.getString("reviewer_subject"),
            rs.getString("reviewer_role"),
            rs.getTimestamp("reviewed_at") == null
                    ? null
                    : rs.getTimestamp("reviewed_at").toInstant(),
            rs.getString("rejection_reason"),
            rs.getObject("refund_id", UUID.class),
            rs.getString("decision_idempotency_key"),
            rs.getString("decision_fingerprint"),
            rs.getTimestamp("created_at").toInstant(),
            rs.getObject("refund_key", UUID.class));
    private final NamedParameterJdbcTemplate jdbc;

    public RefundProposalRepository(JdbcTemplate jdbc) {
        this.jdbc = new NamedParameterJdbcTemplate(jdbc);
    }

    public void lock(String key) {
        jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))", Map.of("key", key));
    }

    public Optional<Proposal> findByKey(TenantContext tenant, String key) {
        return find(tenant, "idempotency_key", key);
    }

    public Optional<Proposal> findByComplaint(TenantContext tenant, String complaintId) {
        return find(tenant, "complaint_id", complaintId);
    }

    public Optional<Proposal> findScoped(TenantContext tenant, UUID proposalId) {
        return find(tenant, "id", proposalId);
    }

    private Optional<Proposal> find(TenantContext tenant, String column, Object value) {
        // The column is selected only by the three private callers above.
        return first(jdbc.query(
                "SELECT * FROM platform.refund_proposal WHERE organization_id=:org AND environment_id=:env AND application_id=:app AND provider_account_id=:provider AND "
                        + column + "=:value",
                scope(tenant).addValue("value", value),
                PROPOSAL));
    }

    public Optional<Proposal> lockForReview(OpsContext ops, UUID proposalId) {
        return first(jdbc.query(
                "SELECT * FROM platform.refund_proposal WHERE organization_id=:org AND environment_id=:env AND id=:id FOR UPDATE",
                ops(ops).addValue("id", proposalId),
                PROPOSAL));
    }

    public boolean decisionKeyUsedElsewhere(OpsContext ops, String key, UUID proposalId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM platform.refund_proposal
                    WHERE organization_id=:org AND environment_id=:env AND decision_idempotency_key=:key AND id<>:id)
                """, ops(ops).addValue("key", key).addValue("id", proposalId), Boolean.class));
    }

    public Optional<RefundablePayment> payment(TenantContext tenant, UUID paymentId) {
        return first(jdbc.query(
                "SELECT * FROM platform.payment WHERE organization_id=:org AND environment_id=:env AND application_id=:app AND provider_account_id=:provider AND id=:id",
                scope(tenant).addValue("id", paymentId),
                (rs, n) -> new RefundablePayment(
                        rs.getObject("id", UUID.class),
                        rs.getObject("organization_id", UUID.class),
                        rs.getObject("environment_id", UUID.class),
                        rs.getObject("application_id", UUID.class),
                        rs.getObject("provider_account_id", UUID.class),
                        rs.getString("currency"),
                        ResolutionStatus.valueOf(rs.getString("resolution_status")),
                        rs.getLong("captured_amount_minor"),
                        rs.getString("latest_charge_id"))));
    }

    public ProposalRules.Refundable refundable(RefundablePayment payment) {
        return first(jdbc.query(
                        "SELECT captured_minor,refunded_minor,reserved_minor,control_state FROM platform.refund_control WHERE payment_id=:id",
                        Map.of("id", payment.id()),
                        (rs, n) -> new ProposalRules.Refundable(
                                rs.getLong("captured_minor"),
                                rs.getLong("refunded_minor"),
                                rs.getLong("reserved_minor"),
                                rs.getString("control_state"))))
                .orElseGet(() -> new ProposalRules.Refundable(payment.capturedMinor(), 0, 0, "NORMAL"));
    }

    public void insert(
            UUID id,
            TenantContext tenant,
            RefundablePayment payment,
            ProposalRequests.Create request,
            String key,
            UUID refundKey) {
        jdbc.update(
                """
                INSERT INTO platform.refund_proposal(id,organization_id,environment_id,application_id,provider_account_id,
                    currency,payment_id,complaint_id,order_ref,decision,amount_minor,reason_code,restaurant_bp,driver_bp,
                    platform_bp,explanation,evidence_refs,agent_thread_id,agent_trace_id,idempotency_key,request_fingerprint,refund_key)
                VALUES (:id,:org,:env,:app,:provider,:currency,:payment,:complaint,:order,:decision,:amount,:reason,
                    :restaurant,:driver,:platform,:explanation,:evidence::jsonb,:thread,:trace,:key,:fingerprint,:refundKey)
                """,
                scope(tenant)
                        .addValue("id", id)
                        .addValue("currency", payment.currency())
                        .addValue("payment", payment.id())
                        .addValue("complaint", request.complaintId())
                        .addValue("order", request.orderRef())
                        .addValue("decision", request.decision())
                        .addValue("amount", request.amountMinor())
                        .addValue("reason", request.reasonCode())
                        .addValue("restaurant", request.split().restaurantBp())
                        .addValue("driver", request.split().driverBp())
                        .addValue("platform", request.split().platformBp())
                        .addValue("explanation", request.explanation())
                        .addValue("evidence", encode(request.evidenceRefs()))
                        .addValue("thread", request.threadId())
                        .addValue("trace", request.traceId())
                        .addValue("key", key)
                        .addValue("fingerprint", request.fingerprint())
                        .addValue("refundKey", refundKey));
    }

    public void approve(UUID id, OpsContext ops, String subject, UUID refundId, String key, String fingerprint) {
        int changed =
                jdbc.update("""
                UPDATE platform.refund_proposal SET status='APPROVED',reviewer_id=:reviewer,reviewer_subject=:subject,
                    reviewer_role='OPS_REVIEWER',reviewed_at=now(),refund_id=:refund,decision_idempotency_key=:key,
                    decision_fingerprint=:fingerprint WHERE id=:id AND status='PENDING_REVIEW'
                """, review(id, ops, subject, key, fingerprint).addValue("refund", refundId));
        changed(changed);
    }

    public void reject(UUID id, OpsContext ops, String subject, String reason, String key, String fingerprint) {
        int changed =
                jdbc.update("""
                UPDATE platform.refund_proposal SET status='REJECTED',reviewer_id=:reviewer,reviewer_subject=:subject,
                    reviewer_role='OPS_REVIEWER',reviewed_at=now(),rejection_reason=:reason,decision_idempotency_key=:key,
                    decision_fingerprint=:fingerprint WHERE id=:id AND status='PENDING_REVIEW'
                """, review(id, ops, subject, key, fingerprint).addValue("reason", reason));
        changed(changed);
    }

    public List<Proposal> page(OpsContext ops, String status, UUID after, int limit) {
        return jdbc.query(
                "SELECT * FROM platform.refund_proposal WHERE organization_id=:org AND environment_id=:env AND status=:status AND id>:after ORDER BY id LIMIT :limit",
                ops(ops).addValue("status", status).addValue("after", after).addValue("limit", limit),
                PROPOSAL);
    }

    public String reviewerSubject(OpsContext ops) {
        return jdbc.queryForObject(
                "SELECT subject FROM platform.ops_identity WHERE organization_id=:org AND id=:id",
                ops(ops).addValue("id", ops.identityId()),
                String.class);
    }

    private static void changed(int count) {
        if (count != 1) throw new IllegalStateException("Proposal review must change exactly one pending row");
    }

    private static MapSqlParameterSource review(
            UUID id, OpsContext ops, String subject, String key, String fingerprint) {
        return new MapSqlParameterSource()
                .addValue("id", id)
                .addValue("reviewer", ops.identityId())
                .addValue("subject", subject)
                .addValue("key", key)
                .addValue("fingerprint", fingerprint);
    }

    private static MapSqlParameterSource scope(TenantContext c) {
        return new MapSqlParameterSource()
                .addValue("org", c.organizationId())
                .addValue("env", c.environmentId())
                .addValue("app", c.applicationId())
                .addValue("provider", c.allowedProviderAccountId());
    }

    private static MapSqlParameterSource ops(OpsContext c) {
        return new MapSqlParameterSource().addValue("org", c.organizationId()).addValue("env", c.environmentId());
    }

    private static <T> Optional<T> first(List<T> values) {
        return values.isEmpty() ? Optional.empty() : Optional.of(values.getFirst());
    }

    private static List<String> decode(String value) {
        try {
            return JSON.readValue(value, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("Cannot decode proposal evidence references", e);
        }
    }

    private static String encode(List<String> value) {
        try {
            return JSON.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("Cannot encode proposal evidence references", e);
        }
    }
}
