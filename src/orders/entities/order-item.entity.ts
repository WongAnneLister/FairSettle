import {Column, Entity, ManyToOne, RelationId} from 'typeorm';
import {Field, InputType, Int, ObjectType} from '@nestjs/graphql';

import {CoreEntity} from 'src/common/entities/core.entity';
import {Dish} from 'src/restaurants/entities/dish.entity';
import {Order} from './order.entity';

@InputType('OrderItemOptionInputType', {isAbstract: true})
@ObjectType()
export class OrderItemOption {
  @Field(type => String)
  name: string;

  @Field(type => String, {nullable: true})
  choice?: string;
}

@InputType('OrderItemInputType', {isAbstract: true})
@ObjectType()
@Entity()
export class OrderItem extends CoreEntity {
  @Field(type => Dish, {nullable: true})
  @ManyToOne(type => Dish, {nullable: true, onDelete: 'CASCADE'})
  dish?: Dish;

  /**
   * A line item belongs to exactly one order. Not exposed as a GraphQL field:
   * Order already resolves its items, and the back-reference would only add a
   * cycle to the schema.
   */
  @ManyToOne(type => Order, order => order.items, {nullable: true, onDelete: 'CASCADE'})
  order?: Order;

  @RelationId((orderItem: OrderItem) => orderItem.order)
  orderId?: number;

  @Field(type => [OrderItemOption], {nullable: true})
  @Column({type: 'json', nullable: true})
  options?: OrderItemOption[];
}
