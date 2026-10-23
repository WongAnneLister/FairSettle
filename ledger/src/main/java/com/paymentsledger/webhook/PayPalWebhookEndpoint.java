package com.paymentsledger.webhook;

import com.paymentsledger.provider.*;
import com.paymentsledger.provider.ProviderModels.VerifiedWebhook;
import com.paymentsledger.provider.adapter.paypal.PayPalAuthClient;
import com.paymentsledger.provider.adapter.paypal.PayPalWebhookVerifier;
import java.time.Clock;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** Trusted PayPal webhook binding; no request field selects an account, scope or webhook id. */
@Component
@Profile("api")
@ConditionalOnProperty(name = "platform.webhooks.paypal.enabled", havingValue = "true")
public final class PayPalWebhookEndpoint {
    private final ProviderScope scope;
    private final String accountRef;
    private final int maximumBytes;
    private final PayPalWebhookVerifier verifier;

    @Autowired
    public PayPalWebhookEndpoint(Environment environment, PayPalAuthClient client, Clock clock) {
        try {
            scope = new ProviderScope(
                    UUID.fromString(value(environment, "organization-id", "PAYPAL_ORGANIZATION_ID")),
                    UUID.fromString(value(environment, "environment-id", "PAYPAL_ENVIRONMENT_ID")),
                    UUID.fromString(value(environment, "provider-account-id", "PAYPAL_PROVIDER_ACCOUNT_ID")),
                    false);
            accountRef = value(environment, "client-id", "PAYPAL_CLIENT_ID");
            if (accountRef == null || accountRef.isBlank()) throw new IllegalArgumentException();
            maximumBytes = environment.getProperty("platform.webhooks.paypal.max-body-bytes", Integer.class, 262144);
            if (maximumBytes < 1 || maximumBytes > 1048576) throw new IllegalArgumentException();
            verifier = new PayPalWebhookVerifier(client, value(environment, "webhook-id", "PAYPAL_WEBHOOK_ID"), clock);
        } catch (RuntimeException invalid) {
            throw new IllegalArgumentException(
                    "Enabled PayPal webhook requires valid trusted scope, client id, webhook id and limits");
        }
    }

    /** For tests and wiring without Spring. */
    public PayPalWebhookEndpoint(
            ProviderScope scope, String accountRef, int maximumBytes, PayPalWebhookVerifier verifier) {
        this.scope = Objects.requireNonNull(scope);
        this.accountRef = Objects.requireNonNull(accountRef);
        this.verifier = Objects.requireNonNull(verifier);
        this.maximumBytes = maximumBytes;
        if (scope.livemode() || accountRef.isBlank() || maximumBytes < 1 || maximumBytes > 1048576)
            throw new IllegalArgumentException(
                    "Enabled PayPal webhook requires valid trusted scope, client id, webhook id and limits");
    }

    private static String value(Environment environment, String key, String fallback) {
        return environment.getProperty("platform.paypal." + key, environment.getProperty(fallback));
    }

    ProviderScope scope() {
        return scope;
    }

    String accountRef() {
        return accountRef;
    }

    int maximumBytes() {
        return maximumBytes;
    }

    ProviderCallResult<VerifiedWebhook> verify(byte[] raw, Map<String, String> headers) {
        return verifier.verify(raw, headers);
    }
}
