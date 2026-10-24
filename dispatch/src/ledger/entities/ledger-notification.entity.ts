import {Column, Entity, Index} from 'typeorm';

import {CoreEntity} from 'src/common/entities/core.entity';

/** Durable receipt and outcome; raw payloads and credentials are never stored. */
@Entity()
@Index('IDX_ledger_notification_event', ['eventId'], {unique: true})
export class LedgerNotification extends CoreEntity {
  @Column({type: 'varchar', length: 64})
  eventId: string;

  @Column({type: 'varchar', length: 64})
  eventType: string;

  @Column({type: 'varchar', length: 256})
  businessKey: string;

  @Column({type: 'char', length: 64})
  digest: string;

  /** The correlated dispatch order; intentionally not a foreign key. */
  @Column({type: 'integer', nullable: true})
  orderId: number | null;

  @Column({type: 'varchar', length: 128})
  outcome: string;
}
