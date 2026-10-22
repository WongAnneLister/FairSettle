import {INestApplication} from '@nestjs/common';
import {createHmac, randomUUID} from 'crypto';
import * as request from 'supertest';

import {OutboxEvent, OutboxStatus} from 'src/fulfillment/entities/outbox-event.entity';
import {ProcessedEvent} from 'src/fulfillment/entities/processed-event.entity';
import {MAX_ATTEMPTS, OutboxService} from 'src/fulfillment/outbox.service';
import {MockFulfillmentProvider} from 'src/fulfillment/provider/mock-provider.service';

import {TestContext, createTestApp, destroyTestApp, gql, registerAndLogin} from './utils/e2e';

const SIGNING_SECRET = 'mock-secret';

/**
 * D1–D4 — the broker layer between this system and whoever actually delivers.
 *
 * The outbox poller is disabled in the test environment (OUTBOX_POLLING), so
 * these tests drive drain() themselves. Racing a one-second timer would make
 * every assertion here a coin flip.
 */
describe('fulfillment (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let outbox: OutboxService;
  let provider: MockFulfillmentProvider;

  let clientToken: string;
  let ownerToken: string;
  let restaurantId: number;
  let dishId: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    outbox = ctx.moduleRef.get(OutboxService);
    provider = ctx.moduleRef.get(MockFulfillmentProvider);
    provider.configure({failureRate: 0, alwaysFailOrderIds: [], callbackUrl: null});

    clientToken = await registerAndLogin(app, 'client@fulfil.test', 'Client');
    ownerToken = await registerAndLogin(app, 'owner@fulfil.test', 'Owner');

    const restaurant = await gql(
      app,
      `mutation {
        createRestaurant(input: {
          name: "Fulfil Kitchen", coverImage: "x", address: "9 Depot Road", categoryName: "Pizza"
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

  const outboxRepo = () => ctx.dataSource.getRepository(OutboxEvent);

  async function placeOrder(): Promise<number> {
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
    return res.body.data.createOrder.orderId;
  }

  function postCallback(body: Record<string, unknown>, secret = SIGNING_SECRET) {
    const raw = JSON.stringify(body);
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    return request(app.getHttpServer())
      .post('/webhooks/fulfillment')
      .set('X-Provider-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(raw);
  }

  /** Makes a Pending row immediately eligible, bypassing its backoff. */
  async function makeDue(outboxId: number): Promise<void> {
    await ctx.dataSource.query(`UPDATE "outbox_event" SET "nextAttemptAt" = now() WHERE id = $1`, [
      outboxId,
    ]);
  }

  // D2 — the outbox row and the order commit together or not at all.
  describe('the dispatch is recorded transactionally', () => {
    it('writes an outbox row in the same transaction as the order', async () => {
      const orderId = await placeOrder();

      const event = await outboxRepo().findOne({where: {aggregateId: orderId}});
      expect(event).not.toBeNull();
      expect(event.status).toBe(OutboxStatus.Pending);
      expect(event.attempts).toBe(0);
      expect(event.payload).toMatchObject({
        restaurantName: 'Fulfil Kitchen',
        address: '9 Depot Road',
        totalCents: 1200,
      });
    });

    it('writes no outbox row when the order is rolled back', async () => {
      const before = await outboxRepo().count();

      const res = await gql(
        app,
        `mutation {
          createOrder(input: {
            restaurantId: ${restaurantId}, items: [{dishId: 999999}]
          }) { ok code }
        }`,
        clientToken,
      );
      expect(res.body.data.createOrder.ok).toBe(false);

      // Calling the provider inline would already have dispatched this order to
      // a real third party by now.
      expect(await outboxRepo().count()).toBe(before);
    });
  });

  // D1 — the provider is reached through the adapter, and the result recorded.
  describe('draining dispatches to the provider', () => {
    it('marks the event sent and records the provider reference', async () => {
      const orderId = await placeOrder();
      await outbox.drain();

      const event = await outboxRepo().findOne({where: {aggregateId: orderId}});
      expect(event.status).toBe(OutboxStatus.Sent);
      expect(event.providerRef).toMatch(/^mock_/);
      expect(event.lastError).toBeNull();
    });

    it('does not dispatch an event twice', async () => {
      const orderId = await placeOrder();
      await outbox.drain();
      const first = await outboxRepo().findOne({where: {aggregateId: orderId}});

      // A second pass must not find it: Sent rows are never claimed again.
      await outbox.drain();
      const second = await outboxRepo().findOne({where: {aggregateId: orderId}});

      expect(second.providerRef).toBe(first.providerRef);
      expect(second.attempts).toBe(first.attempts);
    });

    // D2 — SKIP LOCKED is what lets every replica poll at once.
    it('gives an event to only one of two concurrent drains', async () => {
      const orderId = await placeOrder();

      const dispatched: number[] = [];
      const original = provider.dispatch.bind(provider);
      jest.spyOn(provider, 'dispatch').mockImplementation(async req => {
        dispatched.push(req.orderId);
        return original(req);
      });

      await Promise.all([outbox.drain(), outbox.drain()]);

      expect(dispatched.filter(id => id === orderId)).toHaveLength(1);
      jest.restoreAllMocks();
    });
  });

  // D4 — retries, then quarantine.
  describe('retry and the dead-letter path', () => {
    it('backs off and retries a failing dispatch, then quarantines it', async () => {
      const orderId = await placeOrder();
      provider.configure({alwaysFailOrderIds: [orderId]});

      const event = await outboxRepo().findOne({where: {aggregateId: orderId}});

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await makeDue(event.id);
        await outbox.drain();
      }

      const dead = await outboxRepo().findOne({where: {id: event.id}});
      expect(dead.attempts).toBe(MAX_ATTEMPTS);
      expect(dead.status).toBe(OutboxStatus.Dead);
      expect(dead.lastError).toContain('permanently rejects');

      provider.configure({alwaysFailOrderIds: []});
    });

    it('pushes nextAttemptAt into the future rather than retrying immediately', async () => {
      const orderId = await placeOrder();
      provider.configure({alwaysFailOrderIds: [orderId]});

      const before = await outboxRepo().findOne({where: {aggregateId: orderId}});
      await makeDue(before.id);
      await outbox.drain();

      const after = await outboxRepo().findOne({where: {id: before.id}});
      expect(after.attempts).toBe(1);
      expect(after.status).toBe(OutboxStatus.Pending);
      expect(new Date(after.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());

      provider.configure({alwaysFailOrderIds: []});
    });

    // The head-of-line property: one poison event must not hold up the queue.
    it('keeps delivering other orders while one is failing permanently', async () => {
      const poisonId = await placeOrder();
      provider.configure({alwaysFailOrderIds: [poisonId]});

      const healthyIds = [await placeOrder(), await placeOrder()];

      const poison = await outboxRepo().findOne({where: {aggregateId: poisonId}});
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await makeDue(poison.id);
        await outbox.drain();
      }

      const poisonRow = await outboxRepo().findOne({where: {id: poison.id}});
      expect(poisonRow.status).toBe(OutboxStatus.Dead);

      for (const id of healthyIds) {
        const row = await outboxRepo().findOne({where: {aggregateId: id}});
        expect(row.status).toBe(OutboxStatus.Sent);
      }

      provider.configure({alwaysFailOrderIds: []});
    });
  });

  // D3 — inbound callbacks: signed, deduplicated, and routed through the state
  // machine.
  describe('webhook ingestion', () => {
    /**
     * An order the provider has accepted and the kitchen has finished.
     *
     * Cooked is where the provider's authority begins: it may report PickedUp
     * and Delivered because it performs them, and nothing earlier.
     */
    async function dispatchedOrder(): Promise<{orderId: number; providerRef: string}> {
      const orderId = await placeOrder();
      await outbox.drain();

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

      const event = await outboxRepo().findOne({where: {aggregateId: orderId}});
      return {orderId, providerRef: event.providerRef};
    }

    const readStatus = async (orderId: number) => {
      const res = await gql(
        app,
        `query { getOrder(input: {id: ${orderId}}) { order { status } } }`,
        clientToken,
      );
      return res.body.data.getOrder.order.status;
    };

    it('rejects an unsigned or wrongly signed callback', async () => {
      const {orderId, providerRef} = await dispatchedOrder();
      const body = {eventId: randomUUID(), providerRef, orderId, status: 'PickedUp'};

      await postCallback(body, 'not-the-secret').expect(401);
      await request(app.getHttpServer()).post('/webhooks/fulfillment').send(body).expect(401);

      expect(await readStatus(orderId)).toBe('Cooked');
    });

    it('applies a signed callback through the state machine', async () => {
      const {orderId, providerRef} = await dispatchedOrder();

      const res = await postCallback({
        eventId: randomUUID(),
        providerRef,
        orderId,
        status: 'PickedUp',
      }).expect(200);

      expect(res.body).toMatchObject({received: true, applied: true});
      expect(await readStatus(orderId)).toBe('PickedUp');
    });

    it('applies a redelivered event exactly once', async () => {
      const {orderId, providerRef} = await dispatchedOrder();
      const body = {eventId: randomUUID(), providerRef, orderId, status: 'PickedUp'};

      const first = await postCallback(body).expect(200);
      expect(first.body.applied).toBe(true);

      // Same event id, delivered five more times, concurrently — which is what
      // a provider retrying on timeout actually looks like.
      const repeats = await Promise.all([
        postCallback(body),
        postCallback(body),
        postCallback(body),
        postCallback(body),
        postCallback(body),
      ]);

      repeats.forEach(r => {
        // 200, not 4xx: a provider reads a non-2xx as "try again".
        expect(r.status).toBe(200);
        expect(r.body.applied).toBe(false);
        expect(r.body.reason).toBe('duplicate');
      });

      expect(await readStatus(orderId)).toBe('PickedUp');
      expect(
        await ctx.dataSource.getRepository(ProcessedEvent).count({where: {eventId: body.eventId}}),
      ).toBe(1);
    });

    it('refuses a provider callback about the kitchen', async () => {
      const {orderId, providerRef} = await dispatchedOrder();

      // Signed and well-formed, but not the provider's to report.
      const res = await postCallback({
        eventId: randomUUID(),
        providerRef,
        orderId,
        status: 'Cooking',
      }).expect(200);

      expect(res.body.applied).toBe(false);
      expect(await readStatus(orderId)).toBe('Cooked');
    });

    it('rejects a callback that would move the order backwards', async () => {
      const {orderId, providerRef} = await dispatchedOrder();

      await postCallback({eventId: randomUUID(), providerRef, orderId, status: 'PickedUp'});
      await postCallback({eventId: randomUUID(), providerRef, orderId, status: 'Delivered'});

      // Out-of-order redelivery: a stale PickedUp arriving after Delivered. A
      // fresh event id, so deduplication does not catch it — the state machine
      // is what rejects it.
      const stale = await postCallback({
        eventId: randomUUID(),
        providerRef,
        orderId,
        status: 'PickedUp',
      }).expect(200);

      expect(stale.body.applied).toBe(false);
      expect(await readStatus(orderId)).toBe('Delivered');
    });

    it('ignores a callback for a providerRef it never issued', async () => {
      const res = await postCallback({
        eventId: randomUUID(),
        providerRef: 'mock_never-dispatched',
        orderId: 424242,
        status: 'PickedUp',
      }).expect(200);

      expect(res.body).toMatchObject({applied: false, reason: 'unknown providerRef'});
    });
  });
});
