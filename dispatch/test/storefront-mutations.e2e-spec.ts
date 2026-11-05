import {readFileSync} from 'node:fs';
import * as path from 'node:path';
import * as request from 'supertest';
import {GraphQLSchemaHost} from '@nestjs/graphql';
import {
  GraphQLObjectType,
  OperationDefinitionNode,
  getVariableValues,
  isNonNullType,
  parse,
  validate,
} from 'graphql';
import {DishForm, createDishInput} from '../frontend/src/lib/dish-form';
import {markFailedInput} from '../frontend/src/lib/order-actions';
import {DeliveryFailureReason} from '../frontend/src/lib/types';
import {TestContext, createTestApp, destroyTestApp, gql, registerAndLogin} from './utils/e2e';

const FORM_WITH_PHOTO: DishForm = {
  restaurantId: 1,
  name: ' Margherita Pizza ',
  priceDollars: '14.50',
  description: 'Tomato, mozzarella and basil',
  photo: ' https://example.com/margherita.jpg ',
  options: [{name: 'Size', choices: [{name: 'Large', extraDollars: '3.00'}]}],
};
const FORM_WITHOUT_PHOTO: DishForm = {
  ...FORM_WITH_PHOTO,
  name: 'Plain Focaccia',
  photo: '',
  options: [],
};

describe('storefront mutations (e2e)', () => {
  let ctx: TestContext;
  let owner: string;
  let restaurantId: number;
  let focacciaId: number;
  const source = readFileSync(
    path.resolve(__dirname, '../frontend/src/lib/graphql/mutations.ts'),
    'utf8',
  );
  const documents = new Map<string, string>();
  for (const match of source.matchAll(/export const (\w+) = gql`([\s\S]*?)`;/g)) {
    documents.set(match[1], match[2]);
  }

  function problems(document: string, variables: Record<string, unknown>): string[] {
    const schema = ctx.app.get(GraphQLSchemaHost).schema;
    const ast = parse(document);
    // These are graphql-js's validation and variable-coercion steps before
    // execution: nothing executes and no data changes.
    const messages = validate(schema, ast).map(error => error.message);
    const operation = ast.definitions.find(
      definition => definition.kind === 'OperationDefinition',
    ) as OperationDefinitionNode | undefined;
    if (operation) {
      const result = getVariableValues(schema, operation.variableDefinitions ?? [], variables);
      messages.push(...(result.errors ?? []).map(error => error.message));
    }
    return messages;
  }

  function dishInput(form: DishForm): Record<string, unknown> {
    const result = createDishInput(form);
    expect(result.ok).toBe(true);
    if (!('input' in result)) throw new Error(result.error);
    return {...result.input};
  }

  function send(name: string, token: string, variables: Record<string, unknown>): request.Test {
    const query = documents.get(name);
    expect(query).toBeDefined();
    return request(ctx.app.getHttpServer())
      .post('/graphql')
      .set('Authorization', token)
      .send({query, variables});
  }

  const rows: [string, () => Record<string, unknown>][] = [
    // lib/auth-context.tsx login
    ['LOGIN_MUTATION', () => ({input: {email: 'owner@mutations.test', password: '12345'}})],
    // lib/auth-context.tsx register
    [
      'CREATE_ACCOUNT_MUTATION',
      () => ({input: {email: 'new@mutations.test', password: '12345', role: 'Owner'}}),
    ],
    // app/profile/page.tsx
    ['EDIT_PROFILE_MUTATION', () => ({input: {email: 'renamed@mutations.test'}})],
    // app/profile/page.tsx
    ['EDIT_PROFILE_MUTATION', () => ({input: {password: '67890'}})],
    // app/owner/restaurants/page.tsx
    [
      'CREATE_RESTAURANT_MUTATION',
      () => ({
        input: {
          name: 'Mutations Kitchen',
          coverImage: 'https://example.com/cover.jpg',
          address: '1 Mutation Street',
          categoryName: 'Pizza',
        },
      }),
    ],
    // Unused; minimal valid input.
    ['EDIT_RESTAURANT_MUTATION', () => ({input: {restaurantId: 1, name: 'Renamed Kitchen'}})],
    // Unused; minimal valid input.
    ['DELETE_RESTAURANT_MUTATION', () => ({input: {restaurantId: 1}})],
    // menu/page.tsx through createDishInput
    ['CREATE_DISH_MUTATION', () => ({input: dishInput(FORM_WITH_PHOTO)})],
    // menu/page.tsx through createDishInput
    ['CREATE_DISH_MUTATION', () => ({input: dishInput(FORM_WITHOUT_PHOTO)})],
    // Unused; the photo edit.
    ['EDIT_DISH_MUTATION', () => ({input: {dishId: 1, photo: 'https://example.com/new.jpg'}})],
    // menu/page.tsx
    ['DELETE_DISH_MUTATION', () => ({input: {dishId: 1}})],
    // app/checkout/page.tsx + lib/order-items.ts shape
    [
      'CREATE_ORDER_MUTATION',
      () => ({
        input: {
          restaurantId: 1,
          items: [
            {dishId: 1, options: [{name: 'Size', choice: 'Large'}]},
            {dishId: 1, options: []},
          ],
        },
      }),
    ],
    // app/owner/orders/page.tsx + app/orders/[id]/page.tsx
    ['EDIT_ORDER_MUTATION', () => ({input: {id: 1, status: 'Cooking'}})],
    // app/driver/active/page.tsx + app/orders/[id]/page.tsx
    [
      'EDIT_ORDER_MUTATION',
      () => ({input: markFailedInput(1, DeliveryFailureReason.DRIVER_FAULT)}),
    ],
    // app/driver/available/page.tsx + app/orders/[id]/page.tsx
    ['TAKE_ORDER_MUTATION', () => ({input: {id: 1}})],
    // app/owner/promotions/page.tsx
    ['CREATE_PAYMENT_MUTATION', () => ({input: {restaurantId: 1, transactionId: 'TX-ABCDEFGH'}})],
    // components/order/order-payment-card.tsx
    ['REFRESH_ORDER_PAYMENT_MUTATION', () => ({input: {orderId: 1}})],
  ];

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerAndLogin(ctx.app, 'owner@mutations.test', 'Owner');
    const restaurant = await gql(
      ctx.app,
      `mutation {
        createRestaurant(input: {name: "Mutations Kitchen", coverImage: "https://example.com/cover.jpg", address: "1 Mutation Street", categoryName: "Pizza"}) {
          ok restaurantId
        }
      }`,
      owner,
    );
    expect(restaurant.body.data.createRestaurant.ok).toBe(true);
    restaurantId = restaurant.body.data.createRestaurant.restaurantId;
  });

  afterAll(async () => {
    await destroyTestApp(ctx);
  });

  it('M1 the list is complete and every document has a variables row', () => {
    const expected = [
      'CREATE_ACCOUNT_MUTATION',
      'CREATE_DISH_MUTATION',
      'CREATE_ORDER_MUTATION',
      'CREATE_PAYMENT_MUTATION',
      'CREATE_RESTAURANT_MUTATION',
      'DELETE_DISH_MUTATION',
      'DELETE_RESTAURANT_MUTATION',
      'EDIT_DISH_MUTATION',
      'EDIT_ORDER_MUTATION',
      'EDIT_PROFILE_MUTATION',
      'EDIT_RESTAURANT_MUTATION',
      'LOGIN_MUTATION',
      'REFRESH_ORDER_PAYMENT_MUTATION',
      'TAKE_ORDER_MUTATION',
    ];
    expect([...documents.keys()].sort()).toEqual(expected);
    expect([...new Set(rows.map(([name]) => name))].sort()).toEqual(expected);
  });

  it.each(rows)('M2 %s and its page variables are valid', (name, variables) => {
    expect(problems(documents.get(name), variables())).toEqual([]);
  });

  it('M3 catches an unknown input field', () => {
    const messages = problems(documents.get('CREATE_DISH_MUTATION'), {
      input: {...dishInput(FORM_WITHOUT_PHOTO), bogus: 'x'},
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Field "bogus" is not defined by type "CreateDishInput".');
  });

  it('M4 catches an unknown output field', () => {
    const messages = problems('mutation { deleteDish(input: {dishId: 1}) { ok nope } }', {});
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Cannot query field "nope" on type "DeleteDishOutput".');
  });

  it('M5 saves a dish with its photo and options', async () => {
    const created = await send('CREATE_DISH_MUTATION', owner, {
      input: dishInput({...FORM_WITH_PHOTO, restaurantId}),
    });
    expect(created.status).toBe(200);
    expect(created.body.errors).toBeUndefined();
    expect(created.body.data.createDish).toEqual({ok: true, error: null});
    const menu = await gql(
      ctx.app,
      `query {
        restaurant(input: {restaurantId: ${restaurantId}}) {
          restaurant {menu {id name priceCents photo options {name choices {name extraCents}}}}
        }
      }`,
    );
    expect(menu.status).toBe(200);
    expect(menu.body.errors).toBeUndefined();
    const dish = menu.body.data.restaurant.restaurant.menu.find(
      (entry: {name: string}) => entry.name === 'Margherita Pizza',
    );
    expect(dish).toBeDefined();
    expect(dish.priceCents).toBe(1450);
    expect(dish.photo).toBe('https://example.com/margherita.jpg');
    expect(dish.options).toEqual([{name: 'Size', choices: [{name: 'Large', extraCents: 300}]}]);
  });

  it('M6 saves a dish without a photo or options', async () => {
    const created = await send('CREATE_DISH_MUTATION', owner, {
      input: dishInput({...FORM_WITHOUT_PHOTO, restaurantId}),
    });
    expect(created.status).toBe(200);
    expect(created.body.errors).toBeUndefined();
    expect(created.body.data.createDish.ok).toBe(true);
    const menu = await gql(
      ctx.app,
      `query {
        restaurant(input: {restaurantId: ${restaurantId}}) {
          restaurant {menu {id name priceCents photo options {name choices {name extraCents}}}}
        }
      }`,
    );
    expect(menu.status).toBe(200);
    expect(menu.body.errors).toBeUndefined();
    const dish = menu.body.data.restaurant.restaurant.menu.find(
      (entry: {name: string}) => entry.name === 'Plain Focaccia',
    );
    expect(dish).toBeDefined();
    expect(dish.photo).toBeNull();
    expect(dish.options).toBeNull();
    focacciaId = dish.id;
  });

  it('M7 changes the photo while preserving the dish name and price', async () => {
    const edited = await send('EDIT_DISH_MUTATION', owner, {
      input: {dishId: focacciaId, photo: 'https://example.com/focaccia.jpg'},
    });
    expect(edited.status).toBe(200);
    expect(edited.body.errors).toBeUndefined();
    expect(edited.body.data.editDish.ok).toBe(true);
    const menu = await gql(
      ctx.app,
      `query {
        restaurant(input: {restaurantId: ${restaurantId}}) {
          restaurant {menu {id name priceCents photo options {name choices {name extraCents}}}}
        }
      }`,
    );
    expect(menu.status).toBe(200);
    expect(menu.body.errors).toBeUndefined();
    const dish = menu.body.data.restaurant.restaurant.menu.find(
      (entry: {id: number}) => entry.id === focacciaId,
    );
    expect(dish).toBeDefined();
    expect(dish.photo).toBe('https://example.com/focaccia.jpg');
    expect(dish.priceCents).toBe(1450);
    expect(dish.name).toBe('Plain Focaccia');
  });

  it('M8 allows createRestaurant to report failure without a restaurant id', () => {
    const output = ctx.app
      .get(GraphQLSchemaHost)
      .schema.getType('CreateRestaurantOutput') as GraphQLObjectType;
    const field = output.getFields().restaurantId;
    expect(isNonNullType(field.type)).toBe(false);
  });
});
