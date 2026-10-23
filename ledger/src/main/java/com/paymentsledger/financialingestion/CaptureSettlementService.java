package com.paymentsledger.financialingestion;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.financialingestion.repository.CaptureSettlementRepository;
import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.BalanceTransactionFact;
import java.time.Clock;
import java.util.UUID;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Records a capture settlement as a balance transaction, then posts through normal replay (ADR D9).
 * Runs outside caller transactions; each step owns its local transaction and never calls a provider.
 */
public final class CaptureSettlementService {
    private final CaptureSettlementRepository store;
    private final FinancialTransactions transactions;
    private final ObjectMapper mapper;
    private final FinancialReplayService replay;
    private final Clock clock;

    public CaptureSettlementService(
            CaptureSettlementRepository store,
            PlatformTransactionManager tx,
            ObjectMapper mapper,
            FinancialReplayService replay,
            Clock clock) {
        this.store = store;
        this.transactions = new FinancialTransactions(tx);
        this.mapper = mapper.copy().findAndRegisterModules();
        this.replay = replay;
        this.clock = clock;
    }

    /** Returns the replay outcome, OPENING_POLICY_REQUIRED, or EVIDENCE_CONFLICT. */
    public String record(ProviderScope scope, BalanceTransactionFact fact, ProviderEvidence evidence) {
        if (TransactionSynchronizationManager.isActualTransactionActive())
            throw new IllegalStateException("Settlement recording requires no local transaction");
        String outcome = transactions.run(() -> {
            if (!store.lockPolicy(scope)) return "OPENING_POLICY_REQUIRED";
            String immutable = FinancialFacts.immutable(mapper, fact).toString();
            var existing = store.lockBalanceTransaction(scope, fact.btId());
            if (existing.isEmpty()) {
                UUID observation =
                        store.insertObservation(scope, fact.btId(), encode(evidence), encode(fact), clock.instant());
                store.insertBalanceTransaction(
                        scope, fact, evidence.apiVersion(), immutable, encode(fact), observation, clock.instant());
            } else {
                var stored = existing.get();
                if (!tree(stored.immutableFact()).equals(tree(immutable))) {
                    UUID observation = store.insertObservation(
                            scope, fact.btId(), encode(evidence), encode(fact), clock.instant());
                    store.insertConflict(scope, stored.id(), observation, stored.immutableFact(), immutable);
                    return "EVIDENCE_CONFLICT";
                }
            }
            return null;
        });
        return outcome == null ? replay.replay(scope, fact.btId()) : outcome;
    }

    private String encode(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException invalid) {
            throw new IllegalArgumentException("Invalid provider evidence");
        }
    }

    private com.fasterxml.jackson.databind.JsonNode tree(String value) {
        try {
            return mapper.readTree(value);
        } catch (JsonProcessingException invalid) {
            throw new IllegalArgumentException("Invalid durable evidence");
        }
    }
}
