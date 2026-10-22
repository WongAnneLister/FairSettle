-- F05: PayPal sandbox provider accounts. Same rules as Stripe: test mode only, bound by provider_account_ref.
ALTER TABLE platform.provider_account DROP CONSTRAINT provider_account_provider_check;
ALTER TABLE platform.provider_account ADD CONSTRAINT provider_account_provider_check
    CHECK (provider IN ('FAKE','STRIPE','PAYPAL'));
