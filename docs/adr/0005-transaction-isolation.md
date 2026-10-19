# ADR 0005 — Why the conditional UPDATE is correct under both isolation levels

**Status**: accepted · **Relates to**: [ADR 0001](./0001-atomic-driver-claim.md)

## Context

[ADR 0001](./0001-atomic-driver-claim.md) resolves a claim with

```sql
UPDATE "order" SET "driverId" = $1 WHERE id = $2 AND "driverId" IS NULL
```

and decides the winner by rows affected. Whether that is actually safe depends
on what the database does when two transactions update the same row at once —
and PostgreSQL and MySQL default to different isolation levels.

This project runs PostgreSQL. The reasoning is recorded for both because the
mechanisms differ, and "it works on Postgres" is not a reason.

## PostgreSQL — READ COMMITTED (default)

Transaction B's `UPDATE` finds the row locked by A and blocks. When A commits, B
does **not** fail and does not use its original snapshot: it re-reads the
now-committed row and **re-evaluates its `WHERE` clause** against it. `driverId`
is no longer null, the predicate no longer matches, and B reports `affected = 0`.

That re-evaluation is the entire mechanism. It is specific to `READ COMMITTED` —
under `REPEATABLE READ`, PostgreSQL raises `could not serialize access due to
concurrent update` instead, which would surface as an error rather than a clean
loss. A deployment that raised the isolation level would need the retry path
that the default does not.

## MySQL — REPEATABLE READ (default)

Correct too, by a different route. `REPEATABLE READ` in InnoDB gives *reads* a
consistent snapshot, but a `SELECT ... FOR UPDATE` or any `UPDATE` performs a
**current read** — it sees the latest committed row, not the transaction's
snapshot — and takes a lock. So B blocks, then evaluates its predicate against
the current row, and matches nothing.

Two databases, two different reasons, same outcome. Worth knowing which one you
are relying on: the same code under PostgreSQL `REPEATABLE READ` behaves
differently from MySQL `REPEATABLE READ`, despite the identical name.

## What would break it

Reading the row, deciding in application code, and writing back — under any
isolation level short of `SERIALIZABLE`. That is the original bug, and no
isolation setting available by default rescues it.

## Verification

`test/take-order-concurrency.e2e-spec.ts` fires twenty concurrent claims across
five independent orders and asserts exactly one winner each. Against the
pre-`52cf3ae` code it fails with 8–10 winners per round.

A single round was not enough: with a connection pool of ten, the reads do not
reliably all land before the first write commits, so the broken code passed
about a third of the time. **A flaky reproduction cannot distinguish "fixed"
from "got lucky".**
