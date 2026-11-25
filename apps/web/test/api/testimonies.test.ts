// Posting a Testimony (spec 03, T11 and T13) through the web API: sign-in and
// protection, validation, the one-per-Provider rule, every Moderation decision path
// (fix-before-submit, holds, Kunjungan terbukti), Listed Provider creation,
// aggregates, and that Google's name is never stored.
import type { ModerationDecision, ProofOfVisitExtraction } from "@findyourdent/contracts";
import {
  COLLECTIONS,
  IMPACT_COUNTERS,
  type ModerationDecisionDoc,
  type ProviderDoc,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import { getAuth } from "firebase-admin/auth";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type {
  TestimonyApiError,
  TestimonyAuthorFixResponse,
  TestimonyProofResponse,
  TestimonyStoredResponse,
  TestimonySubmission,
} from "../../app/lib/testimony.ts";
import { AgentUnavailableError } from "../../server/adapters/agent.ts";
import { distinctTestimonyText, submittedBeforeDetectionWindow } from "../support/fixtures.ts";
import { startTestServer, type TestServer } from "../support/harness.ts";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

beforeEach(async () => {
  await server.reset();
});

const NEW_PLACE = "ChIJ-new-klinik-ceria";

function submission(overrides: Partial<TestimonySubmission> = {}): TestimonySubmission {
  return {
    placeId: NEW_PLACE,
    providerName: "  Klinik Gigi Ceria  ",
    region: { provinceCode: "31", regencyCode: "31.71" },
    ratings: { service: 5, hygiene: 4, materialsEquipment: 3 },
    text: "Dokternya sabar menjelaskan pilihan tambalan dan ruangannya bersih.",
    visitMonth: "2026-09",
    procedureCode: "scaling",
    pricePaidRupiah: 300_000,
    displayName: "Siti R.",
    consent: { honestExperience: true, noOthersPersonalData: true },
    ...overrides,
  };
}

interface SendOptions {
  cookie?: string;
  photos?: Buffer[];
  proof?: { bytes: Buffer; type: string };
  appCheck?: boolean;
  method?: "POST" | "DELETE";
}

async function send(path: string, body: unknown, options: SendOptions = {}): Promise<Response> {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.appCheck !== false) headers.set(APP_CHECK_HEADER, server.appCheckToken());
  let form: FormData | undefined;
  if (body !== undefined) {
    form = new FormData();
    form.set("testimony", JSON.stringify(body));
    for (const [i, bytes] of (options.photos ?? []).entries()) {
      form.append("photos", new File([new Uint8Array(bytes)], `foto-${i}.jpg`, { type: "image/jpeg" }));
    }
    if (options.proof) {
      form.set("proof", new File([new Uint8Array(options.proof.bytes)], "struk", { type: options.proof.type }));
    }
  }
  return fetch(new URL(path, server.baseUrl), { method: options.method ?? "POST", headers, body: form });
}

const create = (body: unknown, options?: SendOptions) => send("/api/testimonies", body, options);
const edit = (id: string, body: unknown, options?: SendOptions) => send(`/api/testimonies/${id}`, body, options);
const remove = (id: string, options: SendOptions = {}) =>
  send(`/api/testimonies/${id}`, undefined, { ...options, method: "DELETE" });

async function createOk(body: unknown, options: SendOptions): Promise<TestimonyStoredResponse> {
  const response = await create(body, options);
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as TestimonyStoredResponse;
}

const PUBLISH: ModerationDecision = {
  decision: "publish",
  ruleCodes: [],
  flaggedSpans: [],
  confidence: 0.95,
  authorMessage: "Terima kasih!",
};

const HOLD: ModerationDecision = {
  decision: "hold",
  ruleCodes: ["r2_accusation_as_fact"],
  flaggedSpans: [],
  confidence: 0.9,
  authorMessage: "Testimoni Anda ditinjau tim.",
};

const PHONE_TEXT = "Dokternya sabar. Hubungi saja 0812-3456-7890 untuk janji. Ruangannya bersih.";

/** An R1 authorFix flagging the phone number in PHONE_TEXT. */
const AUTHOR_FIX: ModerationDecision = {
  decision: "authorFix",
  ruleCodes: ["r1_personal_data"],
  flaggedSpans: [{ start: 30, end: 44, text: "0812-3456-7890", ruleCode: "r1_personal_data" }],
  confidence: 0.9,
  authorMessage: "Mohon hapus nomor telepon sebelum mengirim.",
};

const moderateWith = (decision: unknown) => server.fakes.agent.respondToModerationWith(decision);

async function signIn(email: string): Promise<{ cookie: string; uid: string }> {
  const cookie = await server.signInWithGoogle(email);
  const { uid } = await getAuth().getUserByEmail(email);
  return { cookie, uid };
}

async function testimony(id: string): Promise<TestimonyDoc> {
  return (await server.firestore.collection(COLLECTIONS.testimonies).doc(id).get()).data() as TestimonyDoc;
}

async function provider(placeId: string): Promise<ProviderDoc | undefined> {
  return (await server.firestore.collection(COLLECTIONS.providers).doc(placeId).get()).data() as
    | ProviderDoc
    | undefined;
}

async function count(collection: string): Promise<number> {
  return (await server.firestore.collection(collection).count().get()).data().count;
}

async function counter(key: keyof typeof IMPACT_COUNTERS): Promise<number> {
  const snapshot = await server.firestore.collection(COLLECTIONS.counters).doc(IMPACT_COUNTERS[key]).get();
  return (snapshot.get("value") as number | undefined) ?? 0;
}

async function storedObjects(prefix = ""): Promise<string[]> {
  const [files] = await server.uploads.getFiles({ prefix });
  return files.map((file) => file.name);
}

async function photo(): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: "#7fb3d5" } })
    .jpeg()
    .toBuffer();
}

/** A phone photo with GPS coordinates in its EXIF. */
async function photoWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: "#7fb3d5" } })
    .jpeg()
    .withExifMerge({
      IFD0: { Make: "PhoneCo" },
      IFD3: { GPSLatitudeRef: "S", GPSLatitude: "6/1 10/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "106/1 49/1 0/1" },
    })
    .toBuffer();
}

/** Every document in every collection, serialised, so a test can look for a string anywhere. */
async function wholeFirestore(): Promise<string> {
  const collections = await server.firestore.listCollections();
  const dumps = await Promise.all(
    collections.map(async (collection) => {
      const snapshot = await collection.get();
      return snapshot.docs.map((doc) => JSON.stringify({ id: doc.id, ...doc.data() }));
    }),
  );
  return dumps.flat().join("\n");
}

describe("POST /api/testimonies: who may post", () => {
  it("refuses a signed-out Patient and stores nothing", async () => {
    const response = await create(submission(), { photos: [await photo()] });
    expect(response.status).toBe(401);
    const body = (await response.json()) as TestimonyApiError;
    expect(body.error).toBe("sign_in_required");
    expect(body.message).toMatch(/Google/);
    expect(await count(COLLECTIONS.testimonies)).toBe(0);
    expect(await storedObjects()).toEqual([]);
  });

  it("refuses a request without App Check", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const response = await create(submission(), { cookie, appCheck: false });
    expect(response.status).toBe(401);
    expect(((await response.json()) as TestimonyApiError).error).toBe("app_check_required");
    expect(await count(COLLECTIONS.testimonies)).toBe(0);
  });

  it("refuses a sixth submission by the same account within a day", async () => {
    const { cookie } = await signIn("pasien@example.com");
    for (let i = 1; i <= 5; i++) {
      await createOk(submission({ placeId: `ChIJ-place-${i}` }), { cookie });
    }
    const sixth = await create(submission({ placeId: "ChIJ-place-6" }), { cookie });
    expect(sixth.status).toBe(429);
    expect(((await sixth.json()) as TestimonyApiError).error).toBe("rate_limited");
    expect(await count(COLLECTIONS.testimonies)).toBe(5);
  });
});

describe("POST /api/testimonies: validation", () => {
  it("returns a localized message per invalid field and stores nothing", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const response = await create(
      {
        placeId: NEW_PLACE,
        providerName: "   ",
        region: { provinceCode: "31", regencyCode: "35.78" },
        ratings: { service: 0, hygiene: 4.5, materialsEquipment: 6 },
        text: "   ",
        visitMonth: "2999-01",
        procedureCode: "not_a_procedure",
        pricePaidRupiah: -1,
        displayName: "",
        consent: { honestExperience: true, noOthersPersonalData: false },
      },
      { cookie },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as TestimonyApiError;
    expect(body.error).toBe("invalid_submission");
    expect(Object.keys(body.fieldErrors ?? {}).sort()).toEqual(
      [
        "consent",
        "displayName",
        "pricePaidRupiah",
        "procedureCode",
        "providerName",
        "ratings.hygiene",
        "ratings.materialsEquipment",
        "ratings.service",
        "region.regencyCode",
        "text",
        "visitMonth",
      ].sort(),
    );
    expect(body.fieldErrors?.visitMonth).toMatch(/masa depan/);
    expect(await count(COLLECTIONS.testimonies)).toBe(0);
  });

  it("requires the typed name and Region only for a place that is not Listed yet", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const missing = await create(submission({ providerName: undefined, region: undefined }), { cookie });
    expect(missing.status).toBe(400);
    const { fieldErrors } = (await missing.json()) as TestimonyApiError;
    expect(Object.keys(fieldErrors ?? {}).sort()).toEqual(["providerName", "region.provinceCode"]);

    await server.firestore
      .collection(COLLECTIONS.providers)
      .doc("ChIJ-listed")
      .set({
        placeId: "ChIJ-listed",
        name: "Klinik Gigi Terdaftar",
        nameSource: "testimonyAuthor",
        nameNormalized: "klinik gigi terdaftar",
        region: { provinceCode: "35", regencyCode: "35.78" },
        providerType: "klinik",
        providerTypeSource: "inferred",
        claimStatus: "unclaimed",
        aggregates: { testimonyCount: 0, verifiedVisitCount: 0, averages: null, procedurePrices: {} },
        listedBy: "testimony",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    const listed = await create(submission({ placeId: "ChIJ-listed", providerName: undefined, region: undefined }), {
      cookie,
    });
    expect(listed.status).toBe(201);
  });
});

describe("Moderation: publish", () => {
  it("publishes and makes the place a Listed Provider with the typed name, Region and coordinates", async () => {
    const { cookie, uid } = await signIn("pasien@example.com");
    const { testimonyId, status } = await createOk(submission(), { cookie });
    expect(status).toBe("published");

    const stored = await testimony(testimonyId);
    expect(stored).toMatchObject({
      placeId: NEW_PLACE,
      authorUid: uid,
      status: "published",
      text: "Dokternya sabar menjelaskan pilihan tambalan dan ruangannya bersih.",
      displayName: "Siti R.",
      region: { provinceCode: "31", regencyCode: "31.71" },
      providerType: "klinik",
      verifiedVisit: false,
      consent: { termsVersion: "2026-10" },
    });
    expect(stored.publishedAt).toBeDefined();
    expect(stored.proposedProviderName).toBeUndefined();
    expect(stored.proofOfVisit).toBeUndefined();

    expect(server.fakes.places.coordinatesCalls).toEqual([NEW_PLACE]);
    const listed = await provider(NEW_PLACE);
    expect(listed).toMatchObject({
      placeId: NEW_PLACE,
      name: "Klinik Gigi Ceria",
      nameSource: "testimonyAuthor",
      nameNormalized: "klinik gigi ceria",
      region: { provinceCode: "31", regencyCode: "31.71" },
      providerType: "klinik",
      providerTypeSource: "inferred",
      claimStatus: "unclaimed",
      listedBy: "testimony",
      location: { lat: -6.1754, lng: 106.8272 },
      // Without an accepted Proof of Visit it is counted but moves no score or price (spec 09).
      aggregates: { testimonyCount: 1, verifiedVisitCount: 0, averages: null, procedurePrices: {} },
    });
    expect(listed?.location?.fetchedAt).toBeDefined();
    expect(await count(COLLECTIONS.providers)).toBe(1);
    expect(await counter("testimoniesPublished")).toBe(1);

    const decision = (
      await server.firestore
        .collection(COLLECTIONS.moderationDecisions)
        .doc(stored.moderationDecisionId ?? "-")
        .get()
    ).data() as ModerationDecisionDoc;
    expect(decision).toMatchObject({
      subjectType: "testimony",
      subjectId: testimonyId,
      placeId: NEW_PLACE,
      decision: "publish",
      ruleCodes: [],
      model: "gemini-3.5-flash-lite",
    });
  });

  it("infers a private dentist from a typed 'drg.' name", async () => {
    const { cookie } = await signIn("pasien@example.com");
    await createOk(submission({ providerName: "drg. Ayu Lestari" }), { cookie });
    expect((await provider(NEW_PLACE))?.providerType).toBe("privateDentist");
  });

  it.each(["hospital", "general_hospital"])(
    "lists a place Google types as %s as a hospital, whatever the typed name",
    async (type) => {
      server.fakes.places.respondWithCoordinates({
        ok: true,
        location: { lat: -7.2684, lng: 112.7584 },
        types: [type, "health", "point_of_interest"],
      });
      const { cookie } = await signIn("pasien@example.com");
      const { testimonyId } = await createOk(submission({ providerName: "RSUD Dr. Soetomo" }), { cookie });
      expect((await provider(NEW_PLACE))?.providerType).toBe("hospital");
      expect((await testimony(testimonyId))?.providerType).toBe("hospital");
    },
  );

  it("lists the place without coordinates when the Essentials call fails", async () => {
    server.fakes.places.respondWithCoordinates({ ok: false, reason: "cap_reached" });
    const { cookie } = await signIn("pasien@example.com");
    await createOk(submission(), { cookie });
    const listed = await provider(NEW_PLACE);
    expect(listed?.name).toBe("Klinik Gigi Ceria");
    expect(listed?.location).toBeUndefined();
  });

  it("keeps the Listed name for a later author and updates the aggregates", async () => {
    const first = await signIn("pertama@example.com");
    await createOk(submission(), { cookie: first.cookie });
    const second = await signIn("kedua@example.com");
    const { status } = await createOk(
      submission({
        // A text of its own: the same text twice at one place is held as templated (D2).
        text: distinctTestimonyText(1),
        providerName: "Nama Lain Yang Diabaikan",
        region: { provinceCode: "35", regencyCode: "35.78" },
        ratings: { service: 2, hygiene: 3, materialsEquipment: 4 },
        pricePaidRupiah: 100_000,
      }),
      { cookie: second.cookie },
    );
    expect(status).toBe("published");
    const listed = await provider(NEW_PLACE);
    expect(listed?.name).toBe("Klinik Gigi Ceria");
    expect(listed?.region).toEqual({ provinceCode: "31", regencyCode: "31.71" });
    expect(listed?.aggregates).toEqual({
      testimonyCount: 2,
      verifiedVisitCount: 0,
      averages: null,
      procedurePrices: {},
      paymentMethodCounts: { pribadi: 0, bpjs: 0, asuransi: 0, insurers: {} },
    });
    expect(server.fakes.places.coordinatesCalls).toEqual([NEW_PLACE]);
    expect(await counter("testimoniesPublished")).toBe(2);
  });

  it("creates exactly one Listed Provider when two first Testimonies publish at once", async () => {
    const [a, b] = await Promise.all([signIn("a@example.com"), signIn("b@example.com")]);
    const results = await Promise.all([
      createOk(submission({ providerName: "Klinik A" }), { cookie: a.cookie }),
      createOk(submission({ providerName: "Klinik B", text: distinctTestimonyText(1) }), { cookie: b.cookie }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["published", "published"]);
    expect(await count(COLLECTIONS.providers)).toBe(1);
    const listed = await provider(NEW_PLACE);
    expect(["Klinik A", "Klinik B"]).toContain(listed?.name);
    expect(listed?.aggregates.testimonyCount).toBe(2);
  });
});

describe("Moderation: hold", () => {
  it("holds the Testimony, keeps the typed name on it and creates no Listed Provider", async () => {
    moderateWith(HOLD);
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId, status } = await createOk(submission(), { cookie });
    expect(status).toBe("held");
    const stored = await testimony(testimonyId);
    expect(stored.status).toBe("held");
    expect(stored.proposedProviderName).toBe("Klinik Gigi Ceria");
    expect(stored.publishedAt).toBeUndefined();
    expect(await count(COLLECTIONS.providers)).toBe(0);
    expect(server.fakes.places.coordinatesCalls).toEqual([]);
    expect(await counter("testimoniesPublished")).toBe(0);
    const decision = (
      await server.firestore
        .collection(COLLECTIONS.moderationDecisions)
        .doc(stored.moderationDecisionId ?? "-")
        .get()
    ).data() as ModerationDecisionDoc;
    expect(decision).toMatchObject({
      decision: "hold",
      ruleCodes: ["r2_accusation_as_fact"],
      model: "gemini-3.5-flash-lite",
    });
  });

  it("keeps an edited held Testimony held for the admin even when Moderation would publish", async () => {
    moderateWith(HOLD);
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    moderateWith(PUBLISH);
    const response = await edit(testimonyId, submission({ providerName: undefined, region: undefined }), { cookie });
    expect(response.status).toBe(200);
    expect(((await response.json()) as TestimonyStoredResponse).status).toBe("held");
    expect(await provider(NEW_PLACE)).toBeUndefined();
    expect((await testimony(testimonyId)).proposedProviderName).toBe("Klinik Gigi Ceria");
  });

  it("publishes a fixed Testimony, creating the Listed Provider then", async () => {
    moderateWith(HOLD);
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    // Sent back to the author by the admin queue (T14).
    await server.firestore.collection(COLLECTIONS.testimonies).doc(testimonyId).update({ status: "needsAuthorFix" });
    moderateWith(PUBLISH);
    const response = await edit(testimonyId, submission({ providerName: undefined, region: undefined }), { cookie });
    expect(response.status).toBe(200);
    expect(((await response.json()) as TestimonyStoredResponse).status).toBe("published");
    expect((await provider(NEW_PLACE))?.name).toBe("Klinik Gigi Ceria");
    expect((await testimony(testimonyId)).proposedProviderName).toBeUndefined();
    expect(await counter("testimoniesPublished")).toBe(1);
  });
});

async function decisionOf(id: string | undefined): Promise<ModerationDecisionDoc> {
  const snapshot = await server.firestore
    .collection(COLLECTIONS.moderationDecisions)
    .doc(id ?? "-")
    .get();
  return snapshot.data() as ModerationDecisionDoc;
}

describe("Moderation: what the agent is asked", () => {
  it("sends the text, Google's live name, the typed name, the photos and the Proof of Visit, but no star ratings", async () => {
    const { cookie } = await signIn("pasien@example.com");
    await createOk(submission(), {
      cookie,
      photos: [await photo()],
      proof: { bytes: await photo(), type: "image/jpeg" },
    });

    expect(server.fakes.places.displayNameCalls).toEqual([{ placeId: NEW_PLACE, language: "id" }]);
    const [request] = server.fakes.agent.moderationCalls;
    expect(request).toMatchObject({
      subjectType: "testimony",
      language: "id",
      text: submission().text,
      typedProviderName: "Klinik Gigi Ceria",
      googleDisplayName: "Fake Google Place",
      visitMonth: "2026-09",
      procedureCode: "scaling",
      authorFixRound: 0,
      proofOfVisit: { mimeType: "image/jpeg" },
    });
    expect(request?.photos).toHaveLength(1);
    expect(request?.photos?.[0]?.mimeType).toBe("image/jpeg");
    const sent = Buffer.from(request?.photos?.[0]?.dataBase64 ?? "", "base64");
    expect((await sharp(sent).metadata()).width).toBe(640);
    expect(JSON.stringify(request)).not.toContain("ratings");
  });

  it("still screens on the typed name when Google's name is unavailable", async () => {
    server.fakes.places.respondWithDisplayName({ ok: false, reason: "cap_reached" });
    const { cookie } = await signIn("pasien@example.com");
    const { status } = await createOk(submission(), { cookie });

    expect(status).toBe("published");
    expect(server.fakes.agent.moderationCalls[0]?.googleDisplayName).toBeUndefined();
    expect(server.fakes.agent.moderationCalls[0]?.typedProviderName).toBe("Klinik Gigi Ceria");
  });
});

describe("Moderation: fix before submit", () => {
  it("returns the flagged spans and message without storing anything, then publishes the fixed text", async () => {
    moderateWith(AUTHOR_FIX);
    const { cookie } = await signIn("pasien@example.com");
    // Leading blank lines are trimmed before Moderation; the answer says what was screened.
    const response = await create(submission({ text: `\n  ${PHONE_TEXT}` }), {
      cookie,
      photos: [await photo()],
      proof: { bytes: await photo(), type: "image/jpeg" },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as TestimonyAuthorFixResponse;
    expect(body).toEqual({
      status: "needsAuthorFix",
      message: "Mohon hapus nomor telepon sebelum mengirim.",
      text: PHONE_TEXT,
      ruleCodes: ["r1_personal_data"],
      flaggedSpans: AUTHOR_FIX.flaggedSpans,
      roundsLeft: 2,
    });
    expect(await count(COLLECTIONS.testimonies)).toBe(0);
    expect(await count(COLLECTIONS.moderationDecisions)).toBe(0);
    expect(await storedObjects()).toEqual([]);
    expect(await wholeFirestore()).not.toContain("0812-3456-7890");

    moderateWith(PUBLISH);
    const fixed = await createOk(submission({ text: "Dokternya sabar. Ruangannya bersih." }), { cookie });
    expect(fixed.status).toBe("published");
    expect(server.fakes.agent.moderationCalls[1]?.authorFixRound).toBe(1);
    expect((await testimony(fixed.testimonyId)).authorFixRounds).toBe(1);
  });

  it("holds the Testimony for the team after three rounds of fixes", async () => {
    // The agent holds at round three itself; the web service does not rely on it.
    moderateWith(AUTHOR_FIX);
    const { cookie } = await signIn("pasien@example.com");
    const rounds: number[] = [];
    for (let round = 0; round < 3; round++) {
      const response = await create(submission({ text: PHONE_TEXT }), { cookie });
      expect(response.status).toBe(200);
      rounds.push(((await response.json()) as TestimonyAuthorFixResponse).roundsLeft);
    }
    expect(rounds).toEqual([2, 1, 0]);

    const held = await createOk(submission({ text: PHONE_TEXT }), { cookie });
    expect(held.status).toBe("held");
    expect(server.fakes.agent.moderationCalls.map((call) => call.authorFixRound)).toEqual([0, 1, 2, 3]);
    const stored = await testimony(held.testimonyId);
    expect(stored).toMatchObject({ status: "held", authorFixRounds: 3 });
    expect(await decisionOf(stored.moderationDecisionId)).toMatchObject({
      decision: "hold",
      ruleCodes: ["r1_personal_data"],
    });
  });

  it("leaves a published Testimony as it was when an edit needs a fix", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    moderateWith(AUTHOR_FIX);
    const response = await edit(testimonyId, submission({ text: PHONE_TEXT }), { cookie, photos: [await photo()] });

    expect(response.status).toBe(200);
    expect((await response.json()) as TestimonyAuthorFixResponse).toMatchObject({
      status: "needsAuthorFix",
      testimonyId,
      roundsLeft: 2,
    });
    const stored = await testimony(testimonyId);
    expect(stored).toMatchObject({ status: "published", text: submission().text });
    expect(stored.pendingRevision).toBeUndefined();
    expect(await storedObjects(`testimonies/${testimonyId}/`)).toEqual([]);
  });
});

describe("Moderation: holds", () => {
  it("tells the author the plain reason and the 24-hour target", async () => {
    moderateWith(HOLD);
    const { cookie } = await signIn("pasien@example.com");
    const held = await createOk(submission(), { cookie });

    expect(held.status).toBe("held");
    expect(held.message).toContain("tuduhan");
    expect(held.message).toContain("24 jam");
  });

  it("tells a low-confidence hold, a photo hold and a first-round fixable hold apart", async () => {
    const reasons = async (decision: ModerationDecision, placeId: string) => {
      moderateWith(decision);
      const { cookie } = await signIn(`pasien.${placeId}@example.com`);
      return (await createOk(submission({ placeId }), { cookie })).message;
    };
    const unsure = await reasons({ ...HOLD, ruleCodes: ["low_confidence"] }, "ChIJ-place-unsure");
    const photoHeld = await reasons(
      {
        ...HOLD,
        ruleCodes: ["photo_not_clinic_setting"],
        flaggedPhotos: [{ photoIndex: 0, ruleCode: "photo_not_clinic_setting" }],
      },
      "ChIJ-place-photo",
    );
    // Held at once beside a hold rule: no fix rounds were used, so none are mentioned.
    const firstRound = await reasons(
      { ...HOLD, ruleCodes: ["r1_personal_data", "r2_accusation_as_fact"] },
      "ChIJ-place-r1",
    );

    expect(unsure).toContain("belum cukup yakin");
    expect(photoHeld).toContain("foto");
    expect(firstRound).toContain("tuduhan");
    expect(firstRound).toContain("data pribadi");
    expect(firstRound).not.toContain("tiga kali");
    for (const message of [unsure, photoHeld, firstRound]) expect(message).toContain("24 jam");
  });

  it("holds as a model error, without Kunjungan terbukti, when the agent refuses the call, and keeps the unchecked Proof for the team", async () => {
    moderateWith(new AgentUnavailableError("agent responded 422", 422));
    const { cookie } = await signIn("pasien@example.com");
    const held = await createOk(submission(), { cookie, proof: { bytes: await photo(), type: "image/jpeg" } });

    expect(held).toMatchObject({ status: "held", verifiedVisit: false });
    expect(held.message).toContain("24 jam");
    const stored = await testimony(held.testimonyId);
    expect(stored.verifiedVisit).toBe(false);
    expect(stored.proofOfVisit).toMatchObject({ result: "pending", reasons: ["notChecked"] });
    expect(held.proof?.result).toBe("pending");
    expect(await decisionOf(stored.moderationDecisionId)).toMatchObject({
      decision: "hold",
      ruleCodes: ["model_error"],
      model: "fallback",
    });
    expect(await storedObjects("proof-of-visit/")).toHaveLength(1);
    expect(await count(COLLECTIONS.providers)).toBe(0);
  });

  it("holds as a model error when the agent's answer is not a valid decision", async () => {
    moderateWith({ decision: "publish" });
    const { cookie } = await signIn("pasien@example.com");
    const held = await createOk(submission(), { cookie });

    expect(held.status).toBe("held");
    const stored = await testimony(held.testimonyId);
    expect((await decisionOf(stored.moderationDecisionId)).ruleCodes).toEqual(["model_error"]);
  });
});

describe("Moderation: the author's own health details", () => {
  it("publishes with a gentle note, never a hold", async () => {
    moderateWith({ ...PUBLISH, ownHealthDataWarning: true });
    const { cookie } = await signIn("pasien@example.com");
    const published = await createOk(submission(), { cookie });

    expect(published).toMatchObject({ status: "published", ownHealthDataWarning: true });
  });
});

describe("Moderation: Proof of Visit", () => {
  /** What the agent read off a receipt from the right clinic, dated in the visit month (2026-09). */
  const read = (overrides: Partial<ProofOfVisitExtraction> = {}): ProofOfVisitExtraction => ({
    readable: true,
    isProofOfVisit: true,
    clinicNameOnProof: "Klinik Gigi Ceria Cabang Tebet",
    proofDate: "2026-09-12",
    totalRupiah: 300_000,
    clinicNameMatches: true,
    ...overrides,
  });
  const withProof = async (cookie: string, decision: ModerationDecision = PUBLISH) => {
    moderateWith(decision);
    return createOk(submission(), { cookie, proof: { bytes: await photo(), type: "image/jpeg" } });
  };

  it("accepts a matching proof: Kunjungan terbukti, the facts kept, the file deleted and the counter moved", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const published = await withProof(cookie, { ...PUBLISH, proofOfVisit: read() });

    expect(published).toMatchObject({ status: "published", verifiedVisit: true, proof: { result: "accepted" } });
    expect(published.proof?.message).toContain("Kunjungan terbukti");
    const stored = await testimony(published.testimonyId);
    expect(stored.verifiedVisit).toBe(true);
    expect(stored.proofOfVisit).toMatchObject({
      result: "accepted",
      extracted: { clinicName: "Klinik Gigi Ceria Cabang Tebet", proofDate: "2026-09-12", totalRupiah: 300_000 },
    });
    expect(stored.proofOfVisit?.checkedAt).toBeDefined();
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    expect((await provider(NEW_PLACE))?.aggregates.verifiedVisitCount).toBe(1);
    expect(await counter("verifiedVisits")).toBe(1);
  });

  it.each([
    ["unreadable", read({ readable: false, isProofOfVisit: false, clinicNameOnProof: undefined }), "membaca"],
    ["notAProof", read({ isProofOfVisit: false }), "bukan"],
    ["tooOld", read({ proofDate: "2024-03-02", clinicNameMatches: false }), "12 bulan"],
  ] as const)("rejects a %s proof with a plain reason and deletes the file", async (reason, proofOfVisit, words) => {
    const { cookie } = await signIn("pasien@example.com");
    const published = await withProof(cookie, { ...PUBLISH, proofOfVisit });

    expect(published).toMatchObject({ status: "published", verifiedVisit: false, proof: { result: "rejected" } });
    expect(published.proof?.message).toContain(words);
    const stored = await testimony(published.testimonyId);
    expect(stored.proofOfVisit).toMatchObject({ result: "rejected", reason });
    expect(stored.proofOfVisit).not.toHaveProperty("filePath");
    expect(stored.proofOfVisit).not.toHaveProperty("extracted");
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    expect(await counter("verifiedVisits")).toBe(0);
  });

  it("rejects a PDF that is not a proof and deletes it", async () => {
    moderateWith({ ...PUBLISH, proofOfVisit: read({ isProofOfVisit: false }) });
    const { cookie } = await signIn("pasien@example.com");
    const published = await createOk(submission(), {
      cookie,
      proof: { bytes: Buffer.from("%PDF-1.4\n%%EOF\n"), type: "application/pdf" },
    });

    expect((await testimony(published.testimonyId)).proofOfVisit).toMatchObject({
      result: "rejected",
      reason: "notAProof",
    });
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
  });

  it.each([
    ["another clinic's name", read({ clinicNameMatches: false, clinicNameOnProof: "Klinik Lain" }), ["nameMismatch"]],
    ["a date far from the visit month", read({ proofDate: "2026-05-02" }), ["dateMismatch"]],
    ["both", read({ clinicNameMatches: false, proofDate: "2026-05" }), ["nameMismatch", "dateMismatch"]],
  ] as const)(
    "sends a proof with %s to the team, keeps the file and publishes as Belum terbukti",
    async (_, proofOfVisit, reasons) => {
      const { cookie } = await signIn("pasien@example.com");
      const published = await withProof(cookie, { ...PUBLISH, proofOfVisit });

      expect(published).toMatchObject({ status: "published", verifiedVisit: false, proof: { result: "pending" } });
      expect(published.proof?.message).toContain("tim FindYourDent");
      const stored = await testimony(published.testimonyId);
      expect(stored.status).toBe("published");
      expect(stored.verifiedVisit).toBe(false);
      expect(stored.proofOfVisit).toMatchObject({ result: "pending", reasons });
      const kept = await storedObjects("proof-of-visit/");
      expect(kept).toHaveLength(1);
      expect(stored.proofOfVisit).toMatchObject({ filePath: kept[0] });
      expect((await provider(NEW_PLACE))?.aggregates.verifiedVisitCount).toBe(0);
      expect(await counter("verifiedVisits")).toBe(0);
    },
  );

  it("keeps a pending proof while the Testimony itself is held", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const held = await withProof(cookie, { ...HOLD, proofOfVisit: read({ clinicNameMatches: false }) });

    expect(held).toMatchObject({ status: "held", verifiedVisit: false, proof: { result: "pending" } });
    expect((await testimony(held.testimonyId)).proofOfVisit?.result).toBe("pending");
    expect(await storedObjects("proof-of-visit/")).toHaveLength(1);
  });

  it("deletes the Proof file when the Testimony needs a fix", async () => {
    moderateWith({ ...AUTHOR_FIX, proofOfVisit: read({ clinicNameMatches: false }) });
    const { cookie } = await signIn("pasien@example.com");
    await create(submission({ text: PHONE_TEXT }), { cookie, proof: { bytes: await photo(), type: "image/jpeg" } });

    expect(server.fakes.agent.moderationCalls[0]?.proofOfVisit).toBeDefined();
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
  });

  it("shows the proof status on Testimoni saya", async () => {
    const { cookie } = await signIn("pasien@example.com");
    await withProof(cookie, { ...PUBLISH, proofOfVisit: read({ clinicNameMatches: false }) });

    const page = await fetch(new URL("/testimoni-saya", server.baseUrl), { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Bukti kunjungan sedang diperiksa tim FindYourDent");
  });

  it("deletes a pending proof's file and record when the author deletes the Testimony", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await withProof(cookie, { ...PUBLISH, proofOfVisit: read({ clinicNameMatches: false }) });
    expect(await storedObjects("proof-of-visit/")).toHaveLength(1);

    expect((await remove(testimonyId, { cookie })).status).toBe(200);

    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    expect((await testimony(testimonyId)).proofOfVisit).toBeUndefined();
  });

  it("refuses a proof sent in an edit while the earlier one waits for the team, keeping the waiting file", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await withProof(cookie, { ...HOLD, proofOfVisit: read({ clinicNameMatches: false }) });
    const [waiting] = await storedObjects("proof-of-visit/");
    const calls = server.fakes.agent.moderationCalls.length;

    const response = await edit(testimonyId, submission(), {
      cookie,
      proof: { bytes: await photo(), type: "image/jpeg" },
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as TestimonyApiError).error).toBe("proof_pending");
    expect(server.fakes.agent.moderationCalls).toHaveLength(calls);
    expect((await testimony(testimonyId)).proofOfVisit).toMatchObject({ result: "pending", filePath: waiting });
    expect(await storedObjects("proof-of-visit/")).toEqual([waiting]);
  });

  it("never replaces an accepted proof with a later one", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await withProof(cookie, { ...HOLD, proofOfVisit: read() });

    moderateWith({ ...PUBLISH, proofOfVisit: read({ isProofOfVisit: false }) });
    await edit(testimonyId, submission(), { cookie, proof: { bytes: await photo(), type: "image/jpeg" } });

    const stored = await testimony(testimonyId);
    expect(stored.verifiedVisit).toBe(true);
    expect(stored.proofOfVisit?.result).toBe("accepted");
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
  });

  it("answers without a proof status when no proof was sent", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const published = await createOk(submission(), { cookie });

    expect(published).not.toHaveProperty("proof");
    expect((await testimony(published.testimonyId)).proofOfVisit).toBeUndefined();
  });
});

describe("POST /api/testimonies/:testimonyId/proof: attaching a Proof of Visit later", () => {
  /** What the agent read off a receipt from the right clinic, dated in the visit month (2026-09). */
  const read = (overrides: Partial<ProofOfVisitExtraction> = {}): ProofOfVisitExtraction => ({
    readable: true,
    isProofOfVisit: true,
    clinicNameOnProof: "Klinik Gigi Ceria",
    proofDate: "2026-09-12",
    clinicNameMatches: true,
    ...overrides,
  });
  const checkWith = (response: unknown) => server.fakes.agent.respondToProofCheckWith(response);
  const attach = async (id: string, options: SendOptions = {}) => {
    const headers = new Headers();
    if (options.cookie) headers.set("cookie", options.cookie);
    if (options.appCheck !== false) headers.set(APP_CHECK_HEADER, server.appCheckToken());
    const form = new FormData();
    const proof = options.proof ?? { bytes: await photo(), type: "image/jpeg" };
    form.set("proof", new File([new Uint8Array(proof.bytes)], "struk", { type: proof.type }));
    return fetch(new URL(`/api/testimonies/${id}/proof`, server.baseUrl), { method: "POST", headers, body: form });
  };
  const publishedWithoutProof = async (cookie: string) => {
    moderateWith(PUBLISH);
    const published = await createOk(submission(), { cookie });
    server.fakes.agent.moderationCalls.length = 0;
    return published.testimonyId;
  };

  it("accepts a matching proof without screening the Testimony again: Kunjungan terbukti, aggregates and counter moved", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const testimonyId = await publishedWithoutProof(cookie);
    const before = await testimony(testimonyId);
    checkWith({ proofOfVisit: read() });

    const response = await attach(testimonyId, { cookie });

    expect(response.status).toBe(200);
    const body = (await response.json()) as TestimonyProofResponse;
    expect(body).toMatchObject({ testimonyId, verifiedVisit: true, proof: { result: "accepted" } });
    expect(body.proof.message).toContain("Kunjungan terbukti");
    expect(server.fakes.agent.moderationCalls).toEqual([]);
    const [call] = server.fakes.agent.proofCheckCalls;
    expect(call).toMatchObject({ language: "id", visitMonth: "2026-09", proofOfVisit: { mimeType: "image/jpeg" } });
    expect(call).not.toHaveProperty("text");
    const stored = await testimony(testimonyId);
    expect(stored).toMatchObject({
      status: "published",
      text: before.text,
      verifiedVisit: true,
      proofAttempts: 1,
      moderationDecisionId: before.moderationDecisionId,
      proofOfVisit: { result: "accepted", extracted: { clinicName: "Klinik Gigi Ceria", proofDate: "2026-09-12" } },
    });
    expect(stored).not.toHaveProperty("pendingRevision");
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    expect((await provider(NEW_PLACE))?.aggregates.verifiedVisitCount).toBe(1);
    expect(await counter("verifiedVisits")).toBe(1);
  });

  it("sends a doubtful proof to the team: still published as Belum terbukti, the file kept", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const testimonyId = await publishedWithoutProof(cookie);
    checkWith({ proofOfVisit: read({ clinicNameMatches: false, clinicNameOnProof: "Klinik Lain" }) });

    const response = await attach(testimonyId, { cookie });

    expect(response.status).toBe(200);
    const body = (await response.json()) as TestimonyProofResponse;
    expect(body).toMatchObject({ verifiedVisit: false, proof: { result: "pending" }, proofAttemptsLeft: 2 });
    expect(body.proof.message).toContain("tim FindYourDent");
    const stored = await testimony(testimonyId);
    expect(stored).toMatchObject({ status: "published", verifiedVisit: false, proofAttempts: 1 });
    const kept = await storedObjects("proof-of-visit/");
    expect(kept).toHaveLength(1);
    expect(stored.proofOfVisit).toMatchObject({ result: "pending", reasons: ["nameMismatch"], filePath: kept[0] });
    expect((await provider(NEW_PLACE))?.aggregates.verifiedVisitCount).toBe(0);
    expect(await counter("verifiedVisits")).toBe(0);
  });

  it("refuses another proof while one waits for the team, so a held receipt is never wiped", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const testimonyId = await publishedWithoutProof(cookie);
    checkWith({ proofOfVisit: read({ clinicNameMatches: false }) });
    await attach(testimonyId, { cookie });
    const [waiting] = await storedObjects("proof-of-visit/");

    const response = await attach(testimonyId, { cookie });

    expect(response.status).toBe(409);
    const error = (await response.json()) as TestimonyApiError;
    expect(error.error).toBe("proof_pending");
    expect(error.message).toContain("tim FindYourDent");
    expect(server.fakes.agent.proofCheckCalls).toHaveLength(1);
    expect((await testimony(testimonyId)).proofOfVisit).toMatchObject({ result: "pending", filePath: waiting });
    expect(await storedObjects("proof-of-visit/")).toEqual([waiting]);
  });

  it("sends the proof to the team unchecked when the agent fails, never telling the author it is unreadable", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const testimonyId = await publishedWithoutProof(cookie);
    checkWith(new AgentUnavailableError("agent responded 503", 503));

    const body = (await (await attach(testimonyId, { cookie })).json()) as TestimonyProofResponse;

    expect(body.proof.result).toBe("pending");
    expect((await testimony(testimonyId)).proofOfVisit).toMatchObject({ result: "pending", reasons: ["notChecked"] });
  });

  it("allows 3 proof attempts counting the one at submission, then refuses with a plain message", async () => {
    const { cookie } = await signIn("pasien@example.com");
    moderateWith({ ...PUBLISH, proofOfVisit: read({ readable: false, isProofOfVisit: false }) });
    const { testimonyId } = await createOk(submission(), {
      cookie,
      proof: { bytes: await photo(), type: "image/jpeg" },
    });
    checkWith({ proofOfVisit: read({ isProofOfVisit: false }) });

    const second = (await (await attach(testimonyId, { cookie })).json()) as TestimonyProofResponse;
    expect(second).toMatchObject({ proof: { result: "rejected", reason: "notAProof" }, proofAttemptsLeft: 1 });
    const third = (await (await attach(testimonyId, { cookie })).json()) as TestimonyProofResponse;
    expect(third.proofAttemptsLeft).toBe(0);
    const calls = server.fakes.agent.proofCheckCalls.length;

    const fourth = await attach(testimonyId, { cookie });

    expect(fourth.status).toBe(409);
    const error = (await fourth.json()) as TestimonyApiError;
    expect(error.error).toBe("proof_attempts_used");
    expect(error.message).toContain("3 kali");
    expect(server.fakes.agent.proofCheckCalls).toHaveLength(calls);
    expect((await testimony(testimonyId)).proofAttempts).toBe(3);
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
  });

  it("counts a proof sent in an edit, and refuses an edit's proof once every attempt is used", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const testimonyId = await publishedWithoutProof(cookie);
    checkWith({ proofOfVisit: read({ isProofOfVisit: false }) });
    await attach(testimonyId, { cookie });
    await attach(testimonyId, { cookie });
    moderateWith({ ...PUBLISH, proofOfVisit: read({ isProofOfVisit: false }) });
    expect(
      (await edit(testimonyId, submission(), { cookie, proof: { bytes: await photo(), type: "image/jpeg" } })).status,
    ).toBe(200);
    expect((await testimony(testimonyId)).proofAttempts).toBe(3);

    const refused = await edit(testimonyId, submission(), {
      cookie,
      proof: { bytes: await photo(), type: "image/jpeg" },
    });

    expect(refused.status).toBe(409);
    expect(((await refused.json()) as TestimonyApiError).error).toBe("proof_attempts_used");
  });

  it("refuses another account, and leaves the Testimony as it was", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const testimonyId = await publishedWithoutProof(cookie);
    const other = await signIn("orang-lain@example.com");

    const response = await attach(testimonyId, { cookie: other.cookie });

    expect(response.status).toBe(403);
    expect(((await response.json()) as TestimonyApiError).error).toBe("forbidden");
    expect(server.fakes.agent.proofCheckCalls).toEqual([]);
    expect((await testimony(testimonyId)).proofOfVisit).toBeUndefined();
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    expect((await attach(testimonyId)).status).toBe(401);
  });

  it("refuses a Testimony that is not published or already Kunjungan terbukti", async () => {
    const { cookie } = await signIn("pasien@example.com");
    moderateWith({ ...PUBLISH, proofOfVisit: read() });
    const proven = await createOk(submission(), { cookie, proof: { bytes: await photo(), type: "image/jpeg" } });
    moderateWith(HOLD);
    const held = await createOk(submission({ placeId: "ChIJ-another-place" }), { cookie });

    for (const id of [proven.testimonyId, held.testimonyId]) {
      const response = await attach(id, { cookie });
      expect(response.status).toBe(409);
      expect(((await response.json()) as TestimonyApiError).error).toBe("proof_not_allowed");
    }
    expect(server.fakes.agent.proofCheckCalls).toEqual([]);
  });

  it("refuses a request without a proof file", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const testimonyId = await publishedWithoutProof(cookie);

    const response = await attach(testimonyId, { cookie, proof: { bytes: Buffer.from("hello"), type: "text/plain" } });

    expect(response.status).toBe(400);
    expect(((await response.json()) as TestimonyApiError).fieldErrors?.proof).toBeDefined();
    expect((await testimony(testimonyId)).proofAttempts).toBeUndefined();
  });

  it("offers attaching a proof on Testimoni saya", async () => {
    const { cookie } = await signIn("pasien@example.com");
    await publishedWithoutProof(cookie);

    const page = await fetch(new URL("/testimoni-saya", server.baseUrl), { headers: { cookie } });

    expect(await page.text()).toContain("Tambahkan bukti kunjungan");
  });
});

describe("Proven Testimonies and aggregates (spec 09)", () => {
  const ACCEPTED: ModerationDecision = {
    ...PUBLISH,
    proofOfVisit: {
      readable: true,
      isProofOfVisit: true,
      clinicNameOnProof: "Klinik Gigi Ceria",
      proofDate: "2026-09-12",
      clinicNameMatches: true,
    },
  };

  /**
   * A published Testimony from a new Patient, Proven when `proven`. Each is then dated a
   * day past detection's lookback, as Testimonies that arrived over weeks, so its velocity
   * rule (detection.test.ts) does not hold the third one posted here.
   */
  let posted = 0;

  async function post(email: string, proven: boolean, overrides: Partial<TestimonySubmission> = {}) {
    const { cookie } = await signIn(email);
    moderateWith(proven ? ACCEPTED : PUBLISH);
    posted += 1;
    // Each with a text of its own: the same text twice at one place is held as templated (D2).
    const stored = await createOk(submission({ text: distinctTestimonyText(posted), ...overrides }), {
      cookie,
      // Each Patient brings their own receipt: one file twice at a place is possible reuse.
      ...(proven ? { proof: { bytes: Buffer.from(`%PDF-1.4\n% ${email}\n%%EOF\n`), type: "application/pdf" } } : {}),
    });
    expect(stored).toMatchObject({ status: "published", verifiedVisit: proven });
    await submittedBeforeDetectionWindow(server.firestore, stored.testimonyId);
    return { ...stored, cookie };
  }

  it("shows averages only from the third Proven Testimony", async () => {
    await post("a@example.com", true, { ratings: { service: 5, hygiene: 5, materialsEquipment: 5 } });
    await post("b@example.com", true, { ratings: { service: 4, hygiene: 4, materialsEquipment: 4 } });
    expect((await provider(NEW_PLACE))?.aggregates).toMatchObject({
      testimonyCount: 2,
      verifiedVisitCount: 2,
      averages: null,
    });

    await post("c@example.com", true, { ratings: { service: 3, hygiene: 3, materialsEquipment: 3 } });
    expect((await provider(NEW_PLACE))?.aggregates).toMatchObject({
      testimonyCount: 3,
      verifiedVisitCount: 3,
      averages: { service: 4, hygiene: 4, materialsEquipment: 4 },
    });
  });

  it("an unproven Testimony changes no average or price stat, only the count", async () => {
    await post("a@example.com", true, { pricePaidRupiah: 300_000 });
    await post("b@example.com", true, { pricePaidRupiah: 200_000 });
    await post("c@example.com", true, { pricePaidRupiah: 100_000 });
    const before = (await provider(NEW_PLACE))?.aggregates;
    expect(before).toEqual({
      testimonyCount: 3,
      verifiedVisitCount: 3,
      averages: { service: 5, hygiene: 4, materialsEquipment: 3 },
      procedurePrices: { scaling: { count: 3, medianRupiah: 200_000, minRupiah: 100_000, maxRupiah: 300_000 } },
      paymentMethodCounts: { pribadi: 0, bpjs: 0, asuransi: 0, insurers: {} },
    });

    await post("buzzer@example.com", false, {
      ratings: { service: 1, hygiene: 1, materialsEquipment: 1 },
      pricePaidRupiah: 5_000_000,
    });
    expect((await provider(NEW_PLACE))?.aggregates).toEqual({ ...before, testimonyCount: 4 });
  });

  it("drops the averages when a Proven Testimony leaves published", async () => {
    await post("a@example.com", true);
    await post("b@example.com", true);
    const third = await post("c@example.com", true);
    expect((await provider(NEW_PLACE))?.aggregates.averages).not.toBeNull();

    expect((await remove(third.testimonyId, { cookie: third.cookie })).status).toBe(200);
    expect((await provider(NEW_PLACE))?.aggregates).toEqual({
      testimonyCount: 2,
      verifiedVisitCount: 2,
      averages: null,
      procedurePrices: { scaling: { count: 2, medianRupiah: 300_000, minRupiah: 300_000, maxRupiah: 300_000 } },
      paymentMethodCounts: { pribadi: 0, bpjs: 0, asuransi: 0, insurers: {} },
    });
  });
});

describe("Payment Method (spec 07)", () => {
  const countsOf = async () => (await provider(NEW_PLACE))?.aggregates.paymentMethodCounts;
  let rejections = 0;
  const rejected = async (paymentMethod: unknown) => {
    // A refused submission still counts toward the account's daily limit.
    rejections += 1;
    const { cookie } = await signIn(`pasien${rejections}@example.com`);
    const response = await create(submission({ paymentMethod: paymentMethod as never }), { cookie });
    expect(response.status).toBe(400);
    const body = (await response.json()) as TestimonyApiError;
    expect(body.fieldErrors?.paymentMethod).toBeTruthy();
    expect(await count(COLLECTIONS.testimonies)).toBe(0);
  };

  it.each([
    [{ method: "pribadi" }],
    [{ method: "bpjs" }],
    [{ method: "asuransi", insurer: "prudential" }],
    [{ method: "tidakDisebut" }],
  ] as const)("publishes a Testimony paid with %j and stores it", async (paymentMethod) => {
    const { cookie } = await signIn("pasien@example.com");
    const stored = await createOk(submission({ paymentMethod }), { cookie });
    expect(stored.status).toBe("published");
    expect((await testimony(stored.testimonyId)).paymentMethod).toEqual(paymentMethod);
  });

  it("stays valid without a Payment Method, and stores none", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const stored = await createOk(submission(), { cookie });
    expect((await testimony(stored.testimonyId)).paymentMethod).toBeUndefined();
    expect(await countsOf()).toEqual({ pribadi: 0, bpjs: 0, asuransi: 0, insurers: {} });
  });

  it("treats a null Payment Method as skipped", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const stored = await createOk(submission({ paymentMethod: null }), { cookie });
    expect((await testimony(stored.testimonyId)).paymentMethod).toBeUndefined();
  });

  it("rejects an unknown insurer, a missing insurer, an insurer on another method, and stray fields", async () => {
    await rejected({ method: "asuransi", insurer: "not-an-insurer" });
    await rejected({ method: "asuransi" });
    await rejected({ method: "bpjs", insurer: "prudential" });
    await rejected({ method: "pribadi", note: "x" });
    await rejected({ method: "kartuKredit" });
    await rejected("bpjs");
    await rejected({});
  });

  let paid = 0;

  async function post(email: string, paymentMethod?: TestimonySubmission["paymentMethod"]) {
    const { cookie } = await signIn(email);
    moderateWith(PUBLISH);
    paid += 1;
    // Each with a text of its own: the same text twice at one place is held as templated (D2).
    const text = distinctTestimonyText(paid);
    const stored = await createOk(submission({ text, paymentMethod }), { cookie });
    await submittedBeforeDetectionWindow(server.firestore, stored.testimonyId);
    return { ...stored, cookie, text };
  }

  it("counts per method and per insurer, unproven Testimonies included, and drops them on delete", async () => {
    await post("a@example.com", { method: "pribadi" });
    await post("b@example.com", { method: "bpjs" });
    await post("c@example.com", { method: "asuransi", insurer: "prudential" });
    const d = await post("d@example.com", { method: "asuransi", insurer: "prudential" });
    await post("e@example.com", { method: "asuransi", insurer: "allianz" });
    await post("f@example.com", { method: "tidakDisebut" });
    await post("g@example.com");
    expect((await provider(NEW_PLACE))?.aggregates).toMatchObject({ testimonyCount: 7, verifiedVisitCount: 0 });
    expect(await countsOf()).toEqual({
      pribadi: 1,
      bpjs: 1,
      asuransi: 3,
      insurers: { prudential: 2, allianz: 1 },
    });

    expect((await remove(d.testimonyId, { cookie: d.cookie })).status).toBe(200);
    expect(await countsOf()).toEqual({ pribadi: 1, bpjs: 1, asuransi: 2, insurers: { prudential: 1, allianz: 1 } });
  });

  it("recounts when a published Testimony is edited to another method, or to none", async () => {
    const first = await post("a@example.com", { method: "asuransi", insurer: "prudential" });
    await post("b@example.com", { method: "bpjs" });

    moderateWith(PUBLISH);
    expect(
      (
        await edit(first.testimonyId, submission({ text: first.text, paymentMethod: { method: "pribadi" } }), {
          cookie: first.cookie,
        })
      ).status,
    ).toBe(200);
    expect(await countsOf()).toEqual({ pribadi: 1, bpjs: 1, asuransi: 0, insurers: {} });
    expect((await testimony(first.testimonyId)).paymentMethod).toEqual({ method: "pribadi" });

    moderateWith(PUBLISH);
    await edit(first.testimonyId, submission({ text: first.text }), { cookie: first.cookie });
    expect(await countsOf()).toEqual({ pribadi: 0, bpjs: 1, asuransi: 0, insurers: {} });
    expect((await testimony(first.testimonyId)).paymentMethod).toBeUndefined();
  });

  it("keeps a Testimony excluded by a violation out of the Proven count when it is edited", async () => {
    const first = await post("a@example.com", { method: "bpjs" });
    // Proven, then marked by a confirmed Testimony Policy Violation (issue #138).
    await server.firestore
      .collection(COLLECTIONS.testimonies)
      .doc(first.testimonyId)
      .update({ verifiedVisit: true, excludedByViolation: "v1" });

    moderateWith(PUBLISH);
    expect(
      (
        await edit(first.testimonyId, submission({ text: first.text, paymentMethod: { method: "pribadi" } }), {
          cookie: first.cookie,
        })
      ).status,
    ).toBe(200);

    const aggregates = (await provider(NEW_PLACE))?.aggregates;
    expect(aggregates?.testimonyCount).toBe(1);
    expect(aggregates?.verifiedVisitCount).toBe(0);
    expect((await testimony(first.testimonyId)).excludedByViolation).toBe("v1");
  });

  it("keeps the public Payment Method until a held edit of it is approved", async () => {
    const first = await post("a@example.com", { method: "bpjs" });
    moderateWith(HOLD);
    await edit(first.testimonyId, submission({ text: first.text, paymentMethod: { method: "pribadi" } }), {
      cookie: first.cookie,
    });
    const stored = await testimony(first.testimonyId);
    expect(stored.paymentMethod).toEqual({ method: "bpjs" });
    expect(stored.pendingRevision?.paymentMethod).toEqual({ method: "pribadi" });
    expect(await countsOf()).toEqual({ pribadi: 0, bpjs: 1, asuransi: 0, insurers: {} });
  });

  it("counts a held Testimony only once published, and gives the edit page its Payment Method", async () => {
    const { cookie } = await signIn("pasien@example.com");
    moderateWith(HOLD);
    const held = await createOk(submission({ paymentMethod: { method: "bpjs" } }), { cookie });
    expect(held.status).toBe("held");
    expect(await provider(NEW_PLACE)).toBeUndefined();
    const page = await fetch(new URL(`/testimoni-saya/${held.testimonyId}/ubah`, server.baseUrl), {
      headers: { cookie },
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("bpjs");
  });
});

describe("one Testimony per Patient per Provider", () => {
  it("refuses a second Testimony for the same place and points to the existing one", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    const again = await create(submission({ text: "Cerita kedua." }), { cookie, photos: [await photo()] });
    expect(again.status).toBe(409);
    const body = (await again.json()) as TestimonyApiError;
    expect(body).toMatchObject({ error: "already_posted", testimonyId });
    expect(await count(COLLECTIONS.testimonies)).toBe(1);
    expect(await storedObjects()).toEqual([]);
  });

  it("refuses even while the first one is held", async () => {
    moderateWith(HOLD);
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    const again = await create(submission(), { cookie });
    expect(again.status).toBe(409);
    expect(((await again.json()) as TestimonyApiError).testimonyId).toBe(testimonyId);
  });

  it("allows a new Testimony after the author deleted the old one", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    expect((await remove(testimonyId, { cookie })).status).toBe(200);
    const again = await create(submission(), { cookie });
    expect(again.status).toBe(201);
  });
});

describe("photos and Proof of Visit", () => {
  it("stores photos with the GPS EXIF stripped and deletes the Proof of Visit after Moderation", async () => {
    const original = await photoWithGps();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), {
      cookie,
      photos: [original],
      proof: { bytes: await photo(), type: "image/jpeg" },
    });

    const stored = await testimony(testimonyId);
    expect(stored.photoPaths).toHaveLength(1);
    const [bytes] = await server.uploads.file(stored.photoPaths[0] as string).download();
    expect((await sharp(bytes).metadata()).exif).toBeUndefined();
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
  });

  it("refuses a file that is not an image", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const response = await create(submission(), { cookie, photos: [Buffer.from("not an image at all")] });
    expect(response.status).toBe(400);
    const body = (await response.json()) as TestimonyApiError;
    expect(body.error).toBe("invalid_file");
    expect(Object.keys(body.fieldErrors ?? {})).toEqual(["photos"]);
  });
});

describe("editing", () => {
  it("keeps the published version public while an edit is held", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    moderateWith(HOLD);
    const response = await edit(testimonyId, submission({ text: "Versi baru yang ditahan." }), { cookie });
    expect(response.status).toBe(200);
    expect((await response.json()) as TestimonyStoredResponse).toMatchObject({ testimonyId, status: "held" });

    const stored = await testimony(testimonyId);
    expect(stored.status).toBe("published");
    expect(stored.text).toBe("Dokternya sabar menjelaskan pilihan tambalan dan ruangannya bersih.");
    expect(stored.pendingRevision).toMatchObject({ status: "held", text: "Versi baru yang ditahan." });
    expect(await counter("testimoniesPublished")).toBe(1);
    const decision = (
      await server.firestore
        .collection(COLLECTIONS.moderationDecisions)
        .doc(stored.pendingRevision?.moderationDecisionId ?? "-")
        .get()
    ).data() as ModerationDecisionDoc;
    expect(decision).toMatchObject({ subjectType: "testimonyRevision", decision: "hold" });
  });

  it("replaces the published content and the aggregates when the edit is published", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    moderateWith(HOLD);
    await edit(testimonyId, submission({ text: "Ditahan dulu." }), { cookie });
    moderateWith(PUBLISH);
    const response = await edit(
      testimonyId,
      submission({
        text: "Versi baru.",
        ratings: { service: 1, hygiene: 1, materialsEquipment: 1 },
        pricePaidRupiah: undefined,
      }),
      { cookie },
    );
    expect(((await response.json()) as TestimonyStoredResponse).status).toBe("published");

    const stored = await testimony(testimonyId);
    expect(stored).toMatchObject({ status: "published", text: "Versi baru." });
    expect(stored.pendingRevision).toBeUndefined();
    expect(stored.pricePaidRupiah).toBeUndefined();
    expect((await provider(NEW_PLACE))?.aggregates).toEqual({
      testimonyCount: 1,
      verifiedVisitCount: 0,
      averages: null,
      procedurePrices: {},
      paymentMethodCounts: { pribadi: 0, bpjs: 0, asuransi: 0, insurers: {} },
    });
    expect(await counter("testimoniesPublished")).toBe(1);
  });

  it("keeps listed photos, deletes the others from storage and adds new ones", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie, photos: [await photo(), await photo()] });
    const [keep, drop] = (await testimony(testimonyId)).photoPaths as [string, string];

    const response = await edit(testimonyId, submission({ keepPhotoPaths: [keep] }), {
      cookie,
      photos: [await photo()],
    });
    expect(response.status).toBe(200);
    const stored = await testimony(testimonyId);
    expect(stored.photoPaths).toHaveLength(2);
    expect(stored.photoPaths[0]).toBe(keep);
    expect((await storedObjects(`testimonies/${testimonyId}/`)).sort()).toEqual([...stored.photoPaths].sort());
    expect(await storedObjects(drop)).toEqual([]);
  });

  it("refuses to keep a photo the Testimony does not have", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    const response = await edit(
      testimonyId,
      submission({ keepPhotoPaths: ["testimonies/someone-else/photos/x.jpg"] }),
      { cookie },
    );
    expect(response.status).toBe(400);
    expect(Object.keys(((await response.json()) as TestimonyApiError).fieldErrors ?? {})).toEqual(["photos"]);
  });

  it("refuses to edit a hidden or removed Testimony", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    for (const status of ["hidden", "removed"] as const) {
      await server.firestore.collection(COLLECTIONS.testimonies).doc(testimonyId).update({ status });
      const response = await edit(testimonyId, submission(), { cookie });
      expect(response.status).toBe(409);
      expect(((await response.json()) as TestimonyApiError).error).toBe("not_editable");
    }
  });
});

describe("author only", () => {
  it("refuses another account's edit or delete, and unknown ids", async () => {
    const author = await signIn("penulis@example.com");
    const { testimonyId } = await createOk(submission(), { cookie: author.cookie });
    const other = await signIn("orang.lain@example.com");

    const editResponse = await edit(testimonyId, submission({ text: "Bukan punya saya." }), { cookie: other.cookie });
    expect(editResponse.status).toBe(403);
    expect(((await editResponse.json()) as TestimonyApiError).error).toBe("forbidden");
    expect((await remove(testimonyId, { cookie: other.cookie })).status).toBe(403);
    expect((await testimony(testimonyId)).status).toBe("published");

    expect((await remove("does-not-exist", { cookie: author.cookie })).status).toBe(404);
    expect((await edit("does-not-exist", submission(), { cookie: author.cookie })).status).toBe(404);
    expect((await remove(testimonyId, {})).status).toBe(401);
    expect((await remove(testimonyId, { cookie: author.cookie, appCheck: false })).status).toBe(401);
  });
});

describe("author delete", () => {
  const STATUSES = ["submitted", "published", "needsAuthorFix", "held", "rejected", "hidden", "removed"] as const;

  it.each(STATUSES)("deletes from %s: text, photos and stored objects go", async (status) => {
    const { cookie, uid } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie, photos: [await photo()] });
    const ref = server.firestore.collection(COLLECTIONS.testimonies).doc(testimonyId);
    // Move it to the state under test the way Moderation or an admin would have.
    if (status !== "published") {
      const batch = server.firestore.batch();
      batch.update(ref, { status });
      batch.set(server.firestore.collection(COLLECTIONS.counters).doc(IMPACT_COUNTERS.testimoniesPublished), {
        value: 0,
      });
      await batch.commit();
    }
    expect((await storedObjects(`testimonies/${testimonyId}/`)).length).toBe(1);

    const response = await remove(testimonyId, { cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ testimonyId, status: "deleted" });

    const stored = await testimony(testimonyId);
    expect(stored).toMatchObject({ status: "deleted", text: "", photoPaths: [], authorUid: uid });
    expect(stored.deletedAt).toBeDefined();
    expect(await storedObjects(`testimonies/${testimonyId}/`)).toEqual([]);
    expect(await counter("testimoniesPublished")).toBe(0);
    if (status === "published") {
      expect((await provider(NEW_PLACE))?.aggregates).toEqual({
        testimonyCount: 0,
        verifiedVisitCount: 0,
        averages: null,
        procedurePrices: {},
        paymentMethodCounts: { pribadi: 0, bpjs: 0, asuransi: 0, insurers: {} },
      });
    }
    // Gone for good: a second delete finds nothing.
    expect((await remove(testimonyId, { cookie })).status).toBe(404);
  });

  it("removes a pending edit and its photos too", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    moderateWith(HOLD);
    await edit(testimonyId, submission({ text: "Revisi." }), { cookie, photos: [await photo()] });
    expect((await storedObjects(`testimonies/${testimonyId}/`)).length).toBe(1);
    await remove(testimonyId, { cookie });
    const stored = await testimony(testimonyId);
    expect(stored.pendingRevision).toBeUndefined();
    expect(await storedObjects(`testimonies/${testimonyId}/`)).toEqual([]);
  });
});

describe("Google's name", () => {
  it("is never stored anywhere in Firestore", async () => {
    // The fake Places adapter would answer this name for any Google block request.
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie, photos: [await photo()] });
    await edit(testimonyId, submission({ text: "Diperbarui." }), { cookie });
    const second = await signIn("kedua@example.com");
    await createOk(submission({ providerName: "Nama Kedua" }), { cookie: second.cookie });

    // Moderation was given it in memory, three times.
    expect(server.fakes.agent.moderationCalls.map((call) => call.googleDisplayName)).toEqual([
      "Fake Google Place",
      "Fake Google Place",
      "Fake Google Place",
    ]);
    expect(await wholeFirestore()).not.toContain("Fake Google Place");
    expect(server.fakes.places.detailsCalls).toEqual([]);
  });
});

describe("'Testimoni saya'", () => {
  it("sends a signed-out visitor to sign in", async () => {
    const response = await fetch(new URL("/testimoni-saya", server.baseUrl), { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/signin?redirectTo=%2Ftestimoni-saya");
  });

  it("lists the author's Testimonies with the Provider name and plain status, not deleted ones", async () => {
    const { cookie } = await signIn("pasien@example.com");
    await createOk(submission(), { cookie });
    moderateWith(HOLD);
    await createOk(submission({ placeId: "ChIJ-held-place", providerName: "Klinik Ditahan" }), { cookie });
    const { testimonyId: gone } = await createOk(
      submission({ placeId: "ChIJ-gone-place", providerName: "Klinik Dihapus" }),
      { cookie },
    );
    await remove(gone, { cookie });

    const response = await fetch(new URL("/testimoni-saya", server.baseUrl), { headers: { cookie } });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Klinik Gigi Ceria");
    expect(html).toContain("Klinik Ditahan");
    expect(html).toContain("Tayang");
    expect(html).toContain("Sedang ditinjau tim");
    expect(html).not.toContain("Klinik Dihapus");
    expect(html).toContain('content="noindex"');
  });

  it("opens the edit page only for the author", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    const mine = await fetch(new URL(`/testimoni-saya/${testimonyId}/ubah`, server.baseUrl), { headers: { cookie } });
    expect(mine.status).toBe(200);
    const other = await signIn("lain@example.com");
    const theirs = await fetch(new URL(`/testimoni-saya/${testimonyId}/ubah`, server.baseUrl), {
      headers: { cookie: other.cookie },
    });
    expect(theirs.status).toBe(403);
  });
});
