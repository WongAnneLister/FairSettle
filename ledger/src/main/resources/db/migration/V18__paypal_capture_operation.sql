-- F06: one CAPTURE_ORDER operation per PayPal payment (ADR D5).
ALTER TABLE platform.provider_operation DROP CONSTRAINT provider_operation_operation_type_check;
ALTER TABLE platform.provider_operation ADD CONSTRAINT provider_operation_operation_type_check
    CHECK (operation_type IN ('CREATE_CHECKOUT','CANCEL_PAYMENT','CREATE_REFUND','QUERY_REFUND','CAPTURE_ORDER'));
