# FairSettle Agent

The agent proposes refund amounts and liability splits for delivery marketplaces. Only the ledger moves money. The agent never calls PayPal and holds no payment credentials.

## Commands

- Setup: `uv sync --python 3.11`, then `source .venv/bin/activate`.
- Tests: `python -m pytest -q`.

## Where things live

- `fairsettle_agent/clients/`: typed dispatch and ledger clients (F19).
- `../contracts/dispatch-agent-operations.graphql` and `../contracts/ledger-openapi.yaml`: what the clients send.
- `../contracts/fixtures/agent/`: recorded HTTP fixtures.

## Rules

- Money is `int` cents, never `float`.
- Clients never retry and never log credentials.
- Tests never reach a network: `FixtureReplay` raises on an unrecorded request.
- Never hand-edit a recorded fixture. Re-record it as described in `../contracts/README.md`.
