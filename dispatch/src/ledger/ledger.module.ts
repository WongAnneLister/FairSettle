import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {Order} from 'src/orders/entities/order.entity';

import {CheckoutReturnController} from './checkout-return.controller';
import {PaymentRefreshService} from './payment-refresh.service';
import {PaymentRefreshResolver} from './payment-refresh.resolver';

import {LedgerNotification} from './entities/ledger-notification.entity';
import {HttpLedgerClient} from './http-ledger-client';
import {LEDGER_CLIENT} from './ledger-client';
import {LedgerNotificationService} from './ledger-notification.service';
import {LedgerNotificationsController} from './ledger-notifications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LedgerNotification, Order])],
  controllers: [LedgerNotificationsController, CheckoutReturnController],
  providers: [
    {provide: LEDGER_CLIENT, useClass: HttpLedgerClient},
    LedgerNotificationService,
    PaymentRefreshService,
    PaymentRefreshResolver,
  ],
  exports: [LEDGER_CLIENT],
})
export class LedgerModule {}
