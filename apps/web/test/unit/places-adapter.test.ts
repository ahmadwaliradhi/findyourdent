import { describe, expect, it } from "vitest";
import { createGooglePlacesAdapter, type TextSearch } from "../../server/adapters/places.ts";
import { createMemoryDailyQuota } from "../../server/quota.ts";

interface SeenRequest {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fetch that records what it was sent and answers like Places API (New). */
function fakePlaces(answer: () => Response = () => Response.json({ places: [GOOGLE_PLACE] })) {
  const seen: SeenRequest[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return answer();
  }) as typeof globalThis.fetch;
  return { seen, fetch };
}

const GOOGLE_PLACE = {
  id: "ChIJ-gubeng-dental",
  displayName: { text: "Klinik Gigi Senyum Gubeng", languageCode: "id" },
  formattedAddress: "Jl. Raya Gubeng No. 1, Surabaya",
  location: { latitude: -7.2756, longitude: 112.7509 },
  types: ["dentist", "health", "point_of_interest"],
  googleMapsUri: "https://maps.google.com/?cid=1",
};

const SHORTLIST: TextSearch = {
  purpose: "shortlist",
  textQuery: "dokter gigi",
  includedType: "dentist",
  locationBias: { center: { lat: -7.2756, lng: 112.7509 }, radiusMeters: 5000 },
  language: "id",
};

const EMERGENCY: TextSearch = {
  ...SHORTLIST,
  purpose: "emergency",
  textQuery: "IGD rumah sakit",
  includedType: "hospital",
};

function adapterWith(places: ReturnType<typeof fakePlaces>, quota = createMemoryDailyQuota()) {
  return createGooglePlacesAdapter({ apiKey: "test-places-key", fetch: places.fetch, quota });
}

describe("Places adapter: Shortlist search", () => {
  it("sends one Text Search (New) call with exactly the Pro-tier field mask", async () => {
    const places = fakePlaces();

    await adapterWith(places).searchText(SHORTLIST);

    expect(places.seen).toHaveLength(1);
    const [call] = places.seen;
    expect(call?.url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("x-goog-fieldmask")).toBe(
      "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri",
    );
    expect(call?.headers.get("x-goog-api-key")).toBe("test-places-key");
  });

  it("never asks for an Enterprise or Atmosphere field such as rating, hours or phone", async () => {
    const places = fakePlaces();

    await adapterWith(places).searchText(EMERGENCY);

    const mask = places.seen[0]?.headers.get("x-goog-fieldmask") ?? "";
    for (const field of [
      "rating",
      "userRatingCount",
      "regularOpeningHours",
      "nationalPhoneNumber",
      "reviews",
      "photos",
    ]) {
      expect(mask).not.toContain(field);
    }
  });

  it("biases a shared location to a circle and keeps the query and type it was given", async () => {
    const places = fakePlaces();

    await adapterWith(places).searchText(SHORTLIST);

    expect(places.seen[0]?.body).toEqual({
      textQuery: "dokter gigi",
      includedType: "dentist",
      languageCode: "id",
      regionCode: "ID",
      pageSize: 20,
      locationBias: { circle: { center: { latitude: -7.2756, longitude: 112.7509 }, radius: 5000 } },
    });
  });

  it("returns each place as a summary the Shortlist can join by place_id", async () => {
    const result = await adapterWith(fakePlaces()).searchText(SHORTLIST);

    expect(result).toEqual({
      ok: true,
      places: [
        {
          placeId: "ChIJ-gubeng-dental",
          displayName: "Klinik Gigi Senyum Gubeng",
          formattedAddress: "Jl. Raya Gubeng No. 1, Surabaya",
          location: { lat: -7.2756, lng: 112.7509 },
          types: ["dentist", "health", "point_of_interest"],
          googleMapsUri: "https://maps.google.com/?cid=1",
        },
      ],
    });
  });
});

describe("Places adapter: daily cap", () => {
  it("stops calling Google once the Shortlist search cap of 160 a day is used up", async () => {
    const places = fakePlaces();
    const adapter = adapterWith(places);

    const results = [];
    for (let i = 0; i < 161; i++) results.push(await adapter.searchText(EMERGENCY));

    expect(places.seen).toHaveLength(160);
    expect(results.at(-1)).toEqual({ ok: false, reason: "cap_reached" });
  });

  it("serves emergency Hospital searches first: Shortlists stop early to leave room for them", async () => {
    const places = fakePlaces();
    const adapter = adapterWith(places);

    let shortlists = 0;
    while ((await adapter.searchText(SHORTLIST)).ok) shortlists++;
    const emergency = await adapter.searchText(EMERGENCY);

    expect(shortlists).toBeLessThan(160);
    expect(emergency.ok).toBe(true);
  });

  it("treats RESOURCE_EXHAUSTED from Google as cap reached and stops calling for the day", async () => {
    const places = fakePlaces(() =>
      Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED" } }, { status: 429 }),
    );
    const adapter = adapterWith(places);

    const first = await adapter.searchText(EMERGENCY);
    const second = await adapter.searchText(EMERGENCY);

    expect(first).toEqual({ ok: false, reason: "cap_reached" });
    expect(second).toEqual({ ok: false, reason: "cap_reached" });
    expect(places.seen).toHaveLength(1);
  });

  it("starts a new count on the next Jakarta day", async () => {
    const places = fakePlaces();
    let now = Date.parse("2026-10-20T16:59:00Z"); // 23:59 in Jakarta
    const adapter = adapterWith(places, createMemoryDailyQuota({ now: () => now }));
    for (let i = 0; i < 160; i++) await adapter.searchText(EMERGENCY);

    now = Date.parse("2026-10-20T17:01:00Z"); // 00:01 the next day in Jakarta
    const result = await adapter.searchText(EMERGENCY);

    expect(result.ok).toBe(true);
  });

  it("reports Google being down as unavailable, not as cap reached", async () => {
    const places = fakePlaces(() => new Response("oops", { status: 503 }));

    const result = await adapterWith(places).searchText(SHORTLIST);

    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});
