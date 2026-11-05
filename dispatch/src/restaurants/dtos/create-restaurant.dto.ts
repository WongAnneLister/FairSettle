import {Field, InputType, Int, ObjectType, PickType} from '@nestjs/graphql';

import {CoreOutput} from 'src/common/dtos/output.dto';
import {Restaurant} from '../entities/restaurant.entity';

@InputType()
export class CreateRestaurantInput extends PickType(Restaurant, ['name', 'coverImage', 'address']) {
  @Field(type => String)
  categoryName: string;
}

@ObjectType()
export class CreateRestaurantOutput extends CoreOutput {
  // The failure path returns no id; a non-null field turned ok: false into a GraphQL error (F38).
  @Field(type => Int, {nullable: true})
  restaurantId?: number;
}
