import {Field, InputType, ObjectType, PickType} from '@nestjs/graphql';

import {CoreOutput} from 'src/common/dtos/output.dto';
import {DeliveryFailureReason, Order} from '../entities/order.entity';

@InputType()
export class EditOrderInput extends PickType(Order, ['id', 'status']) {
  /** Required when status is DeliveryFailed, refused otherwise (F25). */
  @Field(type => DeliveryFailureReason, {nullable: true})
  failureReason?: DeliveryFailureReason;
}

@ObjectType()
export class EditOrderOutput extends CoreOutput {}
