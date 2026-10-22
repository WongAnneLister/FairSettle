package com.paymentsledger.provider.adapter.paypal;

public sealed interface PayPalExchange {
    /** PayPal answered the target request; authRetried marks the single retry after a 401. */
    record Responded(int status, String body, String debugId, boolean authRetried) implements PayPalExchange {}

    /** No target request was sent because no token could be obtained. No remote effect. */
    record NotSent(String reason) implements PayPalExchange {}

    /** The target request may have been sent; no answer arrived. The remote effect is unknown. */
    record NoResponse(String reason) implements PayPalExchange {}
}
