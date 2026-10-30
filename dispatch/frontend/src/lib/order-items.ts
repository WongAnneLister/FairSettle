import type { CartItem } from './cart-context';

export interface CreateOrderItem {
  dishId: number;
  options: { name: string; choice?: string }[];
}

/**
 * Dispatch's createOrder has no quantity: each item is one unit, priced once.
 * A cart line of quantity n is therefore sent as n identical items, so the
 * order total (and the PayPal charge) matches the cart.
 */
export function orderItemsFromCart(
  items: Array<Pick<CartItem, 'quantity' | 'options'> & { dish: Pick<CartItem['dish'], 'id'> }>
): CreateOrderItem[] {
  return items.flatMap((item) => {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new RangeError('Invalid cart quantity');
    }
    return Array.from({ length: item.quantity }, () => ({
      dishId: item.dish.id,
      options: item.options.map((opt) => ({
        name: opt.name,
        choice: opt.choice || undefined,
      })),
    }));
  });
}
