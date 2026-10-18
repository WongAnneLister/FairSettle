import {UserRole} from 'src/users/entities/user.entity';

import {OrderStatus} from './entities/order.entity';

/**
 * Who may perform a transition.
 *
 * `AssignedDriver` is deliberately not a UserRole: the rule is not "any driver"
 * but "the driver on this order". The baseline checked only the role, and leant
 * on canSeeOrder elsewhere to catch the rest — so the answer to "who may do
 * this?" lived in two places and had to be kept in step by hand.
 */
export type TransitionActor =
  | UserRole.Owner
  | UserRole.Client
  | 'AssignedDriver'
  /**
   * A third-party fulfillment provider reporting progress over a webhook.
   *
   * Deliberately allowed on exactly the edges it actually performs. The
   * provider is doing the delivery, so it may report PickedUp and Delivered —
   * but whether the kitchen has started cooking is the restaurant's business,
   * and a callback claiming otherwise is rejected rather than trusted because
   * it arrived signed.
   */
  | 'FulfillmentProvider';

/**
 * The order lifecycle, in one place.
 *
 * Replaces a set of conditions scattered through editOrder that checked only
 * the TARGET status against the caller's role, never the current status. Under
 * those rules a Pending order could be marked Cooked directly, and a driver
 * could move Pending straight to Delivered — delivered before it was ever made.
 *
 * Cancellation is intentionally absent. Adding a Cancelled state is a feature
 * with its own refund and notification questions, not part of making the
 * existing lifecycle explicit.
 */
export const ORDER_TRANSITIONS: Readonly<
  Record<OrderStatus, Readonly<Partial<Record<OrderStatus, readonly TransitionActor[]>>>>
> = {
  [OrderStatus.Pending]: {[OrderStatus.Cooking]: [UserRole.Owner]},
  [OrderStatus.Cooking]: {[OrderStatus.Cooked]: [UserRole.Owner]},
  [OrderStatus.Cooked]: {[OrderStatus.PickedUp]: ['AssignedDriver', 'FulfillmentProvider']},
  [OrderStatus.PickedUp]: {[OrderStatus.Delivered]: ['AssignedDriver', 'FulfillmentProvider']},
  [OrderStatus.Delivered]: {},
};

export type TransitionVerdict =
  /** Legal, and this actor may perform it. */
  | {kind: 'allowed'}
  /** Already in the target state. Succeed without writing — see note below. */
  | {kind: 'noop'}
  /** No such edge in the lifecycle, regardless of who is asking. */
  | {kind: 'illegal'; reason: string}
  /** The edge exists, but not for this actor. */
  | {kind: 'forbidden'; reason: string};

/**
 * Decides a single transition. Pure — no I/O, so it is cheap to test
 * exhaustively, which `order-state-machine.spec.ts` does.
 *
 * On idempotency: re-submitting the status an order already holds returns
 * `noop`, not an error. That is not politeness. It is the property that makes
 * at-least-once delivery safe to build on — a third-party provider redelivering
 * a status callback is expected behaviour, not an exceptional one, and the
 * transactional outbox work (D2/D3) depends on this being true.
 */
export function evaluateTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: TransitionActor | null,
): TransitionVerdict {
  if (from === to) {
    return {kind: 'noop'};
  }

  const allowedActors = ORDER_TRANSITIONS[from]?.[to];
  if (!allowedActors) {
    return {kind: 'illegal', reason: `An order cannot go from ${from} to ${to}`};
  }

  if (!actor || !allowedActors.includes(actor)) {
    return {
      kind: 'forbidden',
      reason: `Only ${allowedActors.join(' or ')} can move an order from ${from} to ${to}`,
    };
  }

  return {kind: 'allowed'};
}
