package com.paymentsledger.payment.domain;

import java.time.Instant;

/**
 * Pure rules for recovering a capture whose outcome is uncertain (ADR §5 timeout path).
 * Never uses a new request id, resends without a fresh GET in the same attempt or outside the window,
 * or marks the payment failed.
 */
public final class CaptureRecoveryRules {
    public enum Next {
        RESOLVE,
        RESEND,
        ESCALATE_WINDOW,
        ESCALATE_AGE,
        WAIT
    }

    private CaptureRecoveryRules() {}

    public static Next next(
            PaymentProgress payment,
            boolean approvedWithoutCapture,
            Instant retryUntil,
            Instant now,
            boolean ageLimitReached) {
        if (payment.status() == PaymentStatus.SUCCEEDED
                && payment.capturedMinor() > 0
                && payment.resolution() == ResolutionStatus.KNOWN) return Next.RESOLVE;
        if (payment.status() == PaymentStatus.CANCELED && payment.resolution() == ResolutionStatus.KNOWN)
            return Next.RESOLVE;
        if (approvedWithoutCapture && PaymentEvidenceRules.capturable(payment))
            return retryUntil != null && now.isBefore(retryUntil) ? Next.RESEND : Next.ESCALATE_WINDOW;
        return ageLimitReached ? Next.ESCALATE_AGE : Next.WAIT;
    }
}
