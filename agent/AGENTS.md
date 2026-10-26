# FairSettle Agent

The agent proposes refund amounts and liability splits for delivery marketplaces. Only the ledger moves money. The agent never calls PayPal and holds no payment credentials.

## Commands

- Setup: `uv sync --python 3.11`, then `source .venv/bin/activate`.
- Tests: `python -m pytest -q`.

## Where things live

- `fairsettle_agent/clients/`: typed dispatch and ledger clients (F19).
- `fairsettle_agent/decision.py`: the model's `RefundDecision` contract, schema only (F20).
- `fairsettle_agent/evidence.py`: one run's evidence and its citable ids (F20).
- `fairsettle_agent/policy.py`: the PRD's seven hard rules, pure functions; `evaluate` never changes a decision (F20).
- `../contracts/dispatch-agent-operations.graphql` and `../contracts/ledger-openapi.yaml`: what the clients send.
- `../contracts/fixtures/agent/`: recorded HTTP fixtures.

## Rules

- Money is `int` cents, never `float`.
- Policy code never changes an amount or a split; any violation escalates with every reason (PRD rule 7).
- Clients never retry and never log credentials.
- Tests never reach a network: `FixtureReplay` raises on an unrecorded request.
- Never hand-edit a recorded fixture. Re-record it as described in `../contracts/README.md`.
