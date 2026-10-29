import os

os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
# Ryuk fails on Docker Desktop for Mac; the fixture stops the container itself.
os.environ["TESTCONTAINERS_RYUK_DISABLED"] = "true"

import socket
import uuid
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql
import pytest
from testcontainers.community.postgres import PostgresContainer

from fairsettle_agent.clients.replay import FIXTURES_DIR, FixtureReplay

TOKEN = "t" * 40
APP_TOKEN = "app_" + "a" * 36 + "." + "b" * 43


@pytest.fixture
def fixture_names():
    return sorted(path.stem for path in FIXTURES_DIR.glob("*.json"))


@pytest.fixture
def make_replay():
    return FixtureReplay.load


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse_connection(*args, **kwargs):
        raise AssertionError("network access in tests")

    monkeypatch.setattr(socket.socket, "connect", refuse_connection)


@pytest.fixture(scope="session")
def postgres_url():
    try:
        container = PostgresContainer("postgres:16", driver=None)
        container.start()
    except Exception as error:
        pytest.fail(f"F22 tests need Docker: {type(error).__name__}")
    try:
        yield container.get_connection_url()
    finally:
        container.stop()


@pytest.fixture
def database_url(postgres_url):
    name = "f22_" + uuid.uuid4().hex[:12]
    with psycopg.connect(postgres_url, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        parts = urlsplit(postgres_url)
        try:
            yield urlunsplit(parts._replace(path="/" + name))
        finally:
            connection.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
