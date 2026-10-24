import {Inject, Injectable, Logger} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {checkoutKey, paymentRequestFor} from 'src/ledger/checkout';
import {LEDGER_CLIENT, LedgerClient, LedgerPaymentRequest} from 'src/ledger/ledger-client';
import {Order} from 'src/orders/entities/order.entity';
import {DataSource, EntityManager} from 'typeorm';

import {OutboxEvent, OutboxEventType, OutboxStatus} from './entities/outbox-event.entity';
import {FULFILLMENT_PROVIDER, FulfillmentProvider} from './provider/fulfillment-provider';

/** Stop retrying after this many attempts and quarantine the row. */
export const MAX_ATTEMPTS = 5;

/** How many rows one drain pass claims. Bounds the work a single tick can do. */
export const BATCH_SIZE = 10;

/**
 * Exponential backoff, in seconds: 2, 4, 8, 16, 32.
 *
 * Doubling matters more than the base. A provider that is down stays down for
 * seconds or minutes, and a fixed one-second retry turns one outage into a
 * sustained request flood against a service that is already struggling.
 */
export function backoffSeconds(attempts: number): number {
  return 2 ** Math.min(attempts, 10);
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(FULFILLMENT_PROVIDER) private readonly provider: FulfillmentProvider,
    @Inject(LEDGER_CLIENT) private readonly ledger: LedgerClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * Records an intent to dispatch.
   *
   * Takes the caller's EntityManager rather than opening its own connection —
   * that is the entire point. The outbox row and the order row commit together
   * or not at all, so there is no state in which an order exists that nobody
   * owes a dispatch for, and none in which a dispatch is owed for an order that
   * was rolled back.
   */
  enqueueOrderDispatch(
    manager: EntityManager,
    orderId: number,
    payload: Record<string, unknown>,
  ): Promise<OutboxEvent> {
    return manager.save(
      manager.create(OutboxEvent, {
        type: OutboxEventType.OrderDispatch,
        aggregateId: orderId,
        payload,
      }),
    );
  }

  /** Records the payment intent in the same transaction as its order. */
  enqueueOrderPayment(
    manager: EntityManager,
    orderId: number,
    payload: {totalCents: number},
  ): Promise<OutboxEvent> {
    return manager.save(
      manager.create(OutboxEvent, {
        type: OutboxEventType.OrderPayment,
        aggregateId: orderId,
        payload,
      }),
    );
  }

  /**
   * Claims a batch of due events and delivers them.
   *
   * Returns how many were processed, so a caller can drain in a loop.
   */
  async drain(): Promise<number> {
    const claimed = await this.claimBatch();
    for (const event of claimed) {
      await this.deliver(event);
    }
    return claimed.length;
  }

  /**
   * Takes ownership of up to BATCH_SIZE due rows.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes this safe to run on every replica at
   * once: each poller locks the rows it takes, and any other poller arriving
   * concurrently steps over them instead of blocking behind them. Without SKIP
   * LOCKED the pollers serialise; without FOR UPDATE they all claim the same
   * rows and the provider receives the same dispatch N times.
   *
   * The claim happens in its own transaction — the rows are marked in-flight by
   * pushing nextAttemptAt forward before the provider is ever called, so a
   * process that dies mid-dispatch leaves a row that becomes due again rather
   * than one that is locked forever.
   */
  private async claimBatch(): Promise<OutboxEvent[]> {
    return this.dataSource.transaction(async manager => {
      const rows: OutboxEvent[] = await manager.query(
        `SELECT * FROM "outbox_event"
          WHERE status = $1 AND "nextAttemptAt" <= now()
          ORDER BY "nextAttemptAt" ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [OutboxStatus.Pending, BATCH_SIZE],
      );

      if (rows.length === 0) {
        return [];
      }

      // Push the next eligibility out while we work on them. If this process
      // disappears between here and the result being written, the row simply
      // becomes due again later.
      await manager.query(
        `UPDATE "outbox_event"
            SET "nextAttemptAt" = now() + ($2 || ' seconds')::interval
          WHERE id = ANY($1)`,
        [rows.map(r => r.id), backoffSeconds(1)],
      );

      return rows;
    });
  }

  private async deliver(event: OutboxEvent): Promise<void> {
    switch (event.type) {
      case OutboxEventType.OrderDispatch:
        return this.deliverDispatch(event);
      case OutboxEventType.OrderPayment:
        return this.deliverPayment(event);
      default:
        return this.markDead(event, 'unknown outbox event type ' + event.type);
    }
  }

  private async deliverPayment(event: OutboxEvent): Promise<void> {
    try {
      let request: LedgerPaymentRequest;
      try {
        request = paymentRequestFor(
          event.aggregateId,
          (event.payload as {totalCents: number}).totalCents,
          {
            successUrl: this.config.get<string>('LEDGER_CHECKOUT_SUCCESS_URL'),
            cancelUrl: this.config.get<string>('LEDGER_CHECKOUT_CANCEL_URL'),
          },
        );
      } catch (error) {
        if (error instanceof RangeError) {
          await this.markDead(event, 'invalid checkout total');
          return;
        }
        throw error;
      }
      const outcome = await this.ledger.createPayment(request, checkoutKey(event.aggregateId));
      if (outcome.kind === 'accepted') {
        const matched = await this.dataSource.transaction(async manager => {
          const updated = await manager
            .createQueryBuilder()
            .update(Order)
            .set({ledgerPaymentId: outcome.paymentId, checkoutUrl: outcome.checkoutUrl})
            .where('id = :orderId', {orderId: event.aggregateId})
            .andWhere('("ledgerPaymentId" IS NULL OR "ledgerPaymentId" = :paymentId)', {
              paymentId: outcome.paymentId,
            })
            .execute();
          if (updated.affected === 0) {
            return false;
          }
          await manager.update(OutboxEvent, event.id, {
            status: OutboxStatus.Sent,
            providerRef: outcome.paymentId,
            lastError: null,
          });
          return true;
        });
        if (!matched) {
          await this.markDead(event, 'ledger payment id mismatch');
        }
      } else if (outcome.kind === 'pending') {
        if (outcome.paymentId !== null) {
          await this.dataSource
            .createQueryBuilder()
            .update(Order)
            .set({ledgerPaymentId: outcome.paymentId})
            .where('id = :orderId', {orderId: event.aggregateId})
            .andWhere('("ledgerPaymentId" IS NULL OR "ledgerPaymentId" = :paymentId)', {
              paymentId: outcome.paymentId,
            })
            .execute();
        }
        await this.recordFailure(event, 'ledger checkout not ready');
      } else {
        await this.markDead(event, 'ledger ' + outcome.status + ' ' + outcome.code);
      }
    } catch (error) {
      await this.recordFailure(event, error);
    }
  }

  private async markDead(event: OutboxEvent, message: string): Promise<void> {
    await this.dataSource.getRepository(OutboxEvent).update(event.id, {
      status: OutboxStatus.Dead,
      attempts: event.attempts + 1,
      lastError: message,
    });
    this.logger.error('order ' + event.aggregateId + ' quarantined: ' + message);
  }

  private async deliverDispatch(event: OutboxEvent): Promise<void> {
    const payload = event.payload as {
      restaurantName: string;
      address: string;
      totalCents: number;
    };

    try {
      const {providerRef} = await this.provider.dispatch({
        orderId: event.aggregateId,
        restaurantName: payload.restaurantName,
        address: payload.address,
        totalCents: payload.totalCents,
      });

      await this.dataSource
        .getRepository(OutboxEvent)
        .update(event.id, {status: OutboxStatus.Sent, providerRef, lastError: null});

      this.logger.log(`dispatched order ${event.aggregateId} as ${providerRef}`);
    } catch (error) {
      await this.recordFailure(event, error);
    }
  }

  /**
   * Backs off, or gives up.
   *
   * A row that has failed MAX_ATTEMPTS times becomes Dead and is never claimed
   * again. That is the point: one dispatch the provider will never accept —
   * malformed address, a restaurant they refuse to serve — must not be retried
   * ahead of every other order forever. Quarantining it keeps the queue moving
   * and leaves the bad row visible for a human, instead of letting one poison
   * event block the line behind it.
   */
  private async recordFailure(event: OutboxEvent, error: unknown): Promise<void> {
    const attempts = event.attempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    const repository = this.dataSource.getRepository(OutboxEvent);

    if (attempts >= MAX_ATTEMPTS) {
      await repository.update(event.id, {
        attempts,
        status: OutboxStatus.Dead,
        lastError: message,
      });
      this.logger.error(
        `order ${event.aggregateId} quarantined after ${attempts} attempts: ${message}`,
      );
      return;
    }

    await repository.query(
      `UPDATE "outbox_event"
          SET attempts = $2,
              "lastError" = $3,
              "nextAttemptAt" = now() + ($4 || ' seconds')::interval
        WHERE id = $1`,
      [event.id, attempts, message, backoffSeconds(attempts)],
    );

    this.logger.warn(
      `order ${event.aggregateId} attempt ${attempts} failed, retrying in ` +
        `${backoffSeconds(attempts)}s: ${message}`,
    );
  }
}
