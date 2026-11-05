import {createClient} from 'graphql-ws';
import * as WebSocket from 'ws';

import {OrderEventKind} from '../src/orders/entities/order-event.entity';
import {
  TestContext,
  createTestApp,
  destroyTestApp,
  gql,
  portOf,
  registerAndLogin,
} from './utils/e2e';

describe('Driver offers (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let clientToken: string;
  let driverAToken: string;
  let driverBToken: string;
  let restaurantId: number;
  let dishId: number;
  let free: number;
  let paid: number;
  let awaiting: number;
  let failed: number;
  let cooking: number;
  let claimed: number;

  async function placeOrder(
    payment: 'NotRequired' | 'AwaitingPayment' | 'Paid' | 'Failed',
    cook: 'Cooking' | 'Cooked',
  ): Promise<number> {
    const created = await gql(
      ctx.app,
      `mutation {
        createOrder(input: {restaurantId: ${restaurantId}, items: [{dishId: ${dishId}}]}) {
          ok error orderId
        }
      }`,
      clientToken,
    );
    expect(created.body.data.createOrder.ok).toBe(true);
    const id = created.body.data.createOrder.orderId;

    if (payment !== 'NotRequired') {
      // This spec runs without a ledger, so payment states are set directly;
      // F16's specs cover how they are reached. Set payment before the push.
      await ctx.dataSource.query('UPDATE "order" SET "paymentStatus" = $1 WHERE id = $2', [
        payment,
        id,
      ]);
    }

    const started = await gql(
      ctx.app,
      `mutation { editOrder(input: {id: ${id}, status: Cooking}) { ok error } }`,
      ownerToken,
    );
    expect(started.body.data.editOrder.ok).toBe(true);
    if (cook === 'Cooked') {
      const ready = await gql(
        ctx.app,
        `mutation { editOrder(input: {id: ${id}, status: Cooked}) { ok error } }`,
        ownerToken,
      );
      expect(ready.body.data.editOrder.ok).toBe(true);
    }
    return id;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    ownerToken = await registerAndLogin(ctx.app, 'owner@offers.test', 'Owner');
    clientToken = await registerAndLogin(ctx.app, 'client@offers.test', 'Client');
    driverAToken = await registerAndLogin(ctx.app, 'driver-a@offers.test', 'Delivery');
    driverBToken = await registerAndLogin(ctx.app, 'driver-b@offers.test', 'Delivery');

    const restaurant = await gql(
      ctx.app,
      `mutation {
        createRestaurant(input: {
          name: "Offers Kitchen", coverImage: "x", address: "1 Offer Street", categoryName: "Pizza"
        }) { ok error restaurantId }
      }`,
      ownerToken,
    );
    expect(restaurant.body.data.createRestaurant.ok).toBe(true);
    restaurantId = restaurant.body.data.createRestaurant.restaurantId;

    const dish = await gql(
      ctx.app,
      `mutation {
        createDish(input: {
          restaurantId: ${restaurantId}, name: "Offer Pizza", priceCents: 1200,
          description: "A pizza for the driver offer tests"
        }) { ok error }
      }`,
      ownerToken,
    );
    expect(dish.body.data.createDish.ok).toBe(true);
    const menu = await gql(
      ctx.app,
      `query { restaurant(input: {restaurantId: ${restaurantId}}) {
        restaurant { menu { id } }
      } }`,
    );
    dishId = menu.body.data.restaurant.restaurant.menu[0].id;

    free = await placeOrder('NotRequired', 'Cooked');
    paid = await placeOrder('Paid', 'Cooked');
    await ctx.dataSource.query(
      `UPDATE "order" SET "checkoutUrl" = 'https://example.com/approve',
        "ledgerPaymentId" = 'pay_e2e_offer' WHERE id = $1`,
      [paid],
    );
    awaiting = await placeOrder('AwaitingPayment', 'Cooked');
    failed = await placeOrder('Failed', 'Cooked');
    cooking = await placeOrder('NotRequired', 'Cooking');
    claimed = await placeOrder('NotRequired', 'Cooked');
    const claim = await gql(
      ctx.app,
      `mutation { takeOrder(input: {id: ${claimed}}) { ok } }`,
      driverAToken,
    );
    expect(claim.body.data.takeOrder.ok).toBe(true);
  });

  afterAll(async () => {
    await destroyTestApp(ctx);
  });

  const availableOrders = (token: string) =>
    gql(
      ctx.app,
      `query { availableOrders(input: {page: 1}) { ok totalResults orders { id } } }`,
      token,
    );

  it('E1 lists only offered orders', async () => {
    const res = await availableOrders(driverBToken);
    const result = res.body.data.availableOrders;
    expect(result.ok).toBe(true);
    const ids = result.orders.map((order: {id: number}) => order.id);
    expect(ids).toContain(free);
    expect(ids).toContain(paid);
    for (const id of [awaiting, failed, cooking, claimed]) {
      expect(ids).not.toContain(id);
    }
    expect(result.totalResults).toBe(ids.length);
  });

  it('E2 lists the oldest order first', async () => {
    const res = await availableOrders(driverBToken);
    const ids = res.body.data.availableOrders.orders.map((order: {id: number}) => order.id);
    expect(ids.indexOf(free)).toBeLessThan(ids.indexOf(paid));
  });

  it('E3 returns no customer data in the list', async () => {
    const res = await gql(
      ctx.app,
      `query { availableOrders(input: {page: 1}) {
        orders {
          id customer { id email } driver { id } checkoutUrl ledgerPaymentId paymentStatus
          restaurant { name address } items { dish { name } }
        }
      } }`,
      driverBToken,
    );
    expect(res.body.errors).toBeUndefined();
    const order = res.body.data.availableOrders.orders.find(
      (entry: {id: number}) => entry.id === paid,
    );
    expect(order.customer).toBeNull();
    expect(order.driver).toBeNull();
    expect(order.checkoutUrl).toBeNull();
    expect(order.ledgerPaymentId).toBeNull();
    expect(order.paymentStatus).toBe('Paid');
    expect(order.restaurant.address).toBe('1 Offer Street');
    expect(order.items[0].dish.name).toBe('Offer Pizza');
  });

  it('E4 permits only drivers to list available orders', async () => {
    for (const token of [clientToken, ownerToken, undefined]) {
      const res = await gql(ctx.app, `query { availableOrders(input: {page: 1}) { ok } }`, token);
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    }
  });

  it('E5 lets a driver open an offered order as a preview', async () => {
    const res = await gql(
      ctx.app,
      `query { getOrder(input: {id: ${paid}}) {
        ok code order {
          id status customer { email } checkoutUrl ledgerPaymentId driver { id }
          restaurant { name } items { id }
        }
      } }`,
      driverBToken,
    );
    const result = res.body.data.getOrder;
    expect(result.ok).toBe(true);
    expect(result.code).toBeNull();
    expect(result.order.status).toBe('Cooked');
    expect(result.order.customer).toBeNull();
    expect(result.order.checkoutUrl).toBeNull();
    expect(result.order.ledgerPaymentId).toBeNull();
    expect(result.order.driver).toBeNull();
    expect(result.order.restaurant.name).toBe('Offers Kitchen');
    expect(result.order.items).toHaveLength(1);
  });

  it('E6 refuses a driver access to orders that are not offered', async () => {
    for (const id of [awaiting, failed, cooking, claimed]) {
      const res = await gql(
        ctx.app,
        `query { getOrder(input: {id: ${id}}) { ok code error } }`,
        driverBToken,
      );
      expect(res.body.data.getOrder).toEqual({
        ok: false,
        code: 'FORBIDDEN',
        error: "You can't see that.",
      });
    }
  });

  it('E7 still shows the customer to the assigned driver', async () => {
    const res = await gql(
      ctx.app,
      `query { getOrder(input: {id: ${claimed}}) {
        ok order { customer { email } driver { email } }
      } }`,
      driverAToken,
    );
    const result = res.body.data.getOrder;
    expect(result.ok).toBe(true);
    expect(result.order.customer.email).toBe('client@offers.test');
    expect(result.order.driver.email).toBe('driver-a@offers.test');
  });

  it('E8 keeps the timeline private before a claim', async () => {
    const res = await gql(
      ctx.app,
      `query { orderTimeline(input: {orderId: ${free}}) { ok code } }`,
      driverBToken,
    );
    expect(res.body.data.orderTimeline).toEqual({ok: false, code: 'FORBIDDEN'});
  });

  async function expectUnpaidClaimRefused(id: number): Promise<void> {
    const res = await gql(
      ctx.app,
      `mutation { takeOrder(input: {id: ${id}}) { ok error code } }`,
      driverBToken,
    );
    expect(res.body.data.takeOrder).toEqual({
      ok: false,
      code: 'CONFLICT',
      error: 'Order is not paid yet',
    });
    const [order] = await ctx.dataSource.query('SELECT "driverId" FROM "order" WHERE id = $1', [
      id,
    ]);
    expect(order.driverId).toBeNull();
    const [{count}] = await ctx.dataSource.query(
      'SELECT count(*)::int AS count FROM order_event WHERE "orderId" = $1 AND kind = $2',
      [id, OrderEventKind.DRIVER_ASSIGNED],
    );
    expect(count).toBe(0);
  }

  it('E9 refuses to claim an unpaid order without assigning a driver or recording an event', async () => {
    await expectUnpaidClaimRefused(awaiting);
  });

  it('E10 refuses to claim an order whose payment failed', async () => {
    await expectUnpaidClaimRefused(failed);
  });

  it('E11 still explains a claim with the wrong status', async () => {
    const res = await gql(
      ctx.app,
      `mutation { takeOrder(input: {id: ${cooking}}) { ok error code } }`,
      driverBToken,
    );
    expect(res.body.data.takeOrder).toEqual({
      ok: false,
      code: 'CONFLICT',
      error: 'Order is Cooking, not Cooked',
    });
  });

  it('E12 claims a paid order and removes its offer and preview for another driver', async () => {
    const claim = await gql(
      ctx.app,
      `mutation { takeOrder(input: {id: ${paid}}) { ok } }`,
      driverBToken,
    );
    expect(claim.body.data.takeOrder.ok).toBe(true);

    const list = await availableOrders(driverAToken);
    const ids = list.body.data.availableOrders.orders.map((order: {id: number}) => order.id);
    expect(ids).not.toContain(paid);

    const preview = await gql(
      ctx.app,
      `query { getOrder(input: {id: ${paid}}) { ok code } }`,
      driverAToken,
    );
    expect(preview.body.data.getOrder).toEqual({ok: false, code: 'FORBIDDEN'});
  });

  it('E13 returns customer and driver relations in order lists', async () => {
    const driver = await gql(
      ctx.app,
      `query { getOrders(input: {page: 1}) {
        orders { id customer { email } driver { email } }
      } }`,
      driverAToken,
    );
    const order = driver.body.data.getOrders.orders.find(
      (entry: {id: number}) => entry.id === claimed,
    );
    expect(order.customer.email).toBe('client@offers.test');
    expect(order.driver.email).toBe('driver-a@offers.test');

    const owner = await gql(
      ctx.app,
      `query { getOrders(input: {status: Cooked}) { orders { id customer { email } } } }`,
      ownerToken,
    );
    expect(owner.body.data.getOrders.orders.length).toBeGreaterThan(0);
    owner.body.data.getOrders.orders.forEach((entry: {customer: {email: string}}) => {
      expect(entry.customer.email).toBe('client@offers.test');
    });
  });

  it('E14 pushes only offered orders and hides the customer', async () => {
    let markConnected: () => void;
    const connected = new Promise<void>(resolve => {
      markConnected = resolve;
    });
    const client = createClient({
      url: `ws://localhost:${portOf(ctx.app)}/graphql`,
      webSocketImpl: WebSocket,
      connectionParams: {Authorization: driverAToken},
      retryAttempts: 0,
      on: {connected: () => markConnected()},
    });
    let timer: ReturnType<typeof setTimeout>;
    const received = new Promise<{
      id: number;
      paymentStatus: string;
      customer: {id: number} | null;
    }>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('no cookedOrders event within 10000ms')), 10000);
      client.subscribe(
        {query: 'subscription { cookedOrders { id paymentStatus customer { id } } }'},
        {
          next: (msg: {
            data?: {
              cookedOrders?: {id: number; paymentStatus: string; customer: {id: number} | null};
            };
          }) => {
            if (msg.data?.cookedOrders) {
              clearTimeout(timer);
              resolve(msg.data.cookedOrders);
            }
          },
          error: err => {
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(JSON.stringify(err)));
          },
          complete: () => undefined,
        },
      );
    });

    try {
      await connected;
      // Allow the connected socket's subscription to register before cooking.
      await new Promise(resolve => setTimeout(resolve, 500));
      await placeOrder('AwaitingPayment', 'Cooked');
      const offeredId = await placeOrder('NotRequired', 'Cooked');
      const event = await received;
      expect(event.id).toBe(offeredId);
      expect(event.customer).toBeNull();
    } finally {
      clearTimeout(timer);
      await client.dispose();
    }
  });
});
