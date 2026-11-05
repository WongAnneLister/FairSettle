import { describe, expect, it } from 'vitest';
import {
  DELIVERY_FAILURE_REASONS, ORDER_STATUS_LABELS, isFinished,
  claimFailureMessage, markFailedInput, quickActionsFor,
} from './order-actions';
import { DeliveryFailureReason, OrderStatus, User, UserRole } from './types';

const customer = { id: 1, role: UserRole.Client };
const owner = { id: 2, role: UserRole.Owner };
const driver = { id: 5, role: UserRole.Delivery };
const otherDriver = { id: 6, role: UserRole.Delivery };
const assigned: User = { ...driver, email: 'driver@example.test', emailVerified: true };
const order = (status: OrderStatus, assignedDriver: User | null = null) => ({ status, driver: assignedDriver });

describe('order actions', () => {
  it('customer sees no controls', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(quickActionsFor(order(status), customer)).toEqual([]);
    }
  });

  it('signed-out viewer sees no controls', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(quickActionsFor(order(status), null)).toEqual([]);
    }
  });

  it('owner controls', () => {
    expect(quickActionsFor(order(OrderStatus.Pending), owner)).toEqual(['startCooking']);
    expect(quickActionsFor(order(OrderStatus.Cooking), owner)).toEqual(['finishCooking']);
    for (const status of [OrderStatus.Cooked, OrderStatus.PickedUp, OrderStatus.Delivered, OrderStatus.DeliveryFailed]) {
      expect(quickActionsFor(order(status), owner)).toEqual([]);
    }
  });

  it('driver can claim an unassigned ready order', () => {
    expect(quickActionsFor(order(OrderStatus.Cooked), driver)).toEqual(['takeOrder']);
  });

  it('only the assigned driver picks up', () => {
    expect(quickActionsFor(order(OrderStatus.Cooked, assigned), driver)).toEqual(['pickUp']);
    expect(quickActionsFor(order(OrderStatus.Cooked, assigned), otherDriver)).toEqual([]);
  });

  it('assigned driver delivers or fails', () => {
    expect(quickActionsFor(order(OrderStatus.PickedUp, assigned), driver)).toEqual(['deliver', 'markFailed']);
    expect(quickActionsFor(order(OrderStatus.PickedUp, assigned), otherDriver)).toEqual([]);
  });

  it('finished orders have no controls', () => {
    for (const status of [OrderStatus.Delivered, OrderStatus.DeliveryFailed]) {
      for (const user of [owner, driver, customer]) {
        expect(quickActionsFor(order(status, assigned), user)).toEqual([]);
      }
    }
  });

  it('status labels and finished', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(ORDER_STATUS_LABELS[status].length).toBeGreaterThan(0);
      expect(ORDER_STATUS_LABELS[status]).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/);
      expect(isFinished(status)).toBe([OrderStatus.Delivered, OrderStatus.DeliveryFailed].includes(status));
    }
    expect(ORDER_STATUS_LABELS.DeliveryFailed).toBe('Delivery failed');
  });

  it('failure input and reasons', () => {
    expect(markFailedInput(7, DeliveryFailureReason.DRIVER_FAULT)).toEqual({
      id: 7, status: 'DeliveryFailed', failureReason: 'DRIVER_FAULT',
    });
    expect(DELIVERY_FAILURE_REASONS.map(reason => reason.value)).toEqual(['DRIVER_FAULT', 'PLATFORM_FAULT']);
  });

  it('lost race', () => {
    expect(claimFailureMessage('This order already has a driver')).toEqual({
      title: 'Another driver claimed this order', description: 'Available orders have been refreshed',
    });
  });

  it('unpaid', () => {
    expect(claimFailureMessage('Order is not paid yet')).toEqual({
      title: 'Order not paid yet', description: 'Only paid orders can be claimed',
    });
  });

  it('other', () => {
    expect(claimFailureMessage('Order is Cooking, not Cooked')).toEqual({
      title: 'Claim failed', description: 'Order is Cooking, not Cooked',
    });
    expect(claimFailureMessage(null)).toEqual({title: 'Claim failed', description: 'Please try again later'});
  });
});
