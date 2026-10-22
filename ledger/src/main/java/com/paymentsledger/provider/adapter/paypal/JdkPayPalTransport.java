package com.paymentsledger.provider.adapter.paypal;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

final class JdkPayPalTransport implements PayPalTransport {
    static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(15);
    private final HttpClient client;

    JdkPayPalTransport() {
        client = HttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT)
                .followRedirects(HttpClient.Redirect.NEVER)
                .version(HttpClient.Version.HTTP_1_1)
                .build();
    }

    @Override
    public PayPalHttpResponse send(String method, URI uri, Map<String, String> headers, String body)
            throws IOException, InterruptedException {
        var publisher = body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8);
        var request = HttpRequest.newBuilder(uri).timeout(REQUEST_TIMEOUT).method(method, publisher);
        headers.forEach(request::header);
        var response = client.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return new PayPalHttpResponse(response.statusCode(), response.headers().map(), response.body());
    }
}
