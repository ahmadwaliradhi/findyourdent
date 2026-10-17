"""Shortlist reasons (spec 02): one Gemini reason per ranked Provider, through the HTTP
contract. The web service owns order and membership; the agent only writes text."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from findyourdent_agent.adapters import ModelQuotaExhaustedError, ModelUnavailableError
from findyourdent_agent.adapters.fakes import (
    CannedGeminiAdapter,
    FakeGeminiAdapter,
    shortlist_model_output,
)
from findyourdent_agent.agents.shortlist import MODEL_OUTPUT_SCHEMA, shortlist_contents
from findyourdent_agent.config import Settings
from findyourdent_agent.contracts.shortlist_reasons_request import ShortlistReasonsRequest
from findyourdent_agent.data import contracts_dir

CLINIC = "place-klinik-senyum"
DRG = "place-drg-ani"
HOSPITAL = "place-rs-soetomo"


def _provider(place_id: str, name: str, rank: int, **overrides: Any) -> dict[str, Any]:
    provider: dict[str, Any] = {
        "placeId": place_id,
        "name": name,
        "providerType": "klinik",
        "providerTypeSource": "inferred",
        "rank": rank,
        "distanceMeters": 500 * rank,
        "procedureFit": ["root_canal_treatment"],
        "testimonies": {"count": 0, "verifiedVisitCount": 0},
    }
    return provider | overrides


REQUEST: dict[str, Any] = {
    "sessionId": "sess-0001-abcd",
    "language": "id",
    "likelyCategoryCode": "deep_caries_or_pulpitis",
    "likelyProcedures": ["root_canal_treatment", "dental_xray_periapical"],
    "providers": [
        _provider(
            CLINIC,
            "Klinik Senyum Gubeng",
            1,
            testimonies={
                "count": 6,
                "verifiedVisitCount": 2,
                "averageService": 4.6,
                "averageHygiene": 4.8,
                "averageMaterialsEquipment": 4.5,
            },
            priceSignals=[
                {
                    "procedureCode": "root_canal_treatment",
                    "minRupiah": 1_200_000,
                    "maxRupiah": 1_200_000,
                    "source": "testimonies",
                }
            ],
        ),
        _provider(HOSPITAL, "RSUD Dr. Soetomo", 2, providerType="hospital"),
        _provider(DRG, "drg. Ani Wijaya", 3, providerType="privateDentist"),
    ],
}

REASONS = {
    CLINIC: "Enam Testimoni dengan nilai kebersihan tinggi, 500 m dari Anda.",
    HOSPITAL: "Rumah sakit dengan poli gigi untuk perawatan saluran akar.",
    DRG: "Dokter gigi praktik pribadi 1,5 km dari Anda.",
}


def test_reasons_come_back_in_the_request_order_even_when_the_model_shuffles_them(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    fake_gemini.outputs.append(
        shortlist_model_output({p: REASONS[p] for p in (DRG, CLINIC, HOSPITAL)})
    )

    response = client.post("/v1/shortlist-reasons", json=REQUEST)

    assert response.status_code == 200
    assert response.json() == {
        "reasons": [
            {"placeId": CLINIC, "reason": REASONS[CLINIC]},
            {"placeId": HOSPITAL, "reason": REASONS[HOSPITAL]},
            {"placeId": DRG, "reason": REASONS[DRG]},
        ]
    }


def test_reasons_match_the_shared_response_contract(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    schema = json.loads(
        (contracts_dir() / "schemas" / "shortlist-reasons-response.schema.json").read_text()
    )
    fake_gemini.outputs.append(shortlist_model_output(REASONS))

    response = client.post("/v1/shortlist-reasons", json=REQUEST)

    errors = list(Draft202012Validator(schema).iter_errors(response.json()))
    assert errors == [], [e.message for e in errors]


def test_one_call_to_the_shortlist_model_with_its_own_settings(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    fake_gemini.outputs.append(shortlist_model_output(REASONS))

    client.post("/v1/shortlist-reasons", json=REQUEST)

    defaults = Settings()
    assert len(fake_gemini.calls) == 1
    call = fake_gemini.calls[0]
    assert call["model"] == defaults.shortlist_model
    assert call["response_schema"]["required"] == ["reasons"]
    assert call["max_output_tokens"] == defaults.shortlist_max_output_tokens
    assert call["thinking_level"] == defaults.shortlist_thinking_level
    # Provider names are data after the stable instruction, never part of it.
    assert "Klinik Senyum Gubeng" not in call["instruction"]
    assert "sess-0001-abcd" not in str(call["contents"])


@pytest.mark.parametrize(
    "reasons",
    [
        pytest.param({CLINIC: REASONS[CLINIC], HOSPITAL: REASONS[HOSPITAL]}, id="drops one"),
        pytest.param(REASONS | {"place-unknown": "Klinik lain."}, id="adds one"),
        pytest.param(
            {CLINIC: REASONS[CLINIC], HOSPITAL: REASONS[HOSPITAL], "place-unknown": "Lain."},
            id="swaps one",
        ),
    ],
)
def test_a_model_that_changes_the_providers_gets_no_partial_answer(
    client: TestClient, fake_gemini: FakeGeminiAdapter, reasons: dict[str, str]
) -> None:
    fake_gemini.outputs.append(shortlist_model_output(reasons))

    response = client.post("/v1/shortlist-reasons", json=REQUEST)

    assert response.status_code == 503
    assert response.json() == {"error": "model_unavailable"}


def test_a_provider_named_twice_gets_no_partial_answer(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    output = shortlist_model_output(REASONS)
    output["reasons"].append({"placeId": CLINIC, "reason": "Sekali lagi."})
    fake_gemini.outputs.append(output)

    response = client.post("/v1/shortlist-reasons", json=REQUEST)

    assert response.status_code == 503


@pytest.mark.parametrize(
    "reason",
    [
        pytest.param("Minum ibuprofen 400 mg sebelum datang.", id="medicine and dose"),
        pytest.param("", id="empty"),
        pytest.param("x" * 201, id="too long"),
    ],
)
def test_an_unusable_reason_gets_no_partial_answer(
    client: TestClient, fake_gemini: FakeGeminiAdapter, reason: str
) -> None:
    fake_gemini.outputs.append(shortlist_model_output(REASONS | {DRG: reason}))

    response = client.post("/v1/shortlist-reasons", json=REQUEST)

    assert response.status_code == 503
    assert response.json() == {"error": "model_unavailable"}


def test_output_that_is_not_the_schema_is_unavailable(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    fake_gemini.outputs.append({"reasons": "Klinik terbaik."})

    response = client.post("/v1/shortlist-reasons", json=REQUEST)

    assert response.status_code == 503


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (ModelQuotaExhaustedError("gemini 429"), "model_quota_exhausted"),
        (ModelUnavailableError("gemini 500"), "model_unavailable"),
    ],
)
def test_gemini_failure_is_a_retry_state_the_web_falls_back_from(
    client: TestClient, fake_gemini: FakeGeminiAdapter, error: Exception, code: str
) -> None:
    fake_gemini.outputs.append(error)

    response = client.post("/v1/shortlist-reasons", json=REQUEST)

    assert response.status_code == 503
    assert response.json() == {"error": code}


def test_more_than_five_providers_is_refused_before_gemini(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    six = [_provider(f"place-{i}", f"Klinik {i}", min(i, 5)) for i in range(1, 7)]

    response = client.post("/v1/shortlist-reasons", json=REQUEST | {"providers": six})

    assert response.status_code == 422
    assert fake_gemini.calls == []


def test_provider_names_and_reasons_never_reach_logs(
    client: TestClient, fake_gemini: FakeGeminiAdapter, caplog: pytest.LogCaptureFixture
) -> None:
    fake_gemini.outputs.append(shortlist_model_output(REASONS))
    fake_gemini.outputs.append(shortlist_model_output(REASONS | {DRG: "Minum ibuprofen 400 mg."}))
    with caplog.at_level(logging.DEBUG):
        client.post("/v1/shortlist-reasons", json=REQUEST)
        client.post("/v1/shortlist-reasons", json=REQUEST)

    logged = " ".join(str(record.__dict__) for record in caplog.records)
    assert "Klinik Senyum Gubeng" not in logged
    assert "ibuprofen" not in logged
    assert all(reason not in logged for reason in REASONS.values())


def test_the_local_development_adapter_writes_a_reason_for_every_provider() -> None:
    request = ShortlistReasonsRequest.model_validate(REQUEST)
    output = asyncio.run(
        CannedGeminiAdapter().generate_structured(
            model="gemini-3.8-flash",
            instruction="",
            contents=shortlist_contents(request),
            response_schema=MODEL_OUTPUT_SCHEMA,
        )
    )

    assert [r["placeId"] for r in output["reasons"]] == [CLINIC, HOSPITAL, DRG]
