export const DEFAULT_STOREFRONT_URL = 'http://localhost:3001';
export type CheckoutResult = 'approved' | 'canceled';

/** Where PayPal's return is sent on: the storefront page that finds the order again. */
export function storefrontReturnUrl(storefrontUrl: string, result: CheckoutResult): string {
  const url = new URL('/checkout/return', storefrontUrl);
  url.searchParams.set('result', result);
  return url.toString();
}
