// Admin proof review and the 7-day expiry (spec 09, issue #129) through the web API:
// a pending Proof of Visit waits in the admin queue with its file, the facts read and
// the reasons; accept makes the Testimony a Proven Testimony, reject tells the author
// why, and a proof nobody decides within 7 days expires. Every path deletes the file.
import type { ModerationDecision, ProofOfVisitExtraction } from "@findyourdent/contracts";
import {
  type AdminActionDoc,
  COLLECTIONS,
  IMPACT_COUNTERS,
  type ProviderDoc,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminActionRequest, AdminQueueResponse } from "../../app/lib/admin-queue.ts";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type { TestimonyStoredResponse, TestimonySubmission } from "../../app/lib/testimony.ts";
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

function submission(overrides: Partial<TestimonySubmission> = {}): TestimonySubmission {
  return {
    placeId: PLACE,
    providerName: "Klinik Gigi Ceria",
    region: { provinceCode: "31", regencyCode: "31.71" },
    ratings: { service: 5, hygiene: 4, materialsEquipment: 3 },
    text: "Dokternya sabar menjelaskan pilihan tambalan dan ruangannya bersih.",
    visitMonth: "2026-09",
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
const HOLD: ModerationDecision = { ...PUBLISH, decision: "hold", ruleCodes: ["low_confidence"], confidence: 0.5 };

/** A receipt from another clinic: the check sends it to the team. */
const MISMATCH: ProofOfVisitExtraction = {
  readable: true,
  isProofOfVisit: true,
  clinicNameOnProof: "Klinik Lain",
  proofDate: "2026-09-12",
  totalRupiah: 300_000,
  clinicNameMatches: false,
};

async function receipt(): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: "#f5f5dc" } })
    .jpeg()
    .toBuffer();
}

/** Posts a Testimony with a proof the check sends to the team; returns its id and the author's cookie. */
async function postWithPendingProof(
  email = "pasien@example.com",
  moderation: ModerationDecision = PUBLISH,
): Promise<{ id: string; cookie: string }> {
  server.fakes.agent.respondToModerationWith({ ...moderation, proofOfVisit: MISMATCH });
  const cookie = await server.signInWithGoogle(email);
  const form = new FormData();
  form.set("testimony", JSON.stringify(submission()));
  form.set("proof", new File([new Uint8Array(await receipt())], "struk.jpg", { type: "image/jpeg" }));
  const response = await fetch(new URL("/api/testimonies", server.baseUrl), {
    method: "POST",
    headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
    body: form,
  });
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  const { testimonyId } = (await response.json()) as TestimonyStoredResponse;
  return { id: testimonyId, cookie };
}

async function testimony(id: string): Promise<TestimonyDoc> {
  return (await server.firestore.collection(COLLECTIONS.testimonies).doc(id).get()).data() as TestimonyDoc;
}

async function provider(): Promise<ProviderDoc | undefined> {
  return (await server.firestore.collection(COLLECTIONS.providers).doc(PLACE).get()).data() as ProviderDoc | undefined;
}

async function counter(key: keyof typeof IMPACT_COUNTERS): Promise<number> {
  const snapshot = await server.firestore.collection(COLLECTIONS.counters).doc(IMPACT_COUNTERS[key]).get();
  return (snapshot.get("value") as number | undefined) ?? 0;
}

async function proofFiles(): Promise<string[]> {
  const [files] = await server.uploads.getFiles({ prefix: "proof-of-visit/" });
  return files.map((file) => file.name);
}

async function adminActions(): Promise<AdminActionDoc[]> {
  const snapshot = await server.firestore.collection(COLLECTIONS.adminActions).get();
  return snapshot.docs.map((doc) => doc.data() as AdminActionDoc);
}

const adminCookie = () => server.signInWithGoogle(ADMIN_EMAILS[0] as string);

async function queue(cookie: string): Promise<AdminQueueResponse> {
  const response = await server.get("/admin/api/queue", { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as AdminQueueResponse;
}

const act = (cookie: string, body: AdminActionRequest) =>
  server.post("/admin/api/actions", body, { headers: { cookie } });

describe("admin queue: proof review", () => {
  it("lists a pending proof with its file, the facts read and the reasons", async () => {
    const { id } = await postWithPendingProof();
    const admin = await adminCookie();

    const items = (await queue(admin)).items.filter((item) => item.kind === "proofReview");
    expect(items).toEqual([
      expect.objectContaining({
        id,
        subjectId: id,
        proof: {
          fileUrl: `/admin/proofs/${id}/file`,
          reasons: ["nameMismatch"],
          extracted: { clinicName: "Klinik Lain", proofDate: "2026-09-12", totalRupiah: 300_000 },
        },
        testimony: expect.objectContaining({ id, status: "published", verifiedVisit: false }),
      }),
    ]);

    const file = await server.get(`/admin/proofs/${id}/file`, { headers: { cookie: admin } });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/jpeg");
    expect(file.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("admin accepts a proof", () => {
  it("makes the Testimony a Proven Testimony, recomputes aggregates, moves the counter and deletes the file", async () => {
    const { id } = await postWithPendingProof();
    expect(await proofFiles()).toHaveLength(1);
    expect((await provider())?.aggregates.verifiedVisitCount).toBe(0);
    const admin = await adminCookie();

    const response = await act(admin, { action: "acceptProof", subjectId: id });
    expect(response.status).toBe(200);

    const stored = await testimony(id);
    expect(stored.verifiedVisit).toBe(true);
    expect(stored.proofOfVisit).toMatchObject({
      result: "accepted",
      extracted: { clinicName: "Klinik Lain", proofDate: "2026-09-12", totalRupiah: 300_000 },
    });
    expect(stored.proofOfVisit).not.toHaveProperty("filePath");
    expect(stored.proofOfVisit).not.toHaveProperty("reasons");
    expect((await provider())?.aggregates.verifiedVisitCount).toBe(1);
    expect(await counter("verifiedVisits")).toBe(1);
    expect(await proofFiles()).toEqual([]);
    expect(await adminActions()).toEqual([
      expect.objectContaining({
        action: "acceptProof",
        subjectType: "testimony",
        subjectId: id,
        placeId: PLACE,
        adminEmail: ADMIN_EMAILS[0],
        fromStatus: "proof.pending",
        toStatus: "proof.accepted",
      }),
    ]);
    expect((await queue(admin)).items.filter((item) => item.kind === "proofReview")).toEqual([]);
  });

  it("counts a held Testimony's accepted proof only once the Testimony is published", async () => {
    const { id } = await postWithPendingProof("pasien@example.com", HOLD);
    const admin = await adminCookie();

    expect((await act(admin, { action: "acceptProof", subjectId: id })).status).toBe(200);
    expect((await testimony(id)).verifiedVisit).toBe(true);
    expect(await counter("verifiedVisits")).toBe(0);

    expect((await act(admin, { action: "publish", subjectId: id })).status).toBe(200);
    expect(await counter("verifiedVisits")).toBe(1);
    expect((await provider())?.aggregates.verifiedVisitCount).toBe(1);
  });

  it("refuses a Testimony whose proof is not pending", async () => {
    const { id } = await postWithPendingProof();
    const admin = await adminCookie();
    expect((await act(admin, { action: "acceptProof", subjectId: id })).status).toBe(200);

    expect((await act(admin, { action: "acceptProof", subjectId: id })).status).toBe(404);
    expect((await act(admin, { action: "rejectProof", subjectId: id, reason: "Terlambat." })).status).toBe(404);
    expect(await counter("verifiedVisits")).toBe(1);
  });
});

describe("admin rejects a proof", () => {
  it("records the reason the author sees, deletes the file and changes no score", async () => {
    const { id, cookie } = await postWithPendingProof();
    const admin = await adminCookie();

    expect((await act(admin, { action: "rejectProof", subjectId: id })).status).toBe(400);
    const response = await act(admin, {
      action: "rejectProof",
      subjectId: id,
      reason: "Nama klinik di kuitansi berbeda dengan klinik ini.",
    });
    expect(response.status).toBe(200);

    const stored = await testimony(id);
    expect(stored.status).toBe("published");
    expect(stored.verifiedVisit).toBe(false);
    expect(stored.proofOfVisit).toMatchObject({
      result: "rejected",
      reason: "adminRejected",
      adminReason: "Nama klinik di kuitansi berbeda dengan klinik ini.",
    });
    expect(stored.proofOfVisit).not.toHaveProperty("filePath");
    expect(stored.proofOfVisit).not.toHaveProperty("extracted");
    expect((await provider())?.aggregates.verifiedVisitCount).toBe(0);
    expect(await counter("verifiedVisits")).toBe(0);
    expect(await proofFiles()).toEqual([]);
    expect(await adminActions()).toEqual([
      expect.objectContaining({
        action: "rejectProof",
        subjectId: id,
        reason: "Nama klinik di kuitansi berbeda dengan klinik ini.",
        fromStatus: "proof.pending",
        toStatus: "proof.rejected",
      }),
    ]);

    const page = await fetch(new URL("/testimoni-saya", server.baseUrl), { headers: { cookie } });
    const html = await page.text();
    expect(html).toContain("Bukti kunjungan tidak diterima setelah diperiksa tim FindYourDent");
    expect(html).toContain("Nama klinik di kuitansi berbeda dengan klinik ini.");
  });
});

describe("proof review: who may use it", () => {
  it("refuses the file and both actions to anyone but an admin", async () => {
    const { id, cookie } = await postWithPendingProof();

    const signedOut = await fetch(new URL(`/admin/proofs/${id}/file`, server.baseUrl), { redirect: "manual" });
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get("location")).toContain("/signin");
    expect((await server.get(`/admin/proofs/${id}/file`, { headers: { cookie } })).status).toBe(403);
    expect((await server.post("/admin/api/actions", { action: "acceptProof", subjectId: id })).status).toBe(401);
    expect((await act(cookie, { action: "acceptProof", subjectId: id })).status).toBe(403);
    expect((await act(cookie, { action: "rejectProof", subjectId: id, reason: "x" })).status).toBe(403);

    expect((await testimony(id)).proofOfVisit?.result).toBe("pending");
    expect(await proofFiles()).toHaveLength(1);
    expect(await adminActions()).toEqual([]);
  });
});

describe("7-day proof expiry", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const NOW = Date.parse("2026-11-23T03:30:00Z");

  async function checkedDaysAgo(id: string, days: number) {
    await server.firestore
      .collection(COLLECTIONS.testimonies)
      .doc(id)
      .update({ "proofOfVisit.checkedAt": Timestamp.fromMillis(NOW - days * DAY_MS) });
  }

  const run = () =>
    expirePendingProofs({ firestore: server.firestore, uploads: server.uploads, logger: silentLogger, now: () => NOW });

  it("rejects a proof pending for more than 7 days as expired and deletes its file, never accepting it", async () => {
    const old = await postWithPendingProof("lama@example.com");
    await checkedDaysAgo(old.id, 7.5);
    const recent = await postWithPendingProof("baru@example.com");
    await checkedDaysAgo(recent.id, 6);
    expect(await proofFiles()).toHaveLength(2);

    expect(await run()).toEqual({ expired: 1, failed: 0 });

    const expired = await testimony(old.id);
    expect(expired.status).toBe("published");
    expect(expired.verifiedVisit).toBe(false);
    expect(expired.proofOfVisit).toMatchObject({ result: "rejected", reason: "expired" });
    expect(expired.proofOfVisit).not.toHaveProperty("filePath");
    expect(expired.proofOfVisit).not.toHaveProperty("extracted");
    expect((await testimony(recent.id)).proofOfVisit?.result).toBe("pending");
    const files = await proofFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toContain(recent.id);
    expect((await provider())?.aggregates.verifiedVisitCount).toBe(0);
    expect(await counter("verifiedVisits")).toBe(0);

    const page = await fetch(new URL("/testimoni-saya", server.baseUrl), { headers: { cookie: old.cookie } });
    expect(await page.text()).toContain("belum sempat diperiksa dalam 7 hari");
  });

  it("leaves the queue without the expired proof and does nothing on a second run", async () => {
    const { id } = await postWithPendingProof();
    await checkedDaysAgo(id, 8);
    await run();

    expect(await run()).toEqual({ expired: 0, failed: 0 });
    const admin = await adminCookie();
    expect((await queue(admin)).items.filter((item) => item.kind === "proofReview")).toEqual([]);
    expect((await act(admin, { action: "acceptProof", subjectId: id })).status).toBe(404);
  });
});
