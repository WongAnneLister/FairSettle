import {driverPreview, isOfferedToDrivers, OFFERED_PAYMENT_STATUSES} from './driver-offer';
import {Order, OrderPaymentStatus, OrderStatus} from './entities/order.entity';

describe('driver offers', () => {
  const ready = (changes: Partial<Order> = {}) =>
    ({
      status: OrderStatus.Cooked,
      driverId: null,
      paymentStatus: OrderPaymentStatus.Paid,
      ...changes,
    }) as Order;

  it('offered when paid or free', () => {
    expect(isOfferedToDrivers(ready())).toBe(true);
    expect(isOfferedToDrivers(ready({paymentStatus: OrderPaymentStatus.NotRequired}))).toBe(true);
    expect(isOfferedToDrivers(ready({driverId: undefined}))).toBe(true);
  });

  it('unpaid not offered', () => {
    for (const paymentStatus of [OrderPaymentStatus.AwaitingPayment, OrderPaymentStatus.Failed]) {
      expect(isOfferedToDrivers(ready({paymentStatus}))).toBe(false);
    }
  });

  it('only Cooked', () => {
    for (const status of [
      OrderStatus.Pending,
      OrderStatus.Cooking,
      OrderStatus.PickedUp,
      OrderStatus.Delivered,
      OrderStatus.DeliveryFailed,
    ]) {
      expect(isOfferedToDrivers(ready({status}))).toBe(false);
    }
  });

  it('claimed not offered', () => {
    expect(isOfferedToDrivers(ready({driverId: 7}))).toBe(false);
  });

  it('preview hides the customer', () => {
    const order = {
      id: 3,
      status: OrderStatus.Cooked,
      totalCents: 1200,
      paymentStatus: OrderPaymentStatus.Paid,
      customer: {id: 1, email: 'c@x.test'},
      customerId: 1,
      checkoutUrl: 'https://example.com/a',
      ledgerPaymentId: 'pay_1',
      restaurant: {id: 2, name: 'R', address: 'A'},
      items: [{id: 9}],
    } as Order;
    const preview = driverPreview(order);
    expect(preview).not.toBe(order);
    expect(preview.customer).toBeNull();
    expect(preview.customerId).toBeNull();
    expect(preview.checkoutUrl).toBeNull();
    expect(preview.ledgerPaymentId).toBeNull();
    for (const key of [
      'id',
      'status',
      'totalCents',
      'paymentStatus',
      'restaurant',
      'items',
    ] as const) {
      expect(preview[key]).toEqual(order[key]);
    }
    expect(order.customer.email).toBe('c@x.test');
    expect(order.checkoutUrl).toBe('https://example.com/a');
  });

  it('the set', () => {
    expect(OFFERED_PAYMENT_STATUSES).toEqual([
      OrderPaymentStatus.Paid,
      OrderPaymentStatus.NotRequired,
    ]);
  });
});
