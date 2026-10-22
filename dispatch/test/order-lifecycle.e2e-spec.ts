import {INestApplication} from '@nestjs/common';

import {
  TestContext,
  captureQueries,
  createTestApp,
  destroyTestApp,
  gql,
  registerAndLogin,
} from './utils/e2e';

/**
 * End-to-end coverage of the order lifecycle across all three roles.
 *
 * These are CHARACTERIZATION tests: they record what the system does initially,
 * not what it should do. Where current behaviour is wrong the
 * assertion still encodes it, annotated with the audit ID that will change it.
 * A fix for B13 or C1 is therefore required to flip a named assertion here
 * rather than being able to land unnoticed.
 *
 * The primary job of this file is to be the safety net for A4: TypeORM 0.3's
 * where-clause change fails by matching zero rows rather than by throwing, so
 * only an executed query proves a call site was ported correctly.
 */
describe('Order lifecycle (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;

  let clientToken: string;
  let ownerToken: string;
  let driverToken: string;

  let restaurantId: number;
  let dishId: number;
  let orderId: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;

    clientToken = await registerAndLogin(app, 'client@lifecycle.test', 'Client');
    ownerToken = await registerAndLogin(app, 'owner@lifecycle.test', 'Owner');
    driverToken = await registerAndLogin(app, 'driver@lifecycle.test', 'Delivery');
  });

  afterAll(async () => {
    await destroyTestApp(ctx);
  });

  describe('setup: restaurant and menu', () => {
    it('owner creates a restaurant, creating the category on the way', async () => {
      const res = await gql(
        app,
        `mutation {
          createRestaurant(input: {
            name: "Lifecycle Kitchen",
            coverImage: "http://example.com/cover.png",
            address: "1 Test Street",
            categoryName: "Pizza"
          }) { ok error restaurantId }
        }`,
        ownerToken,
      );

      expect(res.body.data.createRestaurant.ok).toBe(true);
      restaurantId = res.body.data.createRestaurant.restaurantId;
      expect(restaurantId).toBeGreaterThan(0);
    });

    it('rejects restaurant creation by a client', async () => {
      const res = await gql(
        app,
        `mutation {
          createRestaurant(input: {
            name: "Not Allowed", coverImage: "x", address: "y", categoryName: "Pizza"
          }) { ok error }
        }`,
        clientToken,
      );

      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('owner adds a dish', async () => {
      const res = await gql(
        app,
        `mutation {
          createDish(input: {
            restaurantId: ${restaurantId},
            name: "Margherita",
            priceCents: 1200,
            description: "Tomato, mozzarella, basil"
          }) { ok error }
        }`,
        ownerToken,
      );

      expect(res.body.data.createDish).toEqual({ok: true, error: null});

      const menu = await gql(
        app,
        `query { restaurant(input: {restaurantId: ${restaurantId}}) {
          ok restaurant { menu { id name priceCents } }
        } }`,
      );
      dishId = menu.body.data.restaurant.restaurant.menu[0].id;
      expect(dishId).toBeGreaterThan(0);
    });
  });

  describe('placing an order', () => {
    // Was B13: `options` is nullable on CreateOrderItemInput, but createOrder
    // iterated it without a guard, so the most ordinary order the system can
    // receive threw TypeError: item.options is not iterable.
    it('accepts an item that omits the optional options field', async () => {
      const res = await gql(
        app,
        `mutation {
          createOrder(input: {restaurantId: ${restaurantId}, items: [{dishId: ${dishId}}]}) {
            ok error orderId
          }
        }`,
        clientToken,
      );

      expect(res.body.data.createOrder.ok).toBe(true);
      expect(res.body.data.createOrder.error).toBeNull();
      expect(res.body.data.createOrder.orderId).toBeGreaterThan(0);
    });

    it('succeeds when options is passed explicitly', async () => {
      const res = await gql(
        app,
        `mutation {
          createOrder(input: {
            restaurantId: ${restaurantId},
            items: [{dishId: ${dishId}, options: []}]
          }) { ok error orderId }
        }`,
        clientToken,
      );

      expect(res.body.data.createOrder.ok).toBe(true);
      orderId = res.body.data.createOrder.orderId;
    });

    it('computes the total in cents from the dish price', async () => {
      const res = await gql(
        app,
        `query { getOrder(input: {id: ${orderId}}) {
          ok order { id status totalCents customer { email } restaurant { name } }
        } }`,
        clientToken,
      );

      const order = res.body.data.getOrder.order;
      expect(order.status).toBe('Pending');
      // Cents, not dollars: the baseline could not represent $12.50 at all (B12).
      expect(order.totalCents).toBe(1200);
      expect(order.customer.email).toBe('client@lifecycle.test');
      expect(order.restaurant.name).toBe('Lifecycle Kitchen');
    });

    // Was B14: Order.items is eager, but eager loading does not cascade to the
    // item's own dish, so an order could not say what was ordered.
    it('returns the dish on each order item', async () => {
      const res = await gql(
        app,
        `query { getOrder(input: {id: ${orderId}}) {
          order { items { id dish { id name priceCents } } }
        } }`,
        clientToken,
      );

      const items = res.body.data.getOrder.order.items;
      expect(items).toHaveLength(1);
      expect(items[0].dish).toEqual({id: dishId, name: 'Margherita', priceCents: 1200});
    });

    // B8: the association was @ManyToMany with a join table, which states that
    // a line item may belong to several orders. It belongs to exactly one.
    it('scopes each line item to exactly one order', async () => {
      const second = await gql(
        app,
        `mutation {
          createOrder(input: {restaurantId: ${restaurantId}, items: [{dishId: ${dishId}}]}) {
            orderId
          }
        }`,
        clientToken,
      );
      const secondId = second.body.data.createOrder.orderId;

      const [first, other] = await Promise.all([
        gql(
          app,
          `query { getOrder(input: {id: ${orderId}}) { order { items { id } } } }`,
          clientToken,
        ),
        gql(
          app,
          `query { getOrder(input: {id: ${secondId}}) { order { items { id } } } }`,
          clientToken,
        ),
      ]);

      const firstItems: number[] = first.body.data.getOrder.order.items.map(
        (i: {id: number}) => i.id,
      );
      const otherItems: number[] = other.body.data.getOrder.order.items.map(
        (i: {id: number}) => i.id,
      );

      expect(firstItems.length).toBeGreaterThan(0);
      expect(otherItems.length).toBeGreaterThan(0);
      expect(firstItems.filter(id => otherItems.includes(id))).toEqual([]);
    });

    it('does not let an unrelated client read the order', async () => {
      const strangerToken = await registerAndLogin(app, 'stranger@lifecycle.test', 'Client');
      const res = await gql(
        app,
        `query { getOrder(input: {id: ${orderId}}) { ok error code } }`,
        strangerToken,
      );

      expect(res.body.data.getOrder.ok).toBe(false);
      expect(res.body.data.getOrder.error).toBe("You can't see that.");
      expect(res.body.data.getOrder.code).toBe('FORBIDDEN');
    });
  });

  // C3: createOrder looked each dish up individually inside the loop, so an
  // order of N line items issued N round trips before it wrote anything.
  describe('dish lookups are batched', () => {
    it('issues one dish query regardless of how many line items there are', async () => {
      // Five distinct dishes so a per-item lookup would be unmistakable.
      const dishIds: number[] = [];
      for (let i = 0; i < 5; i++) {
        await gql(
          app,
          `mutation {
            createDish(input: {
              restaurantId: ${restaurantId}, name: "Batched ${i}", priceCents: ${1000 + i * 100},
              description: "For the batching test"
            }) { ok }
          }`,
          ownerToken,
        );
      }
      const menu = await gql(
        app,
        `query { restaurant(input: {restaurantId: ${restaurantId}}) {
          restaurant { menu { id name } }
        } }`,
      );
      menu.body.data.restaurant.restaurant.menu
        .filter((d: {name: string}) => d.name.startsWith('Batched '))
        .forEach((d: {id: number}) => dishIds.push(d.id));
      expect(dishIds).toHaveLength(5);

      const itemsArg = dishIds.map(id => `{dishId: ${id}}`).join(', ');
      const queries = await captureQueries(ctx.dataSource, async () => {
        const res = await gql(
          app,
          `mutation {
            createOrder(input: {restaurantId: ${restaurantId}, items: [${itemsArg}]}) {
              ok error orderId
            }
          }`,
          clientToken,
        );
        expect(res.body.data.createOrder.ok).toBe(true);
      });

      const dishSelects = queries.filter(q => /SELECT/i.test(q) && /"dish"/.test(q));
      expect(dishSelects).toHaveLength(1);
      // And it is a set lookup, not five statements that happen to be batched.
      expect(dishSelects[0]).toMatch(/IN \(/i);
    });

    it('names every missing dish, not just the first one reached', async () => {
      const res = await gql(
        app,
        `mutation {
          createOrder(input: {
            restaurantId: ${restaurantId},
            items: [{dishId: ${dishId}}, {dishId: 999998}, {dishId: 999999}]
          }) { ok error code }
        }`,
        clientToken,
      );

      expect(res.body.data.createOrder.code).toBe('NOT_FOUND');
      expect(res.body.data.createOrder.error).toBe('Dishes 999998, 999999 not found');
    });
  });

  // B4: order items were saved one at a time inside a loop, and the order row
  // only afterwards. A dish missing partway through returned early, leaving the
  // already-saved items committed with no order referencing them — unreachable,
  // and never cleaned up.
  describe('order creation is atomic', () => {
    const countOrderItems = async (): Promise<number> => {
      const [{n}] = await ctx.dataSource.query('SELECT count(*)::int AS n FROM order_item');
      return n;
    };

    it('leaves no orphaned order items when a later dish does not exist', async () => {
      const before = await countOrderItems();

      const res = await gql(
        app,
        `mutation {
          createOrder(input: {
            restaurantId: ${restaurantId},
            items: [{dishId: ${dishId}}, {dishId: 999999}]
          }) { ok error code orderId }
        }`,
        clientToken,
      );

      expect(res.body.data.createOrder.ok).toBe(false);
      expect(res.body.data.createOrder.code).toBe('NOT_FOUND');

      // The first item is the one at risk: it is valid, so it gets written
      // before the second is found to be missing.
      expect(await countOrderItems()).toBe(before);
    });

    it('leaves no order behind either', async () => {
      const [{n: before}] = await ctx.dataSource.query('SELECT count(*)::int AS n FROM "order"');

      await gql(
        app,
        `mutation {
          createOrder(input: {
            restaurantId: ${restaurantId},
            items: [{dishId: ${dishId}}, {dishId: 999999}]
          }) { ok }
        }`,
        clientToken,
      );

      const [{n: after}] = await ctx.dataSource.query('SELECT count(*)::int AS n FROM "order"');
      expect(after).toBe(before);
    });
  });

  // C9: the baseline returned {ok: false, error: '<sentence>'} for everything,
  // so a client could not tell "does not exist" from "not yours" from "someone
  // else got there first" — only the last of which is worth retrying.
  describe('failure classification', () => {
    it('distinguishes a missing order from a forbidden one', async () => {
      const missing = await gql(
        app,
        `query { getOrder(input: {id: 999999}) { ok error code } }`,
        clientToken,
      );
      expect(missing.body.data.getOrder.code).toBe('NOT_FOUND');

      // Not the owner: they legitimately own the restaurant this order was
      // placed at, so canSeeOrder admits them. An unrelated client is the case.
      const outsider = await registerAndLogin(app, 'outsider@lifecycle.test', 'Client');
      const forbidden = await gql(
        app,
        `query { getOrder(input: {id: ${orderId}}) { ok error code } }`,
        outsider,
      );
      expect(forbidden.body.data.getOrder.ok).toBe(false);
      expect(forbidden.body.data.getOrder.code).toBe('FORBIDDEN');
    });

    it('reports a lost claim as CONFLICT, not FORBIDDEN', async () => {
      const order = await gql(
        app,
        `mutation {
          createOrder(input: {restaurantId: ${restaurantId}, items: [{dishId: ${dishId}}]}) {
            orderId
          }
        }`,
        clientToken,
      );
      const id = order.body.data.createOrder.orderId;

      // A claim is only legal once the order is Cooked — the status is part of
      // the conditional UPDATE's predicate.
      await gql(
        app,
        `mutation { editOrder(input: {id: ${id}, status: Cooking}) { ok } }`,
        ownerToken,
      );
      await gql(
        app,
        `mutation { editOrder(input: {id: ${id}, status: Cooked}) { ok } }`,
        ownerToken,
      );

      const first = await gql(
        app,
        `mutation { takeOrder(input: {id: ${id}}) { ok } }`,
        driverToken,
      );
      expect(first.body.data.takeOrder.ok).toBe(true);

      const loser = await registerAndLogin(app, 'loser@lifecycle.test', 'Delivery');
      const second = await gql(
        app,
        `mutation { takeOrder(input: {id: ${id}}) { ok error code } }`,
        loser,
      );

      // The caller was eligible and simply lost — the client should refresh and
      // retry, which is what CONFLICT says and FORBIDDEN would not.
      expect(second.body.data.takeOrder.code).toBe('CONFLICT');
    });

    it('succeeds with a null code', async () => {
      const res = await gql(
        app,
        `query { getOrder(input: {id: ${orderId}}) { ok error code } }`,
        clientToken,
      );
      expect(res.body.data.getOrder.ok).toBe(true);
      expect(res.body.data.getOrder.code).toBeNull();
    });
  });

  describe('status transitions', () => {
    const setStatus = (status: string, token: string) =>
      gql(
        app,
        `mutation { editOrder(input: {id: ${orderId}, status: ${status}}) { ok error } }`,
        token,
      );

    const readStatus = async () => {
      const res = await gql(
        app,
        `query { getOrder(input: {id: ${orderId}}) { order { status } } }`,
        clientToken,
      );
      return res.body.data.getOrder.order.status;
    };

    it('client cannot change status', async () => {
      const res = await setStatus('Cooked', clientToken);
      expect(res.body.data.editOrder.ok).toBe(false);
    });

    it('driver cannot mark an order as cooking', async () => {
      const res = await setStatus('Cooking', driverToken);
      expect(res.body.data.editOrder.ok).toBe(false);
    });

    // Was B10: the enum member was spelled `Coocking`, and since it is
    // registered with registerEnumType that misspelling was the value every
    // GraphQL client had to send.
    it('owner moves the order to Cooking', async () => {
      const res = await setStatus('Cooking', ownerToken);
      expect(res.body.data.editOrder.ok).toBe(true);
      expect(await readStatus()).toBe('Cooking');
    });

    it('owner marks it cooked', async () => {
      const res = await setStatus('Cooked', ownerToken);
      expect(res.body.data.editOrder.ok).toBe(true);
      expect(await readStatus()).toBe('Cooked');
    });
  });

  describe('driver claim and delivery', () => {
    it('driver claims the order', async () => {
      const res = await gql(
        app,
        `mutation { takeOrder(input: {id: ${orderId}}) { ok error } }`,
        driverToken,
      );
      expect(res.body.data.takeOrder).toEqual({ok: true, error: null});
    });

    it('a second driver cannot claim the same order', async () => {
      const otherDriver = await registerAndLogin(app, 'driver2@lifecycle.test', 'Delivery');
      const res = await gql(
        app,
        `mutation { takeOrder(input: {id: ${orderId}}) { ok error } }`,
        otherDriver,
      );

      // Correct under sequential calls. B2 is that this check is not atomic:
      // two concurrent claims both pass it. E2 will demonstrate that.
      expect(res.body.data.takeOrder.ok).toBe(false);
      expect(res.body.data.takeOrder.error).toBe('This order already has a driver');
    });

    it('the assigned driver delivers the order', async () => {
      const pickedUp = await gql(
        app,
        `mutation { editOrder(input: {id: ${orderId}, status: PickedUp}) { ok error } }`,
        driverToken,
      );
      expect(pickedUp.body.data.editOrder.ok).toBe(true);

      const delivered = await gql(
        app,
        `mutation { editOrder(input: {id: ${orderId}, status: Delivered}) { ok error } }`,
        driverToken,
      );
      expect(delivered.body.data.editOrder.ok).toBe(true);

      const res = await gql(
        app,
        `query { getOrder(input: {id: ${orderId}}) { order { status driver { email } } } }`,
        clientToken,
      );
      expect(res.body.data.getOrder.order.status).toBe('Delivered');
      expect(res.body.data.getOrder.order.driver.email).toBe('driver@lifecycle.test');
    });
  });

  describe('lifecycle enforcement', () => {
    let freshOrderId: number;

    beforeAll(async () => {
      const res = await gql(
        app,
        `mutation {
          createOrder(input: {
            restaurantId: ${restaurantId},
            items: [{dishId: ${dishId}, options: []}]
          }) { orderId }
        }`,
        clientToken,
      );
      freshOrderId = res.body.data.createOrder.orderId;
    });

    // Was C1: editOrder checked only the TARGET status against the caller's
    // role and never the current status, so the lifecycle could be skipped.
    it('refuses to jump a Pending order straight to Cooked', async () => {
      const res = await gql(
        app,
        `mutation { editOrder(input: {id: ${freshOrderId}, status: Cooked}) { ok error code } }`,
        ownerToken,
      );
      expect(res.body.data.editOrder.ok).toBe(false);
      expect(res.body.data.editOrder.code).toBe('CONFLICT');
      expect(res.body.data.editOrder.error).toBe('An order cannot go from Pending to Cooked');

      const read = await gql(
        app,
        `query { getOrder(input: {id: ${freshOrderId}}) { order { status } } }`,
        clientToken,
      );
      expect(read.body.data.getOrder.order.status).toBe('Pending');
    });

    // C2: the property the outbox and webhook work (D2/D3) is built on. A
    // provider redelivering a status callback is expected, not exceptional.
    it('treats re-submitting the current status as a successful no-op', async () => {
      await gql(
        app,
        `mutation { editOrder(input: {id: ${freshOrderId}, status: Cooking}) { ok } }`,
        ownerToken,
      );

      const repeats = await Promise.all([
        gql(
          app,
          `mutation { editOrder(input: {id: ${freshOrderId}, status: Cooking}) { ok error code } }`,
          ownerToken,
        ),
        gql(
          app,
          `mutation { editOrder(input: {id: ${freshOrderId}, status: Cooking}) { ok error code } }`,
          ownerToken,
        ),
        gql(
          app,
          `mutation { editOrder(input: {id: ${freshOrderId}, status: Cooking}) { ok error code } }`,
          ownerToken,
        ),
      ]);

      repeats.forEach(r => {
        expect(r.body.data.editOrder.ok).toBe(true);
        expect(r.body.data.editOrder.error).toBeNull();
      });

      const read = await gql(
        app,
        `query { getOrder(input: {id: ${freshOrderId}}) { order { status } } }`,
        clientToken,
      );
      expect(read.body.data.getOrder.order.status).toBe('Cooking');
    });

    it('refuses to move an order backwards', async () => {
      const res = await gql(
        app,
        `mutation { editOrder(input: {id: ${freshOrderId}, status: Pending}) { ok error code } }`,
        ownerToken,
      );
      expect(res.body.data.editOrder.code).toBe('CONFLICT');
    });

    it('will not let a driver who is not assigned pick the order up', async () => {
      const cooked = await gql(
        app,
        `mutation { editOrder(input: {id: ${freshOrderId}, status: Cooked}) { ok } }`,
        ownerToken,
      );
      expect(cooked.body.data.editOrder.ok).toBe(true);

      const unassigned = await registerAndLogin(app, 'unassigned@lifecycle.test', 'Delivery');
      const res = await gql(
        app,
        `mutation { editOrder(input: {id: ${freshOrderId}, status: PickedUp}) { ok error code } }`,
        unassigned,
      );

      // Not merely "a driver" — the driver on this order. The baseline checked
      // the role only.
      expect(res.body.data.editOrder.ok).toBe(false);
      expect(res.body.data.editOrder.code).toBe('FORBIDDEN');
    });

    // Was B3: takeOrder inspected order.driver but never order.status, so an
    // order nobody had cooked yet could be claimed for delivery. The status is
    // now part of the conditional UPDATE's predicate.
    it('refuses to claim an order that is not cooked yet', async () => {
      const pending = await gql(
        app,
        `mutation {
          createOrder(input: {
            restaurantId: ${restaurantId},
            items: [{dishId: ${dishId}, options: []}]
          }) { orderId }
        }`,
        clientToken,
      );
      const pendingOrderId = pending.body.data.createOrder.orderId;

      const claimed = await gql(
        app,
        `mutation { takeOrder(input: {id: ${pendingOrderId}}) { ok error code } }`,
        driverToken,
      );
      expect(claimed.body.data.takeOrder.ok).toBe(false);
      expect(claimed.body.data.takeOrder.code).toBe('CONFLICT');
      expect(claimed.body.data.takeOrder.error).toBe('Order is Pending, not Cooked');
    });
  });

  describe('listing orders', () => {
    // Was B1: getOrders carried no @Role decorator. The guard returns true when
    // no role metadata is present, without populating the user, so the query was
    // reachable anonymously AND `user.role` threw for everyone.
    it('rejects getOrders without a token', async () => {
      const res = await gql(app, `query { getOrders(input: {}) { ok error } }`);
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('returns the client their own orders', async () => {
      const res = await gql(
        app,
        `query { getOrders(input: {}) { ok error orders { id } } }`,
        clientToken,
      );
      expect(res.body.data.getOrders.ok).toBe(true);
      expect(res.body.data.getOrders.error).toBeNull();
      expect(res.body.data.getOrders.orders.length).toBeGreaterThan(0);
    });

    it('returns the driver only the orders they claimed', async () => {
      const res = await gql(
        app,
        `query { getOrders(input: {}) { ok orders { id } } }`,
        driverToken,
      );
      expect(res.body.data.getOrders.ok).toBe(true);
      expect(res.body.data.getOrders.orders.length).toBeGreaterThan(0);
    });

    it('returns the owner the orders placed at their restaurant', async () => {
      const res = await gql(app, `query { getOrders(input: {}) { ok orders { id } } }`, ownerToken);
      expect(res.body.data.getOrders.ok).toBe(true);
      expect(res.body.data.getOrders.orders.length).toBeGreaterThan(0);
    });

    it('filters by status', async () => {
      const res = await gql(
        app,
        `query { getOrders(input: {status: Delivered}) { ok orders { id status } } }`,
        clientToken,
      );
      expect(res.body.data.getOrders.ok).toBe(true);
      res.body.data.getOrders.orders.forEach((o: {status: string}) =>
        expect(o.status).toBe('Delivered'),
      );
    });
  });
});
