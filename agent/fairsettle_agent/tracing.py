from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Literal, Protocol

from langfuse import Langfuse, propagate_attributes
from opentelemetry.sdk.trace import TracerProvider

InvocationName = Literal["start", "retry_submit", "resume_review", "resume_refund"]


class Stage(Protocol):
    def update(self, **fields) -> None: ...


class _NoopStage:
    def update(self, **fields) -> None:
        pass


@dataclass(frozen=True)
class TracingConfig:
    public_key: str
    secret_key: str = field(repr=False)
    base_url: str

    def __repr__(self) -> str:
        return f"TracingConfig(public_key={self.public_key!r}, secret_key=<set>, base_url={self.base_url!r})"


class Tracing:
    def __init__(self, langfuse: Langfuse | None) -> None:
        self._langfuse = langfuse

    @classmethod
    def off(cls) -> "Tracing":
        return cls(None)

    @classmethod
    def from_config(cls, config: TracingConfig) -> "Tracing":
        return cls(Langfuse(
            public_key=config.public_key, secret_key=config.secret_key, base_url=config.base_url,
            tracer_provider=TracerProvider(),
        ))

    @property
    def enabled(self) -> bool:
        return self._langfuse is not None

    @staticmethod
    def trace_id(complaint_id: str) -> str:
        return Langfuse.create_trace_id(seed=complaint_id)

    @contextmanager
    def invocation(self, complaint_id: str, name: InvocationName) -> Iterator[None]:
        if self._langfuse is None:
            yield
            return
        with propagate_attributes(session_id=complaint_id, trace_name="complaint"):
            with self._langfuse.start_as_current_observation(
                trace_context={"trace_id": self.trace_id(complaint_id)}, name=name,
                metadata={"complaint_id": complaint_id},
            ):
                yield

    @contextmanager
    def stage(self, name: str, *, as_type: Literal["span", "generation"] = "span", **fields) -> Iterator[Stage]:
        if self._langfuse is None:
            yield _NoopStage()
            return
        with self._langfuse.start_as_current_observation(name=name, as_type=as_type, **fields) as observation:
            yield observation

    def flush(self) -> None:
        if self._langfuse is not None:
            self._langfuse.flush()

    def shutdown(self) -> None:
        if self._langfuse is not None:
            self._langfuse.shutdown()
