import {INestApplication} from '@nestjs/common';

import {
  OutboxEvent,
  OutboxEventType,
  OutboxStatus,
} from 'src/fulfillment/entities/outbox-event.entity';
import {OutboxService} from 'src/fulfillment/outbox.service';
import {MockFulfillmentProvider} from 'src/fulfillment/provider/mock-provider.service';
import {Order} from 'src/orders/entities/order.entity';

import type {TestContext} from './utils/e2e';
import {FakeLedger} from './utils/fake-ledger';

describe('checkout (e2e)', () => {
  const fake = new FakeLedger();
  const envKeys = [
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
  let outbox: OutboxService;
  let clientToken: string;
  let restaurantId: number;
  let dishId: number;
  let expensiveDishId: number;

  beforeAll(async () => {
    const baseUrl = await fake.start();
    for (const key of envKeys) {
      savedEnv.set(key, process.env[key]);
    }
    Object.assign(process.env, {
      LEDGER_CHECKOUT: 'enabled',
      LEDGER_BASE_URL: baseUrl,
      LEDGER_APP_TOKEN: 'app_test.e2e-token',
      LEDGER_CHECKOUT_SUCCESS_URL: 'https://example.com/f15/return',
      LEDGER_CHECKOUT_CANCEL_URL: 'https://example.com/f15/cancel',
      LEDGER_TIMEOUT_MS: '300',
      LEDGER_NOTIFICATION_SECRET: 'n'.repeat(40),
    });
    // AppModule validates config on import, so load it after setting this spec's env.
    harness = await import('./utils/e2e');
    ctx = await harness.createTestApp();
    app = ctx.app;
    outbox = ctx.moduleRef.get(OutboxService);
    ctx.moduleRef
      .get(MockFulfillmentProvider)
      .configure({failureRate: 0, alwaysFailOrderIds: [], callbackUrl: null});
    clientToken = await harness.registerAndLogin(app, 'client@checkout.test', 'Client');
    const ownerToken = await harness.registerAndLogin(app, 'owner@checkout.test', 'Owner');
    const restaurant = await harness.gql(
      app,
      'mutation { createRestaurant(input: {name: "Checkout Kitchen", coverImage: "x", address: "1 Checkout Road", categoryName: "Pizza"}) { ok restaurantId } }',
      ownerToken,
    );
    restaurantId = restaurant.body.data.createRestaurant.restaurantId;
    for (const [name, price] of [
      ['Checkout Dish', 1875],
      ['Expensive Dish', 10001],
    ] as const) {
      const response = await harness.gql(
        app,
        'mutation { createDish(input: {restaurantId: ' +
          restaurantId +
          ', name: "' +
          name +
          '", priceCents: ' +
          price +
          ', description: "Checkout test"}) { ok } }',
        ownerToken,
      );
      expect(response.body.data.createDish.ok).toBe(true);
    }
    const menu = await harness.gql(
      app,
      'query { restaurant(input: {restaurantId: ' +
        restaurantId +
        '}) { restaurant { menu { id priceCents } } } }',
    );
    const dishes = menu.body.data.restaurant.restaurant.menu;
    dishId = dishes.find((dish: {priceCents: number}) => dish.priceCents === 1875).id;
    expensiveDishId = dishes.find((dish: {priceCents: number}) => dish.priceCents === 10001).id;
  });

  afterAll(async () => {
    try {
      if (ctx) {
        await harness.destroyTestApp(ctx);
      }
    } finally {
      try {
        await fake.stop();
      } finally {
        for (const [key, value] of savedEnv) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
    }
  });

  beforeEach(async () => {
    await ctx.dataSource.getRepository(OutboxEvent).clear();
  });

  const repo = () => ctx.dataSource.getRepository(OutboxEvent);
  const keyFor = (id: number) => 'dispatch-order-' + id;
  const requestsFor = (id: number) =>
    fake.requests.filter(request => request.body.orderKey === keyFor(id));
  const paymentFor = (id: number) => fake.payments.get(keyFor(id));
  const eventFor = (id: number) =>
    repo().findOneByOrFail({aggregateId: id, type: OutboxEventType.OrderPayment});
  const orderFor = (id: number) => ctx.dataSource.getRepository(Order).findOneByOrFail({id});

  async function createOrder(dish = dishId) {
    const response = await harness.gql(
      app,
      'mutation { createOrder(input: {restaurantId: ' +
        restaurantId +
        ', items: [{dishId: ' +
        dish +
        '}]}) { ok error orderId } }',
      clientToken,
    );
    return response.body.data.createOrder;
  }

  async function placeOrder(): Promise<number> {
    const response = await createOrder();
    expect(response.ok).toBe(true);
    return response.orderId;
  }

  async function makeDue(id: number): Promise<void> {
    await ctx.dataSource.query('UPDATE "outbox_event" SET "nextAttemptAt" = now() WHERE id = $1', [
      id,
    ]);
  }

  it('createOrder writes an order.payment event with the order', async () => {
    const id = await placeOrder();
    const events = await repo().findBy({aggregateId: id});
    expect(events).toHaveLength(2);
    expect(events.filter(event => event.type === OutboxEventType.OrderDispatch)).toHaveLength(1);
    expect(await eventFor(id)).toMatchObject({
      aggregateId: id,
      payload: {totalCents: 1875},
      status: OutboxStatus.Pending,
    });
    const before = await repo().count();
    const ordersBefore = await ctx.dataSource.getRepository(Order).count();
    expect((await createOrder(999999)).ok).toBe(false);
    expect(await repo().count()).toBe(before);
    expect(await ctx.dataSource.getRepository(Order).count()).toBe(ordersBefore);
  });

  it('createOrder refuses totals the ledger cannot price', async () => {
    const before = await ctx.dataSource.getRepository(Order).count();
    expect(await createOrder(expensiveDishId)).toMatchObject({
      ok: false,
      error: 'Order total must be between 1 and 10000 cents for checkout',
    });
    expect(await ctx.dataSource.getRepository(Order).count()).toBe(before);
    expect(await repo().count()).toBe(0);
  });

  it('drain creates one ledger payment and stores it', async () => {
    const id = await placeOrder();
    await outbox.drain();
    const calls = requestsFor(id);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/payments',
      headers: {
        authorization: 'Bearer app_test.e2e-token',
        'idempotency-key': keyFor(id),
        'content-type': 'application/json',
      },
    });
    expect(calls[0].body).toEqual({
      orderKey: keyFor(id),
      productRef: 'dispatch-order',
      priceVersion: 1,
      quantity: 1875,
      amountMinor: 1875,
      currency: 'USD',
      successUrl: 'https://example.com/f15/return',
      cancelUrl: 'https://example.com/f15/cancel',
    });
    const order = await orderFor(id);
    expect(order.ledgerPaymentId).toBe(paymentFor(id).id);
    expect(order.checkoutUrl).toMatch(
      /^https:\/\/www\.sandbox\.paypal\.com\/checkoutnow\?token=FAKE/,
    );
    expect(await eventFor(id)).toMatchObject({
      status: OutboxStatus.Sent,
      providerRef: paymentFor(id).id,
      lastError: null,
    });
    const response = await harness.gql(
      app,
      'query { getOrder(input: {id: ' + id + '}) { order { ledgerPaymentId checkoutUrl } } }',
      clientToken,
    );
    expect(response.body.data.getOrder.order).toEqual({
      ledgerPaymentId: order.ledgerPaymentId,
      checkoutUrl: order.checkoutUrl,
    });
  });

  it('a timeout after the ledger accepted is retried with the same key', async () => {
    const id = await placeOrder();
    fake.script(keyFor(id), [{respond: 'slow', delayMs: 1000}]);
    await outbox.drain();
    const event = await eventFor(id);
    expect(event).toMatchObject({status: OutboxStatus.Pending, attempts: 1});
    expect(new Date(event.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    await makeDue(event.id);
    await outbox.drain();
    expect(requestsFor(id)).toHaveLength(2);
    expect(requestsFor(id).map(request => request.headers['idempotency-key'])).toEqual([
      keyFor(id),
      keyFor(id),
    ]);
    expect([...fake.payments.keys()].filter(key => key === keyFor(id))).toHaveLength(1);
    expect((await orderFor(id)).ledgerPaymentId).toBe(paymentFor(id).id);
    expect((await eventFor(id)).status).toBe(OutboxStatus.Sent);
  });

  it('a redelivered sent event creates no second payment', async () => {
    const id = await placeOrder();
    await outbox.drain();
    const before = await orderFor(id);
    const payment = paymentFor(id);
    const event = await eventFor(id);
    await repo().update(event.id, {status: OutboxStatus.Pending});
    await makeDue(event.id);
    await outbox.drain();
    expect(requestsFor(id)).toHaveLength(2);
    expect(requestsFor(id).map(request => request.headers['idempotency-key'])).toEqual([
      keyFor(id),
      keyFor(id),
    ]);
    expect([...fake.payments.keys()].filter(key => key === keyFor(id))).toHaveLength(1);
    expect(paymentFor(id)).toEqual(payment);
    const after = await orderFor(id);
    expect(after.ledgerPaymentId).toBe(before.ledgerPaymentId);
    expect(after.checkoutUrl).toBe(before.checkoutUrl);
    expect((await eventFor(id)).status).toBe(OutboxStatus.Sent);
  });

  it('two concurrent drains send one request', async () => {
    const id = await placeOrder();
    await Promise.all([outbox.drain(), outbox.drain()]);
    expect(requestsFor(id)).toHaveLength(1);
    expect((await eventFor(id)).status).toBe(OutboxStatus.Sent);
  });

  it('transient ledger errors back off and retry', async () => {
    const id = await placeOrder();
    fake.script(keyFor(id), [
      {respond: 'status', status: 503, code: 'SERVICE_UNAVAILABLE'},
      {respond: 'status', status: 503, code: 'SERVICE_UNAVAILABLE'},
      {respond: 'ok'},
    ]);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await makeDue((await eventFor(id)).id);
      await outbox.drain();
      if (attempt < 3) {
        const event = await eventFor(id);
        expect(event).toMatchObject({status: OutboxStatus.Pending, attempts: attempt});
        expect(new Date(event.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
      }
    }
    expect(requestsFor(id)).toHaveLength(3);
    expect(requestsFor(id).map(request => request.headers['idempotency-key'])).toEqual([
      keyFor(id),
      keyFor(id),
      keyFor(id),
    ]);
    expect((await eventFor(id)).status).toBe(OutboxStatus.Sent);
    expect([...fake.payments.keys()].filter(key => key === keyFor(id))).toHaveLength(1);
  });

  it('a deterministic rejection dead-letters at once', async () => {
    const id = await placeOrder();
    fake.script(keyFor(id), [{respond: 'status', status: 422, code: 'AMOUNT_MISMATCH'}]);
    await outbox.drain();
    expect(await eventFor(id)).toMatchObject({
      status: OutboxStatus.Dead,
      attempts: 1,
      lastError: 'ledger 422 AMOUNT_MISMATCH',
    });
    expect((await orderFor(id)).ledgerPaymentId).toBeNull();
    await outbox.drain();
    expect(requestsFor(id)).toHaveLength(1);
  });

  it('an unknown result keeps the payment id and resolves on replay', async () => {
    const id = await placeOrder();
    fake.script(keyFor(id), [{respond: 'unknown'}]);
    await outbox.drain();
    const event = await eventFor(id);
    expect(event).toMatchObject({
      status: OutboxStatus.Pending,
      attempts: 1,
      lastError: 'ledger checkout not ready',
    });
    expect(await orderFor(id)).toMatchObject({
      ledgerPaymentId: paymentFor(id).id,
      checkoutUrl: null,
    });
    await makeDue(event.id);
    await outbox.drain();
    expect((await eventFor(id)).status).toBe(OutboxStatus.Sent);
    expect((await orderFor(id)).checkoutUrl).toContain('https://www.sandbox.paypal.com/');
    expect([...fake.payments.keys()].filter(key => key === keyFor(id))).toHaveLength(1);
  });

  it('a different payment id is never overwritten', async () => {
    const id = await placeOrder();
    const other = 'pay_OTHER000000000000000000000';
    await ctx.dataSource.query('UPDATE "order" SET "ledgerPaymentId" = $1 WHERE id = $2', [
      other,
      id,
    ]);
    await outbox.drain();
    expect(await eventFor(id)).toMatchObject({
      status: OutboxStatus.Dead,
      lastError: 'ledger payment id mismatch',
    });
    expect((await orderFor(id)).ledgerPaymentId).toBe(other);
    expect((await orderFor(id)).checkoutUrl).toBeNull();
  });

  it('a replay with no next action settles the outbox event', async () => {
    const id = await placeOrder();
    fake.script(keyFor(id), [{respond: 'settled'}]);
    await outbox.drain();
    const payment = paymentFor(id);
    expect(await eventFor(id)).toMatchObject({status: OutboxStatus.Sent, providerRef: payment.id});
    expect(await orderFor(id)).toMatchObject({ledgerPaymentId: payment.id, checkoutUrl: null});
    expect(requestsFor(id)).toHaveLength(1);
    await outbox.drain();
    expect(requestsFor(id)).toHaveLength(1);
  });
});
