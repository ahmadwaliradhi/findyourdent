"""Production adapters. Each ticket fills in one adapter behind the same port; the ones
still raising NotImplementedError are placeholders.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from google import genai
from google.genai import types

from ..config import Settings
from . import Adapters


@dataclass
class GoogleGeminiAdapter:
    """Gemini through google-genai on Vertex AI, global endpoint (ADR-0003)."""

    settings: Settings
    _client: genai.Client | None = field(default=None, init=False, repr=False)

    def _vertex(self) -> genai.Client:
        # Built on first use so the service starts without credentials (tests, local dev).
        if self._client is None:
            self._client = genai.Client(
                vertexai=True,
                project=self.settings.google_cloud_project,
                location=self.settings.google_cloud_location,
            )
        return self._client

    async def generate_structured(
        self,
        *,
        model: str,
        instruction: str,
        contents: list[Any],
        response_schema: dict[str, Any],
        temperature: float,
    ) -> dict[str, Any]:
        response = await self._vertex().aio.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=instruction,
                temperature=temperature,
                response_mime_type="application/json",
                response_json_schema=response_schema,
            ),
        )
        if not response.text:
            raise ValueError("Gemini returned no text")
        return json.loads(response.text)


@dataclass(frozen=True, slots=True)
class VertexAgentSearchAdapter:
    settings: Settings

    async def search(self, query: str, *, max_results: int = 5) -> list[dict[str, Any]]:
        raise NotImplementedError("Agent Search grounding lands in a later ticket (spec 01)")


@dataclass(frozen=True, slots=True)
class GooglePlacesAdapter:
    settings: Settings

    async def nearby(
        self,
        *,
        latitude: float,
        longitude: float,
        provider_type: str,
        max_results: int = 5,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError("Places lookups land in a later ticket (spec 02)")


def production_adapters(settings: Settings) -> Adapters:
    return Adapters(
        gemini=GoogleGeminiAdapter(settings),
        agent_search=VertexAgentSearchAdapter(settings),
        places=GooglePlacesAdapter(settings),
    )
