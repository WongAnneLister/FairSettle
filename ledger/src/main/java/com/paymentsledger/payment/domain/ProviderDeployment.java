package com.paymentsledger.payment.domain;

/**
 * The single provider account this deployment's credentials belong to (Stripe or PayPal). A request bound to that
 * provider must match it exactly; any value may be null when the deployment has no such configuration, which then
 * rejects every request for that provider. For PayPal, accountId is the sandbox REST app's client id.
 */
public record ProviderDeployment(
        String accountId, String organizationId, String environmentId, String providerAccountId) {}
