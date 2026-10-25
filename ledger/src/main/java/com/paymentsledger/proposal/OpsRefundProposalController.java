package com.paymentsledger.proposal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.common.error.ApiException;
import com.paymentsledger.identity.AuthenticationFilter;
import com.paymentsledger.ops.*;
import com.paymentsledger.payment.PaymentIds;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("api")
@RequestMapping("/ops/refund-proposals")
public class OpsRefundProposalController {
    private final RefundProposalService service;
    private final OpsAuditService audit;

    public OpsRefundProposalController(RefundProposalService service, OpsAuditService audit) {
        this.service = service;
        this.audit = audit;
    }

    @GetMapping("")
    public ObjectNode list(HttpServletRequest request, @RequestParam Map<String, String> query) {
        return service.list(AuthenticationFilter.ops(request), query);
    }

    @PostMapping("/{id}/decision")
    public ResponseEntity<ObjectNode> decide(
            HttpServletRequest request,
            @PathVariable String id,
            @RequestHeader(value = "Idempotency-Key", required = false) String key,
            @RequestBody JsonNode body) {
        var ops = AuthenticationFilter.ops(request);
        var proposal = OpsAuthorization.resourceId(id, "prop");
        String target = PaymentIds.format("prop", proposal);
        try {
            var result = service.decide(ops, proposal, key, body);
            request.setAttribute("ops.audited", true);
            var response = ResponseEntity.ok();
            if (result.replay()) response.header("Idempotent-Replay", "true");
            return response.body(result.body());
        } catch (RuntimeException e) {
            audit.record(
                    ops,
                    "DECIDE_REFUND_PROPOSAL",
                    target,
                    body,
                    e instanceof ApiException api
                                    && api.errorCode().httpStatus().value() == 403
                            ? "DENIED"
                            : "REJECTED");
            request.setAttribute("ops.audited", true);
            throw e;
        }
    }
}
