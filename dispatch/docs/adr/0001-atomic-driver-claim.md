# ADR 0001 — Claim an order with a conditional UPDATE

**Status**: accepted · **Finding**: [B2](../AUDIT.md#b2--takeorder-has-a-check-then-write-race) · **Commits**: `7ae792d` (red), `52cf3ae` (green)

## Context

`takeOrder` read the order, checked whether it had a driver, then wrote:

```ts
const order = await this.orders.findOne({where: {id}});   // 1. read
if (order.driver) { return {ok: false, ...}; }            // 2. check
await this.orders.save([{id, driver}]);                   // 3. write
```

Nothing holds between 1 and 3. Twenty drivers claiming at once measured 8–10
winners per round: each was told `ok: true`, and each would drive to collect an
order belonging to someone else.

## Decision

Move the check into the statement that does the write, and decide the winner by
rows affected:

```sql
UPDATE "order" SET "driverId" = $1
 WHERE id = $2 AND "driverId" IS NULL AND status = 'Cooked'
```

`affected === 0` means someone else won. The losing path then re-reads to say
*why* — gone, taken, or not cooked yet — which cannot reintroduce the race
because it only runs after the claim already failed.

## Alternatives

**`SELECT ... FOR UPDATE`** — holds a row lock across application logic for no
benefit. The entire decision is one predicate the database can evaluate itself;
taking a lock, returning to Node, deciding, and writing back is strictly more
machinery and more time holding the row.

**Optimistic locking (`@VersionColumn`)** — version numbers mean "detect the
conflict and retry". A driver who loses a claim has nothing to retry: the order
is gone. The pattern fits read-modify-write over a value the caller wants to
update regardless, not a race for exclusive ownership.

**Application-level mutex / advisory lock** — correct, and unnecessary. It adds
a second thing that can fail (and a second thing to release on crash) to enforce
what a `WHERE` clause already enforces.

## Consequences

Losing is now a normal outcome rather than an error, reported as `CONFLICT`
so a client knows to refresh rather than that it lacks permission.

The same shape recurs in `editOrder`, whose write is conditional on the status
the transition was validated against. Worth recognising as a general rule:
**any read-then-decide-then-write is a race unless the decision is re-checked by
the write itself.**

Correctness under both isolation levels is covered in [ADR 0005](./0005-transaction-isolation.md).

Since F37, the WHERE clause also carries `"paymentStatus" IN ('Paid', 'NotRequired')`.
A claim on an unpaid order loses the same way and is explained as `Order is not paid yet`
(`CONFLICT`). Same mechanism, one more predicate.
