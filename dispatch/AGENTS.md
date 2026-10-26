# Dispatch

Food-delivery order and dispatch backend for customers, restaurants and couriers. GraphQL API.

Read before changing anything here: `docs/adr/` (6 ADRs).

## Commands

- Infrastructure for local development and e2e: `docker compose up -d` in this folder starts PostgreSQL 16 and Redis 7 on host ports. The whole stack, dispatch included, runs from the repository-root compose (F13).
- Install: `npm ci`. Run: `npm run start:dev` (migrations run on boot outside production). GraphQL at `http://localhost:4000/graphql`.
- Unit tests: `npm test`.
- E2E tests against real PostgreSQL and Redis: copy `env.test.example` to `.env.test`, then `npm run test:e2e`.
- Race reproduction, before and after the fix: `./scripts/race-demo.sh`.

- The agent's service token is `AGENT_SERVICE_TOKEN`; it reads `getOrder` and `orderTimeline` only.

## Where things live

| Path | Role |
| --- | --- |
| `src/orders/order-events.ts` | The order event log: one row per applied order change, in the change's own transaction; read by `orderTimeline` (F19) |
| `src/orders/order-state-machine.ts` | The only place order status changes. API calls, provider callbacks and new ledger notifications all go through it |
| `src/ledger/` | The only place dispatch calls the ledger. Payment creation goes through the outbox (`order.payment`); the key is derived from the order id (F15); receives signed ledger payment notifications at `POST /webhooks/ledger` (raw-byte HMAC, inbox by eventId) and moves `paymentStatus` through the state machine (F16) |
| `src/fulfillment/` | Provider adapter, transactional outbox, signed webhook ingestion, retry and dead-letter |
| `src/common/errors/` | Error taxonomy; no bare `catch` that flattens errors |

## Rules from this codebase's own history

- Claims and state changes that race use a conditional UPDATE whose WHERE clause carries the precondition; the winner is whoever changed a row (ADR 0001, ADR 0005). Never read-check-then-write.
- Money is integer cents (ADR 0002). Instants are `timestamptz`.
- Every schema change is a migration file. Never rely on TypeORM `synchronize`.
- Never commit `typeorm migration:generate` output unreviewed: it has produced SQL that silently detached line items, divided prices by 100 and reset timestamps (ADR 0006). Read the SQL and test it against existing data.
- Outbox rows commit in the same transaction as the business row; the poller claims with `FOR UPDATE SKIP LOCKED`.
- Incoming webhooks: HMAC checked in constant time, event id inserted against a unique index before any effect, then the state machine.
- E2E tests use the real database and Redis on purpose. Do not stub them. Do not share process-level singletons between test application instances (a module-level PubSub once made a cross-replica test pass against the bug).

- A new order write site records an `order_event` in the same transaction (F19).
