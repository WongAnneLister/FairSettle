import {schema} from '../config/schema-validation';
import {checkoutKey, interpretLedgerResponse, isCheckoutTotal, paymentRequestFor} from './checkout';
import {LedgerRetryableError} from './ledger-client';

const urls = {
  successUrl: 'https://example.com/f15/return',
  cancelUrl: 'https://example.com/f15/cancel',
};

describe('ledger checkout', () => {
  it('checkoutKey derives from the order id', () => {
    expect(checkoutKey(42)).toBe('dispatch-order-42');
    expect(checkoutKey(1).length).toBeGreaterThanOrEqual(8);
  });

  it('paymentRequestFor builds the exact body', () => {
    expect(paymentRequestFor(42, 1875, urls)).toEqual({
      orderKey: 'dispatch-order-42',
      productRef: 'dispatch-order',
      priceVersion: 1,
      quantity: 1875,
      amountMinor: 1875,
      currency: 'USD',
      ...urls,
    });
  });

  it('paymentRequestFor rejects totals outside the range', () => {
    for (const total of [0, 10001, 12.5, -1]) {
      expect(isCheckoutTotal(total)).toBe(false);
      expect(() => paymentRequestFor(42, total, urls)).toThrow(RangeError);
    }
    for (const total of [1, 10000]) {
      expect(isCheckoutTotal(total)).toBe(true);
      expect(paymentRequestFor(42, total, urls).amountMinor).toBe(total);
    }
  });

  it('interpret accepts a redirect', () => {
    for (const status of [201, 200]) {
      expect(
        interpretLedgerResponse(status, {
          id: 'pay_X',
          nextAction: {type: 'REDIRECT_TO_HOSTED_CHECKOUT', hostedUrl: 'https://example.com/pay'},
        }),
      ).toEqual({kind: 'accepted', paymentId: 'pay_X', checkoutUrl: 'https://example.com/pay'});
    }
  });

  it('interpret pending without a redirect', () => {
    expect(
      interpretLedgerResponse(201, {id: 'pay_X', nextAction: {type: 'WAIT_FOR_CONFIRMATION'}}),
    ).toEqual({kind: 'pending', paymentId: 'pay_X'});
  });

  it('interpret unknown result', () => {
    expect(
      interpretLedgerResponse(500, {
        code: 'PROVIDER_UNKNOWN_RESULT',
        details: [{field: 'paymentId', issue: 'pay_X'}],
      }),
    ).toEqual({kind: 'pending', paymentId: 'pay_X'});
    expect(interpretLedgerResponse(500, {code: 'PROVIDER_UNKNOWN_RESULT'})).toEqual({
      kind: 'pending',
      paymentId: null,
    });
  });

  it('interpret deterministic rejections', () => {
    for (const [status, code] of [
      [400, 'VALIDATION_ERROR'],
      [401, 'UNAUTHORIZED'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [409, 'ORDER_INTENT_CONFLICT'],
      [422, 'AMOUNT_MISMATCH'],
    ] as const) {
      expect(interpretLedgerResponse(status, {code})).toEqual({kind: 'rejected', status, code});
    }
    expect(interpretLedgerResponse(400, {})).toEqual({
      kind: 'rejected',
      status: 400,
      code: 'UNKNOWN',
    });
  });

  it('interpret retryable', () => {
    for (const status of [429, 500, 502, 503]) {
      expect(() => interpretLedgerResponse(status, {code: 'INTERNAL_ERROR'})).toThrow(
        LedgerRetryableError,
      );
      expect(() => interpretLedgerResponse(status, {code: 'INTERNAL_ERROR'})).toThrow(
        'ledger ' + status + ' INTERNAL_ERROR',
      );
      try {
        interpretLedgerResponse(status, {code: 'INTERNAL_ERROR'});
      } catch (error) {
        expect((error as Error).message).not.toContain('Bearer');
      }
    }
  });

  it('config requires ledger settings only when enabled', () => {
    const base = {
      NODE_ENV: 'test',
      DB_HOST: 'localhost',
      DB_PORT: 55432,
      DB_USER: 'adminer',
      DB_PASSWORD: 'secret123',
      DB_NAME: 'food_delivery_test',
      SECRET_KEY: 'test-secret',
      REDIS_HOST: 'localhost',
      REDIS_PORT: 56380,
      FULFILLMENT_SIGNING_SECRET: 'mock-secret',
    };
    const disabled = schema.validate(base);
    expect(disabled.error).toBeUndefined();
    expect(disabled.value.LEDGER_CHECKOUT).toBe('disabled');
    expect(disabled.value.LEDGER_TIMEOUT_MS).toBe(10000);
    expect(schema.validate({...base, LEDGER_CHECKOUT: 'enabled'}).error).toBeDefined();
    const complete = {
      ...base,
      LEDGER_CHECKOUT: 'enabled',
      LEDGER_BASE_URL: 'http://127.0.0.1:8080',
      LEDGER_APP_TOKEN: 'app_test-token',
      LEDGER_CHECKOUT_SUCCESS_URL: urls.successUrl,
      LEDGER_CHECKOUT_CANCEL_URL: urls.cancelUrl,
    };
    for (const key of [
      'LEDGER_BASE_URL',
      'LEDGER_APP_TOKEN',
      'LEDGER_CHECKOUT_SUCCESS_URL',
      'LEDGER_CHECKOUT_CANCEL_URL',
    ] as const) {
      const {[key]: _omitted, ...missing} = complete;
      expect(schema.validate(missing).error).toBeDefined();
    }
    expect(
      schema.validate({...complete, LEDGER_CHECKOUT_SUCCESS_URL: 'http://example.com/return'})
        .error,
    ).toBeDefined();
    expect(
      schema.validate({...complete, LEDGER_CHECKOUT_CANCEL_URL: 'http://example.com/cancel'}).error,
    ).toBeDefined();
    expect(schema.validate(complete).error).toBeUndefined();
  });
});
