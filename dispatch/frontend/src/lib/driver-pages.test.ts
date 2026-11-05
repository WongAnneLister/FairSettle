import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { print } from 'graphql';
import { AVAILABLE_ORDERS_QUERY } from './graphql/queries';

describe('driver pages', () => {
  it('driver pages use the offer list', () => {
    for (const path of ['../app/driver/available/page.tsx', '../app/driver/page.tsx']) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(source).toContain('AVAILABLE_ORDERS_QUERY');
      expect(source).not.toContain('!o.driver');
      expect(source).not.toContain('OrderStatus.Cooked, page');
    }
  });

  it('the offer query asks for no customer data', () => {
    const document = print(AVAILABLE_ORDERS_QUERY);
    expect(document).toContain('availableOrders');
    expect(document).not.toContain('customer');
    expect(document).not.toContain('checkoutUrl');
    expect(document).not.toContain('ledgerPaymentId');
  });
});
