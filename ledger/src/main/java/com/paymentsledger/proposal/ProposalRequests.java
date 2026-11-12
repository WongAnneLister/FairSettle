package com.paymentsledger.proposal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.common.error.ApiException;
import com.paymentsledger.common.error.ErrorCode;
import com.paymentsledger.liability.LiabilityParty;
import com.paymentsledger.liability.LiabilitySplit;
import com.paymentsledger.payment.PaymentIds;
import java.security.MessageDigest;
import java.util.*;

/** Strict parsing and semantic fingerprints for immutable proposals and review decisions. */
public final class ProposalRequests {
    private ProposalRequests() {}

    public record Create(
            String complaintId,
            String orderRef,
            UUID paymentId,
            String decision,
            long amountMinor,
            String currency,
            String reasonCode,
            LiabilitySplit split,
            String explanation,
            List<String> evidenceRefs,
            String threadId,
            String traceId) {
        public String fingerprint() {
            return digest(Arrays.asList(
                    "REFUND_PROPOSAL_V1",
                    complaintId,
                    orderRef,
                    paymentId.toString(),
                    decision,
                    amountMinor,
                    currency,
                    reasonCode,
                    split.restaurantBp(),
                    split.driverBp(),
                    split.platformBp(),
                    explanation,
                    evidenceRefs,
                    threadId,
                    traceId));
        }
    }

    public record Decision(String action, String reason) {
        public String fingerprint() {
            return digest(Arrays.asList("PROPOSAL_DECISION_V1", action, reason));
        }
    }

    public static Create create(JsonNode body) {
        String message = "Invalid refund proposal request";
        fields(
                body,
                Set.of(
                        "complaintId",
                        "orderRef",
                        "paymentId",
                        "decision",
                        "amountMinor",
                        "currency",
                        "reasonCode",
                        "liability",
                        "explanation",
                        "evidenceRefs",
                        "agentRun"),
                Set.of(),
                message);
        String complaint = text(body, "complaintId", 1, 128, false, message);
        require(complaint.matches("^[A-Za-z0-9._:-]{1,128}$"), message);
        String order = text(body, "orderRef", 1, 64, false, message);
        UUID payment;
        try {
            payment = PaymentIds.payment(text(body, "paymentId", 1, 64, false, message));
        } catch (ApiException e) {
            throw invalid(message);
        }
        String decision = text(body, "decision", 1, 32, false, message);
        require(Set.of("FULL_REFUND", "PARTIAL_REFUND").contains(decision), message);
        var amount = body.get("amountMinor");
        require(amount.isIntegralNumber() && amount.canConvertToLong() && amount.longValue() > 0, message);
        String currency = text(body, "currency", 3, 3, false, message);
        require(currency.matches("[A-Z]{3}"), message);
        String reason = text(body, "reasonCode", 1, 32, false, message);
        require(
                Set.of(
                                "LATE_DELIVERY",
                                "MISSING_ITEM",
                                "WRONG_ITEM",
                                "QUALITY",
                                "FOOD_SAFETY",
                                "DELIVERY_FAILED",
                                "OTHER")
                        .contains(reason),
                message);
        var liability = body.get("liability");
        require(liability.isArray() && liability.size() == 3, message);
        var shares = new EnumMap<LiabilityParty, Integer>(LiabilityParty.class);
        boolean duplicate = false;
        for (var line : liability) {
            fields(line, Set.of("party", "basisPoints"), Set.of(), message);
            LiabilityParty party;
            try {
                party = LiabilityParty.valueOf(text(line, "party", 1, 32, false, message));
            } catch (IllegalArgumentException e) {
                throw invalid(message);
            }
            var bp = line.get("basisPoints");
            require(
                    bp.isIntegralNumber() && bp.canConvertToInt() && bp.intValue() >= 0 && bp.intValue() <= 10000,
                    message);
            if (shares.put(party, bp.intValue()) != null) duplicate = true;
        }
        String explanation = text(body, "explanation", 1, 2000, true, message);
        var refs = body.get("evidenceRefs");
        require(refs.isArray() && refs.size() >= 1 && refs.size() <= 50, message);
        var evidence = new ArrayList<String>();
        for (var ref : refs) {
            require(ref.isTextual(), message);
            validText(ref.textValue(), 1, 128, false, message);
            evidence.add(ref.textValue());
        }
        var run = body.get("agentRun");
        fields(run, Set.of("threadId"), Set.of("traceId"), message);
        String thread = text(run, "threadId", 1, 128, false, message);
        String trace = run.has("traceId") ? text(run, "traceId", 1, 128, false, message) : null;
        var split = LiabilitySplit.of(duplicate ? Map.of() : shares);
        return new Create(
                complaint,
                order,
                payment,
                decision,
                amount.longValue(),
                currency,
                reason,
                split,
                explanation,
                List.copyOf(evidence),
                thread,
                trace);
    }

    public static Decision decision(JsonNode body) {
        String message = "Invalid review decision";
        require(body != null && body.isObject(), message);
        String action = text(body, "action", 1, 16, false, message);
        require(Set.of("APPROVE", "REJECT").contains(action), message);
        fields(body, action.equals("APPROVE") ? Set.of("action") : Set.of("action", "reason"), Set.of(), message);
        return new Decision(action, action.equals("REJECT") ? text(body, "reason", 1, 500, false, message) : null);
    }

    private static void fields(JsonNode body, Set<String> required, Set<String> optional, String message) {
        require(body != null && body.isObject(), message);
        required.forEach(k -> require(body.has(k), message));
        body.fieldNames().forEachRemaining(k -> require(required.contains(k) || optional.contains(k), message));
    }

    private static String text(JsonNode body, String field, int min, int max, boolean newline, String message) {
        var value = body.get(field);
        require(value != null && value.isTextual(), message);
        validText(value.textValue(), min, max, newline, message);
        return value.textValue();
    }

    private static void validText(String value, int min, int max, boolean newline, String message) {
        require(
                value.length() >= min
                        && value.length() <= max
                        && value.codePoints().noneMatch(c -> Character.isISOControl(c) && !(newline && c == '\n')),
                message);
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw invalid(message);
    }

    private static ApiException invalid(String message) {
        return new ApiException(ErrorCode.VALIDATION_ERROR, message);
    }

    private static String digest(Object value) {
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256").digest(new ObjectMapper().writeValueAsBytes(value)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
