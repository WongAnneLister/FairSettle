package com.paymentsledger.payment;

import static com.paymentsledger.payment.PaymentRepository.*;

import com.paymentsledger.common.error.*;
import com.paymentsledger.financialingestion.CaptureSettlementService;
import com.paymentsledger.payment.domain.CaptureOutcomeRules;
import com.paymentsledger.payment.domain.CaptureRecoveryRules;
import com.paymentsledger.payment.domain.PaymentFacts;
import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.*;
import java.time.*;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** Commands execute only after committed leases; recovery chooses whether an uncertain command is safe. */
@Component
public class PaymentExecutor {
    private final PaymentRepository repository;
    private final CheckoutPort checkout;
    private final PaymentIntentPort intents;
    private final ChargePort charges;
    private final OrderCapturePort orders;
    private final CaptureSettlementService settlements;
    private final String providerName;

    @Autowired
    public PaymentExecutor(
            PaymentRepository repository,
            ObjectProvider<CheckoutPort> checkout,
            ObjectProvider<PaymentIntentPort> intents,
            ObjectProvider<ChargePort> charges,
            ObjectProvider<OrderCapturePort> orders,
            ObjectProvider<CaptureSettlementService> settlements,
            Environment environment) {
        this(
                repository,
                checkout.getIfAvailable(),
                intents.getIfAvailable(),
                charges.getIfAvailable(),
                orders.getIfAvailable(),
                settlements.getIfAvailable(),
                environment.getProperty("platform.stripe.enabled", Boolean.class, false)
                        ? "STRIPE"
                        : environment.getProperty("platform.paypal.enabled", Boolean.class, false)
                                ? "PAYPAL"
                                : environment.getProperty("platform.provider.fake.enabled", Boolean.class, false)
                                        ? "FAKE"
                                        : null);
    }

    public PaymentExecutor(
            PaymentRepository repository,
            CheckoutPort checkout,
            PaymentIntentPort intents,
            ChargePort charges,
            String providerName) {
        this(repository, checkout, intents, charges, null, null, providerName);
    }

    public PaymentExecutor(
            PaymentRepository repository,
            CheckoutPort checkout,
            PaymentIntentPort intents,
            ChargePort charges,
            OrderCapturePort orders,
            CaptureSettlementService settlements,
            String providerName) {
        this.repository = repository;
        this.checkout = checkout;
        this.intents = intents;
        this.charges = charges;
        this.orders = orders;
        this.settlements = settlements;
        this.providerName = providerName;
    }

    String providerName() {
        return checkout == null ? null : providerName;
    }

    public void drainPrepared(int limit) {
        outsideTransaction();
        if (checkout == null) return;
        for (UUID id : repository.prepared(limit, providerName)) {
            try {
                execute(id);
            } catch (ApiException unavailable) {
                /* A disabled binding remains durable and unsent. */
            }
        }
    }

    public void execute(UUID operation) {
        outsideTransaction();
        if (checkout == null) return;
        var claim = repository.claim(operation, providerName);
        if (claim == null) return;
        executeClaim(claim);
    }

    void executeClaim(Claim claim) {
        outsideTransaction();
        if (claim.type().equals("CREATE_CHECKOUT")) {
            if (repository.deferCreateWithRemoteFact(claim)) return;
            var command = repository.decode(claim.operation().get("command"), CreateCheckoutSessionCommand.class);
            repository.finishCreate(
                    claim, call(() -> checkout.createSession(command), command.operationIdempotencyKey()));
        } else if (claim.type().equals("CAPTURE_ORDER")) capture(claim);
        else cancel(claim);
    }

    private <T> ProviderCallResult<T> call(Supplier<ProviderCallResult<T>> action, String key) {
        outsideTransaction();
        Instant start = repository.now();
        try {
            return action.get();
        } catch (RuntimeException failed) {
            // Exception messages may contain secrets: retain only a fixed redacted classification.
            return new ProviderCallResult<>(
                    ProviderCallClassification.TIMEOUT_UNKNOWN,
                    null,
                    new ProviderEvidence(null, key, start, null, null, "port_exception", null, null));
        }
    }

    private ProviderScope scope(Map<String, Object> p) {
        return new ProviderScope(
                uuid(p, "organization_id"), uuid(p, "environment_id"), uuid(p, "provider_account_id"), false);
    }

    private static boolean success(ProviderCallResult<?> result) {
        return result.payload() != null
                && (result.classification() == ProviderCallClassification.SUCCESS
                        || result.classification() == ProviderCallClassification.AUTH_REQUIRED);
    }

    public void refresh(UUID payment) {
        outsideTransaction();
        var p = repository.payment(payment);
        if (p == null || p.get("checkout_session_id") == null && p.get("payment_intent_id") == null) return;
        // Recovered captures have immutable source provenance, not a CREATE_CHECKOUT operation.
        // L3 refreshes their provider evidence through its existing durable task.
        if ("RECONCILIATION".equals(p.get("origin"))) return;
        var query = query(p);
        boolean applicable = repository.mergeQuery(
                payment, repository.createOperation(payment), query.observations(), query.facts());
        if (applicable) postSettlements(p, query);
        repository.preparedCapture(payment).ifPresent(operation -> {
            try {
                execute(operation);
            } catch (ApiException unavailable) {
                /* A disabled binding remains durable and unsent. */
            }
        });
    }

    ProviderQueryService.Queried query(Map<String, Object> payment) {
        return new ProviderQueryService(repository, checkout, intents, charges, orders).query(payment);
    }

    void capture(Claim claim) {
        outsideTransaction();
        if (orders == null || repository.skipCapture(claim)) return;
        var command = repository.decode(claim.operation().get("command"), CaptureOrderCommand.class);
        var result = call(() -> orders.captureOrder(command), command.operationIdempotencyKey());
        var queried = CaptureOutcomeRules.queriesAfter(
                        result.classification(), result.evidence().providerErrorCode())
                ? query(claim.payment())
                : null;
        if (repository.finishCapture(claim, result, queried)) postSettlements(claim.payment(), queried);
    }

    /** ADR §5: a PREPARED capture is sent; any other is queried first and resent only per CaptureRecoveryRules. */
    void recoverCapture(Claim claim) {
        if ("PREPARED".equals(claim.operation().get("status"))) {
            executeClaim(claim);
            return;
        }
        var queried = query(claim.payment());
        var recovered = repository.finishCaptureRecovery(claim, queried);
        if (recovered.applicable()) postSettlements(claim.payment(), queried);
        if (recovered.next() == CaptureRecoveryRules.Next.RESEND)
            capture(new Claim(
                    claim.operationId(),
                    claim.paymentId(),
                    claim.token(),
                    claim.version(),
                    claim.type(),
                    claim.operation(),
                    repository.payment(claim.paymentId())));
    }

    /** A failure leaves PENDING_EVIDENCE; a later authoritative query or L2 wake retries posting. */
    void postSettlements(Map<String, Object> payment, ProviderQueryService.Queried queried) {
        if (settlements == null || queried.facts().settlements().isEmpty()) return;
        var evidence = queried.observations().stream()
                .filter(o -> o.type().equals("QUERY_ORDER"))
                .reduce((first, last) -> last)
                .map(o -> o.result().evidence())
                .orElse(null);
        if (evidence == null) return;
        for (var settlement : queried.facts().settlements()) {
            try {
                settlements.record(scope(payment), settlement, evidence);
            } catch (RuntimeException unavailable) {
                // Capture facts have committed; leave posting pending so the next query or L2 wake retries.
            }
        }
    }

    private boolean unpaid(PaymentFacts facts) {
        return ProviderQueryService.unpaid(facts);
    }

    void cancel(Claim claim) {
        try (var budget = ProviderRequestBudget.openOrJoin(32)) {
            cancelWithinBudget(claim);
        }
    }

    private void cancelWithinBudget(Claim claim) {
        if (claim.payment().get("checkout_session_id") == null) {
            if (repository.cancelUnsent(claim)) return;
            repository.finishCancel(
                    claim, List.of(), new PaymentFacts(null, null, List.of(), false, false, repository.now()), false);
            return;
        }
        var before = new ProviderQueryService(repository, checkout, intents, charges, orders)
                .budget(15)
                .query(claim.payment());
        var facts = before.facts();
        var observations = new ArrayList<>(before.observations());
        boolean canceled = false;
        if (unpaid(facts)) {
            if (facts.session().status() == CheckoutSessionStatus.OPEN) {
                String sessionId = facts.session().sessionId();
                var result = call(
                        () -> checkout.expireSession(scope(claim.payment()), sessionId),
                        str(claim.operation(), "operation_key"));
                observations.add(new Observation(
                        "EXPIRE_SESSION",
                        result,
                        result.payload() == null
                                ? facts.session().sessionId()
                                : result.payload().sessionId()));
                if (success(result)
                        && result.payload().sessionId().equals(facts.session().sessionId())
                        && matchesMetadata(result.payload().metadata(), claim.paymentId())
                        && result.payload().status() == CheckoutSessionStatus.EXPIRED) {
                    var after = new ProviderQueryService(repository, checkout, intents, charges, orders)
                            .budget(15)
                            .query(claim.payment());
                    observations.addAll(after.observations());
                    facts = after.facts();
                    canceled = unpaid(facts) && facts.session().status() == CheckoutSessionStatus.EXPIRED;
                } else {
                    var after = new ProviderQueryService(repository, checkout, intents, charges, orders)
                            .budget(15)
                            .query(claim.payment());
                    observations.addAll(after.observations());
                    facts = after.facts();
                }
            } else if (facts.session().status() == CheckoutSessionStatus.EXPIRED) canceled = true;
        }
        // Persist uncertain cancellation separately even if the query has known facts.
        if (!canceled && facts.charges().stream().noneMatch(ChargeFact::captured))
            facts = new PaymentFacts(
                    facts.session(),
                    facts.intent(),
                    facts.charges(),
                    false,
                    facts.conflict(),
                    facts.confirmedAt(),
                    facts.paymentVersion());
        repository.finishCancel(claim, observations, facts, canceled);
    }
}
