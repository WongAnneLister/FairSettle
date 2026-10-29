import asyncio
from collections.abc import Callable, Mapping
from contextlib import AbstractAsyncContextManager, asynccontextmanager, suppress
from dataclasses import dataclass
import logging
from typing import Protocol

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .agent import DuplicateComplaint, RunStatus
from .complaint import ComplaintInput
from .tracing import Tracing

logger = logging.getLogger("fairsettle_agent.service")


@dataclass(frozen=True)
class ServiceConfig:
    host: str
    poll_seconds: float

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "ServiceConfig":
        try:
            seconds = float(env.get("FAIRSETTLE_POLL_SECONDS", "5"))
            if not 1 <= seconds <= 300:
                raise ValueError()
        except ValueError:
            raise ValueError("FAIRSETTLE_POLL_SECONDS must be a number from 1 to 300") from None
        return cls(env.get("FAIRSETTLE_HTTP_HOST", "127.0.0.1"), seconds)


class ServiceAgent(Protocol):
    @property
    def tracing(self) -> Tracing: ...
    async def start(self, complaint: ComplaintInput) -> RunStatus: ...
    async def status(self, complaint_id: str) -> RunStatus | None: ...
    async def poll(self) -> list[RunStatus]: ...
    async def running(self) -> list[str]: ...


def complaint_body(status: RunStatus, tracing: Tracing) -> dict:
    return {
        "complaint_id": status.complaint_id, "thread_id": status.thread_id,
        "status": status.status, "proposal_id": status.proposal_id,
        "trace_id": Tracing.trace_id(status.complaint_id) if tracing.enabled else None,
    }


async def poll_loop(agent: ServiceAgent, interval: float, *, sleep=asyncio.sleep) -> None:
    while True:
        try:
            for status in await agent.poll():
                logger.info("complaint %s is %s", status.complaint_id, status.status)
        except Exception as error:
            logger.error("poll pass failed: %s", type(error).__name__)
        await sleep(interval)


def create_app(open_agent: Callable[[], AbstractAsyncContextManager[ServiceAgent]], *,
               poll_seconds: float, sleep=asyncio.sleep) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        async with open_agent() as agent:
            app.state.agent = agent
            for complaint_id in await agent.running():
                logger.warning("complaint %s was left running by an earlier process and is not resumed", complaint_id)
            task = asyncio.create_task(poll_loop(agent, poll_seconds, sleep=sleep))
            try:
                yield
            finally:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    app = FastAPI(lifespan=lifespan)

    @app.get("/health")
    async def health():
        return {"status": "UP"}

    @app.post("/v1/complaints", status_code=201)
    async def start(complaint: ComplaintInput):
        try:
            status = await app.state.agent.start(complaint)
        except DuplicateComplaint:
            return JSONResponse({"code": "DUPLICATE_COMPLAINT"}, status_code=409)
        return complaint_body(status, app.state.agent.tracing)

    @app.get("/v1/complaints/{complaint_id}")
    async def status(complaint_id: str):
        result = await app.state.agent.status(complaint_id)
        if result is None:
            return JSONResponse({"code": "NOT_FOUND"}, status_code=404)
        return complaint_body(result, app.state.agent.tracing)

    return app
