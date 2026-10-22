package com.paymentsledger.provider.adapter.paypal;

import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "platform.paypal.enabled", havingValue = "true")
public class PayPalAdapterConfiguration {
    @Bean
    PayPalAuthClient payPalAuthClient(
            @Value("${platform.paypal.base-url:${PAYPAL_BASE_URL:}}") String baseUrl,
            @Value("${platform.paypal.client-id:${PAYPAL_CLIENT_ID:}}") String clientId,
            @Value("${platform.paypal.client-secret:${PAYPAL_CLIENT_SECRET:}}") String clientSecret) {
        return new PayPalAuthClient(baseUrl, clientId, clientSecret, Clock.systemUTC());
    }
}
