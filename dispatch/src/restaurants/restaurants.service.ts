import {Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {User} from 'src/users/entities/user.entity';
import {ILike, Repository} from 'typeorm';
import {AllRestaurantsInput, AllRestaurantsOutput} from './dtos/all-restaurants.dto';
import {CategoryInput, CategoryOutput} from './dtos/category.dto';
import {CreateDishInput, CreateDishOutput} from './dtos/create-dish.dto';
import {CreateRestaurantInput, CreateRestaurantOutput} from './dtos/create-restaurant.dto';
import {DeleteDishInput, DeleteDishOutput} from './dtos/delete-dish.dto';
import {DeleteRestaurentInput, DeleteRestaurentOutput} from './dtos/delete-restaurant.dto';
import {EditDishInput, EditDishOutput} from './dtos/edit-dish.dto';
import {EditRestaurentInput, EditRestaurentOutput} from './dtos/edit-restaurant.dto';
import {MyRestaurantInput, MyRestaurantOutput} from './dtos/my-restaurant.dto';
import {MyRestaurantsOutput} from './dtos/my-restaurants.dto';
import {RestaurantInput, RestaurantOutput} from './dtos/restaurant.dto';
import {SearchRestaurantInput, SearchRestaurantOutput} from './dtos/search-restaurant.dto';
import {Category} from './entities/category.entity';
import {Dish} from './entities/dish.entity';
import {Restaurant} from './entities/restaurant.entity';
import {CategoryRepository} from './repositories/category.repository';

@Injectable()
export class RestaurantService {
  private readonly logger = new Logger(RestaurantService.name);

  constructor(
    @InjectRepository(Restaurant) private readonly restaurants: Repository<Restaurant>,
    private readonly categories: CategoryRepository,
    @InjectRepository(Dish) private readonly dishes: Repository<Dish>,
  ) {}

  async createRestaurant(
    owner: User,
    createRestaurantInput: CreateRestaurantInput,
  ): Promise<CreateRestaurantOutput> {
    try {
      const newRestaurant = this.restaurants.create(createRestaurantInput);
      newRestaurant.owner = owner;
      const category = await this.categories.getOrCreate(createRestaurantInput.categoryName);
      newRestaurant.category = category;
      await this.restaurants.save(newRestaurant);
      return {ok: true, restaurantId: newRestaurant.id};
    } catch (error) {
      this.logger.error(
        `createRestaurant failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return {ok: false, error: 'Could not create restaurant', code: 'INTERNAL'};
    }
  }

  async editRestaurant(
    owner: User,
    editRestaurantInput: EditRestaurentInput,
  ): Promise<EditRestaurentOutput> {
    try {
      const restaurant = await this.restaurants.findOne({
        where: {id: editRestaurantInput.restaurantId},
      });
      if (!restaurant) {
        return {ok: false, error: 'Restaurant not found'};
      }
      if (owner.id !== restaurant.ownerId) {
        return {ok: false, error: "You cant't edit a restaurant that you don't own"};
      }
      let category: Category = null;
      if (editRestaurantInput.categoryName) {
        category = await this.categories.getOrCreate(editRestaurantInput.categoryName);
      }
      await this.restaurants.save([
        {
          id: editRestaurantInput.restaurantId,
          ...editRestaurantInput,
          ...(category && {category}),
        },
      ]);
      return {ok: true};
    } catch (error) {
      this.logger.error(
        `editRestaurant failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return {ok: false, error: 'Could not edit restaurant', code: 'INTERNAL'};
    }
  }

  async deleteRestaurant(
    owner: User,
    deleteRestaurantInput: DeleteRestaurentInput,
  ): Promise<DeleteRestaurentOutput> {
    try {
      const restaurant = await this.restaurants.findOne({
        where: {id: deleteRestaurantInput.restaurantId},
      });
      if (!restaurant) {
        return {ok: false, error: 'Restaurant not found'};
      }
      if (owner.id !== restaurant.ownerId) {
        return {ok: false, error: "You cant't delete a restaurant that you don't own"};
      }
      await this.restaurants.delete(deleteRestaurantInput.restaurantId);
      return {ok: true};
    } catch (error) {
      this.logger.error(
        `deleteRestaurant failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return {ok: false, error: 'Could not delete restaurant', code: 'INTERNAL'};
    }
  }

  async allRestaurants({page}: AllRestaurantsInput): Promise<AllRestaurantsOutput> {
    try {
      const [restaurants, totalResults] = await this.restaurants.findAndCount({
        take: 50,
        skip: (page - 1) * 50,
        order: {isPromoted: 'DESC'},
        relations: ['category'],
      });
      return {
        ok: true,
        results: restaurants,
        totalPages: Math.ceil(totalResults / 50),
        totalResults,
      };
    } catch (error) {
      this.logger.error(
        `allRestaurants failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return {ok: false, error: 'Not found restaurants', code: 'INTERNAL'};
    }
  }

  async findRestaurantById({restaurantId}: RestaurantInput): Promise<RestaurantOutput> {
    try {
      const restaurant = await this.restaurants.findOne({
        where: {id: restaurantId},
        relations: ['menu', 'category'],
      });
      if (!restaurant) {
        return {ok: false, error: 'Restaurant not found'};
      }
      return {ok: true, restaurant};
    } catch (error) {
      this.logger.error(
        `findRestaurantById failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return {ok: false, error: 'Restaurant not load', code: 'INTERNAL'};
    }
  }

  async searchRestaurant({query, page}: SearchRestaurantInput): Promise<SearchRestaurantOutput> {
    try {
      const [restaurants, totalResults] = await this.restaurants.findAndCount({
        where: {name: ILike(`%${query}%`)},
        take: 25,
        skip: (page - 1) * 25,
        relations: ['category'],
      });
      return {
        ok: true,
        restaurants,
        totalResults,
        totalPages: Math.ceil(totalResults / 25),
      };
    } catch (error) {
      this.logger.error(
        `searchRestaurant failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return {ok: false, error: 'Restaurants not search for restaurants', code: 'INTERNAL'};
    }
  }

  async myRestaurants(owner: User): Promise<MyRestaurantsOutput> {
    try {
      const restaurants = await this.restaurants.find({
        where: {owner: {id: owner.id}},
        relations: ['category'],
      });
      return {ok: true, restaurants};
    } catch (error) {
      this.logger.error(
        `myRestaurants failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return {ok: false, error: 'Could not find restaurants', code: 'INTERNAL'};
    }
  }

  async myRestaurant(
    owner: User,
    myRestaurantInput: MyRestaurantInput,
  ): Promise<MyRestaurantOutput> {
    try {
      const restaurant = await this.restaurants.findOne({
        where: {owner: {id: owner.id}, id: myRestaurantInput.id},
        relations: ['category', 'menu', 'orders'],
      });
      return {restaurant, ok: true};
    } catch (error) {
      this.logger.error(
        `myRestaurant failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return {ok: false, error: 'Could not find restaurant', code: 'INTERNAL'};
    }
  }

  async allCategories() {
    try {
      const categories = await this.categories.find();
      return {ok: true, categories};
    } catch (error) {
      this.logger.error(
        `allCategories failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return {ok: false, error: 'Not found categories', code: 'INTERNAL'};
    }
  }

  async findCategoryBySlug({slug, page}: CategoryInput): Promise<CategoryOutput> {
    try {
      const category = await this.categories.findOne({where: {slug}});
      if (!category) {
        return {ok: false, error: 'Category not found'};
      }
      const restaurants = await this.restaurants.find({
        where: {category: {id: category.id}},
        take: 25,
        skip: (page - 1) * 25,
        order: {isPromoted: 'DESC'},
        relations: ['category'],
      });
      category.restaurants = restaurants;
      const totalResults = await this.countRestaurants(category);
      return {ok: true, category, totalPages: Math.ceil(totalResults / 25), totalResults};
    } catch (error) {
      this.logger.error(
        `findCategoryBySlug failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return {ok: false, error: 'Category not load', code: 'INTERNAL'};
    }
  }

  countRestaurants(category: Category): Promise<number> {
    return this.restaurants.count({where: {category: {id: category.id}}});
  }

  async createDish(owner: User, createDishInput: CreateDishInput): Promise<CreateDishOutput> {
    try {
      const restaurant = await this.restaurants.findOne({
        where: {id: createDishInput.restaurantId},
      });
      if (!restaurant) {
        return {ok: false, error: 'Restaurant not found'};
      }
      if (owner.id !== restaurant.ownerId) {
        return {ok: false, error: "Couldn't add dish"};
      }
      await this.dishes.save(this.dishes.create({...createDishInput, restaurant}));
      return {ok: true};
    } catch (error) {
      this.logger.error(`createDish failed`, error instanceof Error ? error.stack : String(error));
      return {ok: false, error: "Couldn't create dish", code: 'INTERNAL'};
    }
  }

  async editDish(owner: User, editDishInput: EditDishInput): Promise<EditDishOutput> {
    try {
      const dish = await this.dishes.findOne({
        where: {id: editDishInput.dishId},
        relations: ['restaurant'],
      });
      if (!dish) {
        return {ok: false, error: 'Dish not found'};
      }
      if (dish.restaurant.ownerId !== owner.id) {
        return {ok: false, error: 'Could not update this dish'};
      }
      await this.dishes.save([
        {
          id: editDishInput.dishId,
          ...editDishInput,
        },
      ]);
      return {ok: true};
    } catch (error) {
      this.logger.error(`editDish failed`, error instanceof Error ? error.stack : String(error));
      return {ok: false, error: 'Could not update dish', code: 'INTERNAL'};
    }
  }

  async deleteDish(owner: User, {dishId}: DeleteDishInput): Promise<DeleteDishOutput> {
    try {
      const dish = await this.dishes.findOne({where: {id: dishId}, relations: ['restaurant']});
      if (!dish) {
        return {ok: false, error: 'Dish not found'};
      }
      if (dish.restaurant.ownerId !== owner.id) {
        return {ok: false, error: 'Could not delete this dish'};
      }
      await this.dishes.delete(dishId);
      return {ok: true};
    } catch (error) {
      this.logger.error(`deleteDish failed`, error instanceof Error ? error.stack : String(error));
      return {ok: false, error: 'Could not delete dish', code: 'INTERNAL'};
    }
  }
}
