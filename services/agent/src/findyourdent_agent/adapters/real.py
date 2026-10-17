"""Production adapters. Each ticket fills in one adapter behind the same port; the
ones still raising NotImplementedError are not called by any endpoint yet.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import cached_property
from typing import Any

import httpx
from google import genai
from google.genai import errors, types

from ..config import Settings
from . import Adapters, ModelQuotaExhaustedError, ModelUnavailableError
from .fakes import CannedGeminiAdapter


@dataclass
class GoogleGeminiAdapter:
    """Gemini through google-genai on Vertex AI, global endpoint (ADR-0003).

    Structured output, low temperature, and ``max_output_tokens`` on every call: output
    tokens have no daily quota and thinking tokens count as output. RESOURCE_EXHAUSTED
    (HTTP 429) means the daily input-token cap is reached (infra/gcp/README.md).
    """

    settings: Settings
    _client: genai.Client | None = field(default=None, repr=False)

    @cached_property
    def client(self) -> genai.Client:
        return self._client or genai.Client(
            vertexai=True,
            project=self.settings.google_cloud_project,
            location=self.settings.google_cloud_location,
            # Below the web service's 30 s agent timeout, so the Patient gets a retry state.
            http_options=types.HttpOptions(timeout=25_000),
        )

    async def generate_structured(
        self,
        *,
        model: str,
        instruction: str,
        contents: list[Any],
        response_schema: dict[str, Any],
    ) -> dict[str, Any]:
        config = types.GenerateContentConfig(
            system_instruction=instruction,
            temperature=self.settings.guidance_temperature,
            max_output_tokens=self.settings.guidance_max_output_tokens,
            response_mime_type="application/json",
            response_json_schema=response_schema,
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel(self.settings.guidance_thinking_level)
            ),
        )
        turns = [
            types.Content(role=c["role"], parts=[types.Part(text=c["text"])]) for c in contents
        ]
        try:
            response = await self.client.aio.models.generate_content(
                model=model, contents=turns, config=config
            )
        except errors.APIError as error:
            # Only the status goes into the exception: the body can echo the prompt.
            if error.code == 429:
                raise ModelQuotaExhaustedError("gemini 429") from None
            raise ModelUnavailableError(f"gemini {error.code}") from None
        except (httpx.HTTPError, TimeoutError) as error:
            raise ModelUnavailableError(f"gemini {type(error).__name__}") from None
        try:
            parsed = json.loads(response.text or "")
        except json.JSONDecodeError:
            reason = response.candidates[0].finish_reason if response.candidates else None
            raise ModelUnavailableError(f"gemini returned no JSON ({reason})") from None
        if not isinstance(parsed, dict):
            raise ModelUnavailableError("gemini returned JSON that is not an object")
        return parsed


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
    gemini = CannedGeminiAdapter() if settings.gemini_adapter == "fake" else None
    return Adapters(
        gemini=gemini or GoogleGeminiAdapter(settings),
        agent_search=VertexAgentSearchAdapter(settings),
        places=GooglePlacesAdapter(settings),
    )
