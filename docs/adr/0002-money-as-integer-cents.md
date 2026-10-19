# ADR 0002 — Store money as integer cents

**Status**: accepted · **Finding**: [B12](../AUDIT.md#b12--money-is-stored-as-an-integer-but-exposed-as-a-float) · **Commit**: `2b9771d`

## Context

`Dish.price` was a bare `@Column()` over a TypeScript `number`, which TypeORM
infers as `integer`. `Order.total` was exposed to GraphQL as a `Float` over the
same integer representation.

So the API advertised decimals the storage could not hold. $12.50 was stored as
12, and no error was raised at any layer.

## Decision

Integer cents, with the unit in the field name: `priceCents`, `totalCents`,
`extraCents`.

## Alternatives

**`numeric(10,2)`** — exact, and the most literal fix. Rejected because
node-postgres returns `numeric` as a *string* to avoid precision loss, so every
read site needs a transformer or a parse, and any site that forgets silently
gets string concatenation instead of addition. Trading one silent numeric bug
for another is not an improvement.

**`float`/`double`** — rejected outright. `0.1 + 0.2` is the reason.

**A money value object** — the right answer in a larger system, and
over-engineering here. The unit in the name gets most of the benefit at none of
the cost.

## Consequences

Arithmetic is integer arithmetic, exact by construction and never a float.

Formatting moves to the presentation layer, which is where currency formatting
belongs anyway.

**The naming is load-bearing.** A column called `price` tells a reader nothing
about whether 1250 means twelve dollars or twelve hundred, and that ambiguity is
exactly what let a `Float` sit on top of an `int` for the life of the project
without anyone noticing.
