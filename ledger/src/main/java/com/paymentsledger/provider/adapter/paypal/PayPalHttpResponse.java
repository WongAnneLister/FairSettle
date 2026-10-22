package com.paymentsledger.provider.adapter.paypal;

import java.util.List;
import java.util.Map;

record PayPalHttpResponse(int status, Map<String, List<String>> headers, String body) {
    PayPalHttpResponse {
        headers = Map.copyOf(headers);
        body = body == null ? "" : body;
    }

    /** First value of the header, case-insensitive; null if absent. */
    String header(String name) {
        return headers.entrySet().stream()
                .filter(entry -> entry.getKey().equalsIgnoreCase(name))
                .flatMap(entry -> entry.getValue().stream())
                .findFirst()
                .orElse(null);
    }
}
