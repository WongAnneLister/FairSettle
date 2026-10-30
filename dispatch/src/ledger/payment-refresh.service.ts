import {Inject, Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {ForbiddenError, NotFoundError, UnavailableError} from 'src/common/errors/app-error';
import {failure} from 'src/common/errors/failure';
import {Order, OrderPaymentStatus} from 'src/orders/entities/order.entity';
import {User} from 'src/users/entities/user.entity';

import {RefreshOrderPaymentInput, RefreshOrderPaymentOutput} from './dto/refresh-order-payment.dto';
import {LEDGER_CLIENT, LedgerClient, LedgerRetryableError} from './ledger-client';

export const REFRESH_UNAVAILABLE = 'Payment status could not be checked; try again shortly.';

@Injectable()
export class PaymentRefreshService {
  private readonly logger = new Logger(PaymentRefreshService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @Inject(LEDGER_CLIENT) private readonly ledger: LedgerClient,
  ) {}

  async refresh(
    user: User,
    {orderId}: RefreshOrderPaymentInput,
  ): Promise<RefreshOrderPaymentOutput> {
    try {
      const order = await this.orders.findOne({where: {id: orderId}});
      if (!order) throw new NotFoundError('Order not found');
      if (order.customerId !== user.id) throw new ForbiddenError("You can't refresh that.");
      if (order.paymentStatus !== OrderPaymentStatus.AwaitingPayment || !order.ledgerPaymentId) {
        return {ok: true, paymentStatus: order.paymentStatus};
      }
      let outcome;
      try {
        outcome = await this.ledger.readPayment(order.ledgerPaymentId);
      } catch (error) {
        if (error instanceof LedgerRetryableError) {
          this.logger.warn(
            'ledger payment read failed ' + JSON.stringify({orderId, reason: error.message}),
          );
          throw new UnavailableError(REFRESH_UNAVAILABLE);
        }
        throw error;
      }
      if (outcome.kind === 'rejected') {
        this.logger.warn(
          'ledger payment read refused ' +
            JSON.stringify({orderId, status: outcome.status, code: outcome.code}),
        );
        throw new UnavailableError(REFRESH_UNAVAILABLE);
      }
      const again = await this.orders.findOne({where: {id: orderId}});
      return {ok: true, paymentStatus: (again ?? order).paymentStatus};
    } catch (error) {
      return failure(error, this.logger, {op: 'refreshOrderPayment', customerId: user.id, orderId});
    }
  }
}
