from __future__ import annotations

from findyourdent_agent.data import load_districts, load_procedures, load_regions, procedure_codes
from findyourdent_agent.knowledge import bpjs_coverage, cost_estimates


def test_shared_procedure_list_loads() -> None:
    procedures = load_procedures().procedures

    assert procedures
    assert len(procedure_codes()) == len(procedures)


def test_kemendagri_region_list_loads() -> None:
    regions = load_regions()

    assert len(regions.provinces) == 38
    province_codes = {str(p.code) for p in regions.provinces}
    assert all(str(r.provinceCode) in province_codes for r in regions.regencies)


def test_kemendagri_kecamatan_list_loads_under_its_kota_kabupaten() -> None:
    regency_codes = {str(r.code) for r in load_regions().regencies}
    districts = load_districts().districts

    assert len(districts) == 7285
    assert all(str(d.regencyCode) in regency_codes for d in districts)


def test_every_procedure_has_a_cost_range_and_a_bpjs_answer() -> None:
    codes = procedure_codes()

    assert set(cost_estimates().ranges) == codes
    assert set(bpjs_coverage().procedures) == codes


def test_scaling_never_promises_a_frequency() -> None:
    note = bpjs_coverage().procedures["scaling"].note

    assert note is not None
    for text in (note.id, note.en):
        assert not any(word in text for word in ("setahun", "per year", "a year", "2 tahun"))
