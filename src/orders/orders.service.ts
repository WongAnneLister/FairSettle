import {Inject, Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {PubSub} from 'graphql-subscriptions';
import {
  NEW_COOKED_ORDER,
  NEW_ORDER_UPDATES,
  NEW_PENDING_ORDER,
  PUB_SUB,
} from 'src/common/common.constants';
import {ConflictError, ForbiddenError, NotFoundError} from 'src/common/errors/app-error';
import {failure} from 'src/common/errors/failure';
import {Dish} from 'src/restaurants/entities/dish.entity';
import {Restaurant} from 'src/restaurants/entities/restaurant.entity';
import {User, UserRole} from 'src/users/entities/user.entity';
import {DataSource, In, Repository} from 'typeorm';
import {CreateOrderInput, CreateOrderOutput} from './dto/create-order.dto';
import {EditOrderInput, EditOrderOutput} from './dto/edit-order.dto';
import {GetOrderInput, GetOrderOutput} from './dto/get-order.dto';
import {GetOrdersInput, GetOrdersOutput} from './dto/get-orders.dto';
import {TakeOrderInput, TakeOrderOutput} from './dto/take-order.dto';
import {TransitionActor, evaluateTransition} from './order-state-machine';
import {OrderItem} from './entities/order-item.entity';
import {Order, OrderStatus} from './entities/order.entity';

/** Page size for getOrders. Matches the restaurants module. */
const ORDERS_PAGE_SIZE = 25;

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly orderItems: Repository<OrderItem>,
    @InjectRepository(Dish) private readonly dishes: Repository<Dish>,
    @InjectRepository(Restaurant) private readonly restaurants: Repository<Restaurant>,
    @Inject(PUB_SUB) private readonly pubsub: PubSub,
    private readonly dataSource: DataSource,
  ) {}

  async createOrder(
    customer: User,
    {restaurantId, items}: CreateOrderInput,
  ): Promise<CreateOrderOutput> {
    try {
      // Everything that writes runs inside one transaction. Without it, order
      // items were committed one at a time and the order row only afterwards,
      // so a dish missing partway through left items behind that no order
      // referenced — unreachable rows that nothing would ever clean up.
      const {order, ownerId} = await this.dataSource.transaction(async manager => {
        const restaurant = await manager.findOne(Restaurant, {where: {id: restaurantId}});
        if (!restaurant) {
          throw new NotFoundError('Restaurant not found');
        }

        // One query for every dish on the order, not one per line item. The
        // loop below then only does arithmetic.
        const dishIds = [...new Set(items.map(item => item.dishId))];
        const dishes = await manager.find(Dish, {where: {id: In(dishIds)}});
        const dishById = new Map(dishes.map(dish => [dish.id, dish]));

        // Validated up front, so a bad id is rejected before anything is
        // written at all. Reports every missing dish rather than only the first
        // one the loop happened to reach.
        const missing = dishIds.filter(id => !dishById.has(id));
        if (missing.length > 0) {
          // Throwing rather than returning is what rolls the transaction back.
          // An early `return` here would commit a partial write.
          throw new NotFoundError(
            missing.length === 1
              ? `Dish ${missing[0]} not found`
              : `Dishes ${missing.join(', ')} not found`,
          );
        }

        let orderFinalPriceCents = 0;
        const orderItems: OrderItem[] = [];
        for (const item of items) {
          const dish = dishById.get(item.dishId);
          let dishFinalPriceCents = dish.priceCents;
          // `options` is declared nullable on CreateOrderItemInput, so a dish
          // ordered without any options arrives with the field absent.
          for (const itemOption of item.options ?? []) {
            const dishOption = dish.options?.find(
              dishOption => dishOption.name === itemOption.name,
            );
            if (dishOption) {
              if (dishOption.extraCents) {
                dishFinalPriceCents += dishOption.extraCents;
              } else {
                const dishOptionChoice = dishOption.choices?.find(
                  optionChoice => optionChoice.name === itemOption.choice,
                );
                if (dishOptionChoice) {
                  if (dishOptionChoice.extraCents) {
                    dishFinalPriceCents += dishOptionChoice.extraCents;
                  }
                }
              }
            }
          }
          orderFinalPriceCents += dishFinalPriceCents;
          // Built, not saved. With cascade on Order.items the insert happens as
          // part of saving the order, so there is no window in which an item
          // exists without its order — the condition B4 had to clean up after.
          orderItems.push(manager.create(OrderItem, {dish, options: item.options}));
        }

        const saved = await manager.save(
          manager.create(Order, {
            customer,
            restaurant,
            totalCents: orderFinalPriceCents,
            items: orderItems,
          }),
        );

        return {order: saved, ownerId: restaurant.ownerId};
      });

      // Published only after the commit. Announcing from inside the transaction
      // would tell the restaurant about an order that may still roll back.
      await this.pubsub.publish(NEW_PENDING_ORDER, {pendingOrders: {order, ownerId}});
      return {ok: true, orderId: order.id};
    } catch (error) {
      return failure(error, this.logger, {
        op: 'createOrder',
        customerId: customer.id,
        restaurantId,
      });
    }
  }

  async getOrders(user: User, {status, page}: GetOrdersInput): Promise<GetOrdersOutput> {
    try {
      // One query for every role. The Owner branch used to load every order of
      // every restaurant the owner has — fully hydrated, because Order eagerly
      // loads customer, driver, restaurant and items — and then filter by status
      // in Node. A restaurant with three years of history returned one page by
      // pulling tens of thousands of rows into process memory first.
      const query = this.orders
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.restaurant', 'restaurant')
        .leftJoinAndSelect('order.items', 'item')
        .leftJoinAndSelect('item.dish', 'dish')
        .orderBy('order.createdAt', 'DESC')
        // take/skip rather than limit/offset. limit/offset apply to the joined
        // row set, so one order with three items would consume three rows of the
        // page; take/skip make TypeORM paginate over distinct order ids first.
        .take(ORDERS_PAGE_SIZE)
        .skip((page - 1) * ORDERS_PAGE_SIZE);

      switch (user.role) {
        case UserRole.Client:
          query.where('order.customerId = :userId', {userId: user.id});
          break;
        case UserRole.Delivery:
          query.where('order.driverId = :userId', {userId: user.id});
          break;
        case UserRole.Owner:
          query.where('restaurant.ownerId = :userId', {userId: user.id});
          break;
        default:
          throw new ForbiddenError('Unknown role');
      }

      if (status) {
        query.andWhere('order.status = :status', {status});
      }

      const [orders, totalResults] = await query.getManyAndCount();

      return {
        ok: true,
        orders,
        totalResults,
        totalPages: Math.ceil(totalResults / ORDERS_PAGE_SIZE),
      };
    } catch (error) {
      return failure(error, this.logger, {op: 'getOrders', userId: user.id, role: user.role});
    }
  }

  async getOrder(user: User, getOrderInput: GetOrderInput): Promise<GetOrderOutput> {
    try {
      const order = await this.orders.findOne({
        where: {id: getOrderInput.id},
        // B14: Order.items is eager, but eager loading does not cascade to the
        // item's own dish, so line items came back saying nothing about what was
        // ordered. Requested explicitly rather than marking dish eager too —
        // every eager relation is paid for by every query that touches an order.
        relations: ['restaurant', 'items', 'items.dish'],
      });
      if (!order) {
        throw new NotFoundError('Order not found');
      }

      if (!this.canSeeOrder(user, order)) {
        throw new ForbiddenError("You can't see that.");
      }

      return {
        ok: true,
        order,
      };
    } catch (error) {
      return failure(error, this.logger, {
        op: 'getOrder',
        userId: user.id,
        orderId: getOrderInput.id,
      });
    }
  }

  async editOrder(user: User, editOrderInput: EditOrderInput): Promise<EditOrderOutput> {
    try {
      const order = await this.orders.findOne({where: {id: editOrderInput.id}});
      if (!order) {
        throw new NotFoundError('Order not found.');
      }
      if (!this.canSeeOrder(user, order)) {
        throw new ForbiddenError("You can't edit that.");
      }
      const verdict = evaluateTransition(
        order.status,
        editOrderInput.status,
        this.actorFor(user, order),
      );

      switch (verdict.kind) {
        case 'noop':
          // Already there. Succeeding without a write is what makes a
          // redelivered status update safe — see order-state-machine.ts.
          return {ok: true};
        case 'illegal':
          throw new ConflictError(verdict.reason);
        case 'forbidden':
          throw new ForbiddenError(verdict.reason);
      }

      // The verdict was computed from a status read a moment ago. Making the
      // write conditional on that same status means a concurrent transition
      // cannot slip in between — the same reasoning as the claim in takeOrder.
      const applied = await this.orders
        .createQueryBuilder()
        .update(Order)
        .set({status: editOrderInput.status})
        .where('id = :id', {id: editOrderInput.id})
        .andWhere('status = :expected', {expected: order.status})
        .execute();

      if (applied.affected === 0) {
        throw new ConflictError('The order changed while this update was in flight');
      }

      const newOrder = {...order, status: editOrderInput.status};
      if (user.role === UserRole.Owner) {
        if (editOrderInput.status === OrderStatus.Cooked) {
          await this.pubsub.publish(NEW_COOKED_ORDER, {
            cookedOrders: newOrder,
          });
        }
      }
      await this.pubsub.publish(NEW_ORDER_UPDATES, {orderUpdates: newOrder});
      return {ok: true};
    } catch (error) {
      return failure(error, this.logger, {
        op: 'editOrder',
        userId: user.id,
        orderId: editOrderInput.id,
        status: editOrderInput.status,
      });
    }
  }

  async takeOrder(driver: User, {id}: TakeOrderInput): Promise<TakeOrderOutput> {
    try {
      // One atomic statement. The eligibility check lives in the WHERE clause,
      // so the database decides the winner instead of the application guessing
      // from a value it read moments earlier.
      //
      // Under PostgreSQL's default READ COMMITTED, a second concurrent UPDATE
      // blocks on the first, then RE-EVALUATES its predicate against the newly
      // committed row — finds driverId non-null, matches nothing, and reports
      // affected = 0. That re-evaluation is the whole mechanism.
      const claim = await this.orders
        .createQueryBuilder()
        .update(Order)
        .set({driver})
        .where('id = :id', {id})
        .andWhere('"driverId" IS NULL')
        .andWhere('status = :cooked', {cooked: OrderStatus.Cooked})
        .execute();

      if (claim.affected === 0) {
        // Only on the losing path, so this read cannot reintroduce the race.
        await this.explainFailedClaim(id);
      }

      const order = await this.orders.findOne({where: {id}});
      await this.pubsub.publish(NEW_ORDER_UPDATES, {orderUpdates: order});
      return {ok: true};
    } catch (error) {
      return failure(error, this.logger, {op: 'takeOrder', driverId: driver.id, orderId: id});
    }
  }

  /**
   * Turns "the conditional UPDATE matched nothing" into a specific reason.
   *
   * Always throws. Runs only after a claim has already failed, so the extra read
   * costs nothing on the success path and cannot affect the outcome.
   */
  private async explainFailedClaim(id: number): Promise<never> {
    const order = await this.orders.findOne({where: {id}});
    if (!order) {
      throw new NotFoundError('Could not find order');
    }
    if (order.driverId) {
      // CONFLICT, not FORBIDDEN: the caller was eligible and lost a race, so
      // the useful client response is "refresh the list", not "you may not".
      throw new ConflictError('This order already has a driver');
    }
    throw new ConflictError(`Order is ${order.status}, not ${OrderStatus.Cooked}`);
  }

  /**
   * Maps a user onto the actor vocabulary the state machine speaks.
   *
   * Returns null for a driver who is not the one assigned to this order — the
   * distinction the baseline never made, because it checked the role only.
   */
  private actorFor(user: User, order: Order): TransitionActor | null {
    if (user.role === UserRole.Owner) {
      return UserRole.Owner;
    }
    if (user.role === UserRole.Client) {
      return UserRole.Client;
    }
    if (user.role === UserRole.Delivery) {
      return order.driverId === user.id ? 'AssignedDriver' : null;
    }
    return null;
  }

  canSeeOrder(user: User, order: Order): boolean {
    let canSee = true;
    if (user.role === UserRole.Client && order.customerId !== user.id) {
      canSee = false;
    }
    if (user.role === UserRole.Delivery && order.driverId !== user.id) {
      canSee = false;
    }
    if (user.role === UserRole.Owner && order.restaurant.ownerId !== user.id) {
      canSee = false;
    }
    return canSee;
  }
}
