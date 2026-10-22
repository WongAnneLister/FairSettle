# F__ · <title>

## Goal

Behavior (copied from docs/features.json):

Verification (copied from docs/features.json):

## Existing code to follow

- `path/to/File.java`: what to copy from it (structure, naming, error handling)

## Changes

One entry per file. New files first, then modified files.

### `path/to/NewFile.java` (new)

- Class / method signatures:
- What each method does, including failure behavior:

### `path/to/Existing.java` (modified)

- What changes and why:

## Tests

Write these first and confirm they fail before implementing.

| Test | Setup | Action | Expected |
| --- | --- | --- | --- |
| | | | |

Cover the failure paths, not only the happy path: retries, timeouts, duplicates, invalid input.

## Out of scope

- Files and modules this feature must not touch:
- Behavior that belongs to a later feature:

## Risks

- What could go wrong against the real API or the real data, and how the plan handles it:

## Steps

Ordered. Three commits per feature (AGENTS.md): this plan, one work commit, one passing record.

1. `python scripts/features.py start <ID>`. Do not commit yet.
2. Write the tests; confirm they fail. Do not commit yet.
3. Implement until the verification command and the service's test suite are green. Commit everything from steps 1–3: `<service>: <what> (<ID>)`.
4. `python scripts/features.py verify <ID>`, then the progress log entry. Commit `docs/features.json`, `docs/evidence/` and `docs/progress.md`: `repo: <ID> passing`.

## Deviations

Filled in during review: what changed from this plan, why, and in which commit.
