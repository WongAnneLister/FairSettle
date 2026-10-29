import asyncio
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal, cast

import httpx
import litellm
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.types import Command, StateSnapshot
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .clients import DispatchClient, LedgerClient
from .clients.errors import ClientError
from .complaint import ComplaintInput
from .decide import Completion
from .execution import refund_outcome, refund_resume_value
from .gather import DispatchReader
from .graph import AgentLedger, GraphDeps, SubmitDeferred, build_graph
from .model import ModelConfig
from .policy import PolicyConfig
from .store import ComplaintStore
from .tracing import Tracing, TracingConfig

RunStatusName = Literal["running", "submit_retry", "awaiting_review", "approved", "rejected", "declined", "escalated", "refunded", "refund_failed"]


@dataclass(frozen=True)
class RunStatus:
    complaint_id: str
    thread_id: str
    status: RunStatusName
    proposal_id: str | None


class DuplicateComplaint(Exception):
    pass


class ThreadStateError(Exception):
    pass


@dataclass(frozen=True)
class AgentConfig:
    database_url: str = field(repr=False)
    dispatch_base_url: str
    dispatch_service_token: str = field(repr=False)
    ledger_base_url: str
    ledger_app_token: str = field(repr=False)
    model: ModelConfig
    tracing: TracingConfig | None

    def __repr__(self) -> str:
        return (
            f"AgentConfig(database_url=<set>, dispatch_base_url={self.dispatch_base_url!r}, "
            f"dispatch_service_token=<set>, ledger_base_url={self.ledger_base_url!r}, "
            f"ledger_app_token=<set>, model={self.model!r}, tracing={self.tracing!r})"
        )

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "AgentConfig":
        names = (
            "FAIRSETTLE_DATABASE_URL", "DISPATCH_BASE_URL", "AGENT_SERVICE_TOKEN",
            "LEDGER_BASE_URL", "LEDGER_APP_TOKEN",
        )
        for name in names:
            if not env.get(name):
                raise ValueError(f"{name} is required")
        mode = env.get("FAIRSETTLE_TRACING", "on")
        if mode not in ("on", "off"):
            raise ValueError("FAIRSETTLE_TRACING must be on or off")
        tracing = None
        if mode == "on":
            tracing_names = ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL")
            for name in tracing_names:
                if not env.get(name):
                    raise ValueError(f"{name} is required")
            tracing = TracingConfig(*(env[name] for name in tracing_names))
        return cls(*(env[name] for name in names), model=ModelConfig.from_env(env), tracing=tracing)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Agent:
    def __init__(
        self, *, store: ComplaintStore, checkpointer: BaseCheckpointSaver,
        dispatch: DispatchReader, ledger: AgentLedger, model: ModelConfig, tracing: Tracing,
        policy: PolicyConfig = PolicyConfig(), complete: Completion = litellm.acompletion,
        now: Callable[[], datetime] = utc_now, max_submit_attempts: int = 3,
    ) -> None:
        if type(max_submit_attempts) is not int or max_submit_attempts < 1:
            raise ValueError("max_submit_attempts must be an integer of at least 1")
        self._store = store
        self._ledger = ledger
        self._now = now
        self._tracing = tracing
        self._lock = asyncio.Lock()
        self._graph = build_graph(GraphDeps(
            store, dispatch, ledger, model, policy, complete, max_submit_attempts, tracing,
        )).compile(checkpointer=checkpointer)

    @staticmethod
    def _config(complaint_id):
        return {"configurable": {"thread_id": complaint_id}}

    @property
    def tracing(self) -> Tracing:
        return self._tracing

    async def start(self, complaint: ComplaintInput) -> RunStatus:
        async with self._lock:
            received_at = self._now()
            if not await self._store.register(complaint.complaint_id, complaint.order_id, received_at):
                raise DuplicateComplaint(complaint.complaint_id)
            try:
                with self._tracing.invocation(complaint.complaint_id, "start"):
                    await self._graph.ainvoke(
                        {"complaint": complaint.model_dump(mode="json"), "received_at": received_at.isoformat()},
                        self._config(complaint.complaint_id), durability="sync",
                    )
            except SubmitDeferred:
                pass
            return await self.status(complaint.complaint_id)

    async def poll(self) -> list[RunStatus]:
        async with self._lock:
            changed = []
            for row in await self._store.resumable():
                config = self._config(row.complaint_id)
                before = await self.status(row.complaint_id)
                if row.status in ("submitting", "submit_retry"):
                    state = await self._graph.aget_state(config)
                    if state.next != ("submit",):
                        raise ThreadStateError(row.complaint_id, "not waiting to submit")
                    try:
                        with self._tracing.invocation(row.complaint_id, "retry_submit"):
                            await self._graph.ainvoke(None, config, durability="sync")
                    except SubmitDeferred:
                        pass
                elif row.status == "approved":
                    state = await self._graph.aget_state(config)
                    if state.next != ("await_refund",):
                        raise ThreadStateError(row.complaint_id, "not waiting for refund")
                    try:
                        refund = await self._ledger.get_refund(state.values["review"]["refund_id"])
                    except ClientError:
                        continue
                    if refund_outcome(refund) == "waiting":
                        continue
                    with self._tracing.invocation(row.complaint_id, "resume_refund"):
                        await self._graph.ainvoke(Command(resume=refund_resume_value(refund)), config, durability="sync")
                else:
                    try:
                        proposal = await self._ledger.get_proposal(row.proposal_id)
                    except ClientError:
                        continue
                    if proposal.complaint_id != row.complaint_id:
                        raise ThreadStateError(row.complaint_id, "proposal belongs to another complaint")
                    if proposal.status == "PENDING_REVIEW":
                        continue
                    state = await self._graph.aget_state(config)
                    if state.next != ("await_review",):
                        raise ThreadStateError(row.complaint_id, "not waiting for review")
                    review = {
                        "status": str(proposal.status), "refund_id": proposal.refund_id,
                        "rejection_reason": proposal.rejection_reason,
                        "reviewed_at": proposal.reviewed_at.isoformat(),
                    }
                    with self._tracing.invocation(row.complaint_id, "resume_review"):
                        await self._graph.ainvoke(Command(resume=review), config, durability="sync")
                after = await self.status(row.complaint_id)
                if after != before:
                    changed.append(after)
            return changed

    async def running(self) -> list[str]:
        return await self._store.running()

    async def status(self, complaint_id: str) -> RunStatus | None:
        row = await self._store.get(complaint_id)
        if row is None:
            return None
        status = "submit_retry" if row.status == "submitting" else row.status
        return RunStatus(row.complaint_id, row.complaint_id, cast(RunStatusName, status), row.proposal_id)

    async def state(self, complaint_id: str) -> StateSnapshot:
        return await self._graph.aget_state(self._config(complaint_id))


@asynccontextmanager
async def open_persistence(database_url: str) -> AsyncIterator[tuple[ComplaintStore, AsyncPostgresSaver]]:
    pool = AsyncConnectionPool(database_url, kwargs={
        "autocommit": True, "prepare_threshold": 0, "row_factory": dict_row,
    }, open=False)
    try:
        await pool.open(wait=True, timeout=10)
        saver = AsyncPostgresSaver(pool)
        await saver.setup()
        store = ComplaintStore(pool)
        await store.setup()
        yield store, saver
    finally:
        await pool.close()


@asynccontextmanager
async def open_agent(config: AgentConfig, *, complete: Completion = litellm.acompletion) -> AsyncIterator[Agent]:
    tracing = Tracing.off() if config.tracing is None else Tracing.from_config(config.tracing)
    try:
        async with open_persistence(config.database_url) as (store, saver):
            async with (
                httpx.AsyncClient(base_url=config.dispatch_base_url, timeout=10.0) as dispatch_http,
                httpx.AsyncClient(base_url=config.ledger_base_url, timeout=10.0) as ledger_http,
            ):
                yield Agent(
                    store=store, checkpointer=saver,
                    dispatch=DispatchClient(dispatch_http, config.dispatch_service_token),
                    ledger=LedgerClient(ledger_http, config.ledger_app_token),
                    model=config.model, complete=complete, tracing=tracing,
                )
    finally:
        tracing.shutdown()
