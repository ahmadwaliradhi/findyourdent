"""The request the production Gemini adapter and the ADK agents send to Vertex AI.

No network: a stub client records the config the adapter builds.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import pytest
from google.genai import types

from findyourdent_agent.adapters.real import GoogleGeminiAdapter
from findyourdent_agent.agents import guidance as guidance_agent
from findyourdent_agent.agents import shortlist as shortlist_agent
from findyourdent_agent.config import Settings

SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}}


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@dataclass
class _Models:
    requests: list[dict[str, Any]] = field(default_factory=list)

    async def generate_content(self, **request: Any) -> Any:
        self.requests.append(request)
        return SimpleNamespace(text='{"ok": true}', candidates=[])


@pytest.mark.anyio
async def test_the_adapter_sends_no_temperature_to_gemini() -> None:
    # Ignored from Gemini 3.6 Flash and 3.5 Flash-Lite, and a later generation
    # rejects it with HTTP 400 (ai.google.dev/gemini-api/docs/whats-new-gemini-3.6).
    models = _Models()
    client = SimpleNamespace(aio=SimpleNamespace(models=models))
    adapter = GoogleGeminiAdapter(settings=Settings(), _client=client)  # type: ignore[arg-type]

    output = await adapter.generate_structured(
        model="gemini-3.5-flash-lite", instruction="", contents=[], response_schema=SCHEMA
    )

    assert output == {"ok": True}
    (request,) = models.requests
    config: types.GenerateContentConfig = request["config"]
    assert request["model"] == "gemini-3.5-flash-lite"
    assert config.response_json_schema == SCHEMA
    assert config.temperature is None


def test_the_adk_agents_send_no_temperature_to_gemini() -> None:
    settings = Settings()
    configs = [
        guidance_agent.generation_config(settings, SCHEMA),
        shortlist_agent.generation_config(settings),
    ]

    assert [c.temperature for c in configs] == [None, None]
    assert [c.response_json_schema for c in configs] == [
        SCHEMA,
        shortlist_agent.MODEL_OUTPUT_SCHEMA,
    ]
