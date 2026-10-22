import {CategoryResolver, DishResolver, RestaurantResolver} from './restaurants.resolver';

import {CategoryRepository} from './repositories/category.repository';
import {Dish} from './entities/dish.entity';
import {Module} from '@nestjs/common';
import {Restaurant} from './entities/restaurant.entity';
import {RestaurantService} from './restaurants.service';
import {TypeOrmModule} from '@nestjs/typeorm';

@Module({
  // CategoryRepository is no longer a forFeature() entry: under TypeORM 0.3 it
  // is an ordinary provider that constructs itself from the DataSource.
  imports: [TypeOrmModule.forFeature([Restaurant, Dish])],
  providers: [
    RestaurantResolver,
    CategoryResolver,
    DishResolver,
    RestaurantService,
    CategoryRepository,
  ],
})
export class RestaurantsModule {}
