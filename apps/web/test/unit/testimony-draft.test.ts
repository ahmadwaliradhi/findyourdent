import { describe, expect, it } from "vitest";
import {
  EMPTY_FORM_STATE,
  formatPriceInput,
  parseDraft,
  serializeDraft,
  stateFromInitial,
  type TestimonyFormState,
  toSubmission,
  validateForm,
  visitYears,
} from "../../app/lib/testimony-draft.ts";

const NOW = new Date(2026, 9, 17); // 17 October 2026

const filled: TestimonyFormState = {
  provider: {
    placeId: "ChIJ-baru",
    listed: null,
    providerName: "Klinik Gigi Ceria",
    region: { provinceCode: "35", regencyCode: "35.78" },
  },
  ratings: { service: 5, hygiene: 4, materialsEquipment: 3 },
  text: "Dokternya sabar dan ruangannya bersih.",
  procedureCode: "scaling",
  price: "350000",
  visitYear: "2026",
  visitMonth: "09",
  displayName: "Siti R.",
  consentHonest: true,
  consentNoOthers: true,
};

describe("browser draft", () => {
  it("round-trips everything typed", () => {
    expect(parseDraft(serializeDraft(filled))).toEqual(filled);
  });

  it("ignores missing, broken or old drafts", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("{not json")).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 0, state: filled }))).toBeNull();
  });

  it("drops fields of the wrong shape instead of failing", () => {
    const tampered = JSON.stringify({
      v: 1,
      state: {
        ...filled,
        ratings: { service: 9, hygiene: "4", materialsEquipment: 2 },
        procedureCode: "not-a-procedure",
        price: "35.000abc",
        visitMonth: "13",
        consentHonest: "yes",
        provider: { placeId: 42, listed: { name: 1 }, region: null },
      },
    });
    const parsed = parseDraft(tampered);
    expect(parsed?.ratings).toEqual({ service: null, hygiene: null, materialsEquipment: 2 });
    expect(parsed?.procedureCode).toBe("");
    expect(parsed?.price).toBe("35000");
    expect(parsed?.visitMonth).toBe("");
    expect(parsed?.consentHonest).toBe(false);
    expect(parsed?.provider).toEqual(EMPTY_FORM_STATE.provider);
  });
});

describe("validateForm", () => {
  it("finds nothing wrong in a complete form", () => {
    expect(validateForm(filled, { mode: "create", now: NOW })).toEqual({});
  });

  it("asks for every required field, keyed like the server's fieldErrors", () => {
    expect(Object.keys(validateForm(EMPTY_FORM_STATE, { mode: "create", now: NOW })).sort()).toEqual([
      "consent",
      "displayName",
      "placeId",
      "ratings.hygiene",
      "ratings.materialsEquipment",
      "ratings.service",
      "text",
      "visitMonth",
    ]);
  });

  it("asks for the typed name and Region only when the place is not yet Listed", () => {
    const unlisted = {
      ...filled,
      provider: { ...filled.provider, providerName: " ", region: { provinceCode: "", regencyCode: "" } },
    };
    expect(Object.keys(validateForm(unlisted, { mode: "create", now: NOW })).sort()).toEqual([
      "providerName",
      "region.provinceCode",
      "region.regencyCode",
    ]);
    const listed = {
      ...unlisted,
      provider: {
        ...unlisted.provider,
        listed: { name: "Klinik Senyum", region: { provinceCode: "35", regencyCode: "35.78" } },
      },
    };
    expect(validateForm(listed, { mode: "create", now: NOW })).toEqual({});
    // The Provider never changes on edit.
    expect(validateForm({ ...filled, provider: EMPTY_FORM_STATE.provider }, { mode: "edit", now: NOW })).toEqual({});
  });

  it("marks the place, not the hidden name and Region, while the listing check runs or after it failed", () => {
    // Picked from a Listed Provider page: `listed` is still null until the check answers.
    const unchecked = {
      ...filled,
      provider: { ...filled.provider, providerName: "", region: { provinceCode: "", regencyCode: "" } },
    };
    expect(validateForm(unchecked, { mode: "create", now: NOW, listing: "checking" })).toEqual({
      placeId: { key: "errors.listingChecking" },
    });
    expect(validateForm(unchecked, { mode: "create", now: NOW, listing: "failed" })).toEqual({
      placeId: { key: "errors.listingFailed" },
    });
    expect(Object.keys(validateForm(unchecked, { mode: "create", now: NOW, listing: "checked" })).sort()).toEqual([
      "providerName",
      "region.provinceCode",
      "region.regencyCode",
    ]);
  });

  it("refuses a visit month in the future and a price out of range", () => {
    const errors = validateForm({ ...filled, visitMonth: "11", price: "2000000000" }, { mode: "create", now: NOW });
    expect(errors.visitMonth?.key).toBe("errors.visitFuture");
    expect(errors.pricePaidRupiah?.key).toBe("errors.price");
    expect(validateForm({ ...filled, visitMonth: "10" }, { mode: "create", now: NOW })).toEqual({});
  });

  it("refuses a text over the 10,000-character cap", () => {
    expect(validateForm({ ...filled, text: "a".repeat(10_001) }, { mode: "create", now: NOW }).text?.key).toBe(
      "errors.textTooLong",
    );
  });
});

describe("toSubmission", () => {
  it("sends the typed name and Region for a place that is not yet Listed", () => {
    expect(toSubmission(filled, { placeId: "ChIJ-baru" })).toEqual({
      placeId: "ChIJ-baru",
      providerName: "Klinik Gigi Ceria",
      region: { provinceCode: "35", regencyCode: "35.78" },
      ratings: { service: 5, hygiene: 4, materialsEquipment: 3 },
      text: "Dokternya sabar dan ruangannya bersih.",
      visitMonth: "2026-09",
      procedureCode: "scaling",
      pricePaidRupiah: 350_000,
      displayName: "Siti R.",
      consent: { honestExperience: true, noOthersPersonalData: true },
    });
  });

  it("leaves out the name, Region and empty optional fields for a Listed place", () => {
    const listed = {
      ...filled,
      procedureCode: "",
      price: "",
      provider: {
        ...filled.provider,
        listed: { name: "Klinik Senyum", region: { provinceCode: "35", regencyCode: "35.78" } },
      },
    };
    const submission = toSubmission(listed, { placeId: "ChIJ-baru", keepPhotoPaths: ["testimonies/t/photos/a.jpg"] });
    expect(submission).not.toHaveProperty("providerName");
    expect(submission).not.toHaveProperty("region");
    expect(submission).not.toHaveProperty("procedureCode");
    expect(submission).not.toHaveProperty("pricePaidRupiah");
    expect(submission.keepPhotoPaths).toEqual(["testimonies/t/photos/a.jpg"]);
  });

  it("round-trips with the stored content the edit page passes in", () => {
    const submission = toSubmission({ ...filled, provider: EMPTY_FORM_STATE.provider }, { placeId: "ChIJ-baru" });
    const state = stateFromInitial(submission);
    expect(toSubmission(state, { placeId: "ChIJ-baru" })).toEqual(submission);
  });
});

describe("form helpers", () => {
  it("offers this year and the four before", () => {
    expect(visitYears(NOW)).toEqual(["2026", "2025", "2024", "2023", "2022"]);
  });

  it("shows prices with Indonesian thousands separators", () => {
    expect(formatPriceInput("1500000")).toBe("1.500.000");
    expect(formatPriceInput("")).toBe("");
  });
});
