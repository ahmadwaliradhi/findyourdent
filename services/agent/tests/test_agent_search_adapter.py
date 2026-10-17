"""The production Agent Search adapter against canned Discovery Engine responses.

No network: httpx.MockTransport answers with the response shapes of the v1
``servingConfigs:search`` method, so these cover parsing and failure mapping only.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from findyourdent_agent.adapters import AgentSearchUnavailableError, GroundingDoc
from findyourdent_agent.adapters.fakes import FakeAgentSearchAdapter
from findyourdent_agent.adapters.real import VertexAgentSearchAdapter, production_adapters
from findyourdent_agent.config import Settings

SERVING_CONFIG = (
    "projects/findyourdent/locations/global/collections/default_collection"
    "/engines/findyourdent-guidance/servingConfigs/default_search"
)
QUERY = "gigi geraham nyut-nyutan kalau minum dingin"
PERMENKES_URL = "https://peraturan.bpk.go.id/Details/275518/permenkes-no-3-tahun-2023"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class _Credentials:
    valid = True
    token = "test-token"  # noqa: S105 - a stub, not a credential

    def refresh(self, request: Any) -> None:
        raise AssertionError("valid credentials are not refreshed")


def _chunk(content: str, struct: dict[str, Any] | None, title: str = "doc.pdf") -> dict[str, Any]:
    metadata: dict[str, Any] = {"uri": "gs://findyourdent-grounding/doc.pdf", "title": title}
    if struct is not None:
        metadata["structData"] = struct
    return {"chunk": {"id": "c1", "content": content, "documentMetadata": metadata}}


def _permenkes(page_offset: int) -> dict[str, Any]:
    return {
        "title": "Permenkes 3/2023 Standar Tarif Pelayanan Kesehatan",
        "publisher": "Kementerian Kesehatan RI",
        "source_url": PERMENKES_URL,
        "licence": "public domain",
        "language": "id",
        "page_offset": page_offset,
    }


def _adapter(handler: Any, **settings: Any) -> VertexAgentSearchAdapter:
    return VertexAgentSearchAdapter(
        Settings(**settings),
        transport=httpx.MockTransport(handler),
        credentials=_Credentials(),
    )


@pytest.mark.anyio
async def test_chunks_from_one_document_become_one_source() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "results": [
                    _chunk("Tambalan gigi termasuk pelayanan di FKTP.", _permenkes(0)),
                    _chunk("Pencabutan gigi permanen di FKTP.", _permenkes(40)),
                    _chunk(
                        "Facial swelling needs same-day care.",
                        {
                            "title": "Urgent dental care",
                            "publisher": "NHS England",
                            "source_url": "https://www.england.nhs.uk/urgent-dental-care/",
                        },
                    ),
                ]
            },
        )

    docs = await _adapter(handler).search(QUERY, max_results=5)

    assert docs == [
        GroundingDoc(
            title="Permenkes 3/2023 Standar Tarif Pelayanan Kesehatan",
            publisher="Kementerian Kesehatan RI",
            url=PERMENKES_URL,
            snippet="Tambalan gigi termasuk pelayanan di FKTP.",
        ),
        GroundingDoc(
            title="Urgent dental care",
            publisher="NHS England",
            url="https://www.england.nhs.uk/urgent-dental-care/",
            snippet="Facial swelling needs same-day care.",
        ),
    ]
    [request] = requests
    assert request.method == "POST"
    assert str(request.url) == (
        f"https://discoveryengine.googleapis.com/v1/{SERVING_CONFIG}:search"
    )
    assert request.headers["Authorization"] == "Bearer test-token"
    body = json.loads(request.content)
    assert body["query"] == QUERY
    assert body["pageSize"] >= 5


@pytest.mark.anyio
async def test_results_stop_at_max_results_documents() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        results = [
            _chunk(f"isi {i}", {"title": f"Dokumen {i}", "source_url": f"https://a.id/{i}"})
            for i in range(6)
        ]
        return httpx.Response(200, json={"results": results})

    docs = await _adapter(handler).search(QUERY, max_results=2)

    assert [d.title for d in docs] == ["Dokumen 0", "Dokumen 1"]


@pytest.mark.anyio
async def test_document_results_fall_back_to_derived_struct_data() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        document = {
            "id": "d1",
            "derivedStructData": {
                "title": "Teeth and gums referral criteria",
                "link": "gs://findyourdent-grounding/metro-north.pdf",
                "snippets": [{"snippet": "Refer &amp; treat <b>facial swelling</b> today."}],
            },
        }
        return httpx.Response(200, json={"results": [{"id": "d1", "document": document}]})

    [doc] = await _adapter(handler).search(QUERY)

    # A gs:// link is the private bucket, not something a Patient can open.
    assert doc == GroundingDoc(
        title="Teeth and gums referral criteria",
        snippet="Refer & treat facial swelling today.",
    )


@pytest.mark.anyio
async def test_no_results_is_an_empty_list() -> None:
    docs = await _adapter(lambda request: httpx.Response(200, json={})).search(QUERY)

    assert docs == []


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(403, json={"error": {"message": f"denied for query {QUERY}"}}),
        httpx.Response(500, text="boom"),
        httpx.Response(200, text="not json"),
        httpx.Response(200, json={"results": "not a list"}),
    ],
)
@pytest.mark.anyio
async def test_failures_raise_unavailable_without_the_query(response: httpx.Response) -> None:
    with pytest.raises(AgentSearchUnavailableError) as raised:
        await _adapter(lambda request: response).search(QUERY)

    assert QUERY not in str(raised.value)
    assert raised.value.__cause__ is None


@pytest.mark.anyio
async def test_network_error_raises_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    with pytest.raises(AgentSearchUnavailableError):
        await _adapter(handler).search(QUERY)


def test_serving_config_comes_from_settings() -> None:
    assert Settings().agent_search_serving_config == SERVING_CONFIG


def test_local_development_without_credentials_uses_an_empty_search() -> None:
    adapters = production_adapters(Settings(gemini_adapter="fake"))

    assert isinstance(adapters.agent_search, FakeAgentSearchAdapter)
