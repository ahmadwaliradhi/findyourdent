// Posting a Testimony (spec 03, T11) through the web API: sign-in and protection,
// validation, the one-per-Provider rule, the Moderation switch, Listed Provider
// creation, aggregates, and that Google's name is never stored.
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
import type { TestimonyApiError, TestimonySubmission, TestimonySubmitResponse } from "../../app/lib/testimony.ts";
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

async function createOk(body: unknown, options: SendOptions): Promise<TestimonySubmitResponse> {
  const response = await create(body, options);
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as TestimonySubmitResponse;
}

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

describe("Moderation switch: publish", () => {
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
      aggregates: {
        testimonyCount: 1,
        verifiedVisitCount: 0,
        averages: { service: 5, hygiene: 4, materialsEquipment: 3 },
        procedurePrices: { scaling: { count: 1, medianRupiah: 300_000, minRupiah: 300_000, maxRupiah: 300_000 } },
      },
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
      model: "switch",
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
      averages: { service: 3.5, hygiene: 3.5, materialsEquipment: 3.5 },
      procedurePrices: { scaling: { count: 2, medianRupiah: 200_000, minRupiah: 100_000, maxRupiah: 300_000 } },
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

describe("Moderation switch: hold", () => {
  it("holds the Testimony, keeps the typed name on it and creates no Listed Provider", async () => {
    server.setTestimonyModeration("hold");
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
    expect(decision).toMatchObject({ decision: "hold", ruleCodes: ["low_confidence"], model: "switch" });
  });

  it("publishes a held Testimony edited after the switch flips, creating the Listed Provider then", async () => {
    server.setTestimonyModeration("hold");
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    server.setTestimonyModeration("publish");
    const response = await edit(testimonyId, submission({ providerName: undefined, region: undefined }), { cookie });
    expect(response.status).toBe(200);
    expect(((await response.json()) as TestimonySubmitResponse).status).toBe("published");
    expect((await provider(NEW_PLACE))?.name).toBe("Klinik Gigi Ceria");
    expect((await testimony(testimonyId)).proposedProviderName).toBeUndefined();
    expect(await counter("testimoniesPublished")).toBe(1);
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
    server.setTestimonyModeration("hold");
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
    expect(stored.verifiedVisit).toBe(false);
    expect(stored.proofOfVisit).toBeUndefined();
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
    server.setTestimonyModeration("hold");
    const response = await edit(testimonyId, submission({ text: "Versi baru yang ditahan." }), { cookie });
    expect(response.status).toBe(200);
    expect((await response.json()) as TestimonySubmitResponse).toEqual({ testimonyId, status: "held" });

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
    server.setTestimonyModeration("hold");
    await edit(testimonyId, submission({ text: "Ditahan dulu." }), { cookie });
    server.setTestimonyModeration("publish");
    const response = await edit(
      testimonyId,
      submission({
        text: "Versi baru.",
        ratings: { service: 1, hygiene: 1, materialsEquipment: 1 },
        pricePaidRupiah: undefined,
      }),
      { cookie },
    );
    expect(((await response.json()) as TestimonySubmitResponse).status).toBe("published");

    const stored = await testimony(testimonyId);
    expect(stored).toMatchObject({ status: "published", text: "Versi baru." });
    expect(stored.pendingRevision).toBeUndefined();
    expect(stored.pricePaidRupiah).toBeUndefined();
    expect((await provider(NEW_PLACE))?.aggregates).toEqual({
      testimonyCount: 1,
      verifiedVisitCount: 0,
      averages: { service: 1, hygiene: 1, materialsEquipment: 1 },
      procedurePrices: {},
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
      });
    }
    // Gone for good: a second delete finds nothing.
    expect((await remove(testimonyId, { cookie })).status).toBe(404);
  });

  it("removes a pending edit and its photos too", async () => {
    const { cookie } = await signIn("pasien@example.com");
    const { testimonyId } = await createOk(submission(), { cookie });
    server.setTestimonyModeration("hold");
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
    server.setTestimonyModeration("hold");
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
