import {Column, Entity, Index} from 'typeorm';

import {CoreEntity} from 'src/common/entities/core.entity';

export enum OutboxStatus {
  /** Waiting to be dispatched, or waiting out a backoff after a failure. */
  Pending = 'Pending',
  /** The provider accepted it. Terminal. */
  Sent = 'Sent',
  /** Retried to exhaustion. Terminal, and requires a human. */
  Dead = 'Dead',
}

export enum OutboxEventType {
  OrderDispatch = 'order.dispatch',
}

/**
 * A side effect that must happen exactly once, recorded in the same transaction
 * as the state change that caused it.
 *
 * The alternative — calling the provider inline from createOrder — has no
 * correct ordering. Call before committing and a rolled-back order has already
 * been dispatched to a real third party. Call after committing and a crash in
 * between loses the dispatch with no record that it was owed. Writing the intent
 * transactionally and delivering it separately is the only arrangement where
 * neither failure is possible.
 */
@Entity()
// The poller's claim query: pending rows whose backoff has elapsed, oldest
// first. Both columns are in the predicate, so the index serves the whole scan.
@Index(['status', 'nextAttemptAt'])
export class OutboxEvent extends CoreEntity {
  @Column({type: 'varchar', length: 64})
  type: OutboxEventType;

  /** The order this event concerns. Not a foreign key on purpose — see below. */
  @Column()
  aggregateId: number;

  /**
   * A self-contained snapshot of what to send.
   *
   * Deliberately not a join back to the order: the payload records what was true
   * when the event was raised. Re-reading the order at delivery time would send
   * whatever it looks like now, which is a different event.
   */
  @Column({type: 'json'})
  payload: Record<string, unknown>;

  @Column({type: 'varchar', length: 16, default: OutboxStatus.Pending})
  status: OutboxStatus;

  @Column({default: 0})
  attempts: number;

  /**
   * When this row becomes eligible again. Set to now() on insert.
   *
   * `timestamptz`, not `timestamp`. A `timestamp without time zone` carries no
   * offset, so node-postgres parses whatever comes back as LOCAL time — and the
   * database runs in UTC while an application process generally does not. With
   * the app on UTC+8 this column read back eight hours in the past, which a test
   * asserting "the next attempt is in the future" caught immediately.
   *
   * The comparison inside the claim query is unaffected, because both sides are
   * the same type there. Only code that reads the value out sees the shift —
   * which is precisely the kind of bug that survives, since the queue keeps
   * working and only the monitoring lies.
   */
  @Column({type: 'timestamptz', default: () => 'now()'})
  nextAttemptAt: Date;

  /** Last failure, kept for diagnosing a Dead row. */
  @Column({type: 'text', nullable: true})
  lastError?: string;

  /**
   * The provider's own identifier, once it has accepted the dispatch.
   *
   * Indexed because it is the correlation key on the way back in: a callback
   * quotes the provider's reference, not ours, and the webhook handler resolves
   * it to an order on every single event.
   */
  @Index()
  @Column({type: 'varchar', length: 128, nullable: true})
  providerRef?: string;
}
