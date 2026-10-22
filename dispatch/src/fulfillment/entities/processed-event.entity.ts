import {Column, Entity, Index} from 'typeorm';

import {CoreEntity} from 'src/common/entities/core.entity';

/**
 * Every webhook event id this system has already handled.
 *
 * A provider that guarantees at-least-once delivery will redeliver — on a
 * timeout, on a 500, on its own retry schedule — and a redelivered "order
 * delivered" callback must not be a second delivery. The unique index is the
 * whole mechanism: the insert either wins or raises a constraint violation, and
 * there is no window between checking and acting in which a concurrent delivery
 * could slip through. A `SELECT` followed by an `INSERT` would have exactly the
 * race that B2 had.
 */
@Entity()
export class ProcessedEvent extends CoreEntity {
  @Index({unique: true})
  @Column({type: 'varchar', length: 128})
  eventId: string;

  @Column({type: 'varchar', length: 64})
  type: string;
}
