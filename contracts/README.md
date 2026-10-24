# Cross-service contracts

This directory holds shared API contracts and fixtures used by FairSettle services.
`ledger-openapi.yaml` defines the agent-to-ledger contract for refund proposals,
human review and liability allocation (F14).

Amounts use integer minor units (USD cents). Liability shares use integer basis
points summing to 10000. Enums use UPPER_SNAKE literals; fields use camelCase.
The agent maps its lowercase party literals one to one to the contract enums.

API changes start here, then update both sides, as required by the root `AGENTS.md`.
The ledger's complete internal contract remains in
`ledger/docs/contracts/openapi.yaml`.

Lint the shared ledger contract from the repository root:

```bash
npx --yes @redocly/cli lint contracts/ledger-openapi.yaml
```
