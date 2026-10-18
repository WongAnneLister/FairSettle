import {createClient} from 'graphql-ws';
import * as WebSocket from 'ws';

import {
  TestContext,
  createTestApp,
  destroyTestApp,
  gql,
  portOf,
  registerAndLogin,
} from './utils/e2e';

/**
 * C6 — GraphQL subscriptions must survive more than one replica.
 *
 * `graphql-subscriptions`' PubSub is a process-local EventEmitter. With a single
 * instance everything works, so this never shows up in development. With two:
 *
 *   - a driver's WebSocket is held by replica A
 *   - the restaurant's editOrder lands on replica B
 *   - publish() fires into B's memory, and the driver on A hears nothing
 *
 * The order is marked ready and nobody is dispatched. No error is raised
 * anywhere; the event simply does not exist outside the process that published
 * it.
 *
 * This spec runs two full application instances against one database — the
 * smallest arrangement that can tell a process-local bus from a shared one.
 * Against an in-memory PubSub it times out waiting for the event. Against Redis
 * it receives it.
 */
describe('subscriptions across replicas (e2e)', () => {
  let replicaA: TestContext;
  let replicaB: TestContext;

  let ownerToken: string;
  let clientToken: string;
  let driverToken: string;
  let restaurantId: number;
  let dishId: number;

  beforeAll(async () => {
    replicaA = await createTestApp();
    replicaB = await createTestApp();

    ownerToken = await registerAndLogin(replicaA.app, 'owner@replica.test', 'Owner');
    clientToken = await registerAndLogin(replicaA.app, 'client@replica.test', 'Client');
    driverToken = await registerAndLogin(replicaA.app, 'driver@replica.test', 'Delivery');

    const restaurant = await gql(
      replicaA.app,
      `mutation {
        createRestaurant(input: {
          name: "Replica Kitchen", coverImage: "x", address: "y", categoryName: "Pizza"
        }) { restaurantId }
      }`,
      ownerToken,
    );
    restaurantId = restaurant.body.data.createRestaurant.restaurantId;

    await gql(
      replicaA.app,
      `mutation {
        createDish(input: {
          restaurantId: ${restaurantId}, name: "Margherita", priceCents: 1200, description: "Classic"
        }) { ok }
      }`,
      ownerToken,
    );

    const menu = await gql(
      replicaA.app,
      `query { restaurant(input: {restaurantId: ${restaurantId}}) {
        restaurant { menu { id } }
      } }`,
    );
    dishId = menu.body.data.restaurant.restaurant.menu[0].id;
  });

  afterAll(async () => {
    await destroyTestApp(replicaB, {dropDatabase: false});
    await destroyTestApp(replicaA);
  });

  /** Subscribes to cookedOrders on one replica and resolves on the first event. */
  function awaitCookedOrderOn(ctx: TestContext, token: string, timeoutMs: number) {
    const client = createClient({
      url: `ws://localhost:${portOf(ctx.app)}/graphql`,
      webSocketImpl: WebSocket,
      connectionParams: {Authorization: token},
      retryAttempts: 0,
    });

    const received = new Promise<{id: number; status: string}>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no cookedOrders event within ${timeoutMs}ms`)),
        timeoutMs,
      );

      client.subscribe(
        {query: 'subscription { cookedOrders { id status } }'},
        {
          next: (msg: {data?: {cookedOrders?: {id: number; status: string}}}) => {
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

    return {received, close: () => client.dispose()};
  }

  async function placeAndCook(ctx: TestContext): Promise<number> {
    const created = await gql(
      ctx.app,
      `mutation {
        createOrder(input: {restaurantId: ${restaurantId}, items: [{dishId: ${dishId}}]}) {
          orderId
        }
      }`,
      clientToken,
    );
    const orderId = created.body.data.createOrder.orderId;

    await gql(
      ctx.app,
      `mutation { editOrder(input: {id: ${orderId}, status: Cooking}) { ok } }`,
      ownerToken,
    );
    await gql(
      ctx.app,
      `mutation { editOrder(input: {id: ${orderId}, status: Cooked}) { ok } }`,
      ownerToken,
    );

    return orderId;
  }

  it('delivers to a subscriber on the same replica that published', async () => {
    const subscription = awaitCookedOrderOn(replicaA, driverToken, 10000);
    // Give the socket a moment to finish its handshake and register.
    await new Promise(resolve => setTimeout(resolve, 500));

    const orderId = await placeAndCook(replicaA);

    try {
      const event = await subscription.received;
      expect(event.id).toBe(orderId);
      expect(event.status).toBe('Cooked');
    } finally {
      subscription.close();
    }
  });

  // The one that matters. Passing the test above proves nothing about a
  // deployment with more than one pod behind a load balancer.
  it('delivers to a subscriber on a DIFFERENT replica from the publisher', async () => {
    const subscription = awaitCookedOrderOn(replicaA, driverToken, 10000);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Published by replica B; the listener is attached to replica A.
    const orderId = await placeAndCook(replicaB);

    try {
      const event = await subscription.received;
      expect(event.id).toBe(orderId);
      expect(event.status).toBe('Cooked');
    } finally {
      subscription.close();
    }
  });
});
