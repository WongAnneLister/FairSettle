import {Field, InputType, ObjectType} from '@nestjs/graphql';
import {Order, OrderStatus} from '../entities/order.entity';

import {PaginationInput, PaginationOutput} from 'src/common/dtos/pagination.dto';

@InputType()
export class GetOrdersInput extends PaginationInput {
  @Field(type => OrderStatus, {nullable: true})
  status?: OrderStatus;
}

@ObjectType()
export class GetOrdersOutput extends PaginationOutput {
  @Field(type => [Order], {nullable: true})
  orders?: Order[];
}
