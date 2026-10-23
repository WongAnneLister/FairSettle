package com.paymentsledger.provider;

import com.paymentsledger.provider.ProviderModels.OrderRefundFact;
import java.util.List;

/** Finds provider refunds by the ledger's correlation id (PayPal custom_id, ADR D12); outside local transactions. */
public interface RefundSearchPort {
    ProviderCallResult<List<OrderRefundFact>> queryOrderRefunds(ProviderScope scope, String orderId);
}
