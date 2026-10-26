import {INestApplication} from '@nestjs/common';
import {GraphQLSchemaHost} from '@nestjs/graphql';
import {createHmac, randomUUID} from 'crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {GraphQLEnumType, Kind, parse, validate} from 'graphql';
import * as path from 'path';
import * as request from 'supertest';
import {OutboxEvent} from 'src/fulfillment/entities/outbox-event.entity';
import {ProcessedEvent} from 'src/fulfillment/entities/processed-event.entity';
import {OutboxService} from 'src/fulfillment/outbox.service';
import {MockFulfillmentProvider} from 'src/fulfillment/provider/mock-provider.service';
import type {TestContext} from './utils/e2e';

const DOCUMENT = readFileSync(
  path.resolve(__dirname, '../../contracts/dispatch-agent-operations.graphql'),
  'utf8',
);
const FIXTURES = path.resolve(__dirname, '../../contracts/fixtures/agent');
const TOKEN = 's'.repeat(40);

function shapeOf(value: unknown): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.map(shapeOf);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, shapeOf(value[key])]),
    );
  }
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'float';
  return typeof value;
}

function fixture(
  name: string,
  req: {operationName: string; variables: Record<string, number>},
  response: request.Response,
): void {
  const live = {
    name,
    source: 'dispatch/test/agent-fixtures.e2e-spec.ts',
    request: {method: 'POST', path: '/graphql', ...req},
    response: {status: response.status, body: response.body},
  };
  const file = path.join(FIXTURES, name + '.json');
  if (process.env.RECORD_AGENT_FIXTURES === '1') {
    mkdirSync(FIXTURES, {recursive: true});
    writeFileSync(file, JSON.stringify(live, null, 2) + '\n');
  } else {
    const committed = JSON.parse(readFileSync(file, 'utf8'));
    expect(live.request.method).toBe(committed.request.method);
    expect(live.request.operationName).toBe(committed.request.operationName);
    expect(shapeOf(live.request.variables)).toEqual(shapeOf(committed.request.variables));
    expect(live.response.status).toBe(committed.response.status);
    expect(shapeOf(live.response.body)).toEqual(shapeOf(committed.response.body));
  }
}

describe('agent fixtures (e2e)', () => {
  let harness: typeof import('./utils/e2e');
  let ctx: TestContext;
  let app: INestApplication;
  let outbox: OutboxService;
  let savedToken: string | undefined;
  let client: string;
  let owner: string;
  let driver: string;
  let otherDriver: string;
  let driverId: number;
  let restaurantId: number;
  let dishId: number;
  let delivered: number;
  let deliveredEventId: string;

  beforeAll(async () => {
    savedToken = process.env.AGENT_SERVICE_TOKEN;
    process.env.AGENT_SERVICE_TOKEN = TOKEN;
    harness = await import('./utils/e2e');
    ctx = await harness.createTestApp();
    app = ctx.app;
    outbox = ctx.moduleRef.get(OutboxService);
    ctx.moduleRef
      .get(MockFulfillmentProvider)
      .configure({failureRate: 0, alwaysFailOrderIds: [], callbackUrl: null});
    client = await harness.registerAndLogin(app, 'client@agent-fixtures.test', 'Client');
    owner = await harness.registerAndLogin(app, 'owner@agent-fixtures.test', 'Owner');
    driver = await harness.registerAndLogin(app, 'driver@agent-fixtures.test', 'Delivery');
    otherDriver = await harness.registerAndLogin(
      app,
      'other-driver@agent-fixtures.test',
      'Delivery',
    );
    const me = await harness.gql(app, 'query { me { id } }', driver);
    driverId = me.body.data.me.id;
    const restaurant = await harness.gql(
      app,
      'mutation { createRestaurant(input: {name: "Agent Kitchen", coverImage: "x", address: "1 Agent Road", categoryName: "Pizza"}) { ok restaurantId } }',
      owner,
    );
    expect(restaurant.body.data.createRestaurant.ok).toBe(true);
    restaurantId = restaurant.body.data.createRestaurant.restaurantId;
    const dish = await harness.gql(
      app,
      `mutation { createDish(input: {restaurantId: ${restaurantId}, name: "Agent Dish", priceCents: 1250, description: "Fixture dish"}) { ok } }`,
      owner,
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
      if (savedToken === undefined) delete process.env.AGENT_SERVICE_TOKEN;
      else process.env.AGENT_SERVICE_TOKEN = savedToken;
    }
  });

  function agent(operationName: string, variables: Record<string, number>, token = TOKEN) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('X-Service-Token', token)
      .send({query: DOCUMENT, operationName, variables});
  }

  async function placeOrder(): Promise<number> {
    const res = await harness.gql(
      app,
      `mutation { createOrder(input: {restaurantId: ${restaurantId}, items: [{dishId: ${dishId}}]}) { ok error orderId } }`,
      client,
    );
    expect(res.body.data.createOrder.ok).toBe(true);
    return res.body.data.createOrder.orderId;
  }

  async function edit(id: number, status: string, token = owner) {
    const res = await harness.gql(
      app,
      `mutation { editOrder(input: {id: ${id}, status: ${status}}) { ok code } }`,
      token,
    );
    return res.body.data.editOrder;
  }

  async function take(id: number, token = driver) {
    const res = await harness.gql(
      app,
      `mutation { takeOrder(input: {id: ${id}}) { ok code } }`,
      token,
    );
    return res.body.data.takeOrder;
  }

  const rows = (id: number) =>
    ctx.dataSource.query('SELECT * FROM "order_event" WHERE "orderId" = $1 ORDER BY id', [id]);

  async function providerRef(id: number): Promise<string> {
    await outbox.drain();
    const event = await ctx.dataSource
      .getRepository(OutboxEvent)
      .findOneByOrFail({aggregateId: id});
    expect(event.providerRef).toMatch(/^mock_/);
    return event.providerRef;
  }

  function postCallback(body: Record<string, unknown>) {
    const raw = JSON.stringify(body);
    const signature = createHmac('sha256', 'mock-secret').update(raw).digest('hex');
    return request(app.getHttpServer())
      .post('/webhooks/fulfillment')
      .set('X-Provider-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(raw);
  }

  function expectedDelivered() {
    return [
      {
        kind: 'CREATED',
        fromStatus: null,
        toStatus: 'Pending',
        actor: 'Client',
        driverId: null,
        providerEventId: null,
      },
      {
        kind: 'STATUS_CHANGED',
        fromStatus: 'Pending',
        toStatus: 'Cooking',
        actor: 'Owner',
        driverId: null,
        providerEventId: null,
      },
      {
        kind: 'STATUS_CHANGED',
        fromStatus: 'Cooking',
        toStatus: 'Cooked',
        actor: 'Owner',
        driverId: null,
        providerEventId: null,
      },
      {
        kind: 'DRIVER_ASSIGNED',
        fromStatus: null,
        toStatus: null,
        actor: 'AssignedDriver',
        driverId,
        providerEventId: null,
      },
      {
        kind: 'STATUS_CHANGED',
        fromStatus: 'Cooked',
        toStatus: 'PickedUp',
        actor: 'AssignedDriver',
        driverId,
        providerEventId: null,
      },
      {
        kind: 'STATUS_CHANGED',
        fromStatus: 'PickedUp',
        toStatus: 'Delivered',
        actor: 'FulfillmentProvider',
        driverId: null,
        providerEventId: deliveredEventId,
      },
    ];
  }

  it('the operations file is valid against the live schema', () => {
    const document = parse(DOCUMENT);
    expect(validate(ctx.moduleRef.get(GraphQLSchemaHost).schema, document)).toEqual([]);
    expect(
      document.definitions.map(definition =>
        definition.kind === Kind.OPERATION_DEFINITION ? definition.name?.value : null,
      ),
    ).toEqual(['AgentOrder', 'AgentOrderTimeline']);
  });

  it("the timeline enums carry the agent's spellings on the wire", () => {
    const schema = ctx.moduleRef.get(GraphQLSchemaHost).schema;
    for (const [name, expected] of [
      ['OrderEventKind', ['CREATED', 'STATUS_CHANGED', 'DRIVER_ASSIGNED']],
      ['OrderEventActor', ['Owner', 'Client', 'AssignedDriver', 'FulfillmentProvider']],
    ] as const) {
      const type = schema.getType(name);
      expect(type).toBeInstanceOf(GraphQLEnumType);
      expect((type as GraphQLEnumType).getValues().map(value => value.name)).toEqual(expected);
    }
  });

  it('records one event per applied change, in order', async () => {
    delivered = await placeOrder();
    expect(await edit(delivered, 'Cooking')).toMatchObject({ok: true});
    expect(await edit(delivered, 'Cooked')).toMatchObject({ok: true});
    expect(await take(delivered)).toMatchObject({ok: true});
    expect(await edit(delivered, 'PickedUp', driver)).toMatchObject({ok: true});
    const ref = await providerRef(delivered);
    deliveredEventId = randomUUID();
    const callback = await postCallback({
      eventId: deliveredEventId,
      providerRef: ref,
      orderId: delivered,
      status: 'Delivered',
    }).expect(200);
    expect(callback.body.applied).toBe(true);
    const events = await rows(delivered);
    expect(events).toHaveLength(6);
    expect(events).toMatchObject(expectedDelivered());
    for (let i = 1; i < events.length; i++) {
      expect(events[i].id).toBeGreaterThan(events[i - 1].id);
      expect(new Date(events[i].occurredAt).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i - 1].occurredAt).getTime(),
      );
    }
  });

  it('records nothing for rejected or repeated changes', async () => {
    const id = await placeOrder();
    expect(await edit(id, 'Cooked')).toMatchObject({ok: false, code: 'CONFLICT'});
    expect(await edit(id, 'Cooking', client)).toMatchObject({ok: false, code: 'FORBIDDEN'});
    expect(await edit(id, 'Cooking')).toMatchObject({ok: true});
    expect(await edit(id, 'Cooking')).toMatchObject({ok: true});
    expect(await edit(id, 'Cooked')).toMatchObject({ok: true});
    const ref = await providerRef(id);
    expect(await take(id)).toMatchObject({ok: true});
    expect(await take(id, otherDriver)).toMatchObject({ok: false, code: 'CONFLICT'});
    const eventId = randomUUID();
    const body = {eventId, providerRef: ref, orderId: id, status: 'PickedUp'};
    expect((await postCallback(body).expect(200)).body.applied).toBe(true);
    expect((await postCallback(body).expect(200)).body).toMatchObject({
      applied: false,
      reason: 'duplicate',
    });
    const events = await rows(id);
    expect(events).toHaveLength(5);
    expect(events).toMatchObject([
      ...expectedDelivered().slice(0, 4),
      {
        kind: 'STATUS_CHANGED',
        fromStatus: 'Cooked',
        toStatus: 'PickedUp',
        actor: 'FulfillmentProvider',
        driverId: null,
        providerEventId: eventId,
      },
    ]);
  });

  it('agent reads any order with the service token', async () => {
    const res = await agent('AgentOrder', {id: delivered}).expect(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.getOrder).toMatchObject({
      ok: true,
      order: {status: 'Delivered', totalCents: 1250, driver: {id: driverId}},
    });
    fixture(
      'dispatch-order-delivered',
      {operationName: 'AgentOrder', variables: {id: delivered}},
      res,
    );
  });

  it('agent reads the timeline', async () => {
    const res = await agent('AgentOrderTimeline', {orderId: delivered}).expect(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.orderTimeline.ok).toBe(true);
    expect(res.body.data.orderTimeline.events).toHaveLength(6);
    expect(res.body.data.orderTimeline.events).toMatchObject(expectedDelivered());
    fixture(
      'dispatch-timeline-delivered',
      {operationName: 'AgentOrderTimeline', variables: {orderId: delivered}},
      res,
    );
  });

  it('agent reads a new order and its one-event timeline', async () => {
    const id = await placeOrder();
    const order = await agent('AgentOrder', {id}).expect(200);
    expect(order.body.data.getOrder).toMatchObject({
      ok: true,
      order: {status: 'Pending', driver: null},
    });
    fixture('dispatch-order-pending', {operationName: 'AgentOrder', variables: {id}}, order);
    const timeline = await agent('AgentOrderTimeline', {orderId: id}).expect(200);
    expect(timeline.body.data.orderTimeline.ok).toBe(true);
    expect(timeline.body.data.orderTimeline.events).toHaveLength(1);
    expect(timeline.body.data.orderTimeline.events[0]).toMatchObject(expectedDelivered()[0]);
    fixture(
      'dispatch-timeline-pending',
      {operationName: 'AgentOrderTimeline', variables: {orderId: id}},
      timeline,
    );
  });

  it('unknown order is NOT_FOUND', async () => {
    const res = await agent('AgentOrder', {id: 999999}).expect(200);
    expect(res.body.data.getOrder).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      error: 'Order not found',
      order: null,
    });
    fixture(
      'dispatch-order-not-found',
      {operationName: 'AgentOrder', variables: {id: 999999}},
      res,
    );
  });

  it('a wrong service token is refused', async () => {
    const res = await agent('AgentOrder', {id: delivered}, 'x'.repeat(40)).expect(200);
    expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    expect(res.body.data).toBeNull();
    fixture(
      'dispatch-unauthorized',
      {operationName: 'AgentOrder', variables: {id: delivered}},
      res,
    );
  });

  it('the service token reads nothing else', async () => {
    const id = await placeOrder();
    const before = await rows(id);
    for (const query of [
      'query { getOrders(input: {page: 1}) { ok } }',
      `mutation { editOrder(input: {id: ${id}, status: Cooking}) { ok } }`,
      'query { me { id } }',
    ]) {
      const res = await request(app.getHttpServer())
        .post('/graphql')
        .set('X-Service-Token', TOKEN)
        .send({query});
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    }
    const order = await harness.gql(
      app,
      `query { getOrder(input: {id: ${id}}) { order { status } } }`,
      client,
    );
    expect(order.body.data.getOrder.order.status).toBe('Pending');
    expect(await rows(id)).toEqual(before);
  });

  it('a bad service token never falls back to the JWT', async () => {
    const query = `query { getOrder(input: {id: ${delivered}}) { ok } }`;
    expect((await harness.gql(app, query, owner)).body.data.getOrder.ok).toBe(true);
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('X-Service-Token', 'x'.repeat(40))
      .set('Authorization', owner)
      .send({query});
    expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    expect(res.body.data).toBeNull();
  });

  it('a user timeline follows getOrder visibility', async () => {
    const another = await harness.registerAndLogin(
      app,
      'another-client@agent-fixtures.test',
      'Client',
    );
    const query = `query { orderTimeline(input: {orderId: ${delivered}}) { ok code events { id } } }`;
    const allowed = await harness.gql(app, query, client);
    expect(allowed.body.data.orderTimeline.ok).toBe(true);
    expect(allowed.body.data.orderTimeline.events).toHaveLength(6);
    const denied = await harness.gql(app, query, another);
    expect(denied.body.data.orderTimeline).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
      events: null,
    });
    const anonymous = await harness.gql(app, query);
    expect(anonymous.body.errors[0].extensions.code).toBe('FORBIDDEN');
  });

  it('a callback that loses a race records nothing and is redelivered', async () => {
    const id = await placeOrder();
    expect(await edit(id, 'Cooking')).toMatchObject({ok: true});
    expect(await edit(id, 'Cooked')).toMatchObject({ok: true});
    const ref = await providerRef(id);
    const body = {eventId: randomUUID(), providerRef: ref, orderId: id, status: 'PickedUp'};
    const runner = ctx.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let callback: Promise<request.Response> | undefined;
    try {
      await runner.query('UPDATE "order" SET status = \'PickedUp\' WHERE id = $1', [id]);
      // Calling then starts supertest immediately; the row lock gates the callback.
      callback = postCallback(body).then(response => response);
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline) {
        const [activity] = await ctx.dataSource.query(
          "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
        );
        if (Number(activity.count) >= 1) {
          blocked = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await runner.commitTransaction();
      expect((await callback).status).toBe(500);
      expect(
        await ctx.dataSource.getRepository(ProcessedEvent).countBy({eventId: body.eventId}),
      ).toBe(0);
      expect((await rows(id)).filter(event => event.toStatus === 'PickedUp')).toHaveLength(0);
      const again = await postCallback(body).expect(200);
      expect(again.body).toMatchObject({applied: false, reason: 'already in that state'});
      expect(
        await ctx.dataSource.getRepository(ProcessedEvent).countBy({eventId: body.eventId}),
      ).toBe(1);
      expect((await rows(id)).filter(event => event.toStatus === 'PickedUp')).toHaveLength(0);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      if (callback) await callback;
    }
  });
});
