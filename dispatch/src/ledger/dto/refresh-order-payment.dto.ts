import {Field, InputType, Int, ObjectType} from '@nestjs/graphql';
import {IsInt, Min} from 'class-validator';

import {CoreOutput} from 'src/common/dtos/output.dto';
import {OrderPaymentStatus} from 'src/orders/entities/order.entity';

@InputType()
export class RefreshOrderPaymentInput {
  @Field(type => Int)
  @IsInt()
  @Min(1)
  orderId: number;
}

@ObjectType()
export class RefreshOrderPaymentOutput extends CoreOutput {
  @Field(type => OrderPaymentStatus, {nullable: true})
  paymentStatus?: OrderPaymentStatus;
}
