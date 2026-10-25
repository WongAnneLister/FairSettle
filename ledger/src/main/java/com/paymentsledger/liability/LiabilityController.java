package com.paymentsledger.liability;

import com.paymentsledger.identity.AuthenticationFilter;
import com.paymentsledger.payment.PaymentIds;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("api")
public class LiabilityController {
    private final LiabilityService service;

    public LiabilityController(LiabilityService service) {
        this.service = service;
    }

    @GetMapping("/v1/refunds/{id}/liability")
    public Map<String, Object> get(HttpServletRequest request, @PathVariable String id) {
        return service.read(AuthenticationFilter.tenant(request), PaymentIds.parse("ref", id));
    }
}
