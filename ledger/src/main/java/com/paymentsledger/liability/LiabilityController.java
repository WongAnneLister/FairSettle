package com.paymentsledger.liability;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.identity.AuthenticationFilter;
import com.paymentsledger.payment.PaymentIds;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("api")
public class LiabilityController {
    private final LiabilityService service;
    private final ObjectMapper mapper;

    public LiabilityController(LiabilityService service, ObjectMapper mapper) {
        this.service = service;
        this.mapper = mapper;
    }

    @GetMapping("/v1/refunds/{id}/liability")
    public ObjectNode get(HttpServletRequest request, @PathVariable String id) {
        var resource = service.read(AuthenticationFilter.tenant(request), PaymentIds.parse("ref", id));
        var body = mapper.createObjectNode();
        // With non_null inclusion, write F14's required journalId null explicitly, as OpsQueryService does with
        // putNull.
        resource.forEach((key, value) -> {
            if (value == null) body.putNull(key);
            else body.set(key, mapper.valueToTree(value));
        });
        return body;
    }
}
