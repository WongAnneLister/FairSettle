# ADR 0003 — Dispatch to the provider through a transactional outbox

**Status**: accepted · **Finding**: [D2](../AUDIT.md#d2--transactional-outbox) · **Commit**: `846b596`

## Context

An order that has been placed must be handed to a third-party fulfillment
provider. The provider is a remote service with its own latency and its own
outages.

## Decision

`createOrder` writes the order and an `outbox_event` row in one transaction. A
poller claims due rows with `SELECT ... FOR UPDATE SKIP LOCKED` and calls the
provider outside that transaction.

## Alternatives

**Call the provider inline from `createOrder`** — has no correct ordering:

- *before* the commit: a transaction that later rolls back has already dispatched
  a real courier to a real restaurant, and there is nothing to un-send;
- *after* the commit: a crash in between loses the dispatch, and nothing records
  that one was ever owed.

There is no third position. The failure is not unlikely — it is one process
restart during a deploy.

**A message broker (SQS, RabbitMQ, Kafka)** — the usual answer at scale, and it
does not remove this problem: publishing to the broker is itself a remote call
that cannot be in the database transaction. The outbox is what you build
*anyway* to hand work to the broker reliably. Adding a broker here would add
infrastructure without removing the thing it is supposed to replace.

**A cron that scans orders lacking a dispatch** — workable, and it makes every
new side effect a new bespoke scan with its own "have I done this?" predicate.
The outbox generalises: one table, one poller, one retry policy.

## Consequences

Delivery is **at-least-once**, not exactly-once. A crash between the provider
accepting and the row being marked `Sent` re-sends. That is why the provider's
callbacks are deduplicated ([ADR 0004](./0004-idempotent-webhooks.md)) and why
[C2](../AUDIT.md#c2--status-transitions-are-not-idempotent) makes re-applying a
status a no-op rather than an error. **Idempotency downstream is not a nicety
here; it is what makes this design legal.**

`SKIP LOCKED` is what allows every replica to poll at once: each locks what it
takes and others step over it. Without it the pollers serialise; without
`FOR UPDATE` they all claim the same rows and the provider gets N copies.

Rows are marked in-flight before the provider is called, so a process that dies
mid-dispatch leaves a row that becomes due again rather than one locked forever.

Whether a given process polls is configurable (`OUTBOX_POLLING`). Draining from
every API pod means the poll rate scales with however many replicas happen to be
serving traffic, which makes an autoscaler decide how hard the provider gets hit.
