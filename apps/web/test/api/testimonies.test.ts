// Posting a Testimony (spec 03, T11 and T13) through the web API: sign-in and
// protection, validation, the one-per-Provider rule, every Moderation decision path
// (fix-before-submit, holds, Kunjungan terbukti), Listed Provider creation,
// aggregates, and that Google's name is never stored.
import type { ModerationDecision, ProofExtraction } from "@findyourdent/contracts";
import {
  COLLECTIONS,
  IMPACT_COUNTERS,
  type ModerationDecisionDoc,
  type ProviderDoc,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type {
  ProofAttachResponse,
  TestimonyApiError,
  TestimonyAuthorFixResponse,
  TestimonyStoredResponse,
  TestimonySubmission,
} from "../../app/lib/testimony.ts";
import { AgentUnavailableError } from "../../server/adapters/agent.ts";
import { jakartaDate } from "../../server/quota.ts";
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

/** Today in Asia/Jakarta, so the 12-month Proof of Visit rule never makes these tests rot. */
const TODAY = jakartaDate(Date.now());
const THIS_MONTH = TODAY.slice(0, 7);

/** YYYY-MM, `months` calendar months before this month. */
function monthsAgo(months: number): string {
  const [year, month] = THIS_MONTH.split("-").map(Number) as [number, number];
  const index = year * 12 + (month - 1) - months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function submission(overrides: Partial<TestimonySubmission> = {}): TestimonySubmission {
  return {
    placeId: NEW_PLACE,
    providerName: "  Klinik Gigi Ceria  ",
    region: { provinceCode: "31", regencyCode: "31.71" },
    ratings: { service: 5, hygiene: 4, materialsEquipment: 3 },
    text: "Dokternya sabar menjelaskan pilihan tambalan dan ruangannya bersih.",
    visitMonth: THIS_MONTH,
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

/**
 * A receipt-like JPEG with printed text, so two receipts never look alike (a solid
 * colour would, to a perceptual hash).
 */
async function receipt(label = "Klinik Gigi Ceria"): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640">
    <rect width="100%" height="100%" fill="#fdfcf7"/>
    <text x="24" y="60" font-size="28" font-family="sans-serif">${label}</text>
    <text x="24" y="120" font-size="20" font-family="monospace">${TODAY}  Scaling  Rp300.000</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

const aReceipt = async (label?: string) => ({ bytes: await receipt(label), type: "image/jpeg" });
const aPdfReceipt = () => ({ bytes: Buffer.from("%PDF-1.4\n%%EOF\n"), type: "application/pdf" });

/** What the agent read from a proof that names the Provider and is dated in the visit month. */
function proofFacts(overrides: Partial<ProofExtraction> = {}): ProofExtraction {
  return {
    readable: true,
    isProofOfVisit: true,
    clinicNameOnProof: "KLINIK GIGI CERIA",
    proofDate: `${THIS_MONTH}-01`,
    totalRupiah: 300_000,
    clinicNameMatches: true,
    ...overrides,
  };
}

/** A publish whose Proof of Visit extraction is `proofFacts(overrides)`. */
const publishWithProof = (overrides: Partial<ProofExtraction> = {}) =>
  moderateWith({ ...PUBLISH, proofExtraction: proofFacts(overrides) });

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
      // Without a Proof of Visit it is counted but moves no average or price (spec 09).
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
    });
    expect(server.fakes.places.coordinatesCalls).toEqual([NEW_PLACE]);
    expect(await counter("testimoniesPublished")).toBe(2);
  });

  it("creates exactly one Listed Provider when two first Testimonies publish at once", async () => {
    const [a, b] = await Promise.all([signIn("a@example.com"), signIn("b@example.com")]);
    const results = await Promise.all([
      createOk(submission({ providerName: "Klinik A" }), { cookie: a.cookie }),
      createOk(submission({ providerName: "Klinik B" }), { cookie: b.cookie }),
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
      visitMonth: THIS_MONTH,
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

  it("holds as a model error, without Kunjungan terbukti, when the agent refuses the call, and still deletes the Proof", async () => {
    moderateWith(new AgentUnavailableError("agent responded 422", 422));
    const { cookie } = await signIn("pasien@example.com");
    const held = await createOk(submission(), { cookie, proof: await aReceipt() });

    expect(held).toMatchObject({ status: "held", verifiedVisit: false, proof: { result: "notChecked" } });
    expect(held.message).toContain("24 jam");
    const stored = await testimony(held.testimonyId);
    expect(stored.verifiedVisit).toBe(false);
    expect(stored.proofOfVisit).toBeUndefined();
    expect(await decisionOf(stored.moderationDecisionId)).toMatchObject({
      decision: "hold",
      ruleCodes: ["model_error"],
      model: "fallback",
    });
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
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

describe("Proof of Visit: the decision at submission", () => {
  it("accepts a matching proof: Kunjungan terbukti, the facts kept, the file deleted, counted once", async () => {
    publishWithProof();
    const { cookie } = await signIn("pasien@example.com");
    const published = await createOk(submission(), { cookie, proof: await aReceipt() });

    expect(published).toMatchObject({ status: "published", verifiedVisit: true, proof: { result: "accepted" } });
    const stored = await testimony(published.testimonyId);
    expect(stored.verifiedVisit).toBe(true);
    expect(stored.proofOfVisit).toEqual({
      result: "accepted",
      checkedAt: expect.anything(),
      clinicNameOnProof: "KLINIK GIGI CERIA",
      proofDate: `${THIS_MONTH}-01`,
      totalRupiah: 300_000,
      attempts: 1,
    });
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    expect((await provider(NEW_PLACE))?.aggregates.verifiedVisitCount).toBe(1);
    expect(await counter("verifiedVisits")).toBe(1);
    // The decision record keeps no proof facts: they live on the Testimony only.
    expect(Object.keys(await decisionOf(stored.moderationDecisionId))).not.toContain("proofExtraction");
  });

  it.each([
    ["unreadable", { readable: false, isProofOfVisit: false, clinicNameMatches: false }],
    ["notAProof", proofFacts({ isProofOfVisit: false })],
    // Older than 12 months, even with a visit month to match it.
    ["tooOld", proofFacts({ proofDate: `${monthsAgo(13)}-28` })],
  ] as const)(
    "rejects a %s proof: published without the mark, the reason kept, the file deleted",
    async (reason, facts) => {
      moderateWith({ ...PUBLISH, proofExtraction: facts });
      const { cookie } = await signIn("pasien@example.com");
      const visitMonth = reason === "tooOld" ? monthsAgo(13) : THIS_MONTH;
      const published = await createOk(submission({ visitMonth }), { cookie, proof: aPdfReceipt() });

      expect(published).toMatchObject({
        status: "published",
        verifiedVisit: false,
        proof: { result: "rejected", reason },
      });
      const stored = await testimony(published.testimonyId);
      expect(stored.verifiedVisit).toBe(false);
      expect(stored.proofOfVisit).toMatchObject({ result: "rejected", reason, attempts: 1 });
      expect(stored.proofOfVisit?.reasons).toBeUndefined();
      expect(await storedObjects("proof-of-visit/")).toEqual([]);
      expect((await provider(NEW_PLACE))?.aggregates.verifiedVisitCount).toBe(0);
      expect(await counter("verifiedVisits")).toBe(0);
    },
  );

  it("sends a doubtful proof to the team: still published, every reason kept, the file kept privately", async () => {
    publishWithProof({ clinicNameMatches: false, clinicNameOnProof: "Klinik Lain", proofDate: `${monthsAgo(3)}-10` });
    const { cookie } = await signIn("pasien@example.com");
    const published = await createOk(submission(), { cookie, proof: await aReceipt("Klinik Lain") });

    // The author reads "waiting for the team", never which doubt it was.
    expect(published).toMatchObject({ status: "published", verifiedVisit: false, proof: { result: "pending" } });
    expect(published.proof).toEqual({ result: "pending" });
    const stored = await testimony(published.testimonyId);
    expect(stored).toMatchObject({ status: "published", verifiedVisit: false });
    expect(stored.proofOfVisit).toMatchObject({
      result: "pending",
      reasons: ["nameMismatch", "dateMismatch"],
      clinicNameOnProof: "Klinik Lain",
      proofDate: `${monthsAgo(3)}-10`,
      attempts: 1,
    });
    const kept = await storedObjects(`proof-of-visit/${published.testimonyId}/`);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/\.jpg$/);
    expect((await provider(NEW_PLACE))?.aggregates).toMatchObject({ testimonyCount: 1, verifiedVisitCount: 0 });
    expect(await counter("verifiedVisits")).toBe(0);
  });

  it("sends a proof with no printed date to the team; a missing total is fine", async () => {
    const { proofDate: _, totalRupiah: __, ...undated } = proofFacts();
    moderateWith({ ...PUBLISH, proofExtraction: undated });
    const { cookie } = await signIn("pasien@example.com");
    const published = await createOk(submission(), { cookie, proof: await aReceipt() });

    expect(published.proof).toEqual({ result: "pending" });
    const stored = await testimony(published.testimonyId);
    expect(stored.proofOfVisit).toMatchObject({ result: "pending", reasons: ["dateMismatch"] });
    expect(stored.proofOfVisit?.proofDate).toBeUndefined();
    expect(stored.proofOfVisit?.totalRupiah).toBeUndefined();
  });

  it("leaves a proof the agent could not read unchecked: nothing recorded, the file deleted, the Testimony published", async () => {
    moderateWith(PUBLISH);
    const { cookie } = await signIn("pasien@example.com");
    const published = await createOk(submission(), { cookie, proof: await aReceipt() });

    expect(published).toMatchObject({ status: "published", verifiedVisit: false, proof: { result: "notChecked" } });
    expect((await testimony(published.testimonyId)).proofOfVisit).toBeUndefined();
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
  });

  it("averages a Provider only from its third Proven Testimony", async () => {
    const post = async (email: string, service: number, price: number) =>
      createOk(submission({ ratings: { service, hygiene: 4, materialsEquipment: 4 }, pricePaidRupiah: price }), {
        cookie: (await signIn(email)).cookie,
        proof: await aReceipt(`Klinik Gigi Ceria, struk ${email}`),
      });

    await post("satu@example.com", 5, 300_000);
    await post("dua@example.com", 4, 200_000);
    expect((await provider(NEW_PLACE))?.aggregates).toEqual({
      testimonyCount: 2,
      verifiedVisitCount: 2,
      averages: null,
      procedurePrices: { scaling: { count: 2, medianRupiah: 250_000, minRupiah: 200_000, maxRupiah: 300_000 } },
    });

    await post("tiga@example.com", 3, 100_000);
    expect((await provider(NEW_PLACE))?.aggregates).toEqual({
      testimonyCount: 3,
      verifiedVisitCount: 3,
      averages: { service: 4, hygiene: 4, materialsEquipment: 4 },
      procedurePrices: { scaling: { count: 3, medianRupiah: 200_000, minRupiah: 100_000, maxRupiah: 300_000 } },
    });
  });

  it("publishes an unproven Testimony that changes no average or price stat, only the count", async () => {
    for (const email of ["satu@example.com", "dua@example.com", "tiga@example.com"]) {
      await createOk(submission(), {
        cookie: (await signIn(email)).cookie,
        proof: await aReceipt(`Klinik Gigi Ceria, struk ${email}`),
      });
    }
    const proven = (await provider(NEW_PLACE))?.aggregates;
    expect(proven).toMatchObject({ testimonyCount: 3, verifiedVisitCount: 3 });
    expect(proven?.averages).not.toBeNull();

    const unproven = submission({
      ratings: { service: 1, hygiene: 1, materialsEquipment: 1 },
      pricePaidRupiah: 5_000_000,
    });
    const withoutProof = await createOk(unproven, { cookie: (await signIn("empat@example.com")).cookie });
    publishWithProof({ isProofOfVisit: false });
    const rejected = await createOk(unproven, {
      cookie: (await signIn("lima@example.com")).cookie,
      proof: aPdfReceipt(),
    });
    publishWithProof({ clinicNameMatches: false, clinicNameOnProof: "Klinik Lain" });
    const pending = await createOk(unproven, {
      cookie: (await signIn("enam@example.com")).cookie,
      proof: await aReceipt("Klinik Lain"),
    });

    expect([withoutProof, rejected, pending].map((r) => [r.status, r.verifiedVisit])).toEqual([
      ["published", false],
      ["published", false],
      ["published", false],
    ]);
    expect([rejected.proof?.result, pending.proof?.result]).toEqual(["rejected", "pending"]);
    expect((await provider(NEW_PLACE))?.aggregates).toEqual({ ...proven, testimonyCount: 6 });
  });

  it("recomputes the aggregates when an edit brings an accepted Proof of Visit", async () => {
    for (const email of ["satu@example.com", "dua@example.com"]) {
      await createOk(submission(), {
        cookie: (await signIn(email)).cookie,
        proof: await aReceipt(`Klinik Gigi Ceria, struk ${email}`),
      });
    }
    const { cookie } = await signIn("tiga@example.com");
    const later = submission({ ratings: { service: 2, hygiene: 1, materialsEquipment: 3 } });
    const { testimonyId } = await createOk(later, { cookie });
    expect((await provider(NEW_PLACE))?.aggregates).toMatchObject({ verifiedVisitCount: 2, averages: null });

    const response = await edit(testimonyId, later, { cookie, proof: await aReceipt("Klinik Gigi Ceria, struk tiga") });
    expect(await response.json()).toMatchObject({ status: "published", verifiedVisit: true });
    expect((await provider(NEW_PLACE))?.aggregates).toMatchObject({
      testimonyCount: 3,
      verifiedVisitCount: 3,
      averages: { service: 4, hygiene: 3, materialsEquipment: 3 },
    });
  });

  it("decides the proof of a held Testimony too, counting it only once published", async () => {
    moderateWith({ ...HOLD, proofExtraction: proofFacts() });
    const { cookie } = await signIn("pasien@example.com");
    const held = await createOk(submission(), { cookie, proof: await aReceipt() });

    expect(held).toMatchObject({ status: "held", verifiedVisit: true, proof: { result: "accepted" } });
    expect((await testimony(held.testimonyId)).proofOfVisit?.result).toBe("accepted");
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    expect(await counter("verifiedVisits")).toBe(0);
  });

  it("deletes the proof file and records nothing when the Testimony needs a fix", async () => {
    moderateWith({ ...AUTHOR_FIX, proofExtraction: proofFacts() });
    const { cookie } = await signIn("pasien@example.com");
    const response = await create(submission({ text: PHONE_TEXT }), { cookie, proof: await aReceipt() });

    expect(response.status).toBe(200);
    expect(server.fakes.agent.moderationCalls[0]?.proofOfVisit).toBeDefined();
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    expect(await count(COLLECTIONS.testimonies)).toBe(0);
  });

  it("deletes a waiting proof file with the Testimony", async () => {
    publishWithProof({ clinicNameMatches: false });
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie, proof: await aReceipt() });
    expect(await storedObjects(`proof-of-visit/${testimonyId}/`)).toHaveLength(1);

    expect((await remove(testimonyId, { cookie })).status).toBe(200);
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
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
    for (const email of ["satu@example.com", "dua@example.com"]) {
      await createOk(submission({ pricePaidRupiah: 200_000 }), {
        cookie: (await signIn(email)).cookie,
        proof: await aReceipt(`Klinik Gigi Ceria, struk ${email}`),
      });
    }
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie, proof: await aReceipt() });
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
    // Still Proven: an edit keeps an accepted Proof of Visit.
    expect((await provider(NEW_PLACE))?.aggregates).toEqual({
      testimonyCount: 3,
      verifiedVisitCount: 3,
      averages: { service: 3.67, hygiene: 3, materialsEquipment: 2.33 },
      procedurePrices: { scaling: { count: 2, medianRupiah: 200_000, minRupiah: 200_000, maxRupiah: 200_000 } },
    });
    expect(await counter("testimoniesPublished")).toBe(3);
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

describe("Proof of Visit: sent with an edit", () => {
  async function editOk(id: string, options: SendOptions): Promise<TestimonyStoredResponse> {
    const response = await edit(id, submission({ providerName: undefined, region: undefined }), options);
    if (response.status !== 200) throw new Error(`edit failed: ${response.status} ${await response.text()}`);
    return (await response.json()) as TestimonyStoredResponse;
  }

  it("proves a published Testimony: aggregates and the counter follow, the file goes", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    publishWithProof();
    const edited = await editOk(testimonyId, { cookie, proof: await aReceipt() });

    expect(edited).toMatchObject({ status: "published", verifiedVisit: true, proof: { result: "accepted" } });
    expect((await testimony(testimonyId)).proofOfVisit).toMatchObject({ result: "accepted", attempts: 1 });
    expect((await provider(NEW_PLACE))?.aggregates.verifiedVisitCount).toBe(1);
    expect(await counter("verifiedVisits")).toBe(1);
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
  });

  it("replaces a waiting proof: another attempt, and only the newest file is kept", async () => {
    publishWithProof({ clinicNameMatches: false });
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie, proof: await aReceipt("Klinik Lama") });
    const [first] = await storedObjects(`proof-of-visit/${testimonyId}/`);

    const { proofDate: _, ...undated } = proofFacts();
    moderateWith({ ...PUBLISH, proofExtraction: undated });
    const edited = await editOk(testimonyId, { cookie, proof: await aReceipt("Klinik Baru") });

    expect(edited.proof).toEqual({ result: "pending" });
    expect((await testimony(testimonyId)).proofOfVisit).toMatchObject({
      result: "pending",
      reasons: ["dateMismatch"],
      attempts: 2,
    });
    const kept = await storedObjects(`proof-of-visit/${testimonyId}/`);
    expect(kept).toHaveLength(1);
    expect(kept).not.toContain(first);

    publishWithProof();
    await editOk(testimonyId, { cookie, proof: await aReceipt() });
    expect((await testimony(testimonyId)).proofOfVisit).toMatchObject({ result: "accepted", attempts: 3 });
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
  });

  it("proves the public version while a held edit waits", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    moderateWith({ ...HOLD, proofExtraction: proofFacts() });
    const edited = await editOk(testimonyId, { cookie, proof: await aReceipt() });

    expect(edited).toMatchObject({ status: "held", verifiedVisit: true, proof: { result: "accepted" } });
    const stored = await testimony(testimonyId);
    expect(stored).toMatchObject({ status: "published", verifiedVisit: true, text: submission().text });
    expect(stored.pendingRevision?.status).toBe("held");
    expect((await provider(NEW_PLACE))?.aggregates.verifiedVisitCount).toBe(1);
    expect(await counter("verifiedVisits")).toBe(1);
  });

  it("keeps an accepted proof: a new one is not an attempt and its file goes", async () => {
    publishWithProof();
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie, proof: await aReceipt() });

    publishWithProof({ isProofOfVisit: false });
    const edited = await editOk(testimonyId, { cookie, proof: await aReceipt("Lain") });

    expect(edited).toMatchObject({ verifiedVisit: true, proof: { result: "accepted" } });
    expect((await testimony(testimonyId)).proofOfVisit).toMatchObject({ result: "accepted", attempts: 1 });
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    expect(await counter("verifiedVisits")).toBe(1);
  });

  it("leaves a waiting proof alone when the edit sends none, or one the agent could not read", async () => {
    publishWithProof({ clinicNameMatches: false });
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie, proof: await aReceipt() });
    const waiting = await storedObjects(`proof-of-visit/${testimonyId}/`);

    moderateWith(PUBLISH);
    const plain = await editOk(testimonyId, { cookie });
    expect(plain.proof).toBeUndefined();
    const unread = await editOk(testimonyId, { cookie, proof: await aReceipt() });
    expect(unread.proof).toEqual({ result: "notChecked" });

    expect((await testimony(testimonyId)).proofOfVisit).toMatchObject({ result: "pending", attempts: 1 });
    expect(await storedObjects(`proof-of-visit/${testimonyId}/`)).toEqual(waiting);
  });
});

describe("Proof of Visit: attached later", () => {
  /** POST /api/testimonies/:id/proof with only the proof file. */
  async function attach(id: string, options: SendOptions = {}): Promise<Response> {
    const headers = new Headers();
    if (options.cookie) headers.set("cookie", options.cookie);
    if (options.appCheck !== false) headers.set(APP_CHECK_HEADER, server.appCheckToken());
    const form = new FormData();
    if (options.proof) {
      form.set("proof", new File([new Uint8Array(options.proof.bytes)], "struk", { type: options.proof.type }));
    }
    return fetch(new URL(`/api/testimonies/${id}/proof`, server.baseUrl), { method: "POST", headers, body: form });
  }

  async function attachOk(id: string, options: SendOptions): Promise<ProofAttachResponse> {
    const response = await attach(id, options);
    if (response.status !== 200) throw new Error(`attach failed: ${response.status} ${await response.text()}`);
    return (await response.json()) as ProofAttachResponse;
  }

  /** The next proof-only check reads `proofFacts(overrides)`. */
  const proofCheckReads = (overrides: Partial<ProofExtraction> = {}) =>
    server.fakes.agent.respondToProofCheckWith({ proofExtraction: proofFacts(overrides) });

  it("proves a published Testimony without screening it again: only the proof changes, aggregates and the counter follow", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    const before = await testimony(testimonyId);

    proofCheckReads();
    const attached = await attachOk(testimonyId, { cookie, proof: await aReceipt() });

    expect(attached).toEqual({ testimonyId, verifiedVisit: true, proof: { result: "accepted" }, attemptsLeft: 2 });
    // Proof-only mode: the proof and the names to match it against, never the text again.
    expect(server.fakes.agent.moderationCalls).toHaveLength(1);
    const [check] = server.fakes.agent.proofCheckCalls;
    expect(Object.keys(check ?? {}).sort()).toEqual(["googleDisplayName", "proofOfVisit", "typedProviderName"]);
    expect(check).toMatchObject({ typedProviderName: "Klinik Gigi Ceria", proofOfVisit: { mimeType: "image/jpeg" } });

    const after = await testimony(testimonyId);
    const { proofOfVisit, verifiedVisit, updatedAt: _, ...rest } = after;
    const { updatedAt: __, verifiedVisit: ___, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
    expect(after.pendingRevision).toBeUndefined();
    expect(verifiedVisit).toBe(true);
    expect(proofOfVisit).toEqual({
      result: "accepted",
      checkedAt: expect.anything(),
      clinicNameOnProof: "KLINIK GIGI CERIA",
      proofDate: `${THIS_MONTH}-01`,
      totalRupiah: 300_000,
      attempts: 1,
    });
    expect(await count(COLLECTIONS.moderationDecisions)).toBe(1);
    expect((await provider(NEW_PLACE))?.aggregates).toMatchObject({ testimonyCount: 1, verifiedVisitCount: 1 });
    expect(await counter("verifiedVisits")).toBe(1);
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
  });

  it("sends a doubtful proof to the team, and a newer one replaces it as another attempt", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });

    proofCheckReads({ clinicNameMatches: false, clinicNameOnProof: "Klinik Lain" });
    const first = await attachOk(testimonyId, { cookie, proof: await aReceipt("Klinik Lain") });
    expect(first).toEqual({ testimonyId, verifiedVisit: false, proof: { result: "pending" }, attemptsLeft: 2 });
    expect(await testimony(testimonyId)).toMatchObject({
      status: "published",
      verifiedVisit: false,
      text: submission().text,
      proofOfVisit: { result: "pending", reasons: ["nameMismatch"], clinicNameOnProof: "Klinik Lain", attempts: 1 },
    });
    const [waiting] = await storedObjects(`proof-of-visit/${testimonyId}/`);
    expect(waiting).toBeDefined();

    const { proofDate: _, ...undated } = proofFacts();
    server.fakes.agent.respondToProofCheckWith({ proofExtraction: undated });
    const second = await attachOk(testimonyId, { cookie, proof: aPdfReceipt() });
    expect(second).toMatchObject({ proof: { result: "pending" }, attemptsLeft: 1 });
    expect((await testimony(testimonyId)).proofOfVisit).toMatchObject({
      result: "pending",
      reasons: ["dateMismatch"],
      attempts: 2,
    });
    const kept = await storedObjects(`proof-of-visit/${testimonyId}/`);
    expect(kept).toHaveLength(1);
    expect(kept).not.toContain(waiting);
    expect(kept[0]).toMatch(/\.pdf$/);
    expect(server.fakes.agent.moderationCalls).toHaveLength(1);
    expect((await provider(NEW_PLACE))?.aggregates.verifiedVisitCount).toBe(0);
    expect(await counter("verifiedVisits")).toBe(0);
  });

  it("allows 3 proof checks per Testimony, counting submission, edits and attachments, then refuses before any model call", async () => {
    // More writes than the daily limit allows: that limit has its own test below.
    server.setLimits({ testimoniesPerDay: 10 });
    publishWithProof({ isProofOfVisit: false });
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie, proof: await aReceipt() });

    proofCheckReads({ clinicNameMatches: false });
    expect(await attachOk(testimonyId, { cookie, proof: await aReceipt() })).toMatchObject({ attemptsLeft: 1 });
    proofCheckReads({ proofDate: `${monthsAgo(14)}-02` });
    const third = await attachOk(testimonyId, { cookie, proof: await aReceipt() });
    expect(third).toEqual({
      testimonyId,
      verifiedVisit: false,
      proof: { result: "rejected", reason: "tooOld" },
      attemptsLeft: 0,
    });

    const fourth = await attach(testimonyId, { cookie, proof: await aReceipt() });
    expect(fourth.status).toBe(409);
    const refusal = (await fourth.json()) as TestimonyApiError;
    expect(refusal.error).toBe("proof_attempts_used");
    expect(refusal.message).toMatch(/3 kali/);
    expect(server.fakes.agent.proofCheckCalls).toHaveLength(2);

    // The edit form's proof field counts too: refused before Moderation, nothing changed.
    const edited = await edit(testimonyId, submission({ text: "Teks baru yang tidak tersimpan." }), {
      cookie,
      proof: await aReceipt(),
    });
    expect(edited.status).toBe(409);
    const editRefusal = (await edited.json()) as TestimonyApiError;
    expect(editRefusal.error).toBe("proof_attempts_used");
    expect(editRefusal.fieldErrors?.proof).toBeTruthy();
    expect(server.fakes.agent.moderationCalls).toHaveLength(1);

    const stored = await testimony(testimonyId);
    expect(stored.text).toBe(submission().text);
    expect(stored.proofOfVisit).toMatchObject({ result: "rejected", reason: "tooOld", attempts: 3 });
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    // An edit without a proof still goes through.
    expect((await edit(testimonyId, submission({ text: "Teks baru tanpa bukti." }), { cookie })).status).toBe(200);
  });

  it("counts a proof checked before attempts were recorded as one", async () => {
    publishWithProof({ isProofOfVisit: false });
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie, proof: await aReceipt() });
    await server.firestore
      .collection(COLLECTIONS.testimonies)
      .doc(testimonyId)
      .update({ "proofOfVisit.attempts": FieldValue.delete() });

    proofCheckReads({ isProofOfVisit: false });
    expect(await attachOk(testimonyId, { cookie, proof: await aReceipt() })).toMatchObject({ attemptsLeft: 1 });
    expect((await testimony(testimonyId)).proofOfVisit?.attempts).toBe(2);
  });

  it("lets only the author attach, and only to a published Testimony without an accepted proof", async () => {
    server.setLimits({ testimoniesPerDay: 10 });
    const author = await signIn("penulis@example.com");
    const { testimonyId } = await createOk(submission(), { cookie: author.cookie });
    moderateWith(HOLD);
    const { testimonyId: held } = await createOk(
      submission({ placeId: "ChIJ-held-place", providerName: "Klinik Ditahan" }),
      { cookie: author.cookie },
    );
    publishWithProof();
    const { testimonyId: proven } = await createOk(
      submission({ placeId: "ChIJ-proven-place", providerName: "Klinik Terbukti" }),
      { cookie: author.cookie, proof: await aReceipt() },
    );
    const other = await signIn("orang.lain@example.com");
    const proof = await aReceipt();

    const refusals: Array<[Response, number, string]> = [
      [await attach(testimonyId, { cookie: other.cookie, proof }), 403, "forbidden"],
      [await attach(testimonyId, { proof }), 401, "sign_in_required"],
      [await attach(testimonyId, { cookie: author.cookie, proof, appCheck: false }), 401, "app_check_required"],
      [await attach("does-not-exist", { cookie: author.cookie, proof }), 404, "not_found"],
      [await attach(held, { cookie: author.cookie, proof }), 409, "proof_not_attachable"],
      [await attach(proven, { cookie: author.cookie, proof }), 409, "proof_already_accepted"],
    ];
    for (const [response, status, error] of refusals) {
      expect(response.status).toBe(status);
      expect(((await response.json()) as TestimonyApiError).error).toBe(error);
    }
    expect(server.fakes.agent.proofCheckCalls).toEqual([]);
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    expect((await testimony(testimonyId)).proofOfVisit).toBeUndefined();
  });

  it("refuses a request without a proof file, or with a file that is not a document", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });

    for (const options of [{ cookie }, { cookie, proof: { bytes: Buffer.from("hello"), type: "text/plain" } }]) {
      const response = await attach(testimonyId, options);
      expect(response.status).toBe(400);
      const body = (await response.json()) as TestimonyApiError;
      expect(body.error).toBe("invalid_file");
      expect(body.fieldErrors?.proof).toBeTruthy();
    }
    expect(server.fakes.agent.proofCheckCalls).toEqual([]);
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
  });

  it.each([
    ["the agent fails", new AgentUnavailableError("agent responded 503", 503, "model_error")],
    ["the agent's answer is not valid", { proofExtraction: { ...proofFacts(), patientName: "Budi" } }],
  ])("uses no attempt when %s: the file goes and the author is asked to try again later", async (_, answer) => {
    publishWithProof({ clinicNameMatches: false });
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie, proof: await aReceipt() });
    const waiting = await storedObjects(`proof-of-visit/${testimonyId}/`);

    server.fakes.agent.respondToProofCheckWith(answer);
    const response = await attach(testimonyId, { cookie, proof: await aReceipt() });

    expect(response.status).toBe(503);
    const body = (await response.json()) as TestimonyApiError;
    expect(body.error).toBe("proof_check_unavailable");
    expect(body.message).toMatch(/coba lagi nanti/);
    // The proof waiting for the team stays as it was.
    expect((await testimony(testimonyId)).proofOfVisit).toMatchObject({ result: "pending", attempts: 1 });
    expect(await storedObjects(`proof-of-visit/${testimonyId}/`)).toEqual(waiting);
    expect(await wholeFirestore()).not.toContain("Budi");
  });

  it("shares the daily write limit of submissions and edits", async () => {
    server.setLimits({ testimoniesPerDay: 1 });
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });

    const response = await attach(testimonyId, { cookie, proof: await aReceipt() });
    expect(response.status).toBe(429);
    expect(((await response.json()) as TestimonyApiError).error).toBe("rate_limited");
    expect(server.fakes.agent.proofCheckCalls).toEqual([]);
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

  it("shows each Proof of Visit's status in plain words, never why one waits", async () => {
    const { cookie } = await signIn("pasien@example.com");
    publishWithProof();
    await createOk(submission({ placeId: "ChIJ-proof-accepted", providerName: "Klinik Diterima" }), {
      cookie,
      proof: await aReceipt(),
    });
    publishWithProof({ clinicNameMatches: false });
    await createOk(submission({ placeId: "ChIJ-proof-pending", providerName: "Klinik Menunggu" }), {
      cookie,
      proof: await aReceipt(),
    });
    publishWithProof({ proofDate: `${monthsAgo(14)}-02` });
    await createOk(submission({ placeId: "ChIJ-proof-old", providerName: "Klinik Lama", visitMonth: monthsAgo(14) }), {
      cookie,
      proof: await aReceipt(),
    });
    moderateWith(PUBLISH);
    await createOk(submission({ placeId: "ChIJ-no-proof", providerName: "Klinik Tanpa Bukti" }), { cookie });

    const html = await (await fetch(new URL("/testimoni-saya", server.baseUrl), { headers: { cookie } })).text();
    expect(html).toContain("Bukti kunjungan diterima");
    expect(html).toContain("menunggu pemeriksaan tim FindYourDent");
    expect(html).toContain("lebih dari 12 bulan yang lalu");
    expect(html).toContain("Anda bisa mencoba dokumen lain");
    // One status per proof; the Testimony without one has none.
    expect(html.match(/Bukti kunjungan<\/span>/g)).toHaveLength(3);
    expect(html).not.toMatch(/nama klinik|tidak cocok|dipakai ulang/i);
  });

  it("offers to attach a Proof of Visit only to a published Testimony without an accepted proof, while attempts are left", async () => {
    server.setLimits({ testimoniesPerDay: 10 });
    const { cookie } = await signIn("pasien@example.com");
    moderateWith(PUBLISH);
    await createOk(submission({ placeId: "ChIJ-no-proof", providerName: "Klinik Tanpa Bukti" }), { cookie });
    moderateWith(HOLD);
    await createOk(submission({ placeId: "ChIJ-held", providerName: "Klinik Ditahan" }), { cookie });
    publishWithProof();
    await createOk(submission({ placeId: "ChIJ-proven", providerName: "Klinik Terbukti" }), {
      cookie,
      proof: await aReceipt(),
    });
    publishWithProof({ isProofOfVisit: false });
    const { testimonyId: usedUp } = await createOk(
      submission({ placeId: "ChIJ-used-up", providerName: "Klinik Habis" }),
      { cookie, proof: await aReceipt() },
    );
    await server.firestore.collection(COLLECTIONS.testimonies).doc(usedUp).update({ "proofOfVisit.attempts": 3 });

    const html = await (await fetch(new URL("/testimoni-saya", server.baseUrl), { headers: { cookie } })).text();
    expect(html.match(/Lampirkan bukti kunjungan/g)).toHaveLength(1);
    expect(html).toContain("Sisa 3 kali kesempatan");
    // The rejected proof with no attempt left does not invite another document.
    expect(html).toContain("sudah 3 kali dikirim");
    expect(html).not.toContain("Anda bisa mencoba dokumen lain");
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
