package com.paymentsledger.proposal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.common.error.*;
import com.paymentsledger.identity.*;
import com.paymentsledger.liability.LiabilityService;
import com.paymentsledger.ops.*;
import com.paymentsledger.payment.*;
import com.paymentsledger.payment.domain.RefundReservationRules;
import com.paymentsledger.payment.domain.RefundablePayment;
import com.paymentsledger.proposal.domain.ProposalRules;
import com.paymentsledger.proposal.repository.RefundProposalRepository;
import com.paymentsledger.proposal.repository.RefundProposalRepository.Proposal;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Coordinates submission and human review without bypassing refund reservation or liability rules. */
public final class RefundProposalService {
    public record Result(ObjectNode body, boolean replay) {}

    private final RefundProposalRepository proposals;
    private final TransactionTemplate tx;
    private final ObjectMapper mapper;
    private final ProposalResources resources;
    private final RefundRepository refunds;
    private final LiabilityService liability;
    private final OpsAuditService audit;
    private final Supplier<String> provider;

    public RefundProposalService(
            RefundProposalRepository proposals,
            PlatformTransactionManager manager,
            ObjectMapper mapper,
            RefundRepository refunds,
            LiabilityService liability,
            OpsAuditService audit,
            Supplier<String> provider) {
        this.proposals = proposals;
        this.tx = new TransactionTemplate(manager);
        this.mapper = mapper;
        this.resources = new ProposalResources(mapper);
        this.refunds = refunds;
        this.liability = liability;
        this.audit = audit;
        this.provider = provider;
    }

    public Result create(TenantContext tenant, String key, JsonNode body) {
        TenantAccessGuard.requireScope(tenant, "refund-proposals:write");
        PaymentRequests.idempotencyKey(key);
        var request = ProposalRequests.create(body);
        return tx.execute(status -> {
            proposals.lock(RefundReservationRules.lockKey(tenant, "REFUND_PROPOSAL", key));
            proposals.lock(RefundReservationRules.lockKey(tenant, "REFUND_PROPOSAL_COMPLAINT", request.complaintId()));
            var prior = proposals.findByKey(tenant, key);
            if (prior.isPresent()) {
                if (!prior.get().requestFingerprint().equals(request.fingerprint()))
                    throw error(ErrorCode.IDEMPOTENCY_CONFLICT);
                return new Result(resource(prior.get()), true);
            }
            var complaint = proposals.findByComplaint(tenant, request.complaintId());
            if (complaint.isPresent())
                throw new ApiException(
                        ErrorCode.PROPOSAL_EXISTS,
                        "A proposal already exists for this complaint",
                        List.of(new ApiError.Detail(
                                "complaintId",
                                PaymentIds.format("prop", complaint.get().id()))));
            var payment = payment(tenant, request.paymentId());
            if (!request.currency().equals(payment.currency()))
                throw new ApiException(
                        ErrorCode.VALIDATION_ERROR,
                        "Invalid refund proposal request",
                        List.of(new ApiError.Detail("currency", "must equal the payment currency")));
            RefundReservationRules.requireRefundable(tenant, payment, request.currency());
            ProposalRules.requireProposable(proposals.refundable(payment), request.amountMinor());
            UUID id = PaymentIds.newId();
            proposals.insert(id, tenant, payment, request, key);
            return new Result(resource(proposals.findScoped(tenant, id).orElseThrow()), false);
        });
    }

    public ObjectNode get(TenantContext tenant, UUID proposalId) {
        TenantAccessGuard.requireScope(tenant, "refund-proposals:read");
        return resource(proposals
                .findScoped(tenant, proposalId)
                .filter(p -> tenant.allowedCurrencies().contains(p.currency()))
                .orElseThrow(() -> error(ErrorCode.NOT_FOUND)));
    }

    public ObjectNode refundable(TenantContext tenant, UUID paymentId) {
        TenantAccessGuard.requireScope(tenant, "payments:read");
        var payment = payment(tenant, paymentId);
        return resources.refundable(paymentId, payment.currency(), proposals.refundable(payment));
    }

    public ObjectNode list(OpsContext ops, Map<String, String> query) {
        OpsAuthorization.read(ops, false);
        String status = query.getOrDefault("status", "PENDING_REVIEW");
        if (!Set.of("PENDING_REVIEW", "APPROVED", "REJECTED").contains(status)) throw error(ErrorCode.VALIDATION_ERROR);
        int limit;
        try {
            limit = Integer.parseInt(query.getOrDefault("limit", "50"));
        } catch (NumberFormatException e) {
            throw error(ErrorCode.VALIDATION_ERROR);
        }
        if (limit < 1 || limit > 200) throw error(ErrorCode.VALIDATION_ERROR);
        UUID after = cursor(ops, status, query.get("cursor"));
        var rows = proposals.page(ops, status, after, limit + 1);
        var items = rows.stream().limit(limit).map(this::resource).toList();
        String next = rows.size() > limit
                ? encodeCursor(ops, status, rows.get(limit - 1).id())
                : null;
        return resources.page(items, next);
    }

    public Result decide(OpsContext ops, UUID proposalId, String key, JsonNode body) {
        OpsAuthorization.write(ops, "DECIDE_REFUND_PROPOSAL");
        PaymentRequests.idempotencyKey(key);
        var request = ProposalRequests.decision(body);
        return tx.execute(status -> {
            var p = proposals.lockForReview(ops, proposalId).orElseThrow(() -> error(ErrorCode.NOT_FOUND));
            var before = mapper.createObjectNode().put("status", p.status());
            String result;
            boolean replay = false;
            if (!"PENDING_REVIEW".equals(p.status())) {
                var rule = ProposalRules.decided(
                        p.status().equals("APPROVED") ? "APPROVE" : "REJECT",
                        p.decisionIdempotencyKey(),
                        p.decisionFingerprint(),
                        request.action(),
                        key,
                        request.fingerprint());
                switch (rule) {
                    case CONFLICT -> throw error(ErrorCode.IDEMPOTENCY_CONFLICT);
                    case NOT_PENDING -> throw error(ErrorCode.PROPOSAL_NOT_PENDING);
                    case REPLAY -> {
                        replay = true;
                    }
                }
                result = "REPLAYED";
            } else {
                String subject = proposals.reviewerSubject(ops);
                if ("REJECT".equals(request.action())) {
                    proposals.reject(proposalId, ops, subject, request.reason(), key, request.fingerprint());
                    result = "REJECTED";
                } else {
                    var tenant = context(p, "refunds:write");
                    var payment = payment(tenant, p.paymentId());
                    RefundReservationRules.requireRefundable(tenant, payment, p.currency());
                    ProposalRules.requireProposable(proposals.refundable(payment), p.amountMinor());
                    var intent = refunds.prepare(
                            tenant,
                            "proposal-refund:" + proposalId,
                            new RefundRequests.Create(
                                    p.paymentId(),
                                    p.amountMinor(),
                                    p.currency(),
                                    "REQUESTED_BY_CUSTOMER",
                                    "Refund proposal " + PaymentIds.format("prop", proposalId),
                                    "proposal:" + proposalId),
                            provider.get());
                    liability.record(intent.refundId(), proposalId, p.split());
                    proposals.approve(proposalId, ops, subject, intent.refundId(), key, request.fingerprint());
                    result = "APPROVED";
                }
            }
            var current = proposals.lockForReview(ops, proposalId).orElseThrow();
            audit.recordInTransaction(
                    ops,
                    "DECIDE_REFUND_PROPOSAL",
                    PaymentIds.format("prop", proposalId),
                    body,
                    result,
                    before,
                    mapper.createObjectNode().put("status", current.status()));
            return new Result(resource(current), replay);
        });
    }

    private RefundablePayment payment(TenantContext tenant, UUID id) {
        return proposals
                .payment(tenant, id)
                .filter(p -> tenant.allowedCurrencies().contains(p.currency()))
                .orElseThrow(() -> error(ErrorCode.NOT_FOUND));
    }

    private ObjectNode resource(Proposal p) {
        return resources.proposal(
                p, "APPROVED".equals(p.status()) ? liability.read(context(p, "refunds:read"), p.refundId()) : null);
    }

    private static TenantContext context(Proposal p, String scope) {
        return new TenantContext(
                p.organizationId(),
                p.environmentId(),
                p.applicationId(),
                p.providerAccountId(),
                Set.of(p.currency()),
                false,
                Set.of(scope));
    }

    private UUID cursor(OpsContext ops, String status, String value) {
        if (value == null) return new UUID(0, 0);
        try {
            var fields = new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8).split("\\|", -1);
            if (fields.length != 5
                    || !fields[0].equals("refund-proposals")
                    || !fields[1].equals(ops.organizationId().toString())
                    || !fields[2].equals(ops.environmentId().toString())
                    || !fields[3].equals(status)) throw error(ErrorCode.VALIDATION_ERROR);
            return UUID.fromString(fields[4]);
        } catch (RuntimeException e) {
            throw error(ErrorCode.VALIDATION_ERROR);
        }
    }

    private String encodeCursor(OpsContext ops, String status, UUID id) {
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(("refund-proposals|" + ops.organizationId() + "|" + ops.environmentId() + "|" + status
                                + "|" + id)
                        .getBytes(StandardCharsets.UTF_8));
    }

    private static ApiException error(ErrorCode code) {
        return new ApiException(code, "Refund proposal request could not be completed");
    }
}
