import {INestApplication} from '@nestjs/common';

import {OutboxEvent} from 'src/fulfillment/entities/outbox-event.entity';
import {OutboxService} from 'src/fulfillment/outbox.service';
import {MockFulfillmentProvider} from 'src/fulfillment/provider/mock-provider.service';
import {Order} from 'src/orders/entities/order.entity';

import type {TestContext} from './utils/e2e';
import {FakeLedger} from './utils/fake-ledger';

describe('storefront payment (e2e)', () => {
  const fake = new FakeLedger();
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
  let outbox: OutboxService;
  let clientToken: string;
  let otherToken: string;
  let ownerToken: string;
  let restaurantId: number;
  let dishId: number;

  beforeAll(async () => {
    const baseUrl = await fake.start();
    for (const key of keys) savedEnv.set(key, process.env[key]);
    Object.assign(process.env, {
      LEDGER_CHECKOUT: 'enabled',
      LEDGER_BASE_URL: baseUrl,
      LEDGER_APP_TOKEN: 'app_test.e2e-token',
      LEDGER_CHECKOUT_SUCCESS_URL: 'https://example.com/f15/return',
      LEDGER_CHECKOUT_CANCEL_URL: 'https://example.com/f15/cancel',
      LEDGER_TIMEOUT_MS: '300',
      LEDGER_NOTIFICATION_SECRET: 'n'.repeat(40),
    });
    harness = await import('./utils/e2e');
    ctx = await harness.createTestApp();
    app = ctx.app;
    outbox = ctx.moduleRef.get(OutboxService);
    ctx.moduleRef
      .get(MockFulfillmentProvider)
      .configure({failureRate: 0, alwaysFailOrderIds: [], callbackUrl: null});
    clientToken = await harness.registerAndLogin(app, 'client@storefront.test', 'Client');
    otherToken = await harness.registerAndLogin(app, 'other@storefront.test', 'Client');
    ownerToken = await harness.registerAndLogin(app, 'owner@storefront.test', 'Owner');
    const restaurant = await harness.gql(
      app,
      'mutation { createRestaurant(input: {name: "Storefront Kitchen", coverImage: "x", address: "1 Storefront Road", categoryName: "Pizza"}) { ok restaurantId } }',
      ownerToken,
    );
    restaurantId = restaurant.body.data.createRestaurant.restaurantId;
    const dish = await harness.gql(
      app,
      `mutation { createDish(input: {restaurantId: ${restaurantId}, name: "Storefront Dish", priceCents: 1500, description: "Storefront test"}) { ok } }`,
      ownerToken,
    );
    expect(dish.body.data.createDish.ok).toBe(true);
    const menu = await harness.gql(
      app,
      `query { restaurant(input: {restaurantId: ${restaurantId}}) { restaurant { menu { id } } } }`,
    );
    dishId = menu.body.data.restaurant.restaurant.menu[0].id;
  });

  afterAll(async () => {
    try {
      if (ctx) await harness.destroyTestApp(ctx);
    } finally {
      try {
        await fake.stop();
      } finally {
        for (const [key, value] of savedEnv) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    }
  });

  beforeEach(async () => {
    await ctx.dataSource.getRepository(OutboxEvent).clear();
    fake.requests.length = 0;
  });

  async function placeOrder(): Promise<Order> {
    const response = await harness.gql(
      app,
      `mutation { createOrder(input: {restaurantId: ${restaurantId}, items: [{dishId: ${dishId}}]}) { ok orderId } }`,
      clientToken,
    );
    expect(response.body.data.createOrder.ok).toBe(true);
    return ctx.dataSource
      .getRepository(Order)
      .findOneByOrFail({id: response.body.data.createOrder.orderId});
  }
  async function paidOrder(): Promise<Order> {
    const order = await placeOrder();
    await outbox.drain();
    return ctx.dataSource.getRepository(Order).findOneByOrFail({id: order.id});
  }
  async function refresh(id: number, token: string) {
    const response = await harness.gql(
      app,
      `mutation { refreshOrderPayment(input: {orderId: ${id}}) { ok error code paymentStatus } }`,
      token,
    );
    return response.body.data?.refreshOrderPayment;
  }
  function readsOf(paymentId: string) {
    return fake.requests.filter(
      request => request.method === 'GET' && request.path === '/v1/payments/' + paymentId,
    );
  }

  it('customer refreshes an order awaiting payment', async () => {
    const order = await paidOrder();
    expect(await refresh(order.id, clientToken)).toEqual({
      ok: true,
      error: null,
      code: null,
      paymentStatus: 'AwaitingPayment',
    });
    expect(readsOf(order.ledgerPaymentId)).toHaveLength(1);
    expect(readsOf(order.ledgerPaymentId)[0].headers.authorization).toBe(
      'Bearer app_test.e2e-token',
    );
  });
  it('another customer cannot refresh the order', async () => {
    const order = await paidOrder();
    expect(await refresh(order.id, otherToken)).toMatchObject({ok: false, code: 'FORBIDDEN'});
    expect(readsOf(order.ledgerPaymentId)).toHaveLength(0);
  });
  it('the restaurant owner cannot refresh the order', async () => {
    const order = await paidOrder();
    expect(await refresh(order.id, ownerToken)).toMatchObject({ok: false, code: 'FORBIDDEN'});
    expect(readsOf(order.ledgerPaymentId)).toHaveLength(0);
  });
  it('an unknown order is not found', async () => {
    expect(await refresh(999999, clientToken)).toMatchObject({ok: false, code: 'NOT_FOUND'});
  });
  it('an order without a ledger payment needs no read', async () => {
    const order = await placeOrder();
    expect(await refresh(order.id, clientToken)).toMatchObject({
      ok: true,
      paymentStatus: 'AwaitingPayment',
    });
    expect(fake.requests.filter(request => request.method === 'GET')).toHaveLength(0);
  });
  it('a paid order needs no read', async () => {
    const order = await paidOrder();
    await ctx.dataSource.query('UPDATE "order" SET "paymentStatus" = \'Paid\' WHERE id = $1', [
      order.id,
    ]);
    expect(await refresh(order.id, clientToken)).toMatchObject({ok: true, paymentStatus: 'Paid'});
    expect(readsOf(order.ledgerPaymentId)).toHaveLength(0);
  });
  it('a retryable ledger failure is unavailable', async () => {
    const order = await paidOrder();
    fake.scriptRead(order.ledgerPaymentId, [{respond: 'status', status: 503, code: 'UNAVAILABLE'}]);
    expect(await refresh(order.id, clientToken)).toMatchObject({
      ok: false,
      code: 'UNAVAILABLE',
      error: 'Payment status could not be checked; try again shortly.',
    });
    expect(
      (await ctx.dataSource.getRepository(Order).findOneByOrFail({id: order.id})).paymentStatus,
    ).toBe('AwaitingPayment');
  });
  it('a rejected ledger read is unavailable', async () => {
    const order = await paidOrder();
    fake.scriptRead(order.ledgerPaymentId, [{respond: 'status', status: 404, code: 'NOT_FOUND'}]);
    expect(await refresh(order.id, clientToken)).toMatchObject({ok: false, code: 'UNAVAILABLE'});
  });
  it('only signed notifications move payment status', async () => {
    const order = await paidOrder();
    const before = await ctx.dataSource.getRepository(Order).findOneByOrFail({id: order.id});
    const events = async () =>
      ctx.dataSource.query('SELECT count(*) AS n FROM order_event WHERE "orderId" = $1', [
        order.id,
      ]);
    const count = await events();
    fake.scriptRead(order.ledgerPaymentId, [{respond: 'resource', paymentStatus: 'SUCCEEDED'}]);
    expect(await refresh(order.id, clientToken)).toMatchObject({
      ok: true,
      paymentStatus: 'AwaitingPayment',
    });
    expect(await ctx.dataSource.getRepository(Order).findOneByOrFail({id: order.id})).toEqual(
      before,
    );
    expect(await events()).toEqual(count);
  });
});
