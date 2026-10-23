package com.paymentsledger.webhook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paymentsledger.provider.ProviderModels.VerifiedWebhook;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/** Pure rules for PayPal webhook events: the stored snapshot and the match against the verified payload. */
public final class PayPalWebhookEvents {
    private static final Pattern CAPTURE_LINK = Pattern.compile("/v2/payments/captures/([A-Z0-9]{1,36})$");

    private PayPalWebhookEvents() {}

    /** Whitelist-only snapshot; throws if required fields are unsupported. */
    public static ObjectNode snapshot(JsonNode event, ObjectMapper mapper) {
        if (event == null) throw invalid();
        var resource = event.path("resource");
        String type = text(event, "resource_type"), id = text(resource, "id"), eventType = text(event, "event_type");
        if (type == null
                || !type.matches("[A-Za-z_-]{1,64}")
                || id == null
                || !id.matches("[A-Za-z0-9-]{1,64}")
                || eventType == null
                || !eventType.matches("[A-Z0-9._-]{1,128}")) throw invalid();
        var out = mapper.createObjectNode()
                .put("object", "paypal." + type.toLowerCase(Locale.ROOT))
                .put("id", id)
                .put("event_type", eventType);
        bounded(out, event, "resource_version", 16);
        matching(out, "status", text(resource, "status"), "[A-Z_]{1,64}");
        String custom = text(resource, "custom_id");
        if (custom != null) {
            try {
                if (UUID.fromString(custom).toString().equalsIgnoreCase(custom)) out.put("custom_id", custom);
            } catch (IllegalArgumentException invalid) {
                /* Ignore optional invalid correlation ids. */
            }
        }
        matching(
                out,
                "order_id",
                text(resource.path("supplementary_data").path("related_ids"), "order_id"),
                "[A-Z0-9]{1,36}");
        for (var link : resource.path("links")) {
            String href = text(link, "href");
            if (!"up".equals(text(link, "rel")) || href == null) continue;
            var match = CAPTURE_LINK.matcher(href);
            if (match.find()) out.put("capture_id", match.group(1));
        }
        var amount = resource.path("amount");
        String currency = text(amount, "currency_code"), value = text(amount, "value");
        if (currency != null && currency.matches("[A-Z]{3}") && decimal(value))
            out.putObject("amount").put("currency_code", currency).put("value", value);
        var source = resource.has("seller_receivable_breakdown")
                ? resource.path("seller_receivable_breakdown")
                : resource.path("seller_payable_breakdown");
        var breakdown = mapper.createObjectNode();
        matching(breakdown, "gross", text(source.path("gross_amount"), "value"), "\\d+(\\.\\d+)?");
        matching(breakdown, "fee", text(source.path("paypal_fee"), "value"), "\\d+(\\.\\d+)?");
        matching(breakdown, "net", text(source.path("net_amount"), "value"), "\\d+(\\.\\d+)?");
        if (!breakdown.isEmpty()) out.set("breakdown", breakdown);
        bounded(out, resource, "create_time", 40);
        bounded(out, resource, "update_time", 40);
        return out;
    }

    /** True if the parsed event's id, event_type, resource.id and create_time equal the verified payload. */
    public static boolean matches(JsonNode event, VerifiedWebhook verified) {
        if (event == null || verified == null) return false;
        try {
            return verified.eventId().equals(text(event, "id"))
                    && verified.eventType().equals(text(event, "event_type"))
                    && verified.objectId().equals(text(event.path("resource"), "id"))
                    && verified.createdAt().equals(Instant.parse(text(event, "create_time")));
        } catch (RuntimeException invalid) {
            return false;
        }
    }

    private static String text(JsonNode object, String key) {
        return object.path(key).textValue();
    }

    private static boolean decimal(String value) {
        return value != null && value.matches("\\d+(\\.\\d+)?");
    }

    private static void matching(ObjectNode out, String key, String value, String pattern) {
        if (value != null && value.matches(pattern)) out.put(key, value);
    }

    private static void bounded(ObjectNode out, JsonNode source, String key, int length) {
        String value = text(source, key);
        if (value != null && value.length() <= length) out.put(key, value);
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("PayPal webhook event shape is unsupported");
    }
}
