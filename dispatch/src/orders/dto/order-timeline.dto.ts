import {Field, InputType, Int, ObjectType} from '@nestjs/graphql';
import {IsInt, Min} from 'class-validator';
import {CoreOutput} from 'src/common/dtos/output.dto';
import {OrderEvent} from '../entities/order-event.entity';

@InputType()
export class OrderTimelineInput {
  @Field(type => Int)
  @IsInt()
  @Min(1)
  orderId: number;
}

@ObjectType()
export class OrderTimelineOutput extends CoreOutput {
  @Field(type => [OrderEvent], {nullable: true})
  events?: OrderEvent[];
}
