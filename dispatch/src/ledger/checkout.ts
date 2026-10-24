import {LedgerPaymentOutcome, LedgerPaymentRequest, LedgerRetryableError} from './ledger-client';

export const CHECKOUT_PRODUCT_REF = 'dispatch-order';
export const CHECKOUT_MIN_CENTS = 1;
export const CHECKOUT_MAX_CENTS = 10000;

export function checkoutKey(orderId: number): string {
  return 'dispatch-order-' + orderId;
}

export function isCheckoutTotal(totalCents: number): boolean {
  return (
    Number.isInteger(totalCents) &&
    totalCents >= CHECKOUT_MIN_CENTS &&
    totalCents <= CHECKOUT_MAX_CENTS
  );
}

export function paymentRequestFor(
  orderId: number,
  totalCents: number,
  urls: {successUrl: string; cancelUrl: string},
): LedgerPaymentRequest {
  if (!isCheckoutTotal(totalCents)) {
    throw new RangeError('Order total must be between 1 and 10000 cents for checkout');
  }
  return {
    orderKey: checkoutKey(orderId),
    productRef: CHECKOUT_PRODUCT_REF,
    priceVersion: 1,
    quantity: totalCents,
    amountMinor: totalCents,
    currency: 'USD',
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
  };
}

export function interpretLedgerResponse(status: number, body: unknown): LedgerPaymentOutcome {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new LedgerRetryableError('ledger ' + status + ' unparsable body');
  }
  const resource = body as Record<string, unknown>;
  const code = typeof resource.code === 'string' ? resource.code : 'UNKNOWN';
  if (status === 200 || status === 201) {
    if (typeof resource.id !== 'string' || !resource.id) {
      throw new LedgerRetryableError('ledger ' + status + ' unparsable body');
    }
    const action = resource.nextAction as Record<string, unknown> | undefined;
    if (
      action?.type === 'REDIRECT_TO_HOSTED_CHECKOUT' &&
      typeof action.hostedUrl === 'string' &&
      action.hostedUrl
    ) {
      return {kind: 'accepted', paymentId: resource.id, checkoutUrl: action.hostedUrl};
    }
    return {kind: 'pending', paymentId: resource.id};
  }
  if (status === 500 && code === 'PROVIDER_UNKNOWN_RESULT') {
    const details = Array.isArray(resource.details) ? resource.details : [];
    const detail = details.find(item => item?.field === 'paymentId');
    return {kind: 'pending', paymentId: typeof detail?.issue === 'string' ? detail.issue : null};
  }
  if ([400, 401, 403, 404, 409, 422].includes(status)) {
    return {kind: 'rejected', status, code};
  }
  throw new LedgerRetryableError('ledger ' + status + ' ' + code);
}
