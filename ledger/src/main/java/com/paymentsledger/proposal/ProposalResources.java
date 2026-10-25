package com.paymentsledger.proposal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.liability.LiabilityParty;
import com.paymentsledger.payment.PaymentIds;
import com.paymentsledger.proposal.domain.ProposalRules;
import com.paymentsledger.proposal.repository.RefundProposalRepository.Proposal;
import java.util.*;

/** Contract resources keep required nullable fields explicit despite global non_null serialization. */
final class ProposalResources {
    private final ObjectMapper mapper;

    ProposalResources(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    ObjectNode proposal(Proposal p, Map<String, Object> allocation) {
        var b = mapper.createObjectNode()
                .put("complaintId", p.complaintId())
                .put("orderRef", p.orderRef())
                .put("paymentId", PaymentIds.format("pay", p.paymentId()))
                .put("decision", p.decision())
                .put("amountMinor", p.amountMinor())
                .put("currency", p.currency())
                .put("reasonCode", p.reasonCode());
        var liability = b.putArray("liability");
        for (var party : LiabilityParty.values())
            liability
                    .addObject()
                    .put("party", party.name())
                    .put("basisPoints", p.split().basisPoints(party));
        b.put("explanation", p.explanation());
        var evidence = b.putArray("evidenceRefs");
        p.evidenceRefs().forEach(evidence::add);
        var run = b.putObject("agentRun").put("threadId", p.threadId());
        if (p.traceId() != null) run.put("traceId", p.traceId());
        b.put("id", PaymentIds.format("prop", p.id()))
                .put("status", p.status())
                .put("createdAt", p.createdAt().toString());
        if (p.reviewedAt() == null) b.putNull("reviewedAt");
        else b.put("reviewedAt", p.reviewedAt().toString());
        if (p.reviewerSubject() == null) b.putNull("reviewer");
        else b.putObject("reviewer").put("subject", p.reviewerSubject()).put("role", p.reviewerRole());
        if (p.rejectionReason() == null) b.putNull("rejectionReason");
        else b.put("rejectionReason", p.rejectionReason());
        if (p.refundId() == null) b.putNull("refundId");
        else b.put("refundId", PaymentIds.format("ref", p.refundId()));
        if (allocation == null) b.putNull("allocation");
        else {
            var node = b.putObject("allocation");
            allocation.forEach((key, value) -> {
                if (value == null) node.putNull(key);
                else node.set(key, mapper.valueToTree(value));
            });
        }
        return b;
    }

    ObjectNode refundable(UUID paymentId, String currency, ProposalRules.Refundable r) {
        return mapper.createObjectNode()
                .put("paymentId", PaymentIds.format("pay", paymentId))
                .put("currency", currency)
                .put("capturedMinor", r.capturedMinor())
                .put("refundedMinor", r.refundedMinor())
                .put("reservedMinor", r.reservedMinor())
                .put("refundableMinor", r.refundableMinor())
                .put("controlState", r.controlState());
    }

    ObjectNode page(List<ObjectNode> items, String nextCursor) {
        var b = mapper.createObjectNode();
        var array = b.putArray("items");
        items.forEach(array::add);
        if (nextCursor == null) b.putNull("nextCursor");
        else b.put("nextCursor", nextCursor);
        return b;
    }
}
