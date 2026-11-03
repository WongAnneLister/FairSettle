import { DeliveryFailureReason, Order, OrderStatus, User, UserRole } from './types';

export type QuickAction = 'startCooking' | 'finishCooking' | 'takeOrder' | 'pickUp' | 'deliver' | 'markFailed';

/** English label for every order status (F36). */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.Pending]: 'Waiting for the restaurant',
  [OrderStatus.Cooking]: 'Cooking',
  [OrderStatus.Cooked]: 'Ready for pickup',
  [OrderStatus.PickedUp]: 'On the way',
  [OrderStatus.Delivered]: 'Delivered',
  [OrderStatus.DeliveryFailed]: 'Delivery failed',
};

/** Delivered and DeliveryFailed end an order. */
export function isFinished(status: OrderStatus): boolean {
  return status === OrderStatus.Delivered || status === OrderStatus.DeliveryFailed;
}

/** The order page's demo controls the signed-in user may use, in display order. */
export function quickActionsFor(
  order: Pick<Order, 'status' | 'driver'>,
  user: Pick<User, 'id' | 'role'> | null,
): QuickAction[] {
  if (!user || user.role === UserRole.Client || isFinished(order.status)) return [];
  if (user.role === UserRole.Owner) {
    if (order.status === OrderStatus.Pending) return ['startCooking'];
    if (order.status === OrderStatus.Cooking) return ['finishCooking'];
    return [];
  }
  if (user.role === UserRole.Delivery) {
    if (order.status === OrderStatus.Cooked && !order.driver) return ['takeOrder'];
    if (order.driver?.id === user.id) {
      if (order.status === OrderStatus.Cooked) return ['pickUp'];
      if (order.status === OrderStatus.PickedUp) return ['deliver', 'markFailed'];
    }
  }
  return [];
}

export const DELIVERY_FAILURE_REASONS: ReadonlyArray<{ value: DeliveryFailureReason; label: string }> = [
  { value: DeliveryFailureReason.DRIVER_FAULT, label: 'Driver fault' },
  { value: DeliveryFailureReason.PLATFORM_FAULT, label: 'Platform fault' },
];

/** The editOrder input that marks a picked-up order as a failed delivery. */
export function markFailedInput(orderId: number, reason: DeliveryFailureReason):
  { id: number; status: OrderStatus.DeliveryFailed; failureReason: DeliveryFailureReason } {
  return { id: orderId, status: OrderStatus.DeliveryFailed, failureReason: reason };
}
