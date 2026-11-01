# Cross-service contracts

This directory holds shared API contracts and fixtures used by FairSettle services.
`ledger-openapi.yaml` defines the agent-to-ledger contract for refund proposals,
human review and liability allocation (F14).

Dispatch checkout uses `dispatch-order` at 1 USD cent per unit, with `quantity = amountMinor` (1–10000) and a 0 bps share policy (F15).

Amounts use integer minor units (USD cents). Liability shares use integer basis
points summing to 10000. Enums use UPPER_SNAKE literals; fields use camelCase.
The agent maps its lowercase party literals one to one to the contract enums.

API changes start here, then update both sides, as required by the root `AGENTS.md`.
The ledger's complete internal contract remains in
`ledger/docs/contracts/openapi.yaml`.

`ledger-merchant-notifications.md` defines the signed ledger-to-dispatch payment notification contract (F16).
`fixtures/ledger-payment-succeeded.json` is its full-capture example for dispatch order 1 (F16).
Dispatch reads `getPayment` with its application token after the buyer returns, so the ledger captures the approved PayPal order; it never changes the order's payment status from that answer (F33).

Lint the shared ledger contract from the repository root:

```bash
npx --yes @redocly/cli lint contracts/ledger-openapi.yaml
```

- `dispatch-agent-operations.graphql`: the dispatch queries the agent sends with the read-only service token (F19).
  It also lists `deliveryFailures`: order events that moved an order to `DeliveryFailed`, after a cursor, which the agent turns into proactive cases (F25).
- `fixtures/agent/`: recorded agent fixtures. Never edit them by hand. Re-record from the repository root with:

  ```bash
  (cd dispatch && RECORD_AGENT_FIXTURES=1 npm run test:e2e -- --testPathPattern=agent-fixtures)
  (cd ledger && RECORD_AGENT_FIXTURES=1 ./mvnw -q -Dit.test='AgentFixturesHttpIT' -Dtest='NoSuchTest' -Dsurefire.failIfNoSpecifiedTests=false verify)
  ```

  Without `RECORD_AGENT_FIXTURES`, these same tests check the committed response shapes.

  The `ledger-proposal-*` fixtures record proposal creation, replay, conflict, the refund limit, and a pending, approved and rejected proposal (F22).
  `ledger-refund-reserved` records the refund an approval creates, before the worker sends it (F23).
