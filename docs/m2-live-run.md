# M2 live run with PayPal (F24)

This run is performed by a human after review, on `main` with F24's work merged. It creates a real sandbox payment and refund, calls DeepSeek, and sends trace metadata to the local Langfuse. Automated checks do not run this stack or confirm F24.

## Prerequisites

- Docker Desktop running with at least 8 GB of memory.
- ngrok installed, with a public host that stays the same throughout the run.
- The F12 PayPal sandbox app and its PERSONAL buyer and BUSINESS merchant accounts.
- A DeepSeek API key.
- Ports 3000, 3001, 4000, 8000, 8080 and 8081 free. On this Mac, `redis-admin` holds 8081: stop it only with its owner's agreement.

Use one agent process. Its lock is per process; never run a second replica against this database. Keep tracing enabled for the whole deployment (KI-4).

## Prepare `.env.live`

Copy `env.live.example` to `.env.live`. The destination is gitignored; never commit it, print its contents or put credentials in a progress entry. Keep all 16 keys and fill every empty value. Compose reads the file and the Run step sources it in a shell, so no value may contain spaces, quotes, `$`, `;`, `&`, `|`, backticks or backslashes; Compose would interpolate a `$` and the shell would run what follows a `;`. This matters most for `LANGFUSE_ADMIN_PASSWORD`.

Copy `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from the root `.env` manually. They must belong to the sandbox app, never a live app. Obtain `DEEPSEEK_API_KEY` from the operator.

Generate each of `LOCAL_APP_SECRET`, `LOCAL_OPS_SECRET` and `LOCAL_AGENT_SECRET` separately with this command. Each must be 43 characters and different from the others:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
```

Generate each of `LEDGER_NOTIFICATION_SECRET`, `AGENT_SERVICE_TOKEN` and `LANGFUSE_ENCRYPTION_KEY` separately:

```bash
openssl rand -hex 32
```

Generate each of `LANGFUSE_NEXTAUTH_SECRET` and `LANGFUSE_SALT` separately:

```bash
openssl rand -base64 32
```

Generate the Langfuse project keys:

```bash
echo "pk-lf-$(openssl rand -hex 16)"
echo "sk-lf-$(openssl rand -hex 16)"
```

Set `LANGFUSE_ADMIN_EMAIL` to the administrator's email and choose a strong `LANGFUSE_ADMIN_PASSWORD`. The initialization settings create the local `fairsettle-local` project and apply only to an empty Langfuse database.

## Tunnel

```bash
ngrok http 4000
```

Put only the public host name in `PUBLIC_HOST`, for example `name.ngrok-free.dev`: no scheme, path or port. Keep the tunnel and host unchanged for the whole run. If the host changes, stop the stack, update `.env.live`, and start again.

## Start

Run from the repository root in a fresh shell. Exported variables override `.env.live` during Compose interpolation; inspect the rendered configuration locally without sharing it, because it includes secrets.

```bash
docker compose --env-file .env.live -f docker-compose.yml -f docker-compose.live.yml config
docker compose --env-file .env.live -f docker-compose.yml -f docker-compose.live.yml up -d --build --wait
docker compose --env-file .env.live -f docker-compose.yml -f docker-compose.live.yml ps
```

Always use both files. The live stack uses separate `fairsettle-live-*` data volumes and rebuilds the ledger for its fixture changes. Only the ledger calls PayPal. PayPal webhooks stay disabled; payment reads trigger capture, and the synchronous refund response drives posting. The buyer's return goes to dispatch `/checkout/success` or `/checkout/cancel`, which redirects to the storefront; capture happens when the ledger payment is read (by the script, or by the storefront's order page).

## Run

In another fresh shell at the repository root:

```bash
set -a
. ./.env.live
set +a
python3 scripts/m2_live_run.py
```

The script creates an owner, customer, driver, restaurant and a $15.00 order containing a pizza and lemonade. It prints the PayPal checkout URL. Approve with the sandbox PERSONAL account and press Enter. It waits for the ledger's signed payment notification to make the dispatch order `Paid`, delivers the order, and submits the missing-lemonade complaint.

A rerun creates a new customer, order and sandbox payment. A model escalation or decline is a failed run; do not change the proposal or checks to force a pass.

## Review

Open `http://localhost:8080/refund-proposals.html`. Sign in with:

```text
ops_10000000-0000-0000-0000-000000000062.<LOCAL_OPS_SECRET>
```

Replace the placeholder locally. Credential 61 is a viewer and cannot decide. Review the exact proposal id printed by the script, its amount, liability, explanation and cited evidence. Approve exactly as submitted. The page does not edit amounts or shares. If the response is lost, use the pending retry; it sends the same body with the same idempotency key.

The script waits up to 30 minutes for review, follows the refund, checks the liability journal and balance deltas, then prints a summary and a trace URL. Exit 0 is a passing script run; exit 1 is a failed check or error; exit 2 is an interruption, a timeout or an unexpected response shape (the summary's last line names the error type); keep the printed ids and see Troubleshooting. A sandbox answer that differs from the plan must be recorded and needs a plan amendment.

## Check

1. In the PayPal sandbox BUSINESS account, locate the $15.00 payment and refund using the printed PayPal order, capture and refund ids.
2. Check the summary's liability lines and journal id. The journal debits the liable party accounts and credits `SALES_RETURNS`; the balance deltas must match.
3. Open the printed Langfuse trace URL, sign in with `LANGFUSE_ADMIN_EMAIL`, and inspect `decide` for the cited `evidence_refs`. They must match the proposal. The trace must finish as `refunded` and contain no complaint text or explanation.

## Storefront

Open http://localhost:3001 and use 一键免密体验 to sign in as a customer. Choose a restaurant with a menu (the script's `M2 Kitchen …` works), add dishes and submit at checkout. The order page sends you to PayPal; approve with the sandbox PERSONAL account. PayPal returns through the ngrok host: on the first visit ngrok shows its browser warning, choose Visit Site. The order page reads the payment and shows 已支付 once the ledger's notification arrives. If you closed the PayPal tab instead, open the order and choose 我已完成付款，刷新状态. Orders placed here are real sandbox payments and are not checked by the script.

## Record

After the human checks all three items, start a new `docs/progress.md` entry with the output of:

```bash
python3 scripts/features.py handoff
```

Paste the script's summary and record the complaint id, proposal id and PayPal refund id. Never include credentials. Then the human runs:

```bash
python3 scripts/features.py verify F24
```

Type `F24` when prompted and include the three ids in the note. Commit the passing record as `repo: F24 passing` with `docs/features.json`, `docs/evidence/F24.log` and `docs/progress.md`.

## Troubleshooting

If dispatch never becomes `Paid`, inspect the worker log:

```bash
docker compose --env-file .env.live -f docker-compose.yml -f docker-compose.live.yml logs ledger-worker
```

Query operational fields only, never payloads:

```bash
docker compose --env-file .env.live -f docker-compose.yml -f docker-compose.live.yml exec -T -e PGOPTIONS='-c default_transaction_read_only=on' ledger-postgres psql -U postgres -d payments_ledger -c "SELECT e.id AS event_id, e.event_type, e.occurred_at, t.id AS task_id, t.status, t.attempt_count, t.available_at, t.last_reason, t.last_status FROM platform.outbox_event e LEFT JOIN platform.delivery_task t ON t.event_id = e.id ORDER BY e.occurred_at DESC LIMIT 10"
```

No row: the worker has not consumed the event; check Kafka and `kafka-init`. `HELD` with a target or key reason: check `PUBLIC_HOST`, the target row or `MERCHANT_NOTIFICATION_KEY_DISPATCH`. `READY` or `DEAD` with `last_status` 401: the signing secrets differ. `HELD` with `INVALID_DESTINATION` while the target row and `MERCHANT_NOTIFICATION_ALLOWED_HOSTS` are right: the public host resolves to a non-public address, usually a local proxy's fake-IP DNS (`198.18.0.0/15`); check with `docker compose --env-file .env.live -f docker-compose.yml -f docker-compose.live.yml exec -T ledger-worker getent ahostsv4 <PUBLIC_HOST>`, make the proxy return the real address for `*.ngrok-free.dev` (for example Shadowrocket's `always-real-ip`), and wait: held tasks are checked again after 60 seconds. See `ledger/docs/runbook/merchant-notifications.md` for the operational fields and task states.

A refund stuck `SUBMITTED` or `UNKNOWN` is KI-1. Never resend it; follow `docs/known-issues.md` and investigate with a person.

Changing Langfuse keys after first initialization requires removing its data volumes after stopping the stack. This deletes local traces and is the operator's decision:

```bash
docker compose --env-file .env.live -f docker-compose.yml -f docker-compose.live.yml down
docker volume rm fairsettle-live-langfuse-postgres fairsettle-live-langfuse-clickhouse fairsettle-live-langfuse-s3
```

If configuration values differ from `.env.live`, use a fresh shell and check `config`: exported variables override the env file. Local fixture provisioning refuses changed secrets or a database previously provisioned in FAKE mode; it never rotates credentials or changes provider bindings.

## Cleanup

```bash
docker compose --env-file .env.live -f docker-compose.yml -f docker-compose.live.yml down
```

This keeps volumes. Stop ngrok. Deleting any `fairsettle-live-*` volumes is the operator's decision.
