// Proof Fingerprints and the reuse check (spec 09, issue #130) through the web API: an
// accepted or pending proof leaves a fingerprint (no image, no patient name); another
// Testimony at the same place sending the same receipt (same facts, same PDF, or the
// same picture re-encoded) waits for the admin as `possibleReuse`, with the matching
// Testimony linked in the queue. Deleting the Testimony or rejecting its proof frees it.
import type { ModerationDecision, ProofOfVisitExtraction } from "@findyourdent/contracts";
import { COLLECTIONS, type ProofFingerprintDoc, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminActionRequest, AdminQueueResponse, QueueItem } from "../../app/lib/admin-queue.ts";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type { TestimonyStoredResponse, TestimonySubmission } from "../../app/lib/testimony.ts";
import { AgentUnavailableError } from "../../server/adapters/agent.ts";
import { silentLogger } from "../../server/logger.ts";
import { expirePendingProofs } from "../../server/proof-expiry.ts";
import { ADMIN_EMAILS, startTestServer, type TestServer } from "../support/harness.ts";

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

const PLACE = "ChIJ-klinik-ceria";
const OTHER_PLACE = "ChIJ-klinik-senyum";

function submission(placeId = PLACE): TestimonySubmission {
  return {
    placeId,
    providerName: placeId === PLACE ? "Klinik Gigi Ceria" : "Klinik Gigi Senyum",
    region: { provinceCode: "31", regencyCode: "31.71" },
    ratings: { service: 5, hygiene: 4, materialsEquipment: 3 },
    text: "Dokternya sabar menjelaskan pilihan tambalan dan ruangannya bersih.",
    visitMonth: "2026-09",
    displayName: "Siti R.",
    consent: { honestExperience: true, noOthersPersonalData: true },
  };
}

const PUBLISH: ModerationDecision = {
  decision: "publish",
  ruleCodes: [],
  flaggedSpans: [],
  confidence: 0.95,
  authorMessage: "Terima kasih!",
};

/** A receipt from the right clinic in the visit month: accepted unless reused. */
const read = (overrides: Partial<ProofOfVisitExtraction> = {}): ProofOfVisitExtraction => ({
  readable: true,
  isProofOfVisit: true,
  clinicNameOnProof: "Klinik Gigi Ceria",
  proofDate: "2026-09-12",
  totalRupiah: 350_000,
  clinicNameMatches: true,
  ...overrides,
});

/** Another receipt's facts, so only the file can match. */
const OTHER_FACTS = read({
  clinicNameOnProof: "Klinik Gigi Ceria Tebet",
  proofDate: "2026-09-20",
  totalRupiah: 90_000,
});

/** A receipt-like photo with structure for the perceptual hash; flat images all hash alike. */
function receiptSvg(clinic: string, total: string, stampX: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">
  <rect width="600" height="900" fill="#f4f1ea"/>
  <text x="40" y="80" font-family="sans-serif" font-size="40" fill="#111">${clinic}</text>
  <rect x="40" y="110" width="520" height="4" fill="#333"/>
  <text x="40" y="200" font-family="monospace" font-size="28" fill="#222">Scaling gigi</text>
  <text x="40" y="260" font-family="monospace" font-size="28" fill="#222">Tambal komposit</text>
  <rect x="40" y="620" width="520" height="4" fill="#333"/>
  <text x="40" y="700" font-family="sans-serif" font-size="44" fill="#000">TOTAL ${total}</text>
  <circle cx="${stampX}" cy="800" r="60" fill="#3355aa" opacity="0.6"/>
</svg>`;
}

const receiptPhoto = () =>
  sharp(Buffer.from(receiptSvg("Klinik Gigi Ceria", "Rp350.000", 460)))
    .jpeg()
    .toBuffer();
const anotherReceiptPhoto = () =>
  sharp(Buffer.from(receiptSvg("Apotek Lain Jaya Makmur", "Rp1.200.000", 120)))
    .jpeg()
    .toBuffer();
const pdf = (body: string) => Buffer.from(`%PDF-1.4\n% ${body}\n%%EOF\n`);

interface Proof {
  bytes: Buffer;
  type: "image/jpeg" | "image/png" | "application/pdf";
}

async function send(
  path: string,
  cookie: string,
  input: { placeId?: string; proof: Proof; extraction: ProofOfVisitExtraction },
): Promise<Response> {
  server.fakes.agent.respondToModerationWith({ ...PUBLISH, proofOfVisit: input.extraction });
  const form = new FormData();
  form.set("testimony", JSON.stringify(submission(input.placeId)));
  form.set("proof", new File([new Uint8Array(input.proof.bytes)], "struk", { type: input.proof.type }));
  return fetch(new URL(path, server.baseUrl), {
    method: "POST",
    headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
    body: form,
  });
}

/** Posts a Testimony with a proof as a new author; returns the response body and the author's cookie. */
async function post(
  email: string,
  input: { placeId?: string; proof: Proof; extraction: ProofOfVisitExtraction },
): Promise<TestimonyStoredResponse & { cookie: string }> {
  const cookie = await server.signInWithGoogle(email);
  const response = await send("/api/testimonies", cookie, input);
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return { ...((await response.json()) as TestimonyStoredResponse), cookie };
}

async function testimony(id: string): Promise<TestimonyDoc> {
  return (await server.firestore.collection(COLLECTIONS.testimonies).doc(id).get()).data() as TestimonyDoc;
}

async function fingerprint(id: string): Promise<ProofFingerprintDoc | undefined> {
  return (await server.firestore.collection(COLLECTIONS.proofFingerprints).doc(id).get()).data() as
    | ProofFingerprintDoc
    | undefined;
}

async function proofFiles(): Promise<string[]> {
  const [files] = await server.uploads.getFiles({ prefix: "proof-of-visit/" });
  return files.map((file) => file.name);
}

const adminCookie = () => server.signInWithGoogle(ADMIN_EMAILS[0] as string);

async function proofItems(cookie: string): Promise<QueueItem[]> {
  const response = await server.get("/admin/api/queue", { headers: { cookie } });
  expect(response.status).toBe(200);
  return ((await response.json()) as AdminQueueResponse).items.filter((item) => item.kind === "proofReview");
}

const act = (cookie: string, body: AdminActionRequest) =>
  server.post("/admin/api/actions", body, { headers: { cookie } });

const photo = async (): Promise<Proof> => ({ bytes: await receiptPhoto(), type: "image/jpeg" });

describe("the fingerprint kept of a proof", () => {
  it("stores the place, the image hash and the facts key for an accepted proof, and deletes the file", async () => {
    const first = await post("satu@example.com", { proof: await photo(), extraction: read() });
    expect(first).toMatchObject({ verifiedVisit: true, proof: { result: "accepted" } });

    const stored = await fingerprint(first.testimonyId);
    expect(stored).toEqual({
      testimonyId: first.testimonyId,
      placeId: PLACE,
      perceptualHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      fieldsKey: "klinik gigi ceria|2026-09-12|350000",
      createdAt: expect.any(Timestamp),
    });
    expect(await proofFiles()).toEqual([]);
  });

  it("stores a file hash for a PDF, and only the hash when nothing was read off it", async () => {
    server.fakes.agent.respondToModerationWith(new AgentUnavailableError("agent responded 422", 422));
    const cookie = await server.signInWithGoogle("satu@example.com");
    const form = new FormData();
    form.set("testimony", JSON.stringify(submission()));
    form.set("proof", new File([new Uint8Array(pdf("satu"))], "struk.pdf", { type: "application/pdf" }));
    const response = await fetch(new URL("/api/testimonies", server.baseUrl), {
      method: "POST",
      headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
      body: form,
    });
    expect(response.status).toBe(201);
    const { testimonyId } = (await response.json()) as TestimonyStoredResponse;

    expect((await testimony(testimonyId)).proofOfVisit).toMatchObject({ result: "pending", reasons: ["notChecked"] });
    const stored = await fingerprint(testimonyId);
    expect(stored).toMatchObject({ testimonyId, placeId: PLACE, fileSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(stored).not.toHaveProperty("fieldsKey");
    expect(stored).not.toHaveProperty("perceptualHash");
  });

  it("keeps none for a rejected proof", async () => {
    const rejected = await post("satu@example.com", {
      proof: await photo(),
      extraction: read({ isProofOfVisit: false }),
    });
    expect(rejected.proof?.result).toBe("rejected");
    expect(await fingerprint(rejected.testimonyId)).toBeUndefined();
  });
});

describe("the reuse check", () => {
  it("sends the same facts on another picture to the admin: published, not Proven, file kept", async () => {
    const first = await post("satu@example.com", { proof: await photo(), extraction: read() });

    const second = await post("dua@example.com", {
      proof: { bytes: await anotherReceiptPhoto(), type: "image/jpeg" },
      extraction: read({ clinicNameOnProof: "KLINIK GIGI-CERIA." }),
    });

    expect(second).toMatchObject({ status: "published", verifiedVisit: false, proof: { result: "pending" } });
    const stored = await testimony(second.testimonyId);
    expect(stored.verifiedVisit).toBe(false);
    expect(stored.proofOfVisit).toMatchObject({ result: "pending", reasons: ["possibleReuse"] });
    const files = await proofFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toContain(second.testimonyId);
    // The first stays Proven: the reuse check never takes back an accepted proof.
    expect((await testimony(first.testimonyId)).verifiedVisit).toBe(true);
    expect(await fingerprint(second.testimonyId)).toMatchObject({ fieldsKey: "klinik gigi ceria|2026-09-12|350000" });
  });

  it("catches the same PDF whatever was read off it", async () => {
    await post("satu@example.com", { proof: { bytes: pdf("kuitansi"), type: "application/pdf" }, extraction: read() });

    const second = await post("dua@example.com", {
      proof: { bytes: pdf("kuitansi"), type: "application/pdf" },
      extraction: OTHER_FACTS,
    });

    expect((await testimony(second.testimonyId)).proofOfVisit).toMatchObject({
      result: "pending",
      reasons: ["possibleReuse"],
    });
  });

  it("does not match a different PDF with different facts", async () => {
    await post("satu@example.com", { proof: { bytes: pdf("kuitansi"), type: "application/pdf" }, extraction: read() });

    const second = await post("dua@example.com", {
      proof: { bytes: pdf("kuitansi lain"), type: "application/pdf" },
      extraction: OTHER_FACTS,
    });

    expect(second.proof?.result).toBe("accepted");
  });

  it("catches the same picture resized and re-encoded, but accepts a different receipt", async () => {
    const original = await receiptPhoto();
    await post("satu@example.com", { proof: { bytes: original, type: "image/jpeg" }, extraction: read() });

    const reencoded = await sharp(original).resize(420).png().toBuffer();
    const copy = await post("dua@example.com", {
      proof: { bytes: reencoded, type: "image/png" },
      extraction: OTHER_FACTS,
    });
    expect((await testimony(copy.testimonyId)).proofOfVisit).toMatchObject({
      result: "pending",
      reasons: ["possibleReuse"],
    });

    const different = await post("tiga@example.com", {
      proof: { bytes: await anotherReceiptPhoto(), type: "image/jpeg" },
      extraction: read({ proofDate: "2026-09-25", totalRupiah: 120_000 }),
    });
    expect(different).toMatchObject({ verifiedVisit: true, proof: { result: "accepted" } });
  });

  it("does not compare across Providers", async () => {
    await post("satu@example.com", { proof: await photo(), extraction: read() });

    const elsewhere = await post("dua@example.com", {
      placeId: OTHER_PLACE,
      proof: await photo(),
      extraction: read({ clinicNameOnProof: "Klinik Gigi Ceria" }),
    });

    expect(elsewhere).toMatchObject({ verifiedVisit: true, proof: { result: "accepted" } });
    expect(await fingerprint(elsewhere.testimonyId)).toMatchObject({ placeId: OTHER_PLACE });
  });

  it("adds possibleReuse to the other reasons", async () => {
    await post("satu@example.com", { proof: await photo(), extraction: read() });

    const second = await post("dua@example.com", {
      proof: await photo(),
      extraction: read({ clinicNameMatches: false }),
    });

    expect((await testimony(second.testimonyId)).proofOfVisit).toMatchObject({
      result: "pending",
      reasons: ["nameMismatch", "possibleReuse"],
    });
  });

  it("matches a pending proof too, not only accepted ones", async () => {
    await post("satu@example.com", { proof: await photo(), extraction: read({ clinicNameMatches: false }) });

    const second = await post("dua@example.com", { proof: await photo(), extraction: OTHER_FACTS });

    expect((await testimony(second.testimonyId)).proofOfVisit).toMatchObject({
      result: "pending",
      reasons: ["possibleReuse"],
    });
  });

  it("checks a new proof sent in an edit after a rejected one, and fingerprints it", async () => {
    await post("satu@example.com", { proof: await photo(), extraction: read() });
    const second = await post("dua@example.com", {
      proof: { bytes: await anotherReceiptPhoto(), type: "image/jpeg" },
      extraction: read({ isProofOfVisit: false }),
    });
    expect(await fingerprint(second.testimonyId)).toBeUndefined();

    const response = await send(`/api/testimonies/${second.testimonyId}`, second.cookie, {
      proof: await photo(),
      extraction: OTHER_FACTS,
    });
    expect(response.status).toBe(200);

    expect((await testimony(second.testimonyId)).proofOfVisit).toMatchObject({
      result: "pending",
      reasons: ["possibleReuse"],
    });
    expect(await fingerprint(second.testimonyId)).toMatchObject({ placeId: PLACE });
  });
});

describe("freeing a fingerprint", () => {
  it("deletes it with the Testimony, so the receipt's real owner can then use it", async () => {
    const first = await post("satu@example.com", { proof: await photo(), extraction: read() });
    expect(await fingerprint(first.testimonyId)).toBeDefined();

    const deleted = await fetch(new URL(`/api/testimonies/${first.testimonyId}`, server.baseUrl), {
      method: "DELETE",
      headers: { cookie: first.cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
    });
    expect(deleted.status).toBe(200);
    expect(await fingerprint(first.testimonyId)).toBeUndefined();

    const second = await post("dua@example.com", { proof: await photo(), extraction: read() });
    expect(second).toMatchObject({ verifiedVisit: true, proof: { result: "accepted" } });
  });

  it("deletes it when the admin rejects the proof, and keeps it when the admin accepts", async () => {
    const rejected = await post("satu@example.com", {
      proof: await photo(),
      extraction: read({ clinicNameMatches: false }),
    });
    const accepted = await post("dua@example.com", {
      placeId: OTHER_PLACE,
      proof: await photo(),
      extraction: read({ clinicNameMatches: false }),
    });
    const admin = await adminCookie();

    expect(
      (
        await act(admin, {
          action: "rejectProof",
          subjectId: rejected.testimonyId,
          reason: "Bukan kuitansi klinik ini.",
        })
      ).status,
    ).toBe(200);
    expect((await act(admin, { action: "acceptProof", subjectId: accepted.testimonyId })).status).toBe(200);

    expect(await fingerprint(rejected.testimonyId)).toBeUndefined();
    expect(await fingerprint(accepted.testimonyId)).toMatchObject({ placeId: OTHER_PLACE });
  });

  it("fingerprints a proof sent to the admin before fingerprints were kept, when the admin accepts it", async () => {
    const early = await post("satu@example.com", {
      proof: await photo(),
      extraction: read({ clinicNameMatches: false }),
    });
    await server.firestore.collection(COLLECTIONS.proofFingerprints).doc(early.testimonyId).delete();

    expect((await act(await adminCookie(), { action: "acceptProof", subjectId: early.testimonyId })).status).toBe(200);

    expect(await fingerprint(early.testimonyId)).toMatchObject({
      placeId: PLACE,
      perceptualHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      fieldsKey: "klinik gigi ceria|2026-09-12|350000",
    });
    const again = await post("dua@example.com", { proof: await photo(), extraction: OTHER_FACTS });
    expect((await testimony(again.testimonyId)).proofOfVisit).toMatchObject({
      result: "pending",
      reasons: ["possibleReuse"],
    });
  });

  it("checks a proof attached later the same way: reuse waits for the admin, a fresh receipt is fingerprinted", async () => {
    await post("satu@example.com", { proof: await photo(), extraction: read() });
    const attachTo = async (email: string, proof: Proof, extraction: ProofOfVisitExtraction) => {
      const cookie = await server.signInWithGoogle(email);
      server.fakes.agent.respondToModerationWith(PUBLISH);
      const form = new FormData();
      form.set("testimony", JSON.stringify(submission()));
      const created = await fetch(new URL("/api/testimonies", server.baseUrl), {
        method: "POST",
        headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
        body: form,
      });
      const { testimonyId } = (await created.json()) as TestimonyStoredResponse;
      server.fakes.agent.respondToProofCheckWith({ proofOfVisit: extraction });
      const attachForm = new FormData();
      attachForm.set("proof", new File([new Uint8Array(proof.bytes)], "struk", { type: proof.type }));
      const response = await fetch(new URL(`/api/testimonies/${testimonyId}/proof`, server.baseUrl), {
        method: "POST",
        headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
        body: attachForm,
      });
      expect(response.status).toBe(200);
      return testimonyId;
    };

    const reused = await attachTo("dua@example.com", await photo(), OTHER_FACTS);
    expect(await testimony(reused)).toMatchObject({
      verifiedVisit: false,
      proofOfVisit: { result: "pending", reasons: ["possibleReuse"] },
    });

    const fresh = await attachTo(
      "tiga@example.com",
      { bytes: await anotherReceiptPhoto(), type: "image/jpeg" },
      read({ proofDate: "2026-09-03", totalRupiah: 125_000 }),
    );
    expect(await testimony(fresh)).toMatchObject({ verifiedVisit: true, proofOfVisit: { result: "accepted" } });
    expect(await fingerprint(fresh)).toMatchObject({
      placeId: PLACE,
      fieldsKey: "klinik gigi ceria|2026-09-03|125000",
    });
  });

  it("deletes it when the proof expires after 7 days", async () => {
    const NOW = Date.parse("2026-11-23T03:30:00Z");
    const pending = await post("satu@example.com", {
      proof: await photo(),
      extraction: read({ clinicNameMatches: false }),
    });
    await server.firestore
      .collection(COLLECTIONS.testimonies)
      .doc(pending.testimonyId)
      .update({ "proofOfVisit.checkedAt": Timestamp.fromMillis(NOW - 8 * 24 * 60 * 60 * 1000) });

    const summary = await expirePendingProofs({
      firestore: server.firestore,
      uploads: server.uploads,
      logger: silentLogger,
      now: () => NOW,
    });

    expect(summary).toEqual({ expired: 1, failed: 0 });
    expect(await fingerprint(pending.testimonyId)).toBeUndefined();
  });
});

describe("admin queue: possible reuse", () => {
  it("lists the Testimonies whose fingerprint matches, with how, linking the published one", async () => {
    const first = await post("satu@example.com", { proof: await photo(), extraction: read() });
    const second = await post("dua@example.com", { proof: await photo(), extraction: OTHER_FACTS });
    const unrelated = await post("tiga@example.com", {
      proof: await photo(),
      extraction: read({ clinicNameMatches: false }),
      placeId: OTHER_PLACE,
    });
    const admin = await adminCookie();

    const items = await proofItems(admin);
    const item = items.find((i) => i.subjectId === second.testimonyId);
    expect(item?.proof).toMatchObject({
      reasons: ["possibleReuse"],
      reuseMatches: [
        {
          testimonyId: first.testimonyId,
          displayName: "Siti R.",
          status: "published",
          proofResult: "accepted",
          matchedOn: ["perceptualHash"],
          href: `/tempat/${PLACE}#testimoni-${first.testimonyId}`,
        },
      ],
    });
    // A proof pending for other reasons lists no matches at all.
    expect(items.find((i) => i.subjectId === unrelated.testimonyId)?.proof).not.toHaveProperty("reuseMatches");
  });

  it("drops a matching Testimony its author has since deleted", async () => {
    const first = await post("satu@example.com", { proof: await photo(), extraction: read() });
    const second = await post("dua@example.com", { proof: await photo(), extraction: read() });
    const admin = await adminCookie();
    expect((await proofItems(admin)).find((i) => i.subjectId === second.testimonyId)?.proof?.reuseMatches).toEqual([
      expect.objectContaining({ testimonyId: first.testimonyId, matchedOn: ["fieldsKey", "perceptualHash"] }),
    ]);

    await fetch(new URL(`/api/testimonies/${first.testimonyId}`, server.baseUrl), {
      method: "DELETE",
      headers: { cookie: first.cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
    });

    const item = (await proofItems(admin)).find((i) => i.subjectId === second.testimonyId);
    expect(item?.proof).toMatchObject({ reasons: ["possibleReuse"], reuseMatches: [] });
  });
});
