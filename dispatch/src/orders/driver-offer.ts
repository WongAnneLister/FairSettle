import {Order, OrderPaymentStatus, OrderStatus} from './entities/order.entity';

/** Payment states in which a ready order is offered to drivers (F37). */
export const OFFERED_PAYMENT_STATUSES: readonly OrderPaymentStatus[] = [
  OrderPaymentStatus.Paid,
  OrderPaymentStatus.NotRequired,
];

export function isOfferedToDrivers(
  order: Pick<Order, 'status' | 'driverId' | 'paymentStatus'>,
): boolean {
  return (
    order.status === OrderStatus.Cooked &&
    order.driverId == null &&
    OFFERED_PAYMENT_STATUSES.includes(order.paymentStatus)
  );
}

/** What a driver sees before claiming an order; the claim reveals the customer. */
export function driverPreview(order: Order): Order {
  return {...order, customer: null, customerId: null, checkoutUrl: null, ledgerPaymentId: null};
}
