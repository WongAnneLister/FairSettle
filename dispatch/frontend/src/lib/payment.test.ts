import { describe, it, expect } from 'vitest';
import {
  CHECKOUT_ORDER_KEY,
  isSandboxCheckoutUrl,
  paymentView,
  rememberCheckoutOrder,
  takeCheckoutOrder,
  returnPath,
} from './payment';
import { OrderPaymentStatus } from './types';

const sandboxUrl = 'https://www.sandbox.paypal.com/checkoutnow?token=7KR80011U08627743';

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    values,
    setItem: (key: string, value: string) => { values.set(key, value); },
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('payment helpers', () => {
  it('accepts only HTTPS PayPal sandbox checkout URLs', () => {
    expect(isSandboxCheckoutUrl(sandboxUrl)).toBe(true);
    for (const url of [
      'https://www.paypal.com/checkoutnow?token=X',
      'http://www.sandbox.paypal.com/x',
      'https://www.sandbox.paypal.com.evil.test/x',
      'javascript:alert(1)',
      '',
      null,
      undefined,
    ]) {
      expect(isSandboxCheckoutUrl(url)).toBe(false);
    }
  });

  it('renders the exact payment view for each payment state', () => {
    expect(paymentView({ paymentStatus: OrderPaymentStatus.NotRequired })).toBeNull();
    expect(paymentView({ paymentStatus: undefined })).toBeNull();
    expect(paymentView({
      paymentStatus: OrderPaymentStatus.AwaitingPayment,
      checkoutUrl: sandboxUrl,
    })).toEqual({ label: 'Awaiting payment', tone: 'waiting', canPay: true, canRefresh: true });
    expect(paymentView({ paymentStatus: OrderPaymentStatus.AwaitingPayment })).toEqual({
      label: 'Creating PayPal payment…', tone: 'neutral', canPay: false, canRefresh: false,
    });
    expect(paymentView({
      paymentStatus: OrderPaymentStatus.AwaitingPayment,
      checkoutUrl: 'https://www.paypal.com/checkoutnow?token=X',
    })).toEqual({
      label: 'Payment link is invalid. Please contact support.', tone: 'danger', canPay: false, canRefresh: false,
    });
    expect(paymentView({ paymentStatus: OrderPaymentStatus.Paid })).toEqual({
      label: 'Paid', tone: 'success', canPay: false, canRefresh: false,
    });
    expect(paymentView({ paymentStatus: OrderPaymentStatus.Failed })).toEqual({
      label: 'Payment failed', tone: 'danger', canPay: false, canRefresh: false,
    });
  });

  it('remembers a checkout order and consumes it once', () => {
    const storage = fakeStorage();
    rememberCheckoutOrder(storage, 42);
    expect(storage.values.get(CHECKOUT_ORDER_KEY)).toBe('42');
    expect(takeCheckoutOrder(storage)).toBe(42);
    expect(storage.values.has(CHECKOUT_ORDER_KEY)).toBe(false);
    expect(takeCheckoutOrder(storage)).toBeNull();
  });

  it('removes and rejects invalid stored order IDs', () => {
    const storage = fakeStorage();
    for (const value of ['0', '-1', '1.5', 'abc', '12345678901']) {
      storage.setItem(CHECKOUT_ORDER_KEY, value);
      expect(takeCheckoutOrder(storage)).toBeNull();
      expect(storage.values.has(CHECKOUT_ORDER_KEY)).toBe(false);
    }
  });

  it('returns to the remembered order with cancellation feedback', () => {
    expect(returnPath('approved', 7)).toBe('/orders/7');
    expect(returnPath('canceled', 7)).toBe('/orders/7?payment=canceled');
    expect(returnPath(null, 7)).toBe('/orders/7');
    expect(returnPath('approved', null)).toBe('/orders');
  });
});
