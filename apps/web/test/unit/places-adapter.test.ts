import { describe, expect, it } from "vitest";
import {
  type AutocompleteRequest,
  COORDINATES_DAILY_CAP,
  createGooglePlacesAdapter,
  MODERATION_NAME_DAILY_CAP,
  type TextSearch,
} from "../../server/adapters/places.ts";
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

/** What Place Details (New) answers with the Google block's Enterprise field mask. */
const GOOGLE_DETAILS = {
  displayName: { text: "Klinik Gigi Senyum Gubeng", languageCode: "id" },
  types: ["dentist", "health"],
  formattedAddress: "Jl. Raya Gubeng No. 1, Surabaya",
  regularOpeningHours: {
    openNow: true,
    weekdayDescriptions: ["Senin: 09.00–21.00", "Selasa: 09.00–21.00"],
  },
  nationalPhoneNumber: "0812-3456-7890",
  websiteUri: "https://senyum.example",
  rating: 4.7,
  userRatingCount: 132,
  googleMapsUri: "https://maps.google.com/?cid=1",
};

describe("Places adapter: Provider Google block", () => {
  it("sends one Place Details call with exactly the Enterprise field mask, and no reviews or photos", async () => {
    const places = fakePlaces(() => Response.json(GOOGLE_DETAILS));

    await adapterWith(places).getGoogleBlock({ placeId: "ChIJ-gubeng-dental", language: "id" });

    expect(places.seen).toHaveLength(1);
    const [call] = places.seen;
    expect(call?.method).toBe("GET");
    expect(call?.url).toBe("https://places.googleapis.com/v1/places/ChIJ-gubeng-dental?languageCode=id&regionCode=ID");
    expect(call?.headers.get("x-goog-fieldmask")).toBe(
      "displayName,types,formattedAddress,regularOpeningHours,nationalPhoneNumber,websiteUri,rating,userRatingCount,googleMapsUri",
    );
  });

  it("returns the live facts the page shows", async () => {
    const result = await adapterWith(fakePlaces(() => Response.json(GOOGLE_DETAILS))).getGoogleBlock({
      placeId: "ChIJ-gubeng-dental",
      language: "id",
    });

    expect(result).toEqual({
      ok: true,
      block: {
        placeId: "ChIJ-gubeng-dental",
        displayName: "Klinik Gigi Senyum Gubeng",
        types: ["dentist", "health"],
        formattedAddress: "Jl. Raya Gubeng No. 1, Surabaya",
        openNow: true,
        weekdayHours: ["Senin: 09.00–21.00", "Selasa: 09.00–21.00"],
        nationalPhoneNumber: "0812-3456-7890",
        websiteUri: "https://senyum.example",
        rating: 4.7,
        userRatingCount: 132,
        googleMapsUri: "https://maps.google.com/?cid=1",
      },
    });
  });

  it("stops at its own cap of 50 a day, leaving the Place Details room Google Reviews needs", async () => {
    const places = fakePlaces(() => Response.json(GOOGLE_DETAILS));
    const adapter = adapterWith(places);

    const results = [];
    for (let i = 0; i < 51; i++) results.push(await adapter.getGoogleBlock({ placeId: "p", language: "id" }));
    const reviews = await adapter.getGoogleReviews({ placeId: "p", language: "id" });

    expect(results.filter((r) => r.ok)).toHaveLength(50);
    expect(results.at(-1)).toEqual({ ok: false, reason: "cap_reached" });
    expect(reviews.ok).toBe(true);
  });

  it("treats RESOURCE_EXHAUSTED as cap reached and stops calling for the day", async () => {
    const places = fakePlaces(() =>
      Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED" } }, { status: 429 }),
    );
    const adapter = adapterWith(places);

    const first = await adapter.getGoogleBlock({ placeId: "p", language: "id" });
    const second = await adapter.getGoogleBlock({ placeId: "p", language: "id" });

    expect([first, second]).toEqual([
      { ok: false, reason: "cap_reached" },
      { ok: false, reason: "cap_reached" },
    ]);
    expect(places.seen).toHaveLength(1);
  });

  it("reports a place Google does not know as not found", async () => {
    const places = fakePlaces(() => Response.json({ error: { code: 404, status: "NOT_FOUND" } }, { status: 404 }));

    expect(await adapterWith(places).getGoogleBlock({ placeId: "gone", language: "id" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

const GOOGLE_REVIEW = {
  name: "places/ChIJ-gubeng-dental/reviews/r1",
  relativePublishTimeDescription: "2 minggu lalu",
  rating: 5,
  text: { text: "Dokternya ramah.", languageCode: "id" },
  originalText: { text: "Dokternya ramah.", languageCode: "id" },
  authorAttribution: {
    displayName: "Budi S.",
    uri: "https://www.google.com/maps/contrib/1",
    photoUri: "https://lh3.googleusercontent.com/a/photo",
  },
  publishTime: "2026-10-01T03:00:00Z",
  googleMapsUri: "https://www.google.com/maps/reviews/r1",
};

describe("Places adapter: Google Reviews", () => {
  it("sends one Place Details call asking for the reviews field only", async () => {
    const places = fakePlaces(() => Response.json({ reviews: [GOOGLE_REVIEW] }));

    await adapterWith(places).getGoogleReviews({ placeId: "ChIJ-gubeng-dental", language: "en" });

    expect(places.seen).toHaveLength(1);
    expect(places.seen[0]?.url).toBe(
      "https://places.googleapis.com/v1/places/ChIJ-gubeng-dental?languageCode=en&regionCode=ID",
    );
    expect(places.seen[0]?.headers.get("x-goog-fieldmask")).toBe("reviews");
  });

  it("returns each review with its author name, photo and link as Google gave them", async () => {
    const result = await adapterWith(fakePlaces(() => Response.json({ reviews: [GOOGLE_REVIEW] }))).getGoogleReviews({
      placeId: "ChIJ-gubeng-dental",
      language: "id",
    });

    expect(result).toEqual({
      ok: true,
      reviews: [
        {
          rating: 5,
          text: "Dokternya ramah.",
          relativeTime: "2 minggu lalu",
          publishTime: "2026-10-01T03:00:00Z",
          author: {
            name: "Budi S.",
            uri: "https://www.google.com/maps/contrib/1",
            photoUri: "https://lh3.googleusercontent.com/a/photo",
          },
          googleMapsUri: "https://www.google.com/maps/reviews/r1",
        },
      ],
    });
  });

  it("stops at its own cap of 33 a day", async () => {
    const places = fakePlaces(() => Response.json({ reviews: [] }));
    const adapter = adapterWith(places);

    for (let i = 0; i < 33; i++) await adapter.getGoogleReviews({ placeId: "p", language: "id" });
    const over = await adapter.getGoogleReviews({ placeId: "p", language: "id" });

    expect(places.seen).toHaveLength(33);
    expect(over).toEqual({ ok: false, reason: "cap_reached" });
  });
});

const GOOGLE_SUGGESTIONS = {
  suggestions: [
    {
      placePrediction: {
        placeId: "ChIJ-gubeng-dental",
        structuredFormat: {
          mainText: { text: "Klinik Gigi Senyum Gubeng" },
          secondaryText: { text: "Jl. Raya Gubeng No. 1, Surabaya" },
        },
      },
    },
    { placePrediction: { placeId: "ChIJ-no-secondary", structuredFormat: { mainText: { text: "drg. Ani" } } } },
    // A query prediction carries no place: the picker cannot use it.
    { queryPrediction: { text: { text: "klinik gigi dekat saya" } } },
  ],
};

const PICKER: AutocompleteRequest = { input: "klinik senyum", sessionToken: "token-1234abcd", language: "id" };

describe("Places adapter: Testimony provider picker (Autocomplete)", () => {
  it("sends one Autocomplete (New) call restricted to Indonesia and dentist and hospital types, with the session token", async () => {
    const places = fakePlaces(() => Response.json(GOOGLE_SUGGESTIONS));

    await adapterWith(places).autocomplete(PICKER);

    expect(places.seen).toHaveLength(1);
    const [call] = places.seen;
    expect(call?.url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("x-goog-api-key")).toBe("test-places-key");
    expect(call?.headers.get("x-goog-fieldmask")).toBe(
      "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
    );
    expect(call?.body).toEqual({
      input: "klinik senyum",
      sessionToken: "token-1234abcd",
      includedPrimaryTypes: ["dentist", "hospital"],
      includedRegionCodes: ["id"],
      languageCode: "id",
      regionCode: "ID",
    });
  });

  it("biases to a circle only when the Patient shared their location", async () => {
    const places = fakePlaces(() => Response.json(GOOGLE_SUGGESTIONS));

    await adapterWith(places).autocomplete({
      ...PICKER,
      locationBias: { center: { lat: -7.2756, lng: 112.7509 }, radiusMeters: 20_000 },
    });

    expect(places.seen[0]?.body.locationBias).toEqual({
      circle: { center: { latitude: -7.2756, longitude: 112.7509 }, radius: 20_000 },
    });
    const unbiased = fakePlaces(() => Response.json(GOOGLE_SUGGESTIONS));
    await adapterWith(unbiased).autocomplete(PICKER);
    expect(unbiased.seen[0]?.body).not.toHaveProperty("locationBias");
  });

  it("returns place suggestions with Google's main and secondary text, skipping query predictions", async () => {
    const result = await adapterWith(fakePlaces(() => Response.json(GOOGLE_SUGGESTIONS))).autocomplete(PICKER);

    expect(result).toEqual({
      ok: true,
      suggestions: [
        {
          placeId: "ChIJ-gubeng-dental",
          mainText: "Klinik Gigi Senyum Gubeng",
          secondaryText: "Jl. Raya Gubeng No. 1, Surabaya",
        },
        { placeId: "ChIJ-no-secondary", mainText: "drg. Ani" },
      ],
    });
  });

  it("answers no suggestions when Google has none", async () => {
    const result = await adapterWith(fakePlaces(() => Response.json({}))).autocomplete(PICKER);

    expect(result).toEqual({ ok: true, suggestions: [] });
  });

  it("stops calling Google once the Autocomplete cap of 300 a day is used up", async () => {
    const places = fakePlaces(() => Response.json(GOOGLE_SUGGESTIONS));
    const adapter = adapterWith(places);

    for (let i = 0; i < 300; i++) await adapter.autocomplete(PICKER);
    const over = await adapter.autocomplete(PICKER);

    expect(places.seen).toHaveLength(300);
    expect(over).toEqual({ ok: false, reason: "cap_reached" });
  });

  it("treats RESOURCE_EXHAUSTED as cap reached and stops calling for the day", async () => {
    const places = fakePlaces(() => new Response("{}", { status: 429 }));
    const adapter = adapterWith(places);

    const first = await adapter.autocomplete(PICKER);
    const second = await adapter.autocomplete(PICKER);

    expect(first).toEqual({ ok: false, reason: "cap_reached" });
    expect(second).toEqual({ ok: false, reason: "cap_reached" });
    expect(places.seen).toHaveLength(1);
  });

  it("reports Google being down, a bad answer or a network error as unavailable", async () => {
    const down = await adapterWith(fakePlaces(() => new Response("{}", { status: 503 }))).autocomplete(PICKER);
    const garbled = await adapterWith(fakePlaces(() => new Response("not json"))).autocomplete(PICKER);
    const offline = await createGooglePlacesAdapter({
      apiKey: "k",
      quota: createMemoryDailyQuota(),
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    }).autocomplete(PICKER);

    expect(down).toEqual({ ok: false, reason: "unavailable" });
    expect(garbled).toEqual({ ok: false, reason: "unavailable" });
    expect(offline).toEqual({ ok: false, reason: "unavailable" });
  });

  it("never makes a Place Details call", async () => {
    const places = fakePlaces(() => Response.json(GOOGLE_SUGGESTIONS));

    await adapterWith(places).autocomplete(PICKER);

    expect(places.seen.every((call) => call.url.endsWith("places:autocomplete"))).toBe(true);
  });
});

describe("Places adapter: coordinates for a new Listed Provider", () => {
  it("sends one Place Details call with the Essentials field mask `location` only", async () => {
    const places = fakePlaces(() => Response.json({ location: { latitude: -7.2756, longitude: 112.7509 } }));

    const result = await adapterWith(places).getCoordinates("ChIJ-gubeng-dental");

    expect(places.seen).toHaveLength(1);
    const [call] = places.seen;
    expect(call?.method).toBe("GET");
    expect(call?.url.startsWith("https://places.googleapis.com/v1/places/ChIJ-gubeng-dental")).toBe(true);
    expect(call?.headers.get("x-goog-fieldmask")).toBe("location");
    expect(result).toEqual({ ok: true, location: { lat: -7.2756, lng: 112.7509 } });
  });

  it("stops at its own small daily cap, so the Provider page keeps most of the shared Place Details quota", async () => {
    const places = fakePlaces(() => Response.json({ location: { latitude: 1, longitude: 2 } }));
    const adapter = adapterWith(places);

    for (let i = 0; i < COORDINATES_DAILY_CAP; i++) await adapter.getCoordinates("p");
    const over = await adapter.getCoordinates("p");

    expect(COORDINATES_DAILY_CAP).toBeLessThanOrEqual(20);
    expect(places.seen).toHaveLength(COORDINATES_DAILY_CAP);
    expect(over).toEqual({ ok: false, reason: "cap_reached" });
  });

  it("treats RESOURCE_EXHAUSTED as cap reached, an unknown place as not found, and an answer without a location as unavailable", async () => {
    const exhausted = await adapterWith(fakePlaces(() => new Response("{}", { status: 429 }))).getCoordinates("p");
    const unknown = await adapterWith(fakePlaces(() => new Response("{}", { status: 404 }))).getCoordinates("p");
    const empty = await adapterWith(fakePlaces(() => Response.json({}))).getCoordinates("p");

    expect(exhausted).toEqual({ ok: false, reason: "cap_reached" });
    expect(unknown).toEqual({ ok: false, reason: "not_found" });
    expect(empty).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("Places adapter: Google's name for Moderation", () => {
  it("sends one Place Details call with the field mask `displayName` only, in the author's language", async () => {
    const places = fakePlaces(() => Response.json({ displayName: { text: "Klinik Gigi Senyum Gubeng" } }));

    const result = await adapterWith(places).getDisplayName({ placeId: "ChIJ-gubeng-dental", language: "id" });

    expect(places.seen).toHaveLength(1);
    const [call] = places.seen;
    expect(call?.method).toBe("GET");
    expect(call?.url.startsWith("https://places.googleapis.com/v1/places/ChIJ-gubeng-dental?languageCode=id")).toBe(
      true,
    );
    expect(call?.headers.get("x-goog-fieldmask")).toBe("displayName");
    expect(result).toEqual({ ok: true, displayName: "Klinik Gigi Senyum Gubeng" });
  });

  it("stops at its own small daily cap, so the Provider page keeps most of the shared Place Details quota", async () => {
    const places = fakePlaces(() => Response.json({ displayName: { text: "Klinik" } }));
    const adapter = adapterWith(places);

    for (let i = 0; i < MODERATION_NAME_DAILY_CAP; i++) await adapter.getDisplayName({ placeId: "p", language: "id" });
    const over = await adapter.getDisplayName({ placeId: "p", language: "id" });

    expect(MODERATION_NAME_DAILY_CAP).toBeLessThanOrEqual(20);
    expect(places.seen).toHaveLength(MODERATION_NAME_DAILY_CAP);
    expect(over).toEqual({ ok: false, reason: "cap_reached" });
  });

  it("treats an answer without a name as unavailable", async () => {
    const empty = await adapterWith(fakePlaces(() => Response.json({}))).getDisplayName({
      placeId: "p",
      language: "id",
    });

    expect(empty).toEqual({ ok: false, reason: "unavailable" });
  });
});
