export const LEDGER_CLIENT = Symbol('LEDGER_CLIENT');

export interface LedgerPaymentRequest {
  orderKey: string;
  productRef: 'dispatch-order';
  priceVersion: 1;
  quantity: number;
  amountMinor: number;
  currency: 'USD';
  successUrl: string;
  cancelUrl: string;
}

export type LedgerPaymentOutcome =
  | {kind: 'accepted'; paymentId: string; checkoutUrl: string}
  | {kind: 'settled'; paymentId: string}
  | {kind: 'pending'; paymentId: string | null}
  | {kind: 'rejected'; status: number; code: string};

export type LedgerPaymentRead =
  {kind: 'read'; paymentStatus: string} | {kind: 'rejected'; status: number; code: string};

/** Ledger payment ids: `pay_` and 26 Crockford base-32 characters. */
export const LEDGER_PAYMENT_ID = /^pay_[0-9A-Z]{26}$/;

export interface LedgerClient {
  /**
   * Reads one payment. The ledger queries the provider on every read and captures an
   * approved PayPal order (ADR paypal-state-mapping D5), so this is how dispatch asks
   * for capture after the buyer returns. Dispatch never changes paymentStatus from
   * this answer: only signed notifications do (F16).
   */
  readPayment(paymentId: string): Promise<LedgerPaymentRead>;

  createPayment(
    request: LedgerPaymentRequest,
    idempotencyKey: string,
  ): Promise<LedgerPaymentOutcome>;
}

export class LedgerRetryableError extends Error {}
