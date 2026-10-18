import {Category} from 'src/restaurants/entities/category.entity';
import {Dish} from 'src/restaurants/entities/dish.entity';
import {EmailVerification} from 'src/users/entities/email-verification.entity';
import {Order} from 'src/orders/entities/order.entity';
import {OutboxEvent} from 'src/fulfillment/entities/outbox-event.entity';
import {ProcessedEvent} from 'src/fulfillment/entities/processed-event.entity';
import {OrderItem} from 'src/orders/entities/order-item.entity';
import {Payment} from 'src/payments/entities/payment.entity';
import {Restaurant} from 'src/restaurants/entities/restaurant.entity';
import {User} from 'src/users/entities/user.entity';

/**
 * Single source of truth for the entity set.
 *
 * Both the Nest runtime (DatabaseModule) and the TypeORM CLI (data-source.ts)
 * read this list. If they were maintained separately, a new entity registered
 * in only one of them would produce migrations that disagree with the running
 * schema — silently, and only in whichever direction was forgotten.
 */
export const entities = [
  Category,
  Dish,
  EmailVerification,
  Order,
  OrderItem,
  OutboxEvent,
  ProcessedEvent,
  Payment,
  Restaurant,
  User,
];
