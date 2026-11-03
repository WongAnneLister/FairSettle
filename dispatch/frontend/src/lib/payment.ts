import { Order, OrderPaymentStatus } from './types';

export const CHECKOUT_ORDER_KEY = 'fairsettle.checkoutOrderId';

export interface PaymentView {
  label: string;
  tone: 'neutral' | 'waiting' | 'success' | 'danger';
  canPay: boolean;
  canRefresh: boolean;
}

export function isSandboxCheckoutUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'www.sandbox.paypal.com';
  } catch {
    return false;
  }
}

export function paymentView(order: Pick<Order, 'paymentStatus' | 'checkoutUrl'>): PaymentView | null {
  switch (order.paymentStatus) {
    case OrderPaymentStatus.AwaitingPayment:
      if (isSandboxCheckoutUrl(order.checkoutUrl)) {
        return { label: 'Awaiting payment', tone: 'waiting', canPay: true, canRefresh: true };
      }
      if (!order.checkoutUrl) {
        return { label: 'Creating PayPal payment…', tone: 'neutral', canPay: false, canRefresh: false };
      }
      return { label: 'Payment link is invalid. Please contact support.', tone: 'danger', canPay: false, canRefresh: false };
    case OrderPaymentStatus.Paid:
      return { label: 'Paid', tone: 'success', canPay: false, canRefresh: false };
    case OrderPaymentStatus.Failed:
      return { label: 'Payment failed', tone: 'danger', canPay: false, canRefresh: false };
    default:
      return null;
  }
}

export function rememberCheckoutOrder(storage: Pick<Storage, 'setItem'>, orderId: number): void {
  storage.setItem(CHECKOUT_ORDER_KEY, String(orderId));
}

export function takeCheckoutOrder(storage: Pick<Storage, 'getItem' | 'removeItem'>): number | null {
  const value = storage.getItem(CHECKOUT_ORDER_KEY);
  storage.removeItem(CHECKOUT_ORDER_KEY);
  return value !== null && /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : null;
}

export function returnPath(result: string | null, orderId: number | null): string {
  if (orderId === null) return '/orders';
  return result === 'canceled' ? `/orders/${orderId}?payment=canceled` : `/orders/${orderId}`;
}
