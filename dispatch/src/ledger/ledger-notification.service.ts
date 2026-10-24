import {Injectable} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {DataSource, QueryFailedError} from 'typeorm';

import {Order} from 'src/orders/entities/order.entity';
import {evaluatePaymentEvent} from 'src/orders/order-state-machine';

import {LedgerNotification as Receipt} from './entities/ledger-notification.entity';
import {LedgerNotification, orderIdFromKey} from './notification';

type IngestResult =
  {kind: 'duplicate'} | {kind: 'conflict'} | {kind: 'recorded'; applied: boolean; reason: string};

@Injectable()
export class LedgerNotificationService {
  constructor(private readonly dataSource: DataSource) {}

  async ingest(n: LedgerNotification, raw: Buffer): Promise<IngestResult> {
    const digest = createHash('sha256').update(raw).digest('hex');
    try {
      return await this.dataSource.transaction<IngestResult>(async manager => {
        // Insert first; a concurrent duplicate waits for this transaction's decision.
        await manager.insert(Receipt, {
          eventId: n.eventId,
          eventType: n.eventType,
          businessKey: n.businessKey,
          digest,
          orderId: null,
          outcome: 'pending',
        });
        // QueryBuilder avoids eager relation joins: only the order row is locked.
        const order = await manager
          .getRepository(Order)
          .createQueryBuilder('order')
          .where('order.id = :id', {id: orderIdFromKey(n.orderKey)})
          .setLock('pessimistic_write')
          .getOne();
        let outcome: string;
        let applied = false;
        if (!order) {
          outcome = 'ignored: unknown order';
        } else if (n.currency !== 'USD') {
          outcome = 'ignored: currency mismatch';
        } else if (n.amountMinor !== order.totalCents) {
          outcome = 'ignored: amount mismatch';
        } else if (
          n.eventType === 'payment.succeeded' &&
          (n.paymentStatus !== 'SUCCEEDED' || n.capturedAmountMinor !== n.amountMinor)
        ) {
          outcome = 'ignored: not a full capture';
        } else {
          const verdict = evaluatePaymentEvent(order.paymentStatus, n.eventType);
          if (verdict.kind === 'allowed') {
            await manager.update(
              Order,
              {id: order.id, paymentStatus: order.paymentStatus},
              {paymentStatus: verdict.next},
            );
            applied = true;
            outcome = 'applied: ' + verdict.next;
          } else if (verdict.kind === 'noop') {
            outcome = 'ignored: already ' + order.paymentStatus;
          } else {
            outcome = 'ignored: ' + verdict.reason;
          }
        }
        await manager.update(Receipt, {eventId: n.eventId}, {orderId: order?.id ?? null, outcome});
        return {kind: 'recorded', applied, reason: outcome};
      });
    } catch (error) {
      if (error instanceof QueryFailedError && (error as {code?: string}).code === '23505') {
        // The failed transaction is rolled back before reading the committed receipt.
        const receipt = await this.dataSource
          .getRepository(Receipt)
          .findOneByOrFail({eventId: n.eventId});
        return {kind: receipt.digest === digest ? 'duplicate' : 'conflict'};
      }
      throw error;
    }
  }
}
