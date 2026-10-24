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

export interface LedgerClient {
  createPayment(
    request: LedgerPaymentRequest,
    idempotencyKey: string,
  ): Promise<LedgerPaymentOutcome>;
}

export class LedgerRetryableError extends Error {}
