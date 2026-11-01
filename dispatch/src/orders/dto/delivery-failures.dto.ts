import {Field, InputType, Int, ObjectType} from '@nestjs/graphql';
import {CoreOutput} from 'src/common/dtos/output.dto';
import {DeliveryFailureReason} from '../entities/order.entity';

@InputType()
export class DeliveryFailuresInput {
  @Field(type => Int)
  afterEventId: number;

  @Field(type => Int)
  limit: number;
}

@ObjectType()
export class DeliveryFailure {
  @Field(type => Int)
  eventId: number;

  @Field(type => Int)
  orderId: number;

  @Field(type => DeliveryFailureReason)
  failureReason: DeliveryFailureReason;

  @Field(type => Date)
  occurredAt: Date;
}

@ObjectType()
export class DeliveryFailuresOutput extends CoreOutput {
  @Field(type => [DeliveryFailure], {nullable: true})
  failures?: DeliveryFailure[];
}
