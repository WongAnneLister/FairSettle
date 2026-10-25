package com.paymentsledger.proposal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.identity.AuthenticationFilter;
import com.paymentsledger.payment.PaymentIds;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("api")
public class RefundProposalController {
    private final RefundProposalService service;

    public RefundProposalController(RefundProposalService service) {
        this.service = service;
    }

    @PostMapping("/v1/refund-proposals")
    public ResponseEntity<ObjectNode> create(
            HttpServletRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String key,
            @RequestBody JsonNode body) {
        var result = service.create(AuthenticationFilter.tenant(request), key, body);
        return result.replay()
                ? ResponseEntity.ok().header("Idempotent-Replay", "true").body(result.body())
                : ResponseEntity.created(URI.create("/v1/refund-proposals/"
                                + result.body().path("id").asText()))
                        .body(result.body());
    }

    @GetMapping("/v1/refund-proposals/{id}")
    public ObjectNode get(HttpServletRequest request, @PathVariable String id) {
        return service.get(AuthenticationFilter.tenant(request), PaymentIds.parse("prop", id));
    }

    @GetMapping("/v1/payments/{id}/refundable")
    public ObjectNode refundable(HttpServletRequest request, @PathVariable String id) {
        return service.refundable(AuthenticationFilter.tenant(request), PaymentIds.payment(id));
    }
}
