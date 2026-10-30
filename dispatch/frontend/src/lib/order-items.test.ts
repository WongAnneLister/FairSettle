import { describe, it, expect } from 'vitest';
import { orderItemsFromCart } from './order-items';
import type { CartItem } from './cart-context';

function line(dishId: number, quantity: number, options: CartItem['options'] = []) {
  return {
    dish: { id: dishId, name: 'Dish ' + dishId, priceCents: 100 },
    quantity,
    options,
  };
}

describe('orderItemsFromCart', () => {
  it('sends one item for a line of quantity 1', () => {
    expect(orderItemsFromCart([line(7, 1)])).toEqual([{ dishId: 7, options: [] }]);
  });

  it('repeats a line once per unit, because dispatch prices each item as one unit', () => {
    expect(orderItemsFromCart([line(7, 4)])).toEqual([
      { dishId: 7, options: [] },
      { dishId: 7, options: [] },
      { dishId: 7, options: [] },
      { dishId: 7, options: [] },
    ]);
  });

  it('keeps line order and sends only option name and choice', () => {
    const options = [
      { name: 'Size', choice: 'L', extraCents: 200 },
      { name: 'Extra cheese', choice: '', extraCents: 100 },
    ];
    expect(orderItemsFromCart([line(7, 2, options), line(9, 1)])).toEqual([
      { dishId: 7, options: [{ name: 'Size', choice: 'L' }, { name: 'Extra cheese', choice: undefined }] },
      { dishId: 7, options: [{ name: 'Size', choice: 'L' }, { name: 'Extra cheese', choice: undefined }] },
      { dishId: 9, options: [] },
    ]);
  });

  it('refuses quantities that are not positive integers', () => {
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      expect(() => orderItemsFromCart([line(7, quantity)])).toThrow(RangeError);
    }
  });
});
