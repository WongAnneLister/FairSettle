# Architecture decision records

Short notes on the choices that were not obvious, written when the decision was
made rather than reconstructed afterwards. Each states what was rejected and
why — the alternatives are usually the interesting part.

| # | Decision | Relates to |
|---|----------|------------|
| [0001](./0001-atomic-driver-claim.md) | Claim an order with a conditional `UPDATE` | [B2](../AUDIT.md#b2--takeorder-has-a-check-then-write-race) |
| [0002](./0002-money-as-integer-cents.md) | Store money as integer cents | [B12](../AUDIT.md#b12--money-is-stored-as-an-integer-but-exposed-as-a-float) |
| [0003](./0003-transactional-outbox.md) | Dispatch through a transactional outbox | [D2](../AUDIT.md#d2--transactional-outbox) |
| [0004](./0004-idempotent-webhooks.md) | Deduplicate callbacks with a unique index | [D3](../AUDIT.md#d3--idempotent-webhook-ingestion) |
| [0005](./0005-transaction-isolation.md) | Why 0001 holds under READ COMMITTED and REPEATABLE READ | ADR 0001 |
| [0006](./0006-generated-migrations-are-drafts.md) | Treat generated migrations as drafts | B8, B10/B11, B12, B15 |
