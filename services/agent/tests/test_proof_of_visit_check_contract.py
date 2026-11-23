"""Moderation in proof-only mode (spec 09, attach a Proof of Visit later).

A Patient attaches a receipt to a Testimony that is already published. Only the proof is
read: no text, no photos, no decision. Driven through the HTTP API only, with Gemini
replaced by a fake at its adapter.
"""

from __future__ import annotations

import base64
import json
from typing import Any

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
from findyourdent_agent.config import Settings
from findyourdent_agent.data import contracts_dir

PATH = "/v1/moderation/proof-of-visit"
JPEG = base64.b64encode(b"\xff\xd8\xff fake receipt").decode()
PDF = base64.b64encode(b"%PDF-1.7 fake receipt").decode()


def response_validator() -> Draft202012Validator:
    path = contracts_dir() / "schemas" / "proof-of-visit-check-response.schema.json"
    schema = json.loads(path.read_text(encoding="utf-8"))
    return Draft202012Validator(schema, format_checker=FormatChecker())


def a_proof_check(**extra: Any) -> dict[str, Any]:
    return {
        "language": "id",
        "visitMonth": "2026-08",
        "typedProviderName": "Klinik Gigi Senyum",
        "googleDisplayName": "Klinik Gigi Senyum Sehat",
        "proofOfVisit": {"mimeType": "image/jpeg", "dataBase64": JPEG},
        **extra,
    }


def extraction(**overrides: Any) -> dict[str, Any]:
    return {
        "readable": True,
        "isProofOfVisit": True,
        "clinicNameOnProof": "Klinik Gigi Senyum Sehat",
        "proofDate": "2026-08-14",
        "totalRupiah": 350000,
        "clinicNameMatches": True,
        **overrides,
    }


def check(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    response = client.post(PATH, json=body)
    assert response.status_code == 200
    result = response.json()
    assert [e.message for e in response_validator().iter_errors(result)] == []
    return result


def test_returns_the_facts_read_off_the_proof(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    fake_gemini.outputs.append({"proofOfVisit": extraction()})

    result = check(client, a_proof_check())

    assert result == {"proofOfVisit": extraction()}


def test_screens_nothing_but_the_proof(client: TestClient, fake_gemini: FakeGeminiAdapter) -> None:
    fake_gemini.outputs.append({"proofOfVisit": extraction()})

    result = check(client, a_proof_check())

    # No decision, rules, spans or message: the published Testimony is not screened again.
    assert set(result) == {"proofOfVisit"}
    (call,) = fake_gemini.calls
    assert set(call["response_schema"]["properties"]) == {"proofOfVisit"}
    blobs = [p.inline_data for p in call["contents"] if p.inline_data is not None]
    assert [(b.mime_type, b.data) for b in blobs] == [("image/jpeg", base64.b64decode(JPEG))]
    texts = " ".join(p.text for p in call["contents"] if p.text)
    assert "Klinik Gigi Senyum Sehat" in texts
    assert "2026-08" in texts


def test_refuses_a_request_with_testimony_text_or_photos(client: TestClient) -> None:
    for extra in ({"text": "Dokternya sabar."}, {"photos": []}):
        response = client.post(PATH, json=a_proof_check(**extra))
        assert response.status_code == 422


def test_the_model_is_never_asked_for_a_patient_name(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    fake_gemini.outputs.append(
        {"proofOfVisit": extraction(patientName="Budi Santoso", namaPasien="Budi")}
    )

    result = check(
        client, a_proof_check(proofOfVisit={"mimeType": "application/pdf", "dataBase64": PDF})
    )

    assert result == {"proofOfVisit": extraction()}
    assert "Budi" not in json.dumps(result)
    (call,) = fake_gemini.calls
    proof = call["response_schema"]["properties"]["proofOfVisit"]
    assert set(proof["properties"]) == {
        "readable",
        "isProofOfVisit",
        "clinicNameOnProof",
        "proofDate",
        "totalRupiah",
        "clinicNameMatches",
    }


@pytest.mark.parametrize(
    "output", [{}, {"proofOfVisit": "accepted"}, {"proofOfVisit": {"readable": True}}]
)
def test_facts_the_model_did_not_give_or_got_wrong_come_back_as_unchecked(
    client: TestClient, fake_gemini: FakeGeminiAdapter, output: dict[str, Any]
) -> None:
    fake_gemini.outputs.append(output)

    assert check(client, a_proof_check()) == {}


class ExplodingGemini(FakeGeminiAdapter):
    async def generate_structured(self, **kwargs: Any) -> dict[str, Any]:
        raise RuntimeError("gemini down")


def test_a_model_error_comes_back_as_unchecked() -> None:
    adapters = Adapters(
        gemini=ExplodingGemini(), agent_search=FakeAgentSearchAdapter(), places=FakePlacesAdapter()
    )
    with TestClient(create_app(adapters, Settings())) as client:
        assert check(client, a_proof_check()) == {}


def test_a_proof_that_is_not_base64_is_refused(client: TestClient) -> None:
    body = a_proof_check(proofOfVisit={"mimeType": "image/jpeg", "dataBase64": "not base64!!"})

    assert client.post(PATH, json=body).status_code == 422
