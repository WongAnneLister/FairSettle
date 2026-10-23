package com.paymentsledger.provider.adapter.paypal;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.time.Clock;
import java.util.*;

/** LOCAL_HTTP_FIXTURE: strict FIFO replies, no real PayPal calls. */
public final class PayPalTestTransport implements PayPalTransport {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final List<Sent> calls = new ArrayList<>();
    private final Deque<Object> replies = new ArrayDeque<>();
    private int replyNumber;

    public record Sent(String method, URI uri, Map<String, String> headers, String body) {}

    public PayPalTestTransport token() {
        replies.add(new PayPalHttpResponse(
                200, Map.of(), "{\"access_token\":\"tok-fixture\",\"token_type\":\"Bearer\",\"expires_in\":32400}"));
        return this;
    }

    public PayPalTestTransport reply(int status, String body) {
        replies.add(new PayPalHttpResponse(status, Map.of("PayPal-Debug-Id", List.of("dbg-" + ++replyNumber)), body));
        return this;
    }

    public PayPalTestTransport fail(Exception error) {
        replies.add(error);
        return this;
    }

    public List<Sent> calls() {
        return List.copyOf(calls);
    }

    public List<Sent> orderCalls() {
        return calls.stream()
                .filter(s -> s.uri().getPath().startsWith("/v2/checkout/orders"))
                .toList();
    }

    public PayPalAuthClient client(Clock clock) {
        return new PayPalAuthClient(null, "client-fixture", "secret-fixture-do-not-log", clock, this);
    }

    @Override
    public PayPalHttpResponse send(String method, URI uri, Map<String, String> headers, String body)
            throws IOException, InterruptedException {
        calls.add(new Sent(method, uri, Map.copyOf(headers), body));
        Object next = replies.removeFirst();
        if (next instanceof IOException error) throw error;
        if (next instanceof InterruptedException error) throw error;
        var response = (PayPalHttpResponse) next;
        if (response.body().contains("$CUSTOM_ID")) {
            String customId = JSON.readTree(body)
                    .path("purchase_units")
                    .path(0)
                    .path("custom_id")
                    .asText();
            return new PayPalHttpResponse(
                    response.status(), response.headers(), response.body().replace("$CUSTOM_ID", customId));
        }
        return response;
    }

    public static String order(String id, String status, String customId, boolean payerAction) {
        var order = JSON.createObjectNode();
        order.put("id", id);
        order.put("status", status);
        order.put("create_time", "2026-10-22T09:00:00Z");
        var unit = order.putArray("purchase_units").addObject();
        unit.put("reference_id", customId);
        unit.put("custom_id", customId);
        unit.putObject("amount").put("currency_code", "USD").put("value", "100.00");
        order.putObject("payer").put("email_address", "sb-buyer@personal.example.com");
        var links = order.putArray("links");
        links.addObject().put("rel", "self").put("href", "https://api-m.sandbox.paypal.com/v2/checkout/orders/" + id);
        links.addObject()
                .put("rel", payerAction ? "payer-action" : "approve")
                .put("href", "https://www.sandbox.paypal.com/checkoutnow?token=" + id);
        return order.toString();
    }

    public static String capturedOrder(
            String id, String customId, String captureId, String captureStatus, boolean breakdown) {
        try {
            var order = (com.fasterxml.jackson.databind.node.ObjectNode)
                    JSON.readTree(order(id, "COMPLETED", customId, false));
            var unit = (com.fasterxml.jackson.databind.node.ObjectNode)
                    order.path("purchase_units").path(0);
            var capture = unit.putObject("payments").putArray("captures").addObject();
            capture.put("id", captureId)
                    .put("status", captureStatus)
                    .put("final_capture", true)
                    .put("create_time", "2026-10-22T09:05:08Z")
                    .put("update_time", "2026-10-22T09:05:08Z");
            capture.putObject("amount").put("currency_code", "USD").put("value", "100.00");
            if (breakdown) {
                var amounts = capture.putObject("seller_receivable_breakdown");
                amounts.putObject("gross_amount").put("currency_code", "USD").put("value", "100.00");
                amounts.putObject("paypal_fee").put("currency_code", "USD").put("value", "3.49");
                amounts.putObject("net_amount").put("currency_code", "USD").put("value", "96.51");
            }
            if (captureStatus.equals("PENDING"))
                capture.putObject("status_details").put("reason", "PENDING_REVIEW");
            return order.toString();
        } catch (IOException invalidFixture) {
            throw new AssertionError(invalidFixture);
        }
    }

    public static String captureResponse(String orderId, String captureId) {
        var order = JSON.createObjectNode().put("id", orderId).put("status", "COMPLETED");
        order.putArray("purchase_units")
                .addObject()
                .putObject("payments")
                .putArray("captures")
                .addObject()
                .put("id", captureId)
                .put("status", "COMPLETED");
        return order.toString();
    }

    public static String refund(String id, String captureId, String status, String value, String fee, String customId) {
        var refund = JSON.createObjectNode()
                .put("id", id)
                .put("status", status)
                .put("custom_id", customId)
                .put("create_time", "2026-10-22T10:00:00Z");
        refund.putObject("amount").put("currency_code", "USD").put("value", value);
        var links = refund.putArray("links");
        links.addObject().put("rel", "self").put("href", "https://api.sandbox.paypal.com/v2/payments/refunds/" + id);
        links.addObject()
                .put("rel", "up")
                .put("href", "https://api.sandbox.paypal.com/v2/payments/captures/" + captureId);
        if (fee != null) {
            var breakdown = refund.putObject("seller_payable_breakdown");
            breakdown.putObject("gross_amount").put("currency_code", "USD").put("value", value);
            breakdown.putObject("paypal_fee").put("currency_code", "USD").put("value", fee);
            breakdown
                    .putObject("net_amount")
                    .put("currency_code", "USD")
                    .put(
                            "value",
                            new java.math.BigDecimal(value)
                                    .subtract(new java.math.BigDecimal(fee))
                                    .toPlainString());
        }
        return refund.toString();
    }

    public static String orderWithRefunds(String orderId, String customId, String captureId, String... refundBodies) {
        try {
            var order = (com.fasterxml.jackson.databind.node.ObjectNode)
                    JSON.readTree(capturedOrder(orderId, customId, captureId, "COMPLETED", true));
            var payments = (com.fasterxml.jackson.databind.node.ObjectNode)
                    order.path("purchase_units").path(0).path("payments");
            var refunds = payments.putArray("refunds");
            for (String body : refundBodies) refunds.add(JSON.readTree(body));
            return order.toString();
        } catch (IOException invalidFixture) {
            throw new AssertionError(invalidFixture);
        }
    }
}
