"""One retry for a transient Gemini failure (fyd-agent log, 18 Oct 2026).

Driven through the HTTP API with the production Gemini adapter; a stub client in
place of google-genai plays the Vertex AI answers, so there is no network.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Iterator
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from google.genai import errors

from findyourdent_agent.adapters import Adapters
from findyourdent_agent.adapters.fakes import (
    FakeAgentSearchAdapter,
    FakePlacesAdapter,
    guidance_model_output,
)
from findyourdent_agent.adapters.real import GoogleGeminiAdapter
from findyourdent_agent.app import create_app
from findyourdent_agent.config import Settings

COMPLAINT = "Gigi geraham kiri bawah nyut-nyutan sejak tiga hari, makin sakit kalau minum dingin."
GUIDANCE = {"sessionId": "sess-0001-abcd", "language": "id", "complaintText": COMPLAINT}
TESTIMONY = {
    "subjectType": "testimony",
    "language": "id",
    "text": "Dokternya ramah dan menjelaskan perawatan saluran akar dengan jelas.",
    "typedProviderName": "Klinik Gigi Senyum",
    "googleDisplayName": "Klinik Gigi Senyum Sehat",
}
PUBLISH = {
    "ruleCodes": [],
    "flaggedSpans": [],
    "flaggedPhotos": [],
    "confidence": 0.95,
    "authorMessage": "Terima kasih, testimoni Anda sudah tayang.",
    "ownHealthDataWarning": False,
    "proofOfVisit": "notProvided",
}


def _server_error(code: int) -> errors.APIError:
    return errors.ServerError(code, {"error": {"code": code, "message": "echoes the prompt"}})


def _client_error(code: int) -> errors.APIError:
    return errors.ClientError(code, {"error": {"code": code, "message": "echoes the prompt"}})


class _Hang:
    """An attempt that never answers, like the ~23 s hangs in the log."""


@dataclass
class _Vertex:
    """Plays one Vertex AI answer per attempt: an exception, a hang or a JSON body."""

    answers: list[Any]
    attempts: int = 0

    async def generate_content(self, **request: Any) -> Any:
        self.attempts += 1
        answer = self.answers.pop(0)
        if isinstance(answer, _Hang):
            await asyncio.sleep(3600)
        if isinstance(answer, BaseException):
            raise answer
        return SimpleNamespace(text=answer, candidates=[], model_version="test-model")


@dataclass
class _Harness:
    vertex: _Vertex
    adapter: GoogleGeminiAdapter
    sleeps: list[float] = field(default_factory=list)


@pytest.fixture
def vertex() -> _Vertex:
    return _Vertex(answers=[])


@pytest.fixture
def harness(vertex: _Vertex) -> _Harness:
    sleeps: list[float] = []

    async def no_wait(seconds: float) -> None:
        sleeps.append(seconds)

    adapter = GoogleGeminiAdapter(
        settings=Settings(),
        _client=SimpleNamespace(aio=SimpleNamespace(models=vertex)),  # type: ignore[arg-type]
        sleep=no_wait,
    )
    return _Harness(vertex=vertex, adapter=adapter, sleeps=sleeps)


@pytest.fixture
def api(harness: _Harness) -> Iterator[TestClient]:
    adapters = Adapters(
        gemini=harness.adapter, agent_search=FakeAgentSearchAdapter(), places=FakePlacesAdapter()
    )
    with TestClient(create_app(adapters)) as test_client:
        yield test_client


def _guidance_json() -> str:
    return json.dumps(guidance_model_output(language="id"))


@pytest.mark.parametrize(
    "failure",
    [_server_error(503), _server_error(500), httpx.ConnectError("reset"), TimeoutError()],
    ids=["503", "500", "connection", "timeout"],
)
def test_one_transient_failure_then_success_returns_guidance(
    api: TestClient, harness: _Harness, failure: BaseException
) -> None:
    harness.vertex.answers[:] = [failure, _guidance_json()]

    response = api.post("/v1/guidance", json=GUIDANCE)

    assert response.status_code == 200
    assert response.json()["kind"] == "guidance"
    assert harness.vertex.attempts == 2
    (backoff,) = harness.sleeps
    assert 0 < backoff < 1


def test_two_transient_failures_are_unavailable_as_today(
    api: TestClient, harness: _Harness
) -> None:
    harness.vertex.answers[:] = [_server_error(503), httpx.ReadTimeout("slow")]

    response = api.post("/v1/guidance", json=GUIDANCE)

    assert response.status_code == 503
    assert response.json() == {"error": "model_unavailable"}
    assert harness.vertex.attempts == 2


def test_quota_exhaustion_is_not_retried(api: TestClient, harness: _Harness) -> None:
    harness.vertex.answers[:] = [_client_error(429), _guidance_json()]

    response = api.post("/v1/guidance", json=GUIDANCE)

    assert response.status_code == 503
    assert response.json() == {"error": "model_quota_exhausted"}
    assert harness.vertex.attempts == 1
    assert harness.sleeps == []


@pytest.mark.parametrize("code", [400, 403, 404])
def test_a_client_error_is_not_retried(api: TestClient, harness: _Harness, code: int) -> None:
    harness.vertex.answers[:] = [_client_error(code), _guidance_json()]

    response = api.post("/v1/guidance", json=GUIDANCE)

    assert response.status_code == 503
    assert response.json() == {"error": "model_unavailable"}
    assert harness.vertex.attempts == 1


def test_output_that_is_not_json_is_not_retried(api: TestClient, harness: _Harness) -> None:
    harness.vertex.answers[:] = ["not json", _guidance_json()]

    response = api.post("/v1/guidance", json=GUIDANCE)

    assert response.status_code == 503
    assert response.json() == {"error": "model_unavailable"}
    assert harness.vertex.attempts == 1


def test_a_hung_attempt_leaves_time_for_the_retry_inside_the_budget(
    harness: _Harness,
) -> None:
    harness.vertex.answers[:] = [_Hang(), json.dumps({"ok": True})]

    async def call() -> tuple[dict[str, Any], float]:
        loop = asyncio.get_running_loop()
        start = loop.time()
        output = await harness.adapter.generate_structured(
            model="m", instruction="", contents=[], response_schema={}, timeout_seconds=8.0
        )
        return output, loop.time() - start

    output, elapsed = asyncio.run(call())

    assert output == {"ok": True}
    assert harness.vertex.attempts == 2
    # The hung attempt is cut at half the budget, not at the whole of it.
    assert 3.9 < elapsed < 5.0


def test_no_retry_when_too_little_budget_is_left(harness: _Harness) -> None:
    harness.vertex.answers[:] = [_server_error(503), _guidance_json()]

    with pytest.raises(Exception, match="gemini 503"):
        asyncio.run(
            harness.adapter.generate_structured(
                model="m", instruction="", contents=[], response_schema={}, timeout_seconds=2.0
            )
        )
    assert harness.vertex.attempts == 1


def test_moderation_retries_once_then_publishes(api: TestClient, harness: _Harness) -> None:
    harness.vertex.answers[:] = [_server_error(503), json.dumps(PUBLISH)]

    response = api.post("/v1/moderation", json=TESTIMONY)

    assert response.status_code == 200
    assert response.json()["decision"] == "publish"
    assert harness.vertex.attempts == 2


def test_moderation_holds_after_two_failures(api: TestClient, harness: _Harness) -> None:
    harness.vertex.answers[:] = [_server_error(503), _server_error(504)]

    response = api.post("/v1/moderation", json=TESTIMONY)

    assert response.status_code == 200
    assert response.json()["decision"] == "hold"
    assert harness.vertex.attempts == 2


def test_the_retry_is_logged_as_an_outcome_without_the_request(
    api: TestClient, harness: _Harness, caplog: pytest.LogCaptureFixture
) -> None:
    harness.vertex.answers[:] = [_server_error(503), _guidance_json()]

    with caplog.at_level(logging.INFO):
        api.post("/v1/guidance", json=GUIDANCE)

    retries = [r for r in caplog.records if getattr(r, "outcome", None) == "model_retry"]
    assert len(retries) == 1
    assert retries[0].getMessage() == "gemini retrying: gemini 503"
    assert all(
        COMPLAINT not in r.getMessage() and "echoes the prompt" not in r.getMessage()
        for r in caplog.records
    )
