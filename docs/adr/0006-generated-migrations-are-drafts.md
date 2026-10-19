# ADR 0006 — Treat generated migrations as drafts, never as artifacts

**Status**: accepted · **Relates to**: B8, B10/B11, B12, B15

## Context

Four schema changes in this project were started with
`typeorm migration:generate`. **All four produced SQL that was wrong on existing
data**, in four different ways, and only one of them failed loudly.

| Finding | Generated output | Behaviour on real data |
|---------|------------------|------------------------|
| B10/B11 enum rename | casts through `text` | **fails loudly** — `invalid input value for enum` |
| B8 many-to-many → one-to-many | adds column, copies nothing | **silently** detaches every order from its line items |
| B12 money rename | renames, does not rescale | **silently** divides every price by 100 |
| B15 timestamp → timestamptz | `DROP COLUMN` + `ADD COLUMN` | **silently** resets every timestamp to the deploy time |

The last is the worst: the resulting schema is exactly what the entities
describe, so a post-migration check finds nothing wrong.

## Decision

A generated migration is a first draft. Every one is read, and any that touches
existing rows is rewritten by hand and tested against data that resembles
production.

The rule that predicts all four failures:

> `migration:generate` diffs **schema against entities**. Moving, rescaling or
> reinterpreting the rows already in a table is not a schema difference, so it
> will never appear in the output — no matter how obvious it is to a human
> reading the change.

B12 has the sharpest version: the money amounts nested inside a `json` column
are not merely omitted from the diff, they are **undetectable** by it.

## Consequences

Every data-touching migration in `src/database/migrations/` is hand-written and
carries a comment explaining what the generator produced and why it was not
used.

Three checks, cheap enough to run every time:

1. apply to an empty database, then **regenerate** — "No changes in database
   schema were found" is the proof the migration matches the entities;
2. `migration:revert` then `migration:run` — a migration that cannot roll back
   is half a migration, and it costs one command to find out;
3. seed a row that looks like production data and assert its value survives.

Check 3 is the one that matters. Checks 1 and 2 pass happily on all four of the
broken migrations above.

Pure DDL — new tables, new indexes — needs none of this, and the generator
handles it correctly. `FulfillmentOutbox` and `OrderQueryIndexes` were used
as generated.

CI regenerates and fails if a migration appears, so an entity changed without
one is caught before a deploy rather than during it.
