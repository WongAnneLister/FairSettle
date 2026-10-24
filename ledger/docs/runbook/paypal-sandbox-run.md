# PayPal sandbox run (F12)

## Prerequisites

- JDK 21 and Docker.
- An ngrok account with its authtoken configured.
- The F02 sandbox app, a sandbox PERSONAL buyer account, and the sandbox BUSINESS merchant account. Find the accounts at developer.paypal.com → Testing Tools → Sandbox Accounts.
- Fill in the repository-root `.env` locally. User-filled keys are `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `LOCAL_APP_SECRET`, and `LOCAL_OPS_SECRET`. Generate each of the last two independently with:

  ```bash
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
  ```

Keep credentials local. The PayPal and fixture keys are documented in [`ledger/.env.example`](../../.env.example). For this run, set `PAYPAL_ENABLED=true`, `PAYPAL_WEBHOOK_ENABLED=true`, and `LOCAL_FIXTURES_ENABLED=true`. Use `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com` and the fixed fixture scope:

```dotenv
PAYPAL_ORGANIZATION_ID=10000000-0000-0000-0000-000000000001
PAYPAL_ENVIRONMENT_ID=10000000-0000-0000-0000-000000000011
PAYPAL_PROVIDER_ACCOUNT_ID=10000000-0000-0000-0000-000000000021
```

The script uses only the local ledger and read-only database queries. The ledger alone calls PayPal. The fixture price is 10000 USD cents and the partial refund is 2500 cents; revenue share stays enabled.

## Database

```bash
cd ledger && docker compose up -d postgres
```

The fixture database must be empty or already provisioned in PayPal mode with matching credentials. A database provisioned as `FAKE` makes the API refuse startup with `Existing fixture provider differs; recreate the local database`. Recreating it with `docker compose down -v` deletes all local ledger data; that is the operator's decision.

If port 5432 is taken, set `DB_PORT` in the root `.env` and in the Compose call, for example `DB_PORT=5433 docker compose up -d postgres`. Keep the database credentials consistent with the local Compose configuration. The script defaults to container `pl-postgres`, database `payments_ledger`, and user `postgres`; override with `F12_DB_CONTAINER`, `DB_NAME`, and `DB_SUPERUSER` if needed.

## Webhook registration

```bash
ngrok http 8080
```

In the sandbox app, choose Webhooks → Add Webhook. Set the URL to `https://<ngrok-domain>/webhooks/paypal` and select only `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED`. Copy the Webhook ID into `PAYPAL_WEBHOOK_ID` in the root `.env`.

A free ngrok domain changes on every restart, so re-register the webhook then. Restart the API after changing its webhook ID. Do not use the dashboard's Webhooks Simulator: simulated events cannot pass `verify-webhook-signature`.

## Start

From the repository root, in two terminals, load the root `.env` before starting each process:

```bash
set -a; . ./.env; set +a
cd ledger && ./mvnw spring-boot:run -Dspring-boot.run.profiles=api,local
```

```bash
set -a; . ./.env; set +a
cd ledger && LOCAL_FIXTURES_ENABLED=false ./mvnw spring-boot:run -Dspring-boot.run.profiles=worker
```

Wait for `http://localhost:8080/actuator/health` and `http://localhost:8081/actuator/health` to report `UP`. Use the configured `API_PORT` and `WORKER_PORT` if different.

## Run

In another terminal at the repository root:

```bash
set -a; . ./.env; set +a
python3 ledger/scripts/paypal_sandbox_run.py
```

Open the printed approval URL and approve with the sandbox PERSONAL account when prompted. Press Enter after approval. The script waits for capture posting, the worker's partial refund, and both webhooks. Webhooks can take up to ten minutes. It checks that both balance transactions are posted once, that the account has exactly two PSP funds entries, that balances rebuild correctly and sum to zero, and that the effective share is 1125 cents.

A failed check is a failed run. If the sandbox differs from the fixtures, stop and record the observation; fixing it requires a plan amendment. Ctrl-C or a timeout prints the IDs known so far and returns exit code 2.

## Check

Sign in to sandbox.paypal.com with the BUSINESS account. Confirm the $100.00 payment and $25.00 refund with the same IDs printed by the script. This is manual verification step 1.

## Record

Paste the script's summary into the `docs/progress.md` entry, starting with the output of `python3 scripts/features.py handoff`. Include the merchant-account check and any differences from the fixtures, including `custom_id` echoes, capture/refund breakdowns, webhook verification, and the real `PAYMENT.CAPTURE.REFUNDED` shape.

After review, the human runs `python3 scripts/features.py verify F12` in a terminal and types `F12`. Put the order, capture, and refund IDs in the note field. F12 is manual; an agent does not confirm it. Follow the plan's separate ADR and passing-record commit steps where applicable.

## Cleanup

Stop both ledger processes and ngrok. Optionally delete the webhook in the sandbox dashboard.
