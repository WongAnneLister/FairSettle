<div align="center">

# FairSettle · On-Demand Order & Dispatch API

Core order lifecycle, restaurant catalog, driver claiming, and fulfillment dispatch service.

![NestJS](https://img.shields.io/badge/NestJS%2011-E0234E?style=flat-square&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript%205-3178C6?style=flat-square&logo=typescript&logoColor=white)
![GraphQL](https://img.shields.io/badge/GraphQL-E10098?style=flat-square&logo=graphql&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL%2016-316192?style=flat-square&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=flat-square&logo=docker&logoColor=white)

</div>

---

## Overview

The **Dispatch** service manages the end-to-end food delivery workflow across three primary roles:
- **Clients**: Browse restaurants and menus, create orders, track live status.
- **Restaurant Owners**: Manage catalog items, accept and cook incoming orders.
- **Couriers**: Atomically claim cooked orders and complete deliveries.

In addition, it bridges marketplace orders to third-party fulfillment providers and the FairSettle Ledger for payments and dispute liabilities.

---

## Architectural Principles

1. **Race-Condition-Free Claiming**
   Driver claims (`takeOrder`) and status transitions use conditional `UPDATE` statements whose `WHERE` clause carries all preconditions (`driverId IS NULL`, `status = 'Cooked'`). Concurrency safety is enforced at the database row level without distributed locks ([ADR 0001](docs/adr/0001-atomic-driver-claim.md), [ADR 0005](docs/adr/0005-transaction-isolation.md)).

2. **Explicit State Machine**
   Order transitions follow a strict directed state machine: `Pending → Cooking → Cooked → PickedUp → Delivered`. Both GraphQL API mutations and provider webhooks route through the same transition logic, guaranteeing idempotent transitions and rejecting out-of-order deliveries.

3. **Transactional Outbox for Fulfillment**
   Orders dispatched to external fulfillment partners write an `outbox_event` row within the same database transaction as the order. A background poller claims events with `SELECT ... FOR UPDATE SKIP LOCKED` and delivers them with exponential backoff and dead-letter queue support ([ADR 0003](docs/adr/0003-transactional-outbox.md)).

4. **Idempotent Webhook Processing**
   Inbound provider webhooks verify HMAC signatures and insert events into a `processed_event` table with a unique constraint. Duplicate deliveries safely return `200 OK` while preventing duplicate execution ([ADR 0004](docs/adr/0004-idempotent-webhooks.md)).

5. **Multi-Replica Real-Time Subscriptions**
   GraphQL subscriptions use Redis Pub/Sub so that state updates published on one application pod broadcast reliably to clients connected across any replica.

6. **Monetary Precision**
   All money amounts are stored and computed strictly as integer cents ([ADR 0002](docs/adr/0002-money-as-integer-cents.md)), eliminating floating-point rounding errors.

---

## Key Architecture Decisions (ADRs)

| ADR | Title | Scope |
|---|---|---|
| [ADR 0001](docs/adr/0001-atomic-driver-claim.md) | Claim an order with a conditional `UPDATE` | Concurrency & Race conditions |
| [ADR 0002](docs/adr/0002-money-as-integer-cents.md) | Store money as integer cents | Financial data precision |
| [ADR 0003](docs/adr/0003-transactional-outbox.md) | Dispatch through a transactional outbox | Reliable fulfillment delivery |
| [ADR 0004](docs/adr/0004-idempotent-webhooks.md) | Deduplicate provider callbacks with a unique index | Webhook idempotency |
| [ADR 0005](docs/adr/0005-transaction-isolation.md) | Concurrency under READ COMMITTED and REPEATABLE READ | Database isolation analysis |
| [ADR 0006](docs/adr/0006-generated-migrations-are-drafts.md) | Treat generated migrations as drafts | Schema migration safety |

---

## Getting Started

### Prerequisites
- Node.js >= 20
- Docker & Docker Compose

### Local Development

```bash
# 1. Start Postgres and Redis
docker compose up -d

# 2. Install dependencies
npm ci

# 3. Copy development environment configuration
cp env.dev.example .env.dev

# 4. Start the server (migrations execute on startup)
npm run start:dev
```

GraphQL Playground is available at `http://localhost:4000/graphql`.

### Testing

```bash
# Unit tests
npm test

# End-to-end tests (runs against real PostgreSQL and Redis)
cp env.test.example .env.test
npm run test:e2e
```
