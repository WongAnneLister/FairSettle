import {UserRole} from 'src/users/entities/user.entity';

import {OrderStatus} from './entities/order.entity';
import {TransitionActor, evaluateTransition} from './order-state-machine';

const ALL_STATUSES = Object.values(OrderStatus);
const ALL_ACTORS: TransitionActor[] = [UserRole.Owner, UserRole.Client, 'AssignedDriver'];

/** The lifecycle, written out independently of the table under test. */
const LEGAL: ReadonlyArray<[OrderStatus, OrderStatus, TransitionActor]> = [
  [OrderStatus.Pending, OrderStatus.Cooking, UserRole.Owner],
  [OrderStatus.Cooking, OrderStatus.Cooked, UserRole.Owner],
  [OrderStatus.Cooked, OrderStatus.PickedUp, 'AssignedDriver'],
  [OrderStatus.PickedUp, OrderStatus.Delivered, 'AssignedDriver'],
];

describe('order state machine', () => {
  describe('the happy path', () => {
    it.each(LEGAL)('allows %s -> %s for %s', (from, to, actor) => {
      expect(evaluateTransition(from, to, actor)).toEqual({kind: 'allowed'});
    });
  });

  describe('idempotency', () => {
    // The property the outbox and webhook work depends on: a redelivered status
    // callback must be a no-op, not an error.
    it.each(ALL_STATUSES)('treats %s -> %s as a no-op', status => {
      expect(evaluateTransition(status, status, UserRole.Owner)).toEqual({kind: 'noop'});
    });

    it('is a no-op even for an actor who could not perform the transition', () => {
      expect(evaluateTransition(OrderStatus.Cooked, OrderStatus.Cooked, UserRole.Client)).toEqual({
        kind: 'noop',
      });
    });
  });

  describe('illegal transitions', () => {
    // The bug this replaces: editOrder checked only the target status against
    // the role, so skipping ahead in the lifecycle was permitted.
    it('refuses to skip Cooking', () => {
      const verdict = evaluateTransition(OrderStatus.Pending, OrderStatus.Cooked, UserRole.Owner);
      expect(verdict.kind).toBe('illegal');
    });

    it('refuses to deliver an order that was never cooked', () => {
      const verdict = evaluateTransition(
        OrderStatus.Pending,
        OrderStatus.Delivered,
        'AssignedDriver',
      );
      expect(verdict.kind).toBe('illegal');
    });

    it('refuses to move backwards', () => {
      expect(
        evaluateTransition(OrderStatus.Delivered, OrderStatus.Cooked, UserRole.Owner).kind,
      ).toBe('illegal');
      expect(evaluateTransition(OrderStatus.Cooked, OrderStatus.Pending, UserRole.Owner).kind).toBe(
        'illegal',
      );
    });

    it('lets nothing leave Delivered', () => {
      ALL_STATUSES.filter(s => s !== OrderStatus.Delivered).forEach(to => {
        ALL_ACTORS.forEach(actor => {
          expect(evaluateTransition(OrderStatus.Delivered, to, actor).kind).toBe('illegal');
        });
      });
    });
  });

  describe('actor restrictions', () => {
    it('does not let a client drive the lifecycle', () => {
      LEGAL.forEach(([from, to]) => {
        expect(evaluateTransition(from, to, UserRole.Client).kind).toBe('forbidden');
      });
    });

    it('does not let an unassigned driver pick up or deliver', () => {
      // actor === null is how the service reports "a driver, but not this
      // order's driver".
      expect(evaluateTransition(OrderStatus.Cooked, OrderStatus.PickedUp, null).kind).toBe(
        'forbidden',
      );
      expect(evaluateTransition(OrderStatus.PickedUp, OrderStatus.Delivered, null).kind).toBe(
        'forbidden',
      );
    });

    it('does not let the owner pick up or deliver', () => {
      expect(evaluateTransition(OrderStatus.Cooked, OrderStatus.PickedUp, UserRole.Owner)).toEqual({
        kind: 'forbidden',
        reason: 'Only AssignedDriver can move an order from Cooked to PickedUp',
      });
    });

    it('does not let a driver start cooking', () => {
      expect(
        evaluateTransition(OrderStatus.Pending, OrderStatus.Cooking, 'AssignedDriver').kind,
      ).toBe('forbidden');
    });
  });

  describe('exhaustively', () => {
    // Every from/to/actor combination resolves to exactly one verdict, and the
    // only ones that come back `allowed` are the four listed in LEGAL.
    it('allows exactly the four documented transitions and nothing else', () => {
      const allowed: string[] = [];

      ALL_STATUSES.forEach(from =>
        ALL_STATUSES.forEach(to =>
          ALL_ACTORS.forEach(actor => {
            const verdict = evaluateTransition(from, to, actor);
            expect(['allowed', 'noop', 'illegal', 'forbidden']).toContain(verdict.kind);
            if (verdict.kind === 'allowed') {
              allowed.push(`${from}->${to}:${actor}`);
            }
          }),
        ),
      );

      expect(allowed.sort()).toEqual(LEGAL.map(([f, t, a]) => `${f}->${t}:${a}`).sort());
    });
  });
});
