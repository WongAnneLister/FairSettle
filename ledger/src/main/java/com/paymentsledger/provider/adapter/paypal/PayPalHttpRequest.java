package com.paymentsledger.provider.adapter.paypal;

import java.util.Map;

public record PayPalHttpRequest(String method, String path, Map<String, String> headers, String body) {
    public PayPalHttpRequest {
        headers = Map.copyOf(headers);
    }

    public static PayPalHttpRequest get(String path, Map<String, String> headers) {
        return new PayPalHttpRequest("GET", path, headers, null);
    }

    public static PayPalHttpRequest post(String path, Map<String, String> headers, String body) {
        return new PayPalHttpRequest("POST", path, headers, body);
    }
}
