"""Agent contract seam (spec 01 Testing Decisions).

Tests drive the agent service through its HTTP API only. Gemini, Agent Search and
Places are replaced by fakes at their adapters.
"""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker

from findyourdent_agent.adapters import Adapters
from findyourdent_agent.adapters.fakes import (
    FakeAgentSearchAdapter,
    FakeGeminiAdapter,
    FakePlacesAdapter,
)
from findyourdent_agent.app import create_app
from findyourdent_agent.data import contracts_dir


@pytest.fixture(scope="session")
def response_validator() -> Draft202012Validator:
    """Validates a body against the shared guidance-response.schema.json."""
    path = contracts_dir() / "schemas" / "guidance-response.schema.json"
    schema = json.loads(path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


@pytest.fixture
def fake_gemini() -> FakeGeminiAdapter:
    return FakeGeminiAdapter()


@pytest.fixture
def fake_agent_search() -> FakeAgentSearchAdapter:
    return FakeAgentSearchAdapter()


@pytest.fixture
def fake_places() -> FakePlacesAdapter:
    return FakePlacesAdapter()


@pytest.fixture
def client(
    fake_gemini: FakeGeminiAdapter,
    fake_agent_search: FakeAgentSearchAdapter,
    fake_places: FakePlacesAdapter,
) -> Iterator[TestClient]:
    app = create_app(
        Adapters(gemini=fake_gemini, agent_search=fake_agent_search, places=fake_places)
    )
    with TestClient(app) as test_client:
        yield test_client
