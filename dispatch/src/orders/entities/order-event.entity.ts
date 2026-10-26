import {Field, Int, ObjectType, registerEnumType} from '@nestjs/graphql';
import {Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from 'typeorm';
import {Order, OrderStatus} from './order.entity';

export enum OrderEventKind {
  CREATED = 'CREATED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  DRIVER_ASSIGNED = 'DRIVER_ASSIGNED',
}
registerEnumType(OrderEventKind, {name: 'OrderEventKind'});

export enum OrderEventActor {
  Owner = 'Owner',
  Client = 'Client',
  AssignedDriver = 'AssignedDriver',
  FulfillmentProvider = 'FulfillmentProvider',
}
registerEnumType(OrderEventActor, {name: 'OrderEventActor'});

/** One row per applied order change, in the same transaction; never updated; the agent's timeline (F19). */
@ObjectType()
@Entity('order_event')
@Index('IDX_order_event_order', ['orderId', 'id'])
@Check('CHK_order_event_kind', `"kind" IN ('CREATED', 'STATUS_CHANGED', 'DRIVER_ASSIGNED')`)
@Check(
  'CHK_order_event_actor',
  `"actor" IN ('Owner', 'Client', 'AssignedDriver', 'FulfillmentProvider')`,
)
@Check(
  'CHK_order_event_status',
  `("fromStatus" IS NULL OR "fromStatus" IN ('Pending', 'Cooking', 'Cooked', 'PickedUp', 'Delivered'))
    AND ("toStatus" IS NULL OR "toStatus" IN ('Pending', 'Cooking', 'Cooked', 'PickedUp', 'Delivered'))`,
)
@Check(
  'CHK_order_event_shape',
  `("kind" = 'CREATED' AND "fromStatus" IS NULL AND "toStatus" = 'Pending' AND "driverId" IS NULL)
    OR ("kind" = 'STATUS_CHANGED' AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL)
    OR ("kind" = 'DRIVER_ASSIGNED' AND "fromStatus" IS NULL AND "toStatus" IS NULL AND "driverId" IS NOT NULL)`,
)
export class OrderEvent {
  @Field(type => Int)
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  orderId: number;

  @Field(type => OrderEventKind)
  @Column({type: 'varchar', length: 32})
  kind: OrderEventKind;

  @Field(type => OrderStatus, {nullable: true})
  @Column({type: 'varchar', length: 16, nullable: true})
  fromStatus: OrderStatus | null;

  @Field(type => OrderStatus, {nullable: true})
  @Column({type: 'varchar', length: 16, nullable: true})
  toStatus: OrderStatus | null;

  @Field(type => OrderEventActor)
  @Column({type: 'varchar', length: 32})
  actor: OrderEventActor;

  @Field(type => Int, {nullable: true})
  @Column({type: 'integer', nullable: true})
  driverId: number | null;

  @Field(type => String, {nullable: true})
  @Column({type: 'varchar', length: 128, nullable: true})
  providerEventId: string | null;

  @Field(type => Date)
  @Column({type: 'timestamptz', default: () => 'clock_timestamp()'})
  occurredAt: Date;

  @ManyToOne(() => Order, {onDelete: 'CASCADE'})
  @JoinColumn({name: 'orderId'})
  order: Order;
}
