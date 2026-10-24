import {Global, Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {LedgerModule} from 'src/ledger/ledger.module';

import {OutboxEvent} from './entities/outbox-event.entity';
import {ProcessedEvent} from './entities/processed-event.entity';
import {OutboxPoller} from './outbox.poller';
import {OutboxService} from './outbox.service';
import {FULFILLMENT_PROVIDER} from './provider/fulfillment-provider';
import {MockFulfillmentProvider} from './provider/mock-provider.service';
import {WebhookIngestService} from './webhook-ingest.service';
import {WebhooksController} from './webhooks.controller';

/**
 * Global so OrdersModule can enqueue without importing the provider wiring.
 *
 * The provider is bound to a token rather than a class: swapping the mock for a
 * real integration is one line here and touches nothing else, which is the
 * property the adapter exists for.
 */
@Global()
@Module({
  imports: [LedgerModule, TypeOrmModule.forFeature([OutboxEvent, ProcessedEvent])],
  controllers: [WebhooksController],
  providers: [
    MockFulfillmentProvider,
    {provide: FULFILLMENT_PROVIDER, useExisting: MockFulfillmentProvider},
    OutboxService,
    WebhookIngestService,
    OutboxPoller,
  ],
  exports: [OutboxService, MockFulfillmentProvider],
})
export class FulfillmentModule {}
