"""Production adapters. Each ticket fills in one adapter behind the same port; the ones
still raising NotImplementedError are placeholders.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import random
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import google.auth
import google.auth.exceptions
import google.auth.transport.requests
import httpx
from google import genai
from google.genai import errors, types

from ..config import Settings
from . import (
    Adapters,
    AgentSearchUnavailableError,
    GroundingDoc,
    ModelQuotaExhaustedError,
    ModelUnavailableError,
)
from .fakes import CannedGeminiAdapter, FakeAgentSearchAdapter

# Output tokens have no daily quota and thinking tokens count as output, so a call
# that names no cap still gets one (infra/gcp/README.md).
DEFAULT_MAX_OUTPUT_TOKENS = 4096
# The whole call, retry included, when the caller names no budget: below the web
# service's 30 s agent timeout, so the Patient gets a retry state (Guidance, Shortlist
# reasons). Moderation and Price List extraction pass their own.
DEFAULT_CALL_BUDGET_SECONDS = 25.0
# One retry for a transient failure. Healthy answers take under 8 s while the failures
# seen on 18 Oct 2026 hung for about 23 s, so each attempt gets an even share of what
# is left of the budget instead of all of it.
_MAX_ATTEMPTS = 2
_BACKOFF_SECONDS = (0.2, 0.8)
# A retry with less time than this left would only time out again.
_MIN_RETRY_SECONDS = 3.0

log = logging.getLogger(__name__)


class _TransientModelError(ModelUnavailableError):
    """A failure worth one more attempt: a 5xx, a connection error or a timeout."""


@dataclass
class GoogleGeminiAdapter:
    """Gemini through google-genai on Vertex AI, global endpoint (ADR-0003).

    Structured output with bounded output tokens on every call. RESOURCE_EXHAUSTED
    (HTTP 429) means the daily input-token cap is reached (infra/gcp/README.md).
    """

    settings: Settings
    _client: genai.Client | None = field(default=None, repr=False)
    # The exact model version of the last answer, for the Moderation evaluation results.
    last_model_version: str | None = field(default=None, repr=False)
    sleep: Callable[[float], Awaitable[None]] = field(default=asyncio.sleep, repr=False)

    def _vertex_client(self) -> genai.Client:
        # Built on first use so the service starts without credentials (tests, local dev).
        if self._client is None:
            self._client = genai.Client(
                vertexai=True,
                project=self.settings.google_cloud_project,
                location=self.settings.google_cloud_location,
                # Below the web service's 30 s agent timeout, so the Patient gets a retry state.
                http_options=types.HttpOptions(timeout=25_000),
            )
        return self._client

    async def generate_structured(
        self,
        *,
        model: str,
        instruction: str,
        contents: list[Any],
        response_schema: dict[str, Any],
        max_output_tokens: int | None = None,
        thinking_level: str | None = None,
        timeout_seconds: float | None = None,
    ) -> dict[str, Any]:
        config = types.GenerateContentConfig(
            system_instruction=instruction,
            max_output_tokens=max_output_tokens or DEFAULT_MAX_OUTPUT_TOKENS,
            response_mime_type="application/json",
            response_json_schema=response_schema,
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel(thinking_level))
            if thinking_level
            else None,
        )
        loop = asyncio.get_running_loop()
        deadline = loop.time() + (timeout_seconds or DEFAULT_CALL_BUDGET_SECONDS)
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            share = (deadline - loop.time()) / (_MAX_ATTEMPTS - attempt + 1)
            try:
                response = await self._attempt(model, contents, config, share)
                break
            except _TransientModelError as error:
                backoff = random.uniform(*_BACKOFF_SECONDS)  # noqa: S311 (jitter, not a secret)
                left = deadline - loop.time() - backoff
                if attempt == _MAX_ATTEMPTS or left < _MIN_RETRY_SECONDS:
                    log.warning(
                        "gemini failed after %d attempts: %s",
                        attempt,
                        error,
                        extra={"outcome": "model_retry_exhausted"},
                    )
                    raise ModelUnavailableError(str(error)) from None
                # The reason is a status or class name only, never the request.
                log.warning("gemini retrying: %s", error, extra={"outcome": "model_retry"})
                await self.sleep(backoff)
        self.last_model_version = response.model_version
        try:
            parsed = json.loads(response.text or "")
        except json.JSONDecodeError:
            reason = response.candidates[0].finish_reason if response.candidates else None
            raise ModelUnavailableError(f"gemini returned no JSON ({reason})") from None
        if not isinstance(parsed, dict):
            raise ModelUnavailableError("gemini returned JSON that is not an object")
        return parsed

    async def _attempt(
        self,
        model: str,
        contents: list[Any],
        config: types.GenerateContentConfig,
        timeout_seconds: float,
    ) -> Any:
        try:
            async with asyncio.timeout(timeout_seconds):
                return await self._vertex_client().aio.models.generate_content(
                    model=model, contents=contents, config=config
                )
        except errors.APIError as error:
            # Only the status goes into the exception: the body can echo the prompt.
            if error.code == 429:
                raise ModelQuotaExhaustedError("gemini 429") from None
            if isinstance(error, errors.ServerError):
                raise _TransientModelError(f"gemini {error.code}") from None
            raise ModelUnavailableError(f"gemini {error.code}") from None
        except (httpx.HTTPError, TimeoutError) as error:
            raise _TransientModelError(f"gemini {type(error).__name__}") from None


_DISCOVERY_ENGINE = "https://discoveryengine.googleapis.com/v1"
_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
# Short: grounding is optional and Gemini still has to answer within the web
# service's 30 s agent timeout.
_SEARCH_TIMEOUT_SECONDS = 5.0
# Enough excerpt to ground an explanation without growing every prompt.
_SNIPPET_CHARS = 800
_TAGS = re.compile(r"<[^>]+>")


def _clean(text: str) -> str:
    """Search snippets mark the match with <b> tags and HTML entities."""
    return " ".join(html.unescape(_TAGS.sub("", text)).split())


def _public_url(value: Any) -> str | None:
    # gs:// links point into the private source bucket, not at a page a Patient can open.
    return value if isinstance(value, str) and value.startswith("https://") else None


def _grounding_doc(result: dict[str, Any]) -> GroundingDoc | None:
    """One search result as a source document. The data store holds layout-chunked
    PDFs, so results are chunks; document results (with Google's derived title, link
    and snippets) are read too, in case the engine answers in document mode."""
    if chunk := result.get("chunk"):
        metadata = chunk.get("documentMetadata") or {}
        struct = metadata.get("structData") or {}
        title = struct.get("title") or metadata.get("title")
        url = struct.get("source_url") or metadata.get("uri")
        snippet = chunk.get("content") or ""
    else:
        document = result.get("document") or {}
        struct = document.get("structData") or {}
        derived = document.get("derivedStructData") or {}
        title = struct.get("title") or derived.get("title")
        url = struct.get("source_url") or derived.get("link")
        snippets = derived.get("snippets") or []
        snippet = " ".join(s.get("snippet", "") for s in snippets if isinstance(s, dict))
    snippet = _clean(snippet)[:_SNIPPET_CHARS]
    if not title or not snippet:
        return None
    publisher = struct.get("publisher")
    return GroundingDoc(
        title=_clean(str(title)),
        snippet=snippet,
        url=_public_url(url),
        publisher=publisher if isinstance(publisher, str) and publisher else None,
    )


@dataclass
class VertexAgentSearchAdapter:
    """Agent Search (formerly Vertex AI Search) through the Discovery Engine v1 REST
    ``servingConfigs:search`` method, with the service account's default credentials.

    Every failure becomes AgentSearchUnavailableError carrying a status or class name
    only, never the query, and Guidance falls back to the curated knowledge files.
    """

    settings: Settings
    transport: httpx.AsyncBaseTransport | None = field(default=None, repr=False)
    credentials: Any = field(default=None, repr=False)

    async def _token(self) -> str:
        # Loaded on first use so the service starts without credentials (tests, local
        # dev); refreshing does blocking I/O, so it runs off the event loop.
        if self.credentials is None:
            self.credentials, _ = await asyncio.to_thread(
                google.auth.default, scopes=[_CLOUD_PLATFORM_SCOPE]
            )
        if not self.credentials.valid:
            await asyncio.to_thread(
                self.credentials.refresh, google.auth.transport.requests.Request()
            )
        return str(self.credentials.token)

    async def search(self, query: str, *, max_results: int = 5) -> list[GroundingDoc]:
        url = f"{_DISCOVERY_ENGINE}/{self.settings.agent_search_serving_config}:search"
        body = {
            "query": query,
            # Several chunks can come from one document (Permenkes 3/2023 alone has 8
            # parts), so ask for more results than documents.
            "pageSize": max_results * 3,
            "contentSearchSpec": {"searchResultMode": "CHUNKS"},
        }
        try:
            headers = {"Authorization": f"Bearer {await self._token()}"}
            async with httpx.AsyncClient(
                transport=self.transport, timeout=_SEARCH_TIMEOUT_SECONDS
            ) as client:
                response = await client.post(url, json=body, headers=headers)
            if response.is_error:
                # The status only: an error body can echo the query.
                raise AgentSearchUnavailableError(f"agent search {response.status_code}")
            results = response.json().get("results", [])
            if not isinstance(results, list):
                raise AgentSearchUnavailableError("agent search returned no result list")
            docs: dict[str, GroundingDoc] = {}
            for result in results:
                doc = _grounding_doc(result) if isinstance(result, dict) else None
                if doc and (key := doc.url or doc.title.lower()) not in docs:
                    docs[key] = doc
        except AgentSearchUnavailableError:
            raise
        except (
            httpx.HTTPError,
            ValueError,
            AttributeError,
            google.auth.exceptions.GoogleAuthError,
        ) as error:
            raise AgentSearchUnavailableError(f"agent search {type(error).__name__}") from None
        return list(docs.values())[:max_results]


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
    if settings.gemini_adapter == "fake":
        # Local development without credentials: no documents, so Guidance is grounded
        # in the curated knowledge files.
        return Adapters(
            gemini=CannedGeminiAdapter(),
            agent_search=FakeAgentSearchAdapter(),
            places=GooglePlacesAdapter(settings),
        )
    return Adapters(
        gemini=GoogleGeminiAdapter(settings),
        agent_search=VertexAgentSearchAdapter(settings),
        places=GooglePlacesAdapter(settings),
    )
