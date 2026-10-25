package com.paymentsledger.proposal.domain;

import com.paymentsledger.common.error.ApiException;
import com.paymentsledger.common.error.ErrorCode;

/** Pure refund proposal availability and final-decision rules. */
public final class ProposalRules {
    private ProposalRules() {}

    public enum Replay {
        REPLAY,
        CONFLICT,
        NOT_PENDING
    }

    public record Refundable(long capturedMinor, long refundedMinor, long reservedMinor, String controlState) {
        public long refundableMinor() {
            return "NORMAL".equals(controlState) ? Math.max(0, capturedMinor - refundedMinor - reservedMinor) : 0;
        }
    }

    public static void requireProposable(Refundable refundable, long amountMinor) {
        if (!"NORMAL".equals(refundable.controlState()))
            throw new ApiException(ErrorCode.REFUND_BLOCKED, "Refund control is blocked");
        if (amountMinor > refundable.refundableMinor())
            throw new ApiException(ErrorCode.REFUND_LIMIT_EXCEEDED, "Refund exceeds the available amount");
    }

    public static Replay decided(
            String storedAction,
            String storedKey,
            String storedFingerprint,
            String action,
            String key,
            String fingerprint) {
        if (storedKey.equals(key) && !storedFingerprint.equals(fingerprint)) return Replay.CONFLICT;
        return storedAction.equals(action) ? Replay.REPLAY : Replay.NOT_PENDING;
    }
}
