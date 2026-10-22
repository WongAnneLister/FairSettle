# FairSettle

AI refund and liability settlement for delivery marketplaces, on PayPal.
An agent proposes how much to refund and who pays; the ledger is the only component that moves money.

This file is read by every coding agent (Codex reads it directly; Claude Code imports it from CLAUDE.md).

## Layout

| Path | What | Stack | Ports |
| --- | --- | --- | --- |
| `ledger/` | Payments ledger: double-entry, payment/refund state machines, PayPal and Stripe adapters, ops console | Java 21, Spring Boot, PostgreSQL, Kafka, Redis | API 8080, worker 8081 |
| `dispatch/` | Order and dispatch API: orders, couriers, fulfillment | NestJS, TypeORM, PostgreSQL, Redis | 4000 |
| `agent/` | Refund and liability agent | Python, LangGraph, LiteLLM, Langfuse | 8000, UI 7860 |
| `contracts/` | Cross-service API contracts and shared fixtures | OpenAPI, JSON | |
| `docs/` | PRD, ADRs, plans, feature list, progress log | | |

## Hard rules

- Money is integer cents everywhere. Liability splits are basis points summing to 10000.
- The agent never calls PayPal and holds no payment credentials. Only the ledger calls PayPal.
- Do not change the ledger's dispute, payout, BT import or revenue-share accrual modules unless the active feature says so.
- A change to an API between services starts in `contracts/`, then both sides.
- Sandbox only. Never put credentials in code, logs or commits.

## Feature list and gate

`docs/features.json` is the single source of truth for what is done. Chat history, TODO comments and `docs/progress.md` are not.

- Only `python3 scripts/features.py` changes a feature's state (`start`, `verify`, `block`). Never edit `docs/features.json` or `docs/evidence/` any other way, and never delete a feature.
- Exactly one feature is active at a time.
- Only `verify` sets a feature to passing, and it refuses to run with uncommitted changes. Commit first, then verify, then commit `docs/features.json` and `docs/evidence/`.
- Never change a feature's verification command, and never weaken a test's assertions to make it pass. If either looks wrong, stop and say why.
- Features with `"kind": "manual"` need a human; do not try to confirm them.
- Commit messages: `<service>: <what> (<ID>)`, e.g. `ledger: capture PayPal order (F06)`. Review fixes add `, review fix`.
- Before each commit, check `git diff --stat` for files outside the active feature's service.

## Roles

Work on a feature goes through four steps. Each step is a separate session.

1. **Plan** (Claude Code): writes `docs/plans/<ID>.md` from `docs/plans/TEMPLATE.md`. No production code.
2. **Implement** (Codex): follows the plan exactly. Tests first, watch them fail, then implementation. Small commits.
3. **Review** (Claude Code, fresh session): compares `git diff` with the plan. Fixes small issues that need no design decision, each as its own commit marked `review fix`, and records it under "Deviations" in the plan. Lists design issues without fixing them.
4. **Verify**: `python3 scripts/features.py verify <ID>`.

If you are implementing and the plan is wrong, incomplete or does not work against the real code: stop, explain what you found, and do not redesign on your own.

## End of session

Append an entry to `docs/progress.md` using its template, starting with the output of `python3 scripts/features.py handoff`.
