import {Field, InputType, ObjectType} from '@nestjs/graphql';
import {PaginationInput, PaginationOutput} from 'src/common/dtos/pagination.dto';
import {Order} from '../entities/order.entity';

@InputType()
export class AvailableOrdersInput extends PaginationInput {}

@ObjectType()
export class AvailableOrdersOutput extends PaginationOutput {
  @Field(type => [Order], {nullable: true})
  orders?: Order[];
}
