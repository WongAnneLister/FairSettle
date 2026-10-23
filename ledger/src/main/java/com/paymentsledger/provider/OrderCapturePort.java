package com.paymentsledger.provider;

import com.paymentsledger.provider.ProviderModels.*;

/** Orders with an explicit capture step (PayPal); callers invoke this port outside local database transactions. */
public interface OrderCapturePort {
    ProviderCallResult<OrderFact> queryOrder(ProviderScope scope, String orderId);

    ProviderCallResult<CaptureOrderFact> captureOrder(CaptureOrderCommand command);
}
