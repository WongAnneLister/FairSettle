package com.paymentsledger.provider.adapter.paypal;

import com.paymentsledger.provider.ProviderScope;
import java.time.Clock;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "platform.paypal.enabled", havingValue = "true")
public class PayPalCheckoutConfiguration {
    @Bean
    PayPalCheckoutAdapter payPalCheckoutAdapter(
            PayPalAuthClient client,
            @Value("${platform.paypal.organization-id:${PAYPAL_ORGANIZATION_ID:}}") String organizationId,
            @Value("${platform.paypal.environment-id:${PAYPAL_ENVIRONMENT_ID:}}") String environmentId,
            @Value("${platform.paypal.provider-account-id:${PAYPAL_PROVIDER_ACCOUNT_ID:}}") String providerAccountId,
            @Value("${platform.stripe.enabled:false}") boolean stripeEnabled,
            @Value("${platform.provider.fake.enabled:false}") boolean fakeEnabled) {
        return new PayPalCheckoutAdapter(
                client,
                scope(organizationId, environmentId, providerAccountId, stripeEnabled, fakeEnabled),
                Clock.systemUTC());
    }

    @Bean
    PayPalRefundAdapter payPalRefundAdapter(
            PayPalAuthClient client,
            @Value("${platform.paypal.organization-id:${PAYPAL_ORGANIZATION_ID:}}") String organizationId,
            @Value("${platform.paypal.environment-id:${PAYPAL_ENVIRONMENT_ID:}}") String environmentId,
            @Value("${platform.paypal.provider-account-id:${PAYPAL_PROVIDER_ACCOUNT_ID:}}") String providerAccountId,
            @Value("${platform.stripe.enabled:false}") boolean stripeEnabled,
            @Value("${platform.provider.fake.enabled:false}") boolean fakeEnabled) {
        return new PayPalRefundAdapter(
                client,
                scope(organizationId, environmentId, providerAccountId, stripeEnabled, fakeEnabled),
                Clock.systemUTC());
    }

    private static ProviderScope scope(
            String organizationId,
            String environmentId,
            String providerAccountId,
            boolean stripeEnabled,
            boolean fakeEnabled) {
        if (stripeEnabled || fakeEnabled)
            throw new IllegalArgumentException("Select exactly one provider implementation");
        ProviderScope scope;
        try {
            scope = new ProviderScope(
                    UUID.fromString(organizationId),
                    UUID.fromString(environmentId),
                    UUID.fromString(providerAccountId),
                    false);
        } catch (RuntimeException invalid) {
            throw new IllegalArgumentException("Valid trusted PayPal scope IDs are required");
        }
        return scope;
    }
}
