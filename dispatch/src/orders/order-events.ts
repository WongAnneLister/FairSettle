import {EntityManager} from 'typeorm';
import {OrderEvent, OrderEventActor, OrderEventKind} from './entities/order-event.entity';
import {OrderStatus} from './entities/order.entity';

export type NewOrderEvent =
  | {kind: OrderEventKind.CREATED; orderId: number}
  | {
      kind: OrderEventKind.STATUS_CHANGED;
      orderId: number;
      from: OrderStatus;
      to: OrderStatus;
      actor:
        | OrderEventActor.Owner
        | OrderEventActor.AssignedDriver
        | OrderEventActor.FulfillmentProvider;
      driverId: number | null;
      providerEventId: string | null;
    }
  | {kind: OrderEventKind.DRIVER_ASSIGNED; orderId: number; driverId: number};

/** Record only after the order write, using the change's own transaction. */
export async function recordOrderEvent(
  manager: EntityManager,
  event: NewOrderEvent,
): Promise<void> {
  switch (event.kind) {
    case OrderEventKind.CREATED:
      await manager.insert(OrderEvent, {
        orderId: event.orderId,
        kind: event.kind,
        fromStatus: null,
        toStatus: OrderStatus.Pending,
        actor: OrderEventActor.Client,
        driverId: null,
        providerEventId: null,
      });
      break;
    case OrderEventKind.STATUS_CHANGED:
      await manager.insert(OrderEvent, {
        orderId: event.orderId,
        kind: event.kind,
        fromStatus: event.from,
        toStatus: event.to,
        actor: event.actor,
        driverId: event.driverId,
        providerEventId: event.providerEventId,
      });
      break;
    case OrderEventKind.DRIVER_ASSIGNED:
      await manager.insert(OrderEvent, {
        orderId: event.orderId,
        kind: event.kind,
        fromStatus: null,
        toStatus: null,
        actor: OrderEventActor.AssignedDriver,
        driverId: event.driverId,
        providerEventId: null,
      });
      break;
  }
}
