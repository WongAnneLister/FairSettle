import {INestApplication} from '@nestjs/common';
import {createHash, randomUUID} from 'node:crypto';

import {LedgerNotification} from 'src/ledger/entities/ledger-notification.entity';
import {Order, OrderPaymentStatus, OrderStatus} from 'src/orders/entities/order.entity';

import type {TestContext} from './utils/e2e';
import {notificationBody, postNotification} from './utils/ledger-notifications';

describe('payment-notification (e2e)', () => {
  const keys = [
    'LEDGER_CHECKOUT',
    'LEDGER_BASE_URL',
    'LEDGER_APP_TOKEN',
    'LEDGER_CHECKOUT_SUCCESS_URL',
    'LEDGER_CHECKOUT_CANCEL_URL',
    'LEDGER_TIMEOUT_MS',
    'LEDGER_NOTIFICATION_SECRET',
  ];
  const savedEnv = new Map<string, string | undefined>();
  let harness: typeof import('./utils/e2e');
  let ctx: TestContext;
  let app: INestApplication;
  let clientToken: string;
  let restaurantId: number;
  let dishId: number;

  beforeAll(async () => {
    for (const key of keys) {
      savedEnv.set(key, process.env[key]);
    }
    Object.assign(process.env, {
      LEDGER_CHECKOUT: 'enabled',
      LEDGER_BASE_URL: 'http://127.0.0.1:1',
      LEDGER_APP_TOKEN: 'app_test.e2e-token',
      LEDGER_CHECKOUT_SUCCESS_URL: 'https://example.com/f16/return',
      LEDGER_CHECKOUT_CANCEL_URL: 'https://example.com/f16/cancel',
      LEDGER_TIMEOUT_MS: '300',
      LEDGER_NOTIFICATION_SECRET: 'n'.repeat(40),
    });
    harness = await import('./utils/e2e');
    ctx = await harness.createTestApp();
    app = ctx.app;
    clientToken = await harness.registerAndLogin(app, 'client@payment-notification.test', 'Client');
    const owner = await harness.registerAndLogin(app, 'owner@payment-notification.test', 'Owner');
    const restaurant = await harness.gql(
      app,
      'mutation { createRestaurant(input: {name: "Notification Kitchen", coverImage: "x", address: "1 Ledger Road", categoryName: "Pizza"}) { ok restaurantId } }',
      owner,
    );
    restaurantId = restaurant.body.data.createRestaurant.restaurantId;
    const dish = await harness.gql(
      app,
      'mutation { createDish(input: {restaurantId: ' +
        restaurantId +
        ', name: "Notification Dish", priceCents: 1875, description: "Payment notification test"}) { ok } }',
      owner,
    );
    expect(dish.body.data.createDish.ok).toBe(true);
    const menu = await harness.gql(
      app,
      'query { restaurant(input: {restaurantId: ' +
        restaurantId +
        '}) { restaurant { menu { id } } } }',
    );
    dishId = menu.body.data.restaurant.restaurant.menu[0].id;
  });

  afterAll(async () => {
    try {
      if (ctx) {
        await harness.destroyTestApp(ctx);
      }
    } finally {
      for (const [key, value] of savedEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  beforeEach(async () => {
    await ctx.dataSource.getRepository(LedgerNotification).clear();
  });

  const inbox = () => ctx.dataSource.getRepository(LedgerNotification);
  const orderFor = (id: number) => ctx.dataSource.getRepository(Order).findOneByOrFail({id});
  const eventFor = (id: number, overrides: Record<string, unknown> = {}) =>
    notificationBody({eventId: randomUUID(), orderKey: 'dispatch-order-' + id, ...overrides});

  async function placeOrder(): Promise<number> {
    const res = await harness.gql(
      app,
      'mutation { createOrder(input: {restaurantId: ' +
        restaurantId +
        ', items: [{dishId: ' +
        dishId +
        '}]}) { ok orderId } }',
      clientToken,
    );
    expect(res.body.data.createOrder.ok).toBe(true);
    return res.body.data.createOrder.orderId;
  }

  it('orders start awaiting payment when checkout is enabled', async () => {
    const id = await placeOrder();
    expect((await orderFor(id)).paymentStatus).toBe(OrderPaymentStatus.AwaitingPayment);
    const response = await harness.gql(
      app,
      'query { getOrder(input: {id: ' + id + '}) { order { paymentStatus status } } }',
      clientToken,
    );
    expect(response.body.data.getOrder.order).toEqual({
      paymentStatus: 'AwaitingPayment',
      status: 'Pending',
    });
  });

  it('a signed payment.succeeded marks the order paid', async () => {
    const id = await placeOrder();
    const raw = eventFor(id);
    const event = JSON.parse(raw.toString('utf8'));
    const response = await postNotification(app, raw).expect(200);
    expect(response.body).toMatchObject({received: true, duplicate: false, applied: true});
    expect(await orderFor(id)).toMatchObject({
      paymentStatus: OrderPaymentStatus.Paid,
      status: OrderStatus.Pending,
      ledgerPaymentId: null,
    });
    expect(await inbox().count()).toBe(1);
    expect(await inbox().findOneByOrFail({eventId: event.eventId})).toMatchObject({
      eventId: event.eventId,
      businessKey: event.businessKey,
      digest: createHash('sha256').update(raw).digest('hex'),
      orderId: id,
      outcome: 'applied: Paid',
    });
  });

  it('a redelivered event is a duplicate', async () => {
    const id = await placeOrder();
    const raw = eventFor(id);
    const timestamp = Math.floor(Date.now() / 1000) - 1;
    await postNotification(app, raw, {timestamp}).expect(200);
    const before = await inbox().find();
    const response = await postNotification(app, raw, {timestamp: timestamp + 1}).expect(200);
    expect(response.body).toEqual({received: true, duplicate: true});
    expect(await inbox().find()).toEqual(before);
    expect((await orderFor(id)).paymentStatus).toBe(OrderPaymentStatus.Paid);
  });

  it('an event id reused with different content is a conflict', async () => {
    const id = await placeOrder();
    const eventId = randomUUID();
    await postNotification(app, eventFor(id, {eventId})).expect(200);
    const before = await inbox().find();
    const response = await postNotification(app, eventFor(id, {eventId, amountMinor: 1874})).expect(
      409,
    );
    expect(response.body).toEqual({error: 'event id reused with different content'});
    expect(await inbox().find()).toEqual(before);
    expect((await orderFor(id)).paymentStatus).toBe(OrderPaymentStatus.Paid);
  });

  it('payment.canceled marks an awaiting order failed', async () => {
    const id = await placeOrder();
    const raw = eventFor(id, {
      eventType: 'payment.canceled',
      paymentStatus: 'CANCELED',
      capturedAmountMinor: 0,
    });
    const response = await postNotification(app, raw).expect(200);
    expect(response.body).toMatchObject({received: true, duplicate: false, applied: true});
    expect((await orderFor(id)).paymentStatus).toBe(OrderPaymentStatus.Failed);
    expect((await inbox().find())[0].outcome).toBe('applied: Failed');
  });

  it('out-of-order events are ignored', async () => {
    const id = await placeOrder();
    await postNotification(app, eventFor(id)).expect(200);
    const informational = await postNotification(
      app,
      eventFor(id, {eventType: 'payment.state_changed', paymentStatus: 'PROCESSING'}),
    ).expect(200);
    expect(informational.body).toMatchObject({
      applied: false,
      reason: 'ignored: informational event',
    });
    const canceled = eventFor(id, {eventType: 'payment.canceled', paymentStatus: 'CANCELED'});
    expect((await postNotification(app, canceled).expect(200)).body.applied).toBe(false);
    expect(
      (await inbox().findOneByOrFail({eventId: JSON.parse(canceled.toString('utf8')).eventId}))
        .outcome,
    ).toContain('cannot apply');
    expect((await orderFor(id)).paymentStatus).toBe(OrderPaymentStatus.Paid);
    const failed = await placeOrder();
    await postNotification(
      app,
      eventFor(failed, {
        eventType: 'payment.canceled',
        paymentStatus: 'CANCELED',
        capturedAmountMinor: 0,
      }),
    ).expect(200);
    expect((await postNotification(app, eventFor(failed)).expect(200)).body.applied).toBe(false);
    expect((await orderFor(failed)).paymentStatus).toBe(OrderPaymentStatus.Failed);
  });

  it('bad signatures store nothing', async () => {
    const id = await placeOrder();
    const raw = eventFor(id);
    await postNotification(app, raw, {secret: 'x'.repeat(40)}).expect(401);
    await postNotification(app, raw, {timestamp: Math.floor(Date.now() / 1000) - 301}).expect(401);
    await postNotification(app, raw).unset('X-Payments-Signature').expect(401);
    const different = Buffer.from(raw.toString('utf8') + ' ');
    const body = JSON.parse(raw.toString('utf8'));
    const {signNotification} = await import('src/ledger/notification');
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signNotification(
      different,
      body.eventId,
      body.businessKey,
      timestamp,
      'n'.repeat(40),
    );
    await postNotification(app, raw, {timestamp, signature}).expect(401);
    expect(await inbox().count()).toBe(0);
    expect((await orderFor(id)).paymentStatus).toBe(OrderPaymentStatus.AwaitingPayment);
  });

  it('headers must match the body', async () => {
    const id = await placeOrder();
    await postNotification(app, eventFor(id), {eventIdHeader: randomUUID()}).expect(400);
    expect(await inbox().count()).toBe(0);
    expect((await orderFor(id)).paymentStatus).toBe(OrderPaymentStatus.AwaitingPayment);
  });

  it('inconsistent events are recorded but not applied', async () => {
    const id = await placeOrder();
    for (const [patch, reason] of [
      [{amountMinor: 1874}, 'ignored: amount mismatch'],
      [{orderKey: 'dispatch-order-999999'}, 'ignored: unknown order'],
      [{capturedAmountMinor: 1800}, 'ignored: not a full capture'],
      [{currency: 'EUR'}, 'ignored: currency mismatch'],
    ] as const) {
      const raw = eventFor(id, patch);
      const response = await postNotification(app, raw).expect(200);
      expect(response.body).toMatchObject({
        received: true,
        duplicate: false,
        applied: false,
        reason,
      });
      expect(
        (await inbox().findOneByOrFail({eventId: JSON.parse(raw.toString('utf8')).eventId}))
          .outcome,
      ).toBe(reason);
      expect((await orderFor(id)).paymentStatus).toBe(OrderPaymentStatus.AwaitingPayment);
    }
    expect(await inbox().count()).toBe(4);
  });

  it('concurrent duplicates apply once', async () => {
    const id = await placeOrder();
    const raw = eventFor(id);
    const responses = await Promise.all(Array.from({length: 5}, () => postNotification(app, raw)));
    expect(responses.every(response => response.status === 200)).toBe(true);
    expect(responses.filter(response => response.body.duplicate === false)).toHaveLength(1);
    expect(responses.filter(response => response.body.duplicate === true)).toHaveLength(4);
    expect(await inbox().count()).toBe(1);
    expect((await orderFor(id)).paymentStatus).toBe(OrderPaymentStatus.Paid);
  });

  it('raw bytes with extra whitespace verify', async () => {
    const id = await placeOrder();
    const event = JSON.parse(eventFor(id).toString('utf8'));
    const raw = Buffer.from(JSON.stringify(event, null, 2));
    expect((await postNotification(app, raw).expect(200)).body.applied).toBe(true);
    expect((await orderFor(id)).paymentStatus).toBe(OrderPaymentStatus.Paid);
    expect((await inbox().find())[0].digest).toBe(createHash('sha256').update(raw).digest('hex'));
  });
});
