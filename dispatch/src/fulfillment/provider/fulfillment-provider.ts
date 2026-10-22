export const FULFILLMENT_PROVIDER = 'FULFILLMENT_PROVIDER';

export interface DispatchRequest {
  orderId: number;
  restaurantName: string;
  address: string;
  totalCents: number;
}

export interface DispatchResult {
  /** The provider's identifier for this delivery job. */
  providerRef: string;
}

/**
 * The boundary between this system and whoever actually delivers the order.
 *
 * Everything past this interface is someone else's service, with its own
 * latency, its own outages and its own opinion about how many times to redeliver
 * a callback. Keeping it behind one small interface is what makes the rest of
 * the system testable: the outbox, the retry policy and the webhook handling can
 * all be exercised against a provider that fails on demand, which a real one
 * will not do on request.
 *
 * `dispatch` may throw. That is expected, and is what the retry policy is for.
 */
export interface FulfillmentProvider {
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
}
