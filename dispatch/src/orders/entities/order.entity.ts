import {Column, Entity, Index, ManyToOne, OneToMany, RelationId} from 'typeorm';
import {Field, Int, InputType, ObjectType, registerEnumType} from '@nestjs/graphql';
import {IsEnum, IsNumber} from 'class-validator';

import {CoreEntity} from 'src/common/entities/core.entity';
import {OrderItem} from './order-item.entity';
import {Restaurant} from 'src/restaurants/entities/restaurant.entity';
import {User} from 'src/users/entities/user.entity';

export enum OrderStatus {
  Pending = 'Pending',
  Cooking = 'Cooking',
  Cooked = 'Cooked',
  PickedUp = 'PickedUp',
  Delivered = 'Delivered',
}

registerEnumType(OrderStatus, {name: 'OrderStatus'});

@InputType('OrderInputType', {isAbstract: true})
@ObjectType()
@Entity()
// One composite index per role's query path in getOrders. Status is the second
// column in each because it is an equality filter applied on top of the owner
// predicate, and leaving it off would still let the index serve the unfiltered
// case.
@Index(['restaurant', 'status'])
@Index(['driver', 'status'])
@Index(['customer', 'status'])
export class Order extends CoreEntity {
  @Field(type => User, {nullable: true})
  @ManyToOne(type => User, user => user.orders, {onDelete: 'SET NULL', nullable: true, eager: true})
  customer?: User;

  @RelationId((order: Order) => order.customer)
  customerId: number;

  @Field(type => User, {nullable: true})
  @ManyToOne(type => User, user => user.rides, {onDelete: 'SET NULL', nullable: true, eager: true})
  driver?: User;

  @RelationId((order: Order) => order.driver)
  driverId: number;

  @Field(type => Restaurant, {nullable: true})
  @ManyToOne(type => Restaurant, restaurant => restaurant.orders, {
    onDelete: 'SET NULL',
    nullable: true,
    eager: true,
  })
  restaurant?: Restaurant;

  /**
   * Was @ManyToMany with a join table, which states that a line item may belong
   * to several orders — not true of the domain, and an extra table to traverse
   * on every read.
   */
  @Field(type => [OrderItem])
  @OneToMany(type => OrderItem, item => item.order, {eager: true, cascade: true})
  items: OrderItem[];

  /** Integer cents — see Dish.priceCents. Was a Float over an integer column. */
  @Column({nullable: true})
  @Field(type => Int, {nullable: true})
  @IsNumber()
  totalCents?: number;

  @Column({type: 'enum', enum: OrderStatus, default: OrderStatus.Pending})
  @Field(type => OrderStatus)
  @IsEnum(OrderStatus)
  status: OrderStatus;
}
