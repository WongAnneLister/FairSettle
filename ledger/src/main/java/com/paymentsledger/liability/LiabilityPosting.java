package com.paymentsledger.liability;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.paymentsledger.ledger.PostingCommand;
import com.paymentsledger.ledger.PostingLine;
import com.paymentsledger.ledger.Side;
import java.util.ArrayList;
import java.util.Map;
import java.util.UUID;

public final class LiabilityPosting {
    public static final String EVENT_TYPE = "L-LIABILITY";

    private LiabilityPosting() {}

    public static String eventKey(UUID refundId) {
        return "liability.allocate:" + refundId;
    }

    public static PostingCommand command(
            UUID liabilityId,
            UUID refundId,
            UUID paymentId,
            UUID proposalId,
            LiabilityAllocation allocation,
            Map<String, UUID> accounts,
            ObjectMapper mapper) {
        var entries = new ArrayList<PostingLine>();
        for (var line : allocation.lines()) {
            if (line.amountMinor() > 0)
                entries.add(new PostingLine(
                        account(accounts, line.party().accountPurpose()), Side.DEBIT, line.amountMinor()));
        }
        entries.add(new PostingLine(account(accounts, "SALES_RETURNS"), Side.CREDIT, allocation.amountMinor()));
        var facts = mapper.createObjectNode()
                .put("liability_id", liabilityId.toString())
                .put("refund_id", refundId.toString())
                .put("payment_id", paymentId.toString())
                .put("proposal_id", proposalId.toString())
                .put("amount_minor", allocation.amountMinor())
                .put("restaurant_bp", allocation.split().restaurantBp())
                .put("driver_bp", allocation.split().driverBp())
                .put("platform_bp", allocation.split().platformBp())
                .put("restaurant_minor", allocation.restaurantMinor())
                .put("driver_minor", allocation.driverMinor())
                .put("platform_minor", allocation.platformMinor());
        return new PostingCommand(
                eventKey(refundId), EVENT_TYPE, "INTERNAL", liabilityId.toString(), facts, entries, null);
    }

    private static UUID account(Map<String, UUID> accounts, String purpose) {
        UUID id = accounts.get(purpose);
        if (id == null) throw new IllegalStateException("Missing liability account: " + purpose);
        return id;
    }
}
