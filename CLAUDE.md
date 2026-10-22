# FairSettle

AI refund and liability settlement for delivery marketplaces, on PayPal.
An agent proposes how much to refund and who pays; the ledger is the only component that moves money.

## Layout

| Path | What | Stack | Ports |
| --- | --- | --- | --- |
| `ledger/` | Payments ledger: double-entry, payment/refund state machines, PayPal and Stripe adapters, ops console | Java 21, Spring Boot, PostgreSQL, Kafka, Redis | API 8080, worker 8081 |
| `dispatch/` | Order and dispatch API: orders, couriers, fulfillment | NestJS, TypeORM, PostgreSQL, Redis | 4000 |
| `agent/` | Refund and liability agent | Python, LangGraph, LiteLLM, Langfuse | 8000, UI 7860 |
| `contracts/` | Cross-service API contracts and shared fixtures | OpenAPI, JSON | |
| `docs/` | PRD, ADRs, feature list, progress log | | |

Each service has its own `CLAUDE.md` with build and test commands.

## Hard rules

- Money is integer cents everywhere. Liability splits are basis points summing to 10000.
- The agent never calls PayPal and holds no payment credentials. Only the ledger calls PayPal.
- Do not change the ledger's dispute, payout, BT import or revenue-share accrual modules unless the active feature says so.
- A change to an API between services starts in `contracts/`, then both sides.
- Sandbox only. Never put credentials in code, logs or commits.

## Feature workflow (read before every session)

`docs/features.json` is the single source of truth for what is done. Chat history, TODO comments and `docs/progress.md` are not.

1. Run `python3 scripts/features.py status`, then `next`.
2. Work on exactly one feature. Start it with `python3 scripts/features.py start <ID>`.
3. Before coding, read the feature's `behavior` and `verification`. If the verification names a test that does not exist yet, write that test first and watch it fail.
4. Implement in small commits. Commit message: `<service>: <what> (<ID>)`, for example `ledger: capture PayPal order (F06)`.
5. When done, commit everything, then run `python3 scripts/features.py verify <ID>`. Only this command may set a feature to passing. Then commit `docs/features.json` and `docs/evidence/`.
6. If verification fails, fix and verify again. Do not change the verification command to make it pass; if it is genuinely wrong, stop and ask.
7. If you cannot finish, run `python3 scripts/features.py block <ID> "<reason>"` and say exactly where you stopped.
8. Features with `"kind": "manual"` need a human; the script refuses to run them non-interactively. Tell the user what to check.
9. End of session: append an entry to `docs/progress.md` using its template, starting with the output of `python3 scripts/features.py handoff`.

Never edit `docs/features.json` or `docs/evidence/` by hand or through a shell command. Never delete a feature; block it instead.
Before each commit, check `git diff --stat` for files outside the active feature's service.
