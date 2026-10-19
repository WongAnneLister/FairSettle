# ADR 0004 — Deduplicate provider callbacks with a unique index

**Status**: accepted · **Finding**: [D3](../AUDIT.md#d3--idempotent-webhook-ingestion) · **Commit**: `846b596`

## Context

The provider reports progress over webhooks and guarantees at-least-once
delivery. It will redeliver on a timeout, on a 5xx, and on its own retry
schedule. A redelivered "delivered" callback must not be a second delivery.

## Decision

A `processed_event` table with a unique index on `eventId`. The handler inserts
first, then acts, both inside one transaction. A duplicate raises a unique
violation, which is caught and answered `200`.

Status changes route through the same state machine that serves the GraphQL API.

## Alternatives

**`SELECT` then `INSERT`** — the same check-then-write race as
[B2](../AUDIT.md#b2--takeorder-has-a-check-then-write-race), and a provider
retrying on timeout produces exactly the concurrency that exposes it. Two
copies of one callback can both find nothing and both proceed.

**Claim in one transaction, apply in another** — leaves a window where a crash
marks the event handled without applying it. The provider would never redeliver
it, because it already got a 200. The event is then lost permanently, which is
worse than processing it twice.

**Deduplicate in Redis with a TTL** — faster, and it puts the correctness of a
financial-ish state change on a cache with an eviction policy. The database
already has the transaction the state change needs.

**Trust the signature and apply blindly** — a valid signature proves who sent
it, not how many times.

## Consequences

Duplicates and deliberately-ignored events both answer `200`. A provider reads
non-2xx as "try again", so returning 4xx for an event that was already applied
is how a redelivery loop starts. The response body says whether it was applied;
the status code says whether to stop sending.

Routing through the state machine means **out-of-order redelivery is handled for
free**: a stale `PickedUp` arriving after `Delivered` is rejected by the
transition table rather than moving the order backwards.

The provider is its own actor in that table, allowed on exactly the two edges it
performs (`Cooked → PickedUp`, `PickedUp → Delivered`). It cannot report that
the kitchen started cooking. **Signed and well-formed is not the same as
authorised** — an early version of the ingest service passed `AssignedDriver`
for provider callbacks, which would have let a courier's webhook drive the
restaurant's half of the lifecycle.

`processed_event` grows without bound and needs a retention policy before this
runs for real.
