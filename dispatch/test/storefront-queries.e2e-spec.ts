import {readFileSync} from 'node:fs';
import * as path from 'node:path';
import * as request from 'supertest';
import {TestContext, createTestApp, destroyTestApp, gql, registerAndLogin} from './utils/e2e';

describe('storefront queries (e2e)', () => {
  let ctx: TestContext;
  let owner: string;
  let client: string;
  let driver: string;
  let restaurantId: number;
  const orderIds: number[] = [];
  const source = readFileSync(
    path.resolve(__dirname, '../frontend/src/lib/graphql/queries.ts'),
    'utf8',
  );
  const documents = new Map<string, string>();
  for (const match of source.matchAll(/export const (\w+) = gql`([\s\S]*?)`;/g)) {
    documents.set(match[1], match[2]);
  }

  const send = (name: string, token?: string, variables = {}) => {
    const query = documents.get(name);
    expect(query).toBeDefined();
    const operation = request(ctx.app.getHttpServer()).post('/graphql');
    if (token) operation.set('Authorization', token);
    return operation.send({query, variables});
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerAndLogin(ctx.app, 'owner@queries.test', 'Owner');
    client = await registerAndLogin(ctx.app, 'client@queries.test', 'Client');
    driver = await registerAndLogin(ctx.app, 'driver@queries.test', 'Delivery');
    const restaurant = await gql(
      ctx.app,
      `mutation {
      createRestaurant(input: {name: "Queries Kitchen", coverImage: "x", address: "1 Query Street", categoryName: "Pizza"}) {
        ok restaurantId
      }
    }`,
      owner,
    );
    expect(restaurant.body.data.createRestaurant.ok).toBe(true);
    restaurantId = restaurant.body.data.createRestaurant.restaurantId;
    const dish = await gql(
      ctx.app,
      `mutation {
      createDish(input: {restaurantId: ${restaurantId}, name: "Query Pizza", priceCents: 1200, description: "Classic"}) {ok}
    }`,
      owner,
    );
    expect(dish.body.data.createDish.ok).toBe(true);
    const menu = await gql(
      ctx.app,
      `query {
      restaurant(input: {restaurantId: ${restaurantId}}) {restaurant {menu {id}}}
    }`,
    );
    const dishId = menu.body.data.restaurant.restaurant.menu[0].id;
    for (let i = 0; i < 2; i++) {
      const created = await gql(
        ctx.app,
        `mutation {
        createOrder(input: {restaurantId: ${restaurantId}, items: [{dishId: ${dishId}}]}) {ok orderId}
      }`,
        client,
      );
      expect(created.body.data.createOrder.ok).toBe(true);
      const id = created.body.data.createOrder.orderId;
      orderIds.push(id);
      for (const status of ['Cooking', 'Cooked']) {
        const cooked = await gql(
          ctx.app,
          `mutation {editOrder(input: {id: ${id}, status: ${status}}) {ok}}`,
          owner,
        );
        expect(cooked.body.data.editOrder.ok).toBe(true);
      }
    }
    const claimed = await gql(
      ctx.app,
      `mutation {takeOrder(input: {id: ${orderIds[0]}}) {ok}}`,
      driver,
    );
    expect(claimed.body.data.takeOrder.ok).toBe(true);
  });

  afterAll(async () => {
    await destroyTestApp(ctx);
  });

  it('the list is complete', () => {
    expect([...documents.keys()].sort()).toEqual(
      [
        'ALL_CATEGORIES_QUERY',
        'ALL_RESTAURANTS_QUERY',
        'AVAILABLE_ORDERS_QUERY',
        'GET_ORDERS_QUERY',
        'GET_ORDER_QUERY',
        'GET_PAYMENTS_QUERY',
        'ME_QUERY',
        'MY_RESTAURANTS_QUERY',
        'MY_RESTAURANT_QUERY',
        'RESTAURANT_QUERY',
        'SEARCH_RESTAURANT_QUERY',
        'USER_PROFILE_QUERY',
      ].sort(),
    );
  });

  it('every query runs for its role', async () => {
    const rows: [string, string | undefined, object, string][] = [
      ['ME_QUERY', client, {}, 'me'],
      ['USER_PROFILE_QUERY', client, {email: 'client@queries.test'}, 'userProfile'],
      ['ALL_RESTAURANTS_QUERY', undefined, {input: {page: 1}}, 'restaurants'],
      ['RESTAURANT_QUERY', undefined, {input: {restaurantId}}, 'restaurant'],
      ['ALL_CATEGORIES_QUERY', undefined, {}, 'allCategories'],
      [
        'SEARCH_RESTAURANT_QUERY',
        undefined,
        {input: {query: 'Queries', page: 1}},
        'searchRestaurant',
      ],
      ['MY_RESTAURANTS_QUERY', owner, {}, 'myRestaurants'],
      ['MY_RESTAURANT_QUERY', owner, {input: {id: restaurantId}}, 'myRestaurant'],
      ...[client, owner, driver].map(
        token =>
          ['GET_ORDERS_QUERY', token, {input: {page: 1}}, 'getOrders'] as [
            string,
            string,
            object,
            string,
          ],
      ),
      ['GET_ORDER_QUERY', client, {input: {id: orderIds[0]}}, 'getOrder'],
      ['GET_ORDER_QUERY', driver, {input: {id: orderIds[1]}}, 'getOrder'],
      ['AVAILABLE_ORDERS_QUERY', driver, {input: {page: 1}}, 'availableOrders'],
      ['GET_PAYMENTS_QUERY', owner, {}, 'getPayments'],
    ];
    for (const [name, token, variables, root] of rows) {
      const res = await send(name, token, variables);
      expect(res.body.errors).toBeUndefined();
      const value = res.body.data[root];
      expect(value).not.toBeNull();
      if ('ok' in value) expect(value.ok).toBe(true);
    }
  });

  it('owner restaurants come with their menu', async () => {
    const res = await send('MY_RESTAURANTS_QUERY', owner);
    expect(res.body.errors).toBeUndefined();
    const restaurants = res.body.data.myRestaurants.restaurants;
    expect(restaurants).toHaveLength(1);
    expect(restaurants[0].menu).toHaveLength(1);
    expect(restaurants[0].menu[0].priceCents).toBe(1200);
  });
});
