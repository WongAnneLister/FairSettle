import pytest

from fairsettle_agent.clients.replay import FIXTURES_DIR, FixtureReplay

TOKEN = "t" * 40
APP_TOKEN = "app_" + "a" * 36 + "." + "b" * 43


@pytest.fixture
def fixture_names():
    return sorted(path.stem for path in FIXTURES_DIR.glob("*.json"))


@pytest.fixture
def make_replay():
    return FixtureReplay.load
