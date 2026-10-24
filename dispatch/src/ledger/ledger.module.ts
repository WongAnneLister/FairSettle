import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';
import {Order} from 'src/orders/entities/order.entity';
import {LedgerNotification} from './entities/ledger-notification.entity';
import {LedgerNotificationService} from './ledger-notification.service';
import {LedgerNotificationsController} from './ledger-notifications.controller';

import {HttpLedgerClient} from './http-ledger-client';
import {LEDGER_CLIENT} from './ledger-client';

@Module({
  imports: [TypeOrmModule.forFeature([LedgerNotification, Order])],
  controllers: [LedgerNotificationsController],
  providers: [{provide: LEDGER_CLIENT, useClass: HttpLedgerClient}, LedgerNotificationService],
  exports: [LEDGER_CLIENT],
})
export class LedgerModule {}
