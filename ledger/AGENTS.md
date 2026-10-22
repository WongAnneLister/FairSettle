# Ledger

Payments gateway and double-entry ledger. Modular monolith: one build, two runtime roles (API and Worker) sharing one PostgreSQL transaction domain.

Read before changing anything here: `docs/ledger/` (accounts, the seven invariants, worked examples), `docs/state-machines/`, `docs/adr/`, `docs/contracts/` (provider port). Root `docs/adr/paypal-state-mapping.md` is the source for PayPal behavior.

## Commands

- JDK 21 is required (`java -version` must print 21.x). Use the Maven Wrapper; no global Maven.
- Unit tests: `./mvnw test`. One class: `./mvnw -q -Dtest='ClassName' test`.
- Full build with integration tests: `./mvnw verify`. Needs Docker running (PostgreSQL, Redis, Kafka).
- Format before every commit: `./mvnw spotless:apply`. CI fails on `spotless:check`.
- Run: a profile is mandatory, the process fails fast without one.
  - API: `./mvnw spring-boot:run -Dspring-boot.run.profiles=api` (port 8080)
  - Worker: `./mvnw spring-boot:run -Dspring-boot.run.profiles=worker` (port 8081)

## Where things live (`src/main/java/com/paymentsledger/`)

| Package | Role |
| --- | --- |
| `provider` | Provider port plus Fake and Stripe adapters. The PayPal adapter goes here, following the Stripe adapter's structure |
| `payment` | Business orders and payments, payment state machine |
| `refund` | Refund limits, reservations, recovery |
| `ledger` | Immutable double-entry ledger; the only posting entry point |
| `notification` | Outbox, Kafka, merchant notifications |
| `ops` | Ops API, approvals, independent review |
| `identity` | Trusted identity and account scope |
| `dispute`, `payout`, `financialingestion`, `revenueshare`, `reconciliation` | Do not change unless the active feature names them (F17 may touch refund-related parts of `revenueshare`) |

## Invariants that must never break

- All postings go through the ledger's posting service. Never write ledger, voucher or entry tables directly.
- The runtime database role (`payments_app`) is INSERT-only on ledger events, vouchers and entries. Balances change only through the controlled database functions. Never grant it UPDATE or DELETE; schema and grants change only in migrations run by the migration role.
- Startup refuses live credentials. Keep that true for PayPal: refuse any base URL that is not the sandbox.
- API keys, client secrets, full tokens, card data and bank fields never reach logs.
- An unknown provider outcome becomes UNKNOWN and is resolved by querying the provider, never by resending the write.
- Money is integer minor units; never `double` or `float`.

## Testing notes

- Integration tests use a real PostgreSQL; do not replace them with mocks to make something pass.
- A passing local fixture is not proof of the real provider contract. Real sandbox checks are manual features (F12, F24).
- `docs/adr/paypal-samples/` at the repository root holds real sandbox responses; use them as fixtures for PayPal adapter tests.
