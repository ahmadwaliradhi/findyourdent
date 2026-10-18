// Admin proof review and the 7-day expiry (spec 09, ticket #129) through the web API:
// a doubtful Proof of Visit waits in the admin queue with its file, the facts read from
// it and the reasons; an admin accepts or rejects it; nobody deciding within 7 days
// expires it. Nothing is ever accepted by timeout.
import type { ModerationDecision, ProofExtraction } from "@findyourdent/contracts";
import {
  type AdminActionDoc,
  COLLECTIONS,
  IMPACT_COUNTERS,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminActionRequest, AdminQueueResponse } from "../../app/lib/admin-queue.ts";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type { TestimonyStoredResponse, TestimonySubmission } from "../../app/lib/testimony.ts";
import { jakartaDate } from "../../server/quota.ts";
import { ADMIN_EMAILS, startTestServer, type TestServer } from "../support/harness.ts";
import { receiptJpeg } from "../support/receipts.ts";

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
const HOUR_MS = 60 * 60 * 1000;

/** Today in Asia/Jakarta, so the 12-month Proof of Visit rule never makes these tests rot. */
const THIS_MONTH = jakartaDate(Date.now()).slice(0, 7);

function submission(overrides: Partial<TestimonySubmission> = {}): TestimonySubmission {
  return {
    placeId: PLACE,
    providerName: "Klinik Gigi Ceria",
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

const PUBLISH: ModerationDecision = {
  decision: "publish",
  ruleCodes: [],
  flaggedSpans: [],
  confidence: 0.95,
  authorMessage: "Terima kasih!",
};

/** What the agent read from a receipt whose clinic name does not match the Provider. */
function doubtfulFacts(overrides: Partial<ProofExtraction> = {}): ProofExtraction {
  return {
    readable: true,
    isProofOfVisit: true,
    clinicNameOnProof: "Klinik Gigi Sentosa",
    proofDate: `${THIS_MONTH}-02`,
    totalRupiah: 300_000,
    clinicNameMatches: false,
    ...overrides,
  };
}

/**
 * Posts a Testimony with a receipt the agent reads as `facts` (a doubtful one by
 * default, so it waits for the team) and returns its id. The receipt is the author's
 * own unless one is given.
 */
async function postWithProof(
  email: string,
  options: {
    facts?: ProofExtraction;
    decision?: ModerationDecision;
    overrides?: Partial<TestimonySubmission>;
    receipt?: Buffer;
  } = {},
): Promise<string> {
  server.fakes.agent.respondToModerationWith({
    ...(options.decision ?? PUBLISH),
    proofExtraction: options.facts ?? doubtfulFacts(),
  });
  const cookie = await server.signInWithGoogle(email);
  const form = new FormData();
  form.set("testimony", JSON.stringify(submission(options.overrides)));
  const receipt = options.receipt ?? (await receiptJpeg(`Struk ${email}`));
  form.set("proof", new File([new Uint8Array(receipt)], "struk.jpg", { type: "image/jpeg" }));
  const response = await fetch(new URL("/api/testimonies", server.baseUrl), {
    method: "POST",
    headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
    body: form,
  });
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as TestimonyStoredResponse).testimonyId;
}

async function testimony(id: string): Promise<TestimonyDoc> {
  return (await server.firestore.collection(COLLECTIONS.testimonies).doc(id).get()).data() as TestimonyDoc;
}

async function hasFingerprint(id: string): Promise<boolean> {
  return (await server.firestore.collection(COLLECTIONS.proofFingerprints).doc(id).get()).exists;
}

async function storedObjects(prefix: string): Promise<string[]> {
  const [files] = await server.uploads.getFiles({ prefix });
  return files.map((file) => file.name);
}

async function adminCookie(): Promise<string> {
  return server.signInWithGoogle(ADMIN_EMAILS[0] as string);
}

async function queue(cookie: string): Promise<AdminQueueResponse> {
  const response = await server.get("/admin/api/queue", { headers: { cookie } });
  if (response.status !== 200) throw new Error(`queue failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as AdminQueueResponse;
}

const act = (cookie: string, body: AdminActionRequest) =>
  server.post("/admin/api/actions", body, { headers: { cookie } });

async function adminActions(): Promise<AdminActionDoc[]> {
  const snapshot = await server.firestore.collection(COLLECTIONS.adminActions).get();
  return snapshot.docs.map((doc) => doc.data() as AdminActionDoc);
}

describe("admin queue: proof review", () => {
  it("shows a waiting proof with its file, the facts read from it, the reasons and a 72-hour target from the check", async () => {
    const id = await postWithProof("pasien@example.com");
    const checkedAt = (await testimony(id)).proofOfVisit?.checkedAt.toMillis() ?? 0;

    const { items } = await queue(await adminCookie());

    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item).toMatchObject({ kind: "proof", subjectId: id, overdue: false });
    expect(Date.parse(item?.createdAt ?? "")).toBe(checkedAt);
    expect(Date.parse(item?.dueAt ?? "") - checkedAt).toBe(72 * HOUR_MS);
    expect(item?.proof).toMatchObject({
      testimonyId: id,
      placeId: PLACE,
      providerName: "Klinik Gigi Ceria",
      testimonyStatus: "published",
      visitMonth: THIS_MONTH,
      fileUrl: `/admin/proofs/${id}`,
      fileType: "image",
      clinicNameOnProof: "Klinik Gigi Sentosa",
      proofDate: `${THIS_MONTH}-02`,
      totalRupiah: 300_000,
      reasons: ["nameMismatch"],
      attempts: 1,
      matchingTestimonies: [],
    });
  });

  it("links a reused receipt to the Testimonies whose fingerprints it matches", async () => {
    const shared = await receiptJpeg("Struk bersama");
    const matching = doubtfulFacts({ clinicNameMatches: true });
    const first = await postWithProof("satu@example.com", {
      facts: matching,
      receipt: shared,
      overrides: { displayName: "Budi S." },
    });
    // The same picture read with another total: the file matches, the key does not.
    const second = await postWithProof("dua@example.com", {
      facts: doubtfulFacts({ clinicNameMatches: true, totalRupiah: 450_000 }),
      receipt: shared,
    });
    // Another receipt at the same place, waiting for its name only, matches nothing.
    await postWithProof("tiga@example.com", { facts: doubtfulFacts({ totalRupiah: 99_000 }) });
    expect((await testimony(first)).proofOfVisit?.result).toBe("accepted");
    const cookie = await adminCookie();

    const proofs = (await queue(cookie)).items.filter((item) => item.kind === "proof");

    expect(proofs.map((item) => [item.subjectId, item.proof?.reasons, item.proof?.matchingTestimonies])).toEqual(
      expect.arrayContaining([
        [
          second,
          ["possibleReuse"],
          [{ testimonyId: first, placeId: PLACE, displayName: "Budi S.", status: "published" }],
        ],
        [expect.any(String), ["nameMismatch"], []],
      ]),
    );
    expect(proofs).toHaveLength(2);

    const html = await (await server.get("/admin", { headers: { cookie } })).text();
    expect(html).toContain("Mirip bukti Testimoni lain di tempat ini");
    expect(html).toContain("Testimoni dengan bukti yang mirip");
    expect(html).toContain(`href="/tempat/${PLACE}#testimoni-${first}"`);
  });
});

describe("admin page: proof review", () => {
  it("renders the proof, the facts read from it, the reasons in words, the target and both actions", async () => {
    const { proofDate: _, ...undated } = doubtfulFacts();
    const id = await postWithProof("pasien@example.com", { facts: undated });
    const response = await server.get("/admin", { headers: { cookie: await adminCookie() } });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Periksa bukti kunjungan");
    expect(html).toContain(`src="/admin/proofs/${id}"`);
    expect(html).toContain("Klinik Gigi Sentosa");
    expect(html).toContain("Nama klinik tidak cocok dengan tempat ini");
    expect(html).toContain("Tanggal tidak cocok dengan bulan kunjungan");
    expect(html).toContain("Target ");
    expect(html).toContain("Terima bukti");
    expect(html).toContain("Tolak bukti");
  });
});

describe("GET /admin/proofs/:testimonyId", () => {
  it("streams the waiting proof privately to an admin, and to nobody else", async () => {
    const id = await postWithProof("pasien@example.com");
    const author = await server.signInWithGoogle("pasien@example.com");

    const response = await server.get(`/admin/proofs/${id}`, { headers: { cookie: await adminCookie() } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect((await sharp(bytes).metadata()).format).toBe("jpeg");

    const signedOut = await server.get(`/admin/proofs/${id}`, { redirect: "manual" });
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get("location")).toMatch(/^\/signin\?/);
    expect((await server.get(`/admin/proofs/${id}`, { headers: { cookie: author } })).status).toBe(403);
  });

  it("answers 404 when there is no waiting file", async () => {
    const cookie = await adminCookie();
    expect((await server.get("/admin/proofs/does-not-exist", { headers: { cookie } })).status).toBe(404);
  });
});

async function verifiedVisitCount(placeId = PLACE): Promise<number | undefined> {
  const snapshot = await server.firestore.collection(COLLECTIONS.providers).doc(placeId).get();
  return snapshot.get("aggregates.verifiedVisitCount") as number | undefined;
}

async function counter(key: keyof typeof IMPACT_COUNTERS): Promise<number> {
  const snapshot = await server.firestore.collection(COLLECTIONS.counters).doc(IMPACT_COUNTERS[key]).get();
  return (snapshot.get("value") as number | undefined) ?? 0;
}

describe("admin accepts a proof", () => {
  it("makes a published Testimony Proven: aggregates and counter follow, the file goes, the action is logged", async () => {
    const id = await postWithProof("pasien@example.com");
    expect(await verifiedVisitCount()).toBe(0);
    expect(await counter("verifiedVisits")).toBe(0);
    const cookie = await adminCookie();

    const response = await act(cookie, { action: "acceptProof", subjectId: id });

    expect(response.status).toBe(200);
    const stored = await testimony(id);
    expect(stored.verifiedVisit).toBe(true);
    expect(stored.status).toBe("published");
    expect(stored.proofOfVisit).toMatchObject({ result: "accepted", clinicNameOnProof: "Klinik Gigi Sentosa" });
    expect(stored.proofOfVisit?.reasons).toBeUndefined();
    // An accepted receipt keeps its fingerprint, so it cannot prove another Testimony.
    expect(await hasFingerprint(id)).toBe(true);
    expect(await verifiedVisitCount()).toBe(1);
    expect(await counter("verifiedVisits")).toBe(1);
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    expect(await adminActions()).toEqual([
      expect.objectContaining({
        action: "acceptProof",
        subjectType: "proofOfVisit",
        subjectId: id,
        placeId: PLACE,
        adminEmail: ADMIN_EMAILS[0],
        fromStatus: "pending",
        toStatus: "accepted",
      }),
    ]);
    expect((await queue(cookie)).items).toEqual([]);
  });

  it("on a held Testimony touches no public number until the Testimony is published", async () => {
    const id = await postWithProof("pasien@example.com", { decision: { ...PUBLISH, decision: "hold" } });
    const cookie = await adminCookie();
    const before = (await queue(cookie)).items;
    expect(before.map((item) => item.kind).sort()).toEqual(["held", "proof"]);

    expect((await act(cookie, { action: "acceptProof", subjectId: id })).status).toBe(200);

    // The held text keeps its place and its 24-hour target in the queue.
    const after = (await queue(cookie)).items;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ kind: "held", createdAt: before.find((item) => item.kind === "held")?.createdAt });
    expect(await testimony(id)).toMatchObject({
      status: "held",
      verifiedVisit: true,
      proofOfVisit: { result: "accepted" },
    });
    expect(await verifiedVisitCount()).toBeUndefined();
    expect(await counter("verifiedVisits")).toBe(0);
    expect(await storedObjects("proof-of-visit/")).toEqual([]);

    expect((await act(cookie, { action: "publish", subjectId: id })).status).toBe(200);
    expect(await verifiedVisitCount()).toBe(1);
    expect(await counter("verifiedVisits")).toBe(1);
  });
});

describe("admin rejects a proof", () => {
  const NOTE = "Nama klinik di struk bukan klinik ini.";

  it("only with a reason, which the author reads on Testimoni saya; the file and fingerprint go and nothing is counted", async () => {
    const id = await postWithProof("pasien@example.com");
    const cookie = await adminCookie();

    expect((await act(cookie, { action: "rejectProof", subjectId: id })).status).toBe(400);
    expect((await testimony(id)).proofOfVisit?.result).toBe("pending");
    expect(await storedObjects(`proof-of-visit/${id}/`)).toHaveLength(1);
    expect(await hasFingerprint(id)).toBe(true);

    expect((await act(cookie, { action: "rejectProof", subjectId: id, reason: NOTE })).status).toBe(200);
    expect(await hasFingerprint(id)).toBe(false);

    const stored = await testimony(id);
    expect(stored).toMatchObject({ status: "published", verifiedVisit: false });
    expect(stored.proofOfVisit).toMatchObject({ result: "rejected", reason: "adminRejected", adminReason: NOTE });
    expect(stored.proofOfVisit?.reasons).toBeUndefined();
    expect(stored.adminReason).toBeUndefined();
    expect(await verifiedVisitCount()).toBe(0);
    expect(await counter("verifiedVisits")).toBe(0);
    expect(await storedObjects("proof-of-visit/")).toEqual([]);
    expect(await adminActions()).toEqual([
      expect.objectContaining({
        action: "rejectProof",
        subjectType: "proofOfVisit",
        subjectId: id,
        reason: NOTE,
        fromStatus: "pending",
        toStatus: "rejected",
      }),
    ]);
    expect((await queue(cookie)).items).toEqual([]);

    const author = await server.signInWithGoogle("pasien@example.com");
    const page = await (await server.get("/testimoni-saya", { headers: { cookie: author } })).text();
    expect(page).toContain("Bukti kunjungan tidak diterima setelah diperiksa tim FindYourDent.");
    expect(page).toContain(NOTE);
  });
});

describe("proof actions: who may decide, and what", () => {
  it("refuses a signed-out visitor and a Patient, and changes nothing", async () => {
    const id = await postWithProof("pasien@example.com");
    const author = await server.signInWithGoogle("pasien@example.com");

    expect((await server.post("/admin/api/actions", { action: "acceptProof", subjectId: id })).status).toBe(401);
    expect((await act(author, { action: "acceptProof", subjectId: id })).status).toBe(403);
    expect((await act(author, { action: "rejectProof", subjectId: id, reason: "Saya penulisnya." })).status).toBe(403);

    expect(await testimony(id)).toMatchObject({ verifiedVisit: false, proofOfVisit: { result: "pending" } });
    expect(await storedObjects(`proof-of-visit/${id}/`)).toHaveLength(1);
    expect(await adminActions()).toEqual([]);
  });

  it("refuses a proof that is not waiting: already decided, accepted at submission, or none at all", async () => {
    const cookie = await adminCookie();
    const decided = await postWithProof("pasien@example.com");
    expect((await act(cookie, { action: "acceptProof", subjectId: decided })).status).toBe(200);
    const accepted = await postWithProof("lain@example.com", {
      facts: doubtfulFacts({ clinicNameMatches: true }),
      overrides: { placeId: "ChIJ-lain" },
    });
    expect((await testimony(accepted)).proofOfVisit?.result).toBe("accepted");

    for (const subjectId of [decided, accepted, "does-not-exist"]) {
      expect((await act(cookie, { action: "rejectProof", subjectId, reason: "Coba." })).status).toBe(404);
    }
    expect(await adminActions()).toHaveLength(1);
  });
});
