import {ConflictError} from 'src/common/errors/app-error';
import {OrderEventActor, OrderEventKind} from 'src/orders/entities/order-event.entity';
import {recordOrderEvent} from 'src/orders/order-events';
import {Injectable, Logger} from '@nestjs/common';
import {DataSource, QueryFailedError} from 'typeorm';

import {Order, OrderStatus} from 'src/orders/entities/order.entity';
import {evaluateTransition} from 'src/orders/order-state-machine';

import {OutboxEvent} from './entities/outbox-event.entity';
import {ProcessedEvent} from './entities/processed-event.entity';

export interface IngestResult {
  applied: boolean;
  reason: string;
}

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class WebhookIngestService {
  private readonly logger = new Logger(WebhookIngestService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Applies one provider callback, exactly once.
   *
   * The deduplication and the state change share a transaction. Claiming the
   * event id in one transaction and applying it in another would leave a window
   * where a crash loses the update while the id is already marked handled — the
   * event would then be permanently ignored on redelivery.
   */
  async apply(event: {
    eventId: string;
    providerRef: string;
    orderId: number;
    status: string;
  }): Promise<IngestResult> {
    try {
      return await this.dataSource.transaction(async manager => {
        // Claim the id first. Insert-then-act, not check-then-act: a SELECT
        // followed by an INSERT is the same check-then-write race as B2, and a
        // provider retrying on timeout produces exactly that concurrency.
        await manager.insert(ProcessedEvent, {
          eventId: event.eventId,
          type: `fulfillment.${event.status}`,
        });

        const outbox = await manager.findOne(OutboxEvent, {
          where: {providerRef: event.providerRef},
        });
        if (!outbox) {
          // Signed, well-formed, and about something this system never
          // dispatched. Recorded as handled so it is not retried forever.
          return {applied: false, reason: 'unknown providerRef'};
        }

        const order = await manager.findOne(Order, {where: {id: outbox.aggregateId}});
        if (!order) {
          return {applied: false, reason: 'order no longer exists'};
        }

        const target = event.status as OrderStatus;
        if (!Object.values(OrderStatus).includes(target)) {
          return {applied: false, reason: `unknown status ${event.status}`};
        }

        // The provider's callbacks go through the same state machine as a
        // driver tapping a button. Callbacks can arrive out of order — a
        // redelivered PickedUp after a Delivered — and the transition table
        // rejects those deterministically rather than moving the order
        // backwards.
        const verdict = evaluateTransition(order.status, target, 'FulfillmentProvider');
        if (verdict.kind === 'noop') {
          return {applied: false, reason: 'already in that state'};
        }
        if (verdict.kind !== 'allowed') {
          return {applied: false, reason: verdict.reason};
        }

        const updated = await manager.update(
          Order,
          {id: order.id, status: order.status},
          {status: target},
        );
        if (updated.affected !== 1) {
          throw new ConflictError('The order changed while this callback was applied');
        }
        await recordOrderEvent(manager, {
          kind: OrderEventKind.STATUS_CHANGED,
          orderId: order.id,
          from: order.status,
          to: target,
          actor: OrderEventActor.FulfillmentProvider,
          driverId: null,
          providerEventId: event.eventId,
        });
        return {applied: true, reason: `moved to ${target}`};
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as {code?: string}).code === UNIQUE_VIOLATION
      ) {
        // The provider redelivered. Nothing to do, and a 200 stops it retrying.
        this.logger.debug(`duplicate event ${event.eventId} ignored`);
        return {applied: false, reason: 'duplicate'};
      }
      throw error;
    }
  }
}
