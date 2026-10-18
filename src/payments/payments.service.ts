import {Injectable, Logger} from '@nestjs/common';
import {Cron, CronExpression} from '@nestjs/schedule';
import {InjectRepository} from '@nestjs/typeorm';
import {Restaurant} from 'src/restaurants/entities/restaurant.entity';
import {User} from 'src/users/entities/user.entity';
import {LessThan, Repository} from 'typeorm';
import {CreatePaymentInput, CreatePaymentOutput} from './dtos/create-payment.dto';
import {GetPaymentsOutput} from './dtos/get-payment.dto';
import {Payment} from './entities/payment.entity';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Restaurant) private readonly restaurants: Repository<Restaurant>,
  ) {}

  async createPayment(
    owner: User,
    {restaurantId, transactionId}: CreatePaymentInput,
  ): Promise<CreatePaymentOutput> {
    try {
      const restaurant = await this.restaurants.findOne({where: {id: restaurantId}});
      if (!restaurant) {
        return {ok: false, error: 'Could not found restaurant'};
      }
      if (restaurant.ownerId !== owner.id) {
        return {ok: false, error: 'You are not allowed to do this.'};
      }
      await this.payments.save(this.payments.create({transactionId, user: owner, restaurant}));
      restaurant.isPromoted = true;
      const date = new Date();
      date.setDate(date.getDate() + 7);
      restaurant.promotedUntil = date;
      await this.restaurants.save(restaurant);
      return {ok: true};
    } catch (error) {
      this.logger.error(
        `createPayment failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return {ok: false, error: 'Could not create payment', code: 'INTERNAL'};
    }
  }

  async getPayments(user: User): Promise<GetPaymentsOutput> {
    try {
      const payments = await this.payments.find({where: {user: {id: user.id}}});
      return {ok: true, payments};
    } catch (error) {
      this.logger.error(`getPayments failed`, error instanceof Error ? error.stack : String(error));
      return {ok: false, error: 'Could not load payments.', code: 'INTERNAL'};
    }
  }

  @Cron(CronExpression.EVERY_12_HOURS)
  async checkPromotedRestaurants() {
    const restaurants = await this.restaurants.find({
      where: {
        isPromoted: true,
        promotedUntil: LessThan(new Date()),
      },
    });
    // Array.prototype.forEach ignores the promise its callback returns, so an
    // async callback makes the job resolve before any write has landed and turns
    // every failure into an unhandled rejection.
    for (const restaurant of restaurants) {
      restaurant.isPromoted = false;
      restaurant.promotedUntil = null;
      await this.restaurants.save(restaurant);
    }
  }
}
