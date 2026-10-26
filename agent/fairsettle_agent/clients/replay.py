from collections.abc import Iterable
from dataclasses import dataclass
import json
from pathlib import Path

import httpx

from .errors import UnrecordedRequest

FIXTURES_DIR: Path = Path(__file__).resolve().parents[3] / "contracts/fixtures/agent"


@dataclass(frozen=True)
class Recording:
    name: str
    method: str
    path: str
    operation_name: str | None
    variables: dict | None
    status: int
    body: object


def _key(method: str, path: str, operation_name: str | None, variables: dict | None) -> tuple:
    return method, path, operation_name, json.dumps(variables, sort_keys=True, separators=(",", ":"))


class FixtureReplay:
    def __init__(self, recordings: Iterable[Recording]) -> None:
        self._recordings = {}
        self._requests: list[httpx.Request] = []
        for recording in recordings:
            key = _key(recording.method, recording.path, recording.operation_name, recording.variables)
            if key in self._recordings:
                raise ValueError("Duplicate fixture match key")
            self._recordings[key] = recording

    @classmethod
    def load(cls, *names: str, directory: Path = FIXTURES_DIR) -> "FixtureReplay":
        recordings = []
        for name in names:
            value = json.loads((directory / f"{name}.json").read_text(encoding="utf-8"))
            if (not isinstance(value, dict)
                    or not {"name", "source", "request", "response"}.issubset(value)
                    or value["name"] != name):
                raise ValueError("Invalid fixture envelope")
            request, response = value["request"], value["response"]
            if (not isinstance(request, dict)
                    or not {"method", "path", "operationName", "variables"}.issubset(request)
                    or not isinstance(response, dict)
                    or not {"status", "body"}.issubset(response)):
                raise ValueError("Missing fixture exchange key")
            recordings.append(Recording(
                name=name, method=request["method"], path=request["path"],
                operation_name=request["operationName"], variables=request["variables"],
                status=response["status"], body=response["body"],
            ))
        return cls(recordings)

    @property
    def requests(self) -> list[httpx.Request]:
        return self._requests

    def transport(self) -> httpx.MockTransport:
        def handle(request: httpx.Request) -> httpx.Response:
            self._requests.append(request)
            operation_name, variables = None, None
            if request.method == "POST" and request.url.path == "/graphql":
                try:
                    body = json.loads(request.content)
                    if isinstance(body, dict):
                        operation_name, variables = body.get("operationName"), body.get("variables")
                except ValueError:
                    pass
            key = _key(request.method, request.url.path, operation_name, variables)
            recording = self._recordings.get(key)
            if recording is None:
                raise UnrecordedRequest(
                    "fixture", f"no recording for {request.method} {request.url.path} {operation_name}",
                )
            return httpx.Response(recording.status, json=recording.body)
        return httpx.MockTransport(handle)

    def client(self, base_url: str = "http://fixture.invalid") -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=base_url, transport=self.transport())
