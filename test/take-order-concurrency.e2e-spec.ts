import {INestApplication} from '@nestjs/common';

import {TestContext, createTestApp, destroyTestApp, gql, registerAndLogin} from './utils/e2e';

const DRIVER_COUNT = 20;
const ROUNDS = 5;

/**
 * B2 — the check-then-write race in takeOrder.
 *
 * takeOrder reads the order, checks `order.driver`, then writes:
 *
 *     const order = await this.orders.findOne({where: {id}});   // 1. read
 *     if (order.driver) { return {ok: false, ...}; }            // 2. check
 *     await this.orders.save([{id, driver}]);                   // 3. write
 *
 * Nothing holds between 1 and 3. Concurrent callers all read driver = null, all
 * pass the check, and all write — the last one silently overwriting the rest.
 * Every one of them is told `ok: true`, while only one actually owns the order.
 * The others drive to collect an order assigned to somebody else.
 *
 * The sequential case in order-lifecycle.e2e-spec.ts passes against the broken
 * code, because sequentially the check does work. That is precisely why this
 * file exists: the bug is only visible under concurrency, and an assertion that
 * cannot distinguish correct from broken code is not evidence of anything.
 *
 * This test was committed while it still failed. Run it against the commit
 * before B2 to watch it do so.
 */
describe('takeOrder under concurrency (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;

  let clientToken: string;
  let ownerToken: string;
  let driverTokens: string[];
  let restaurantId: number;
  let dishId: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;

    clientToken = await registerAndLogin(app, 'client@race.test', 'Client');
    ownerToken = await registerAndLogin(app, 'owner@race.test', 'Owner');

    driverTokens = [];
    for (let i = 0; i < DRIVER_COUNT; i++) {
      driverTokens.push(await registerAndLogin(app, `driver${i}@race.test`, 'Delivery'));
    }

    const restaurant = await gql(
      app,
      `mutation {
        createRestaurant(input: {
          name: "Race Kitchen", coverImage: "x", address: "y", categoryName: "Pizza"
        }) { restaurantId }
      }`,
      ownerToken,
    );
    restaurantId = restaurant.body.data.createRestaurant.restaurantId;

    await gql(
      app,
      `mutation {
        createDish(input: {
          restaurantId: ${restaurantId}, name: "Margherita", priceCents: 1200, description: "Classic"
        }) { ok }
      }`,
      ownerToken,
    );

    const menu = await gql(
      app,
      `query { restaurant(input: {restaurantId: ${restaurantId}}) {
        restaurant { menu { id } }
      } }`,
    );
    dishId = menu.body.data.restaurant.restaurant.menu[0].id;
  });

  afterAll(async () => {
    await destroyTestApp(ctx);
  });

  /** Places an order and drives it to Cooked, the state a driver may claim. */
  async function createCookedOrder(): Promise<number> {
    const created = await gql(
      app,
      `mutation {
        createOrder(input: {restaurantId: ${restaurantId}, items: [{dishId: ${dishId}}]}) {
          orderId
        }
      }`,
      clientToken,
    );
    const orderId = created.body.data.createOrder.orderId;

    await gql(
      app,
      `mutation { editOrder(input: {id: ${orderId}, status: Cooking}) { ok } }`,
      ownerToken,
    );
    await gql(
      app,
      `mutation { editOrder(input: {id: ${orderId}, status: Cooked}) { ok } }`,
      ownerToken,
    );

    return orderId;
  }

  interface RoundResult {
    orderId: number;
    winners: number[];
    loserCodes: string[];
    storedDriver: string | null;
  }

  /** One order, all drivers claiming it at once. */
  async function raceForOneOrder(): Promise<RoundResult> {
    const orderId = await createCookedOrder();

    const responses = await Promise.all(
      driverTokens.map(async (token, i) => ({
        i,
        body: (
          await gql(app, `mutation { takeOrder(input: {id: ${orderId}}) { ok error code } }`, token)
        ).body.data.takeOrder,
      })),
    );

    const stored = await gql(
      app,
      `query { getOrder(input: {id: ${orderId}}) { order { driver { email } } } }`,
      clientToken,
    );

    return {
      orderId,
      winners: responses.filter(r => r.body.ok).map(r => r.i),
      loserCodes: responses.filter(r => !r.body.ok).map(r => r.body.code),
      storedDriver: stored.body.data.getOrder.order.driver?.email ?? null,
    };
  }

  /**
   * Several independent rounds rather than one.
   *
   * A single round is not a reliable reproduction: TypeORM's connection pool
   * defaults to 10, so with twenty callers the reads do not always all land
   * before the first write commits, and the broken code occasionally produces
   * the correct answer by luck. Over several rounds it does not.
   *
   * A flaky reproduction is worse than none — it cannot distinguish "fixed"
   * from "got lucky".
   */
  it(`gives exactly one winner per order across ${ROUNDS} rounds of ${DRIVER_COUNT} concurrent claims`, async () => {
    const rounds: RoundResult[] = [];
    for (let r = 0; r < ROUNDS; r++) {
      rounds.push(await raceForOneOrder());
    }

    const multiWinner = rounds.filter(r => r.winners.length !== 1);
    expect(multiWinner.map(r => ({order: r.orderId, winners: r.winners.length}))).toEqual([]);

    rounds.forEach(round => {
      // Losing a race is a CONFLICT, not a FORBIDDEN: the caller was eligible
      // and should refresh, not be told they lack permission.
      expect(round.loserCodes).toEqual(Array(DRIVER_COUNT - 1).fill('CONFLICT'));
    });
  });

  it('records the same driver in the database that it reported to the caller', async () => {
    const round = await raceForOneOrder();

    // The API answer is only half of it. Even with a single reported winner,
    // concurrent writers can still overwrite each other — the stored row is
    // what the driver actually acts on.
    expect(round.winners).toHaveLength(1);
    expect(round.storedDriver).toBe(`driver${round.winners[0]}@race.test`);
  });
});
