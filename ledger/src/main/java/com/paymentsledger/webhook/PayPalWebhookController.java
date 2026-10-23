package com.paymentsledger.webhook;

import com.paymentsledger.common.error.*;
import com.paymentsledger.provider.ProviderCallClassification;
import com.paymentsledger.provider.adapter.paypal.PayPalWebhookVerifier;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

/** Acknowledgement follows the completed receipt transaction; no business processing on this request. */
@RestController
@Profile("api")
public final class PayPalWebhookController {
    private final Supplier<PayPalWebhookEndpoint> endpoint;
    private final PayPalWebhookReceiver receiver;

    @Autowired
    public PayPalWebhookController(ObjectProvider<PayPalWebhookEndpoint> endpoint, PayPalWebhookReceiver receiver) {
        this.endpoint = endpoint::getIfAvailable;
        this.receiver = receiver;
    }

    /** For tests and wiring without Spring. */
    public PayPalWebhookController(PayPalWebhookEndpoint endpoint, PayPalWebhookReceiver receiver) {
        this.endpoint = () -> endpoint;
        this.receiver = receiver;
    }

    @PostMapping(path = "/webhooks/paypal", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Boolean> receive(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        var binding = endpoint.get();
        if (binding == null)
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE, "PayPal webhook endpoint is not configured");
        var headers = new LinkedHashMap<String, String>();
        for (String name : PayPalWebhookVerifier.HEADERS) {
            var values = Collections.list(request.getHeaders(name));
            if (values.size() != 1) throw invalidSignature();
            headers.put(name, values.getFirst());
        }
        byte[] raw;
        try {
            raw = request.getInputStream().readNBytes(binding.maximumBytes() + 1);
        } catch (IOException invalid) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR, "Unable to read webhook payload");
        }
        if (raw.length > binding.maximumBytes())
            throw new ApiException(ErrorCode.VALIDATION_ERROR, "Webhook payload exceeds configured limit");
        var verified = binding.verify(raw, headers);
        if (verified.classification() == ProviderCallClassification.DEFINITIVE_REJECT
                || verified.classification() == ProviderCallClassification.CONTRACT_MISMATCH) throw invalidSignature();
        if (verified.classification() != ProviderCallClassification.SUCCESS || verified.payload() == null)
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE, "Webhook verification unavailable; retry later");
        var receipt = receiver.receive(binding.scope(), binding.accountRef(), raw, verified);
        return Map.of("received", true, "duplicate", receipt.duplicate());
    }

    private static ApiException invalidSignature() {
        return new ApiException(
                ErrorCode.SIGNATURE_VERIFICATION_FAILED, "Webhook signature or endpoint scope is invalid");
    }
}
