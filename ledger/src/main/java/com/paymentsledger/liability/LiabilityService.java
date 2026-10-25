package com.paymentsledger.liability;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.common.error.ApiException;
import com.paymentsledger.common.error.ErrorCode;
import com.paymentsledger.identity.TenantAccessGuard;
import com.paymentsledger.identity.TenantContext;
import com.paymentsledger.ledger.LedgerPostingService;
import com.paymentsledger.ledger.LedgerScope;
import com.paymentsledger.liability.repository.LiabilityRepository;
import com.paymentsledger.payment.PaymentIds;
import com.paymentsledger.payment.domain.RefundViewRules;
import com.paymentsledger.payment.repository.RefundRecordRepository;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

public final class LiabilityService {
    private static final Logger LOG = LoggerFactory.getLogger(LiabilityService.class);
    private final LiabilityRepository repository;
    private final TransactionTemplate tx;
    private final ObjectMapper mapper;
    private final LedgerPostingService ledger;
    private final RefundRecordRepository refunds;

    public LiabilityService(
            LiabilityRepository repository,
            PlatformTransactionManager manager,
            ObjectMapper mapper,
            LedgerPostingService ledger,
            RefundRecordRepository refunds) {
        this.repository = repository;
        this.tx = new TransactionTemplate(manager);
        this.mapper = mapper;
        this.ledger = ledger;
        this.refunds = refunds;
    }

    public UUID record(UUID refundId, UUID proposalId, LiabilitySplit split) {
        return tx.execute(status -> {
            if (refundId == null || proposalId == null || split == null)
                throw new ApiException(ErrorCode.VALIDATION_ERROR, "Refund, proposal and liability split are required");
            var refund = repository
                    .refund(refundId)
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Refund not found"));
            var allocation = LiabilityAllocation.allocate(refund.amountMinor(), split);
            Optional<UUID> inserted;
            try {
                inserted = repository.insert(refundId, refund, proposalId, allocation);
            } catch (DuplicateKeyException e) {
                throw new ApiException(ErrorCode.EVIDENCE_CONFLICT, "Proposal already has a liability allocation");
            }
            if (inserted.isPresent()) return inserted.get();
            var existing = repository
                    .findByRefund(refundId)
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Refund liability not found"));
            if (proposalId.equals(existing.proposalId())
                    && split.equals(existing.allocation().split())) return existing.id();
            throw new ApiException(ErrorCode.EVIDENCE_CONFLICT, "Refund already has a different liability allocation");
        });
    }

    public boolean post(UUID liabilityId) {
        return Boolean.TRUE.equals(tx.execute(status -> {
            var row = repository
                    .lock(liabilityId)
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Refund liability not found"));
            if ("POSTED".equals(row.postingStatus())) return false;
            var refund = refunds.find(row.refundId())
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Refund not found"));
            var transactions = refunds.balanceTransactions(refund);
            boolean conflict = transactions.stream()
                    .anyMatch(b -> "QUARANTINED".equals(b.state()) || refunds.hasEvidenceConflict(b.id()));
            String financialStatus = RefundViewRules.financialStatus(refund, transactions, conflict);
            if (!"SUCCEEDED".equals(refund.status()) || !"POSTED".equals(financialStatus)) {
                LOG.debug(
                        "liability_post reason=NOT_READY liabilityId={} refundStatus={} financialStatus={}",
                        liabilityId,
                        refund.status(),
                        financialStatus);
                return false;
            }
            var accounts = repository.provisionAccounts(
                    row.refundId(), row.organizationId(), row.environmentId(), row.currency());
            var command = LiabilityPosting.command(
                    liabilityId, row.refundId(), row.paymentId(), row.proposalId(), row.allocation(), accounts, mapper);
            UUID journal = ledger.post(
                    new LedgerScope(row.organizationId(), row.environmentId(), row.currency(), null), command);
            repository.markPosted(liabilityId, journal);
            return true;
        }));
    }

    public int postReady(int limit) {
        if (TransactionSynchronizationManager.isActualTransactionActive())
            throw new IllegalStateException("Liability batch requires its own transactions");
        if (limit < 1 || limit > 100)
            throw new IllegalArgumentException("Liability batch limit must be between 1 and 100");
        var ids = repository.readyCandidates(limit);
        int posted = 0;
        for (UUID id : ids) {
            long attempt = 0;
            try {
                attempt = tx.execute(status -> repository.markAttempted(id));
                if (post(id)) posted++;
                else if (LiabilityFailures.milestone(attempt))
                    LOG.warn("liability_post reason=STILL_NOT_READY liabilityId={} attempt={}", id, attempt);
            } catch (RuntimeException e) {
                LOG.warn(
                        "liability_post reason=RETRY_REQUIRED liabilityId={} attempt={} {}",
                        id,
                        attempt,
                        LiabilityFailures.describe(e));
            }
        }
        return posted;
    }

    public Map<String, Object> read(TenantContext tenant, UUID refundId) {
        TenantAccessGuard.requireScope(tenant, "refunds:read");
        var row = repository
                .findScoped(refundId, tenant)
                .filter(r -> tenant.allowedCurrencies().contains(r.currency()))
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Refund liability not found"));
        var result = new LinkedHashMap<String, Object>();
        result.put("refundId", PaymentIds.format("ref", refundId));
        result.put("proposalId", PaymentIds.format("prop", row.proposalId()));
        result.put("currency", row.currency());
        result.put("amountMinor", row.allocation().amountMinor());
        result.put(
                "lines",
                row.allocation().lines().stream()
                        .map(line -> {
                            var resource = new LinkedHashMap<String, Object>();
                            resource.put("party", line.party().name());
                            resource.put("basisPoints", line.basisPoints());
                            resource.put("amountMinor", line.amountMinor());
                            return resource;
                        })
                        .toList());
        result.put("postingStatus", row.postingStatus());
        result.put("journalId", row.journalId() == null ? null : row.journalId().toString());
        return result;
    }
}
