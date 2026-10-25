package com.paymentsledger.payment;

import static com.paymentsledger.payment.PaymentRepository.*;

import com.paymentsledger.financialingestion.CaptureSettlementService;
import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.*;
import java.time.*;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** Refund adapter for the shared coordinator. Provider calls always follow committed common leases. */
@Component
public class RefundExecutor {
    private final PaymentRepository operations;
    private final RefundRepository refunds;
    private final RefundPort port;
    private final RefundSearchPort search;
    private final CaptureSettlementService settlements;
    private final String provider;

    @Autowired
    public RefundExecutor(
            PaymentRepository operations,
            RefundRepository refunds,
            ObjectProvider<RefundPort> ports,
            ObjectProvider<RefundSearchPort> searches,
            ObjectProvider<CaptureSettlementService> settlements,
            Environment env) {
        this(
                operations,
                refunds,
                ports.getIfAvailable(),
                searches.getIfAvailable(),
                settlements.getIfAvailable(),
                env.getProperty("platform.stripe.enabled", Boolean.class, false)
                        ? "STRIPE"
                        : env.getProperty("platform.paypal.enabled", Boolean.class, false)
                                ? "PAYPAL"
                                : env.getProperty("platform.provider.fake.enabled", Boolean.class, false)
                                        ? "FAKE"
                                        : null);
    }

    public RefundExecutor(PaymentRepository operations, RefundRepository refunds, RefundPort port, String provider) {
        this(operations, refunds, port, null, null, provider);
    }

    public RefundExecutor(
            PaymentRepository operations,
            RefundRepository refunds,
            RefundPort port,
            RefundSearchPort search,
            CaptureSettlementService settlements,
            String provider) {
        this.operations = operations;
        this.refunds = refunds;
        this.port = port;
        this.search = search;
        this.settlements = settlements;
        this.provider = provider;
    }

    public String providerName() {
        return port == null ? null : provider;
    }

    public void execute(UUID operation) {
        outsideTransaction();
        if (port == null) return;
        var claim = operations.claim(operation, provider);
        if (claim != null) executeClaim(claim);
    }

    void executeClaim(Claim claim) {
        outsideTransaction();
        if ("QUERY_REFUND".equals(claim.type())) {
            recover(claim);
            return;
        }
        if (!refunds.submitted(claim)) return;
        var command = operations.decode(claim.operation().get("command"), CreateRefundCommand.class);
        var result = call(() -> port.createRefund(command), command.operationIdempotencyKey());
        refunds.finish(claim, result, false);
        postSettlement(claim, result);
    }

    void recover(Claim claim) {
        outsideTransaction();
        if (port == null) return;
        String anchor = operations.refundRecoveryAnchor(claim);
        if ("CONFLICTING_REFUND_ANCHORS".equals(anchor)) {
            refunds.conflictingAnchors(claim);
            return;
        }
        if ("CONFLICT".equals(claim.payment().get("resolution_status"))) {
            operations.escalate(claim, "EVIDENCE_CONFLICT");
            return;
        }
        if (anchor != null) {
            String id = anchor;
            var result = call(
                    () -> port.queryRefund(RefundRepository.scope(claim.payment()), id),
                    str(claim.operation(), "operation_key"));
            refunds.finish(claim, result, true);
            postSettlement(claim, result);
            return;
        }
        if ("QUERY_REFUND".equals(claim.type())) {
            operations.escalate(claim, "QUERY_WITHOUT_TRUSTED_REFUND");
            return;
        }
        if ("PREPARED".equals(claim.operation().get("status"))) {
            executeClaim(claim);
            return;
        }
        if (search != null) {
            recoverBySearch(claim);
            return;
        }
        Instant horizon = instant(claim.operation(), "retry_until"),
                first = instant(claim.operation(), "first_send_at");
        Duration verified = operations.recoveryPolicy().verifiedWindow(provider);
        if (horizon != null
                && first != null
                && operations.now().isBefore(horizon)
                && !verified.isZero()
                && operations.now().isBefore(first.plus(verified))) executeClaim(claim);
        else
            operations.escalate(
                    claim, horizon == null ? "IDEMPOTENCY_WINDOW_UNVERIFIED" : "IDEMPOTENCY_WINDOW_EXPIRED");
    }

    /** ADR §7 / D12: find the refund by custom_id; never resend. */
    private void recoverBySearch(Claim claim) {
        var payment = operations.payment((UUID) claim.payment().get("payment_id"));
        String orderId = str(payment, "checkout_session_id");
        String refundId = claim.operation().get("refund_id").toString();
        if (orderId == null) {
            operations.escalate(claim, "REFUND_WITHOUT_ORDER");
            return;
        }
        Instant requested = operations.now();
        ProviderCallResult<List<OrderRefundFact>> result;
        try {
            result = search.queryOrderRefunds(RefundRepository.scope(claim.payment()), orderId);
        } catch (RuntimeException unavailable) {
            result = new ProviderCallResult<>(
                    ProviderCallClassification.TIMEOUT_UNKNOWN,
                    null,
                    new ProviderEvidence(null, null, requested, null, null, "port_exception", null, null));
        }
        if (result.classification() != ProviderCallClassification.SUCCESS || result.payload() == null) {
            refunds.finish(claim, new ProviderCallResult<>(result.classification(), null, result.evidence()), true);
            return;
        }
        var matches = result.payload().stream()
                .filter(f -> refundId.equals(f.customId()))
                .toList();
        if (matches.size() > 1) refunds.conflictingAnchors(claim);
        else if (matches.size() == 1) {
            var adopted = new ProviderCallResult<>(
                    ProviderCallClassification.SUCCESS, matches.getFirst().refund(), result.evidence());
            refunds.finish(claim, adopted, true);
            postSettlement(claim, adopted);
        } else
            refunds.finish(
                    claim,
                    new ProviderCallResult<>(ProviderCallClassification.TRANSIENT_EMPTY, null, result.evidence()),
                    true);
    }

    /** Posts a refund settlement after its write-back committed; failures leave it for the next query. */
    private void postSettlement(Claim claim, ProviderCallResult<RefundFact> result) {
        if (settlements == null || result.payload() == null || result.payload().settlement() == null) return;
        try {
            settlements.record(
                    RefundRepository.scope(claim.payment()), result.payload().settlement(), result.evidence());
        } catch (RuntimeException unavailable) {
            // Leave the settlement for a later authoritative query.
        }
    }

    public void refreshProviderRefund(ProviderScope scope, String providerRefundId) {
        outsideTransaction();
        if (port == null || scope.livemode()) return;
        operations.checkProviderScope(scope, provider);
        var result = call(() -> port.queryRefund(scope, providerRefundId), null);
        if (result.classification() == ProviderCallClassification.SUCCESS
                && result.payload() != null
                && providerRefundId.equals(result.payload().refundId()))
            refunds.accept(scope, result.payload(), result.evidence(), null);
        else
            refunds.recordSourceQuery(
                    scope,
                    providerRefundId,
                    new ProviderCallResult<>(result.classification(), null, result.evidence()));
    }

    private ProviderCallResult<RefundFact> call(Supplier<ProviderCallResult<RefundFact>> action, String key) {
        outsideTransaction();
        Instant start = operations.now();
        try {
            return action.get();
        } catch (RuntimeException e) {
            return new ProviderCallResult<>(
                    ProviderCallClassification.TIMEOUT_UNKNOWN,
                    null,
                    new ProviderEvidence(null, key, start, null, null, "port_exception", null, null));
        }
    }
}
