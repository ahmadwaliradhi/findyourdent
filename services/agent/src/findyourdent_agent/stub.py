"""Fixed Guidance card returned by the walking-skeleton endpoint. No model is called.

Content mirrors a typical deep-caries complaint so the web app can render a realistic
card. The procedure codes are hard-coded here; app startup warns if any of them is
missing from packages/contracts/data/procedures.json.
"""

from __future__ import annotations

from typing import Any, Literal

from .contracts.guidance_response import GuidanceCardResponse

Language = Literal["id", "en"]

PROCEDURES = ("dental_xray_periapical", "tooth_filling", "root_canal_treatment")

_COST_ESTIMATE = [
    ("dental_xray_periapical", 50_000, 150_000),
    ("tooth_filling", 150_000, 600_000),
    ("root_canal_treatment", 1_000_000, 3_500_000),
]

_SOURCES: list[dict[str, Any]] = [
    {
        "title": "Pedoman Nasional Pelayanan Kedokteran Tata Laksana Karies Gigi",
        "citation": "KMK HK.01.07/MENKES/1492/2023",
    },
    {
        "title": "Standar Tarif dan Manfaat Pelayanan Kesehatan JKN",
        "citation": "Permenkes 3/2023, Pasal 3 ayat (2)",
    },
    {"title": "Pindah FKTP", "citation": "Perpres 59/2024, Pasal 7"},
]

_TEXT: dict[Language, dict[str, Any]] = {
    "id": {
        "category": (
            "Keluhan ngilu saat minum dingin dan nyeri berdenyut bisa jadi tanda lubang gigi "
            "yang dalam atau peradangan saraf gigi (pulpitis). Dokter gigi perlu memeriksa "
            "untuk memastikan."
        ),
        "visits": [
            "Pemeriksaan dan rontgen gigi untuk melihat seberapa dalam lubangnya.",
            "Penambalan, atau perawatan saluran akar bila saraf sudah meradang.",
            "Kontrol dan tambalan akhir atau mahkota bila perawatan saluran akar dilakukan.",
        ],
        "why_prices_vary": [
            "Bahan tambalan berbeda harganya (komposit, GIC, atau inlay).",
            "Gigi geraham punya lebih banyak saluran akar, jadi perawatannya lebih lama.",
            "Perlu tidaknya rontgen dan berapa kali kunjungan.",
            "Ditangani dokter gigi umum atau spesialis konservasi gigi (Sp.KG).",
        ],
        "cost_source": "Estimasi tim FindYourDent dari tarif publik dan daftar harga klinik",
        "bpjs": (
            "Penambalan ditanggung BPJS Kesehatan di FKTP tempat Anda terdaftar atau dokter "
            "gigi jejaringnya, bukan di sembarang klinik. Perawatan saluran akar tidak ada di "
            "daftar layanan FKTP, jadi biasanya perlu rujukan ke rumah sakit atas indikasi "
            "medis. Anda bisa pindah FKTP setelah terdaftar tiga bulan, dan perpindahan "
            "berlaku mulai bulan berikutnya."
        ),
        "disclaimer": (
            "Ini informasi edukasi, bukan diagnosis. Tetap periksakan gigi Anda ke dokter gigi. "
            "Untuk obat, tanyakan apoteker atau dokter gigi."
        ),
    },
    "en": {
        "category": (
            "Pain with cold drinks and a throbbing ache can be a sign of a deep cavity or an "
            "inflamed tooth nerve (pulpitis). A dentist needs to examine it to be sure."
        ),
        "visits": [
            "Check-up and a dental X-ray to see how deep the cavity is.",
            "A filling, or root canal treatment if the nerve is inflamed.",
            "Follow-up and the final filling or a crown if a root canal was done.",
        ],
        "why_prices_vary": [
            "Filling materials differ in price (composite, GIC or inlay).",
            "Molars have more root canals, so treatment takes longer.",
            "Whether an X-ray is needed and how many visits it takes.",
            "Whether a general dentist or a conservative dentistry specialist (Sp.KG) treats it.",
        ],
        "cost_source": "FindYourDent team estimate from public tariffs and clinic price lists",
        "bpjs": (
            "BPJS Kesehatan covers fillings at your registered FKTP or its partner dentist, not "
            "at any clinic. Root canal treatment is not on the FKTP list, so it usually needs a "
            "referral to a hospital on medical grounds. You can change FKTP after three months "
            "registered, and the change starts the next month."
        ),
        "disclaimer": (
            "This is educational information, not a diagnosis. Please still see a dentist. "
            "For medicines, ask a pharmacist or dentist."
        ),
    },
}


def stub_guidance(language: Language) -> GuidanceCardResponse:
    text = _TEXT[language]
    card = {
        "kind": "guidance",
        "guidance": {
            "urgencyTier": "segera",
            "likelyCategory": {"code": "deep_caries_or_pulpitis", "explanation": text["category"]},
            "journey": {
                "type": "multi",
                "visits": [
                    {"order": i, "purpose": purpose}
                    for i, purpose in enumerate(text["visits"], start=1)
                ],
            },
            "likelyProcedures": list(PROCEDURES),
            "whyPricesVary": text["why_prices_vary"],
            "costEstimate": [
                {
                    "procedureCode": code,
                    "minRupiah": low,
                    "maxRupiah": high,
                    "label": "estimasi",
                    "source": text["cost_source"],
                }
                for code, low, high in _COST_ESTIMATE
            ],
            "bpjs": {"status": "referral_needed", "explanation": text["bpjs"]},
            "sources": _SOURCES,
            "disclaimer": text["disclaimer"],
        },
    }
    return GuidanceCardResponse.model_validate(card)
