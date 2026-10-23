package com.paymentsledger.payment.domain;

import com.paymentsledger.provider.ProviderCallClassification;

/** Pure rules for a PayPal capture call's write-back; recovery resends belong to F07. */
public final class CaptureOutcomeRules {
    private CaptureOutcomeRules() {}

    public record Outcome(String operationStatus, String operationResolution, boolean markUnknown, boolean conflict) {}

    public static boolean queriesAfter(ProviderCallClassification classification, String errorCode) {
        return classification == ProviderCallClassification.SUCCESS
                || classification == ProviderCallClassification.DEFINITIVE_REJECT && buyerRejection(errorCode);
    }

    public static Outcome decide(
            ProviderCallClassification classification,
            String errorCode,
            boolean orderMatches,
            PaymentProgress payment) {
        if (payment.status() == PaymentStatus.SUCCEEDED
                && payment.capturedMinor() > 0
                && payment.resolution() == ResolutionStatus.KNOWN)
            return new Outcome("RESOLVED", "KNOWN", false, false);
        if (classification == ProviderCallClassification.SUCCESS)
            return orderMatches
                    ? new Outcome("UNKNOWN", "UNKNOWN", true, false)
                    : new Outcome("UNKNOWN", "CONFLICT", true, true);
        if (classification == ProviderCallClassification.CONTRACT_MISMATCH)
            return new Outcome("UNKNOWN", "CONFLICT", true, true);
        if (classification == ProviderCallClassification.DEFINITIVE_REJECT)
            return buyerRejection(errorCode)
                    ? new Outcome("ACKNOWLEDGED", "KNOWN", false, false)
                    : new Outcome("ACKNOWLEDGED", "CONFLICT", true, true);
        if (classification == ProviderCallClassification.CAPABILITY_UNAVAILABLE)
            return new Outcome("ACKNOWLEDGED", "KNOWN", false, false);
        return new Outcome("UNKNOWN", "UNKNOWN", true, false);
    }

    private static boolean buyerRejection(String errorCode) {
        return "ORDER_NOT_APPROVED".equals(errorCode) || "INSTRUMENT_DECLINED".equals(errorCode);
    }
}
