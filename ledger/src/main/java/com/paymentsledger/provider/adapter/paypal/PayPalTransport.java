package com.paymentsledger.provider.adapter.paypal;

import java.io.IOException;
import java.net.URI;
import java.util.Map;

interface PayPalTransport {
    PayPalHttpResponse send(String method, URI uri, Map<String, String> headers, String body)
            throws IOException, InterruptedException;
}
