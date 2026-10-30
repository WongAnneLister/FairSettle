# FairSettle Agent

The agent proposes refund amounts and liability splits for delivery marketplaces. Only the ledger moves money. The agent never calls PayPal and holds no payment credentials.

## Commands

- Setup: `uv sync --python 3.11`, then `source .venv/bin/activate`.
- Tests: `python -m pytest -q`.
- Run: `python -m fairsettle_agent` serves `POST /v1/complaints`, `GET /v1/complaints/{id}` and `GET /health` on port 8000 and polls every `FAIRSETTLE_POLL_SECONDS` (default 5) in the same process; `FAIRSETTLE_HTTP_HOST` defaults to `127.0.0.1` (F24). Image: `agent/Dockerfile`; the live stack runs it (`docs/m2-live-run.md`).
- Tests that use Postgres (`tests/test_resume.py`) start `postgres:16` with Testcontainers and need Docker running; without Docker they fail, they never skip (F22). Ryuk is disabled in `tests/conftest.py` because it fails on Docker Desktop for Mac; after a hard kill, remove leftovers with `docker rm -f $(docker ps -aq --filter label=org.testcontainers.lang=python)`. Runtime: `FAIRSETTLE_DATABASE_URL`, `DISPATCH_BASE_URL`, `AGENT_SERVICE_TOKEN`, `LEDGER_BASE_URL`, `LEDGER_APP_TOKEN` from the environment (F22). The ledger token must be a credential of the application that created the payment (seeded in F24).
- Model: `FAIRSETTLE_MODEL` (default `deepseek/deepseek-flash`; evaluation and demo `deepseek/deepseek-v4-pro`) and `DEEPSEEK_API_KEY`, both from the environment, never committed (F21). Tests never call a model: they use LiteLLM `mock_response` or fake completions.
- Tracing: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` are required unless `FAIRSETTLE_TRACING=off` (F23). Tests never reach Langfuse: they inject an in-memory span exporter, with a new public key for each client, because Langfuse clients are singletons per public key.

## Where things live

- `fairsettle_agent/clients/`: typed dispatch and ledger clients (F19).
- `fairsettle_agent/decision.py`: the model's `RefundDecision` contract, schema only (F20).
- `fairsettle_agent/evidence.py`: one run's evidence and its citable ids (F20).
- `fairsettle_agent/policy.py`: the PRD's seven hard rules, pure functions; `evaluate` never changes a decision (F20).
- `fairsettle_agent/complaint.py`: the strict complaint input contract (F21).
- `fairsettle_agent/gather.py`: parallel evidence gathering, no model (F21).
- `fairsettle_agent/model.py`: prompt, evidence document, and reply parsing (F21).
- `fairsettle_agent/decide.py`: one retry, then escalate; then F20's policy (F21).
- `fairsettle_agent/proposal.py`: decision to ledger proposal request (F22).
- `fairsettle_agent/store.py`: the agent's `agent_complaint` table: complaint registry, 7-day count, run status (F22).
- `fairsettle_agent/graph.py`: the LangGraph graph (F22).
- `fairsettle_agent/agent.py`: `Agent.start` / `poll`, config, Postgres persistence (F22).
- `fairsettle_agent/execution.py`: refund outcome after approval (F23).
- `fairsettle_agent/service.py`: HTTP API and poll loop (F24).
- `fairsettle_agent/__main__.py`: entry point (F24).
- `fairsettle_agent/tracing.py`: Langfuse traces keyed by complaint id (F23).
- `../contracts/dispatch-agent-operations.graphql` and `../contracts/ledger-openapi.yaml`: what the clients send.
- `../contracts/fixtures/agent/`: recorded HTTP fixtures.

## Rules

- Money is `int` cents, never `float`.
- Policy code never changes an amount or a split; any violation escalates with every reason (PRD rule 7).
- Untrusted text (the complaint, any evidence) goes to the model only inside the data markers of `build_messages`. A failed evidence source or an invalid second reply escalates; nothing is decided on partial evidence.
- Set `LITELLM_LOCAL_MODEL_COST_MAP=True` before importing LiteLLM to use its bundled price map without a network fetch.
- Clients never retry and never log credentials.
- Graph state holds JSON values only. The node that calls `interrupt()` does nothing before it, because it runs again on resume. The only ledger write is the `submit` node, keyed `refund-proposal:<complaintId>`. Never resume a thread without checking `state.next` first.
- Tests never reach a network: `FixtureReplay` raises on an unrecorded request.
- Never hand-edit a recorded fixture. Re-record it as described in `../contracts/README.md`.
- Langfuse gets metadata only: no complaint text, model reply, explanation, evidence, rejection reason or customer id.
- Never call `Langfuse.get_trace_url`; it connects to the server.
- After approval the agent only reads the refund; the ledger executes it.
- Exactly one agent process per database: the lock that keeps `start` and `poll` apart is per process (F22). Never run a second replica.
- Keep `FAIRSETTLE_TRACING` fixed for a deployment; switching it while a complaint is `submit_retry` changes the retried body (KI-4).
- Rows left `running` by a crashed process are logged at startup and not resumed (F24).
