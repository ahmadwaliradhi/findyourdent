// Testimony Policy Violation cases on the owner pages (spec 09 part 2, issue #137 slice 2):
// the claimed Provider sees its notified and decided cases, never the evidence, and may
// respond while the 7-day window is open. Everything goes through HTTP.
import { COLLECTIONS, type PolicyViolationDoc } from "@findyourdent/contracts/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminActionRequest, AdminQueueResponse } from "../../app/lib/admin-queue.ts";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import { seedProvider } from "../support/fixtures.ts";
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

const OWNER = "drg.sari@example.com";
const DAY_MS = 24 * 60 * 60 * 1000;
const SECRET_NOTE = "CATATAN-INTERNAL-RAHASIA";
const SECRET_REPORT = "laporan-rahasia-77";
const SECRET_HOLD = "tahan-rahasia-88";
const SECRET_PATH = "violations/bukti-rahasia-99.png";

const adminCookie = () => server.signInWithGoogle(ADMIN_EMAILS[0] as string);

/** A Listed Provider with an approved Claim by OWNER, through the real Claim flow; returns the owner's cookie. */
async function claimedProvider() {
  const listed = await seedProvider(server.firestore);
  const cookie = await server.signInWithGoogle(OWNER);
  const form = new FormData();
  form.set("claim", JSON.stringify({ role: "owner", contactPhone: "0812-1111-2222" }));
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  form.set("permit", new File([png], "sip.png", { type: "image/png" }));
  const submitted = await fetch(new URL(`/api/providers/${listed.placeId}/claims`, server.baseUrl), {
    method: "POST",
    headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
    body: form,
  });
  expect(submitted.status).toBe(201);
  const { claimId } = (await submitted.json()) as { claimId: string };
  const approve: AdminActionRequest = { action: "approveClaim", subjectId: claimId };
  expect((await server.post("/admin/api/actions", approve, { headers: { cookie: await adminCookie() } })).status).toBe(
    200,
  );
  return { listed, cookie };
}

type Seed = Partial<Omit<PolicyViolationDoc, "notifiedAt" | "responseDueAt" | "decidedAt">> & {
  placeId: string;
  notifiedAt?: Date;
  responseDueAt?: Date;
};

/** Writes a case straight into Firestore; defaults to a notified case with a open window. */
async function seedViolation(seed: Seed): Promise<string> {
  const now = new Date();
  const status = seed.status ?? "providerNotified";
  const notified = status !== "open";
  const doc = {
    evidence: {
      reportIds: [SECRET_REPORT],
      detectionHoldIds: [SECRET_HOLD],
      notes: SECRET_NOTE,
      privateEvidencePaths: [SECRET_PATH],
    },
    suspectedPeriod: { from: "2026-08-01", to: "2026-10-31" },
    openedBy: "admin-uid",
    ...(notified
      ? {
          notifiedAt: now,
          responseDueAt: new Date(now.getTime() + 7 * DAY_MS),
          notifiedVia: "ownerPages",
        }
      : {}),
    createdAt: now,
    updatedAt: now,
    ...seed,
    status,
  };
  return (await server.firestore.collection(COLLECTIONS.policyViolations).add(doc)).id;
}

async function ownerPage(cookie: string, placeId: string): Promise<string> {
  const response = await fetch(new URL(`/tempat/${placeId}/klaim`, server.baseUrl), { headers: { cookie } });
  expect(response.status).toBe(200);
  return response.text();
}

describe("the owner's view of Testimony Policy Violation cases", () => {
  it("shows a notified case to the claimant, without any evidence", async () => {
    const { listed, cookie } = await claimedProvider();
    await seedViolation({ placeId: listed.placeId });

    const html = await ownerPage(cookie, listed.placeId);

    expect(html).toContain("Kasus dugaan pelanggaran kebijakan testimoni");
    expect(html).toContain("1 Agustus 2026");
    for (const secret of [SECRET_NOTE, SECRET_REPORT, SECRET_HOLD, SECRET_PATH]) {
      expect(html).not.toContain(secret);
    }
  });

  it("shows nothing for a case that is still open (not notified yet)", async () => {
    const { listed, cookie } = await claimedProvider();
    await seedViolation({ placeId: listed.placeId, status: "open" });

    expect(await ownerPage(cookie, listed.placeId)).not.toContain("Kasus dugaan pelanggaran kebijakan testimoni");
  });
  it("never shows a case that was dismissed straight from open, without a notification", async () => {
    const { listed, cookie } = await claimedProvider();
    const id = await seedViolation({ placeId: listed.placeId, status: "open" });
    const dismiss: AdminActionRequest = { action: "dismissViolation", subjectId: id, reason: "Salah paham." };
    expect(
      (await server.post("/admin/api/actions", dismiss, { headers: { cookie: await adminCookie() } })).status,
    ).toBe(200);

    const html = await ownerPage(cookie, listed.placeId);

    expect(html).not.toContain("Kasus dugaan pelanggaran kebijakan testimoni");
    expect(html).not.toContain("Salah paham.");
  });
});

describe("the owner's view across places", () => {
  it("shows a confirmed case with the team's reason and the response, and no form", async () => {
    const { listed, cookie } = await claimedProvider();
    await seedViolation({
      placeId: listed.placeId,
      status: "confirmed",
      providerResponse: { text: "Kami berhenti memberi diskon.", respondedAt: new Date() as never, responderUid: "x" },
      decisionReason: "Diskon untuk Testimoni terbukti.",
    } as Seed);

    const html = await ownerPage(cookie, listed.placeId);

    expect(html).toContain("Diskon untuk Testimoni terbukti.");
    expect(html).toContain("Kami berhenti memberi diskon.");
    expect(html).not.toContain("Kirim tanggapan");
  });

  it("does not show another Provider's case", async () => {
    const { listed, cookie } = await claimedProvider();
    const other = await seedProvider(server.firestore);
    await seedViolation({ placeId: other.placeId });

    expect(await ownerPage(cookie, listed.placeId)).not.toContain("Kasus dugaan pelanggaran kebijakan testimoni");
  });
});

const respondUrl = (placeId: string, violationId: string) =>
  `/api/providers/${placeId}/policy-violations/${violationId}/response`;

const respond = (cookie: string | null, placeId: string, violationId: string, body: unknown) =>
  server.post(respondUrl(placeId, violationId), body, cookie ? { headers: { cookie } } : {});

async function stored(id: string): Promise<PolicyViolationDoc> {
  return (await server.firestore.collection(COLLECTIONS.policyViolations).doc(id).get()).data() as PolicyViolationDoc;
}

describe("POST /api/providers/:placeId/policy-violations/:violationId/response", () => {
  it("asks a signed-out visitor to sign in, and refuses a signed-in account that is not the claimant", async () => {
    const { listed } = await claimedProvider();
    const id = await seedViolation({ placeId: listed.placeId });

    const signedOut = await respond(null, listed.placeId, id, { text: "Halo" });
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toMatchObject({ error: "sign_in_required" });

    const stranger = await server.signInWithGoogle("pasien@example.com");
    const refused = await respond(stranger, listed.placeId, id, { text: "Halo" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "not_owner" });
    expect((await stored(id)).providerResponse).toBeUndefined();
  });

  it("stores the trimmed response on a notified case, and a later one replaces it", async () => {
    const { listed, cookie } = await claimedProvider();
    const id = await seedViolation({ placeId: listed.placeId });

    const first = await respond(cookie, listed.placeId, id, { text: "  Kami tidak memberi imbalan.  " });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "saved", message: expect.stringContaining("Tanggapan Anda") });
    expect((await stored(id)).providerResponse).toMatchObject({ text: "Kami tidak memberi imbalan." });
    expect((await stored(id)).providerResponse?.responderUid).toBeTruthy();
    // Not a Moderation subject: nothing is screened.
    expect(server.fakes.agent.moderationCalls).toHaveLength(0);

    const second = await respond(cookie, listed.placeId, id, { text: "Ini penjelasan lengkap kami." });
    expect(second.status).toBe(200);
    expect((await stored(id)).providerResponse?.text).toBe("Ini penjelasan lengkap kami.");
    expect(await ownerPage(cookie, listed.placeId)).toContain("Ini penjelasan lengkap kami.");
  });

  it("refuses a case that is open or already decided, with 409", async () => {
    const { listed, cookie } = await claimedProvider();
    for (const status of ["open", "confirmed", "dismissed"] as const) {
      const id = await seedViolation({ placeId: listed.placeId, status });
      const response = await respond(cookie, listed.placeId, id, { text: "Tanggapan" });
      expect(response.status, status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "violation_closed" });
      expect((await stored(id)).providerResponse, status).toBeUndefined();
    }
  });

  it("refuses an empty, blank, missing or too long response, with 400", async () => {
    const { listed, cookie } = await claimedProvider();
    const id = await seedViolation({ placeId: listed.placeId });

    for (const body of [{ text: "" }, { text: "   " }, {}, { text: 5 }, { text: "x".repeat(2001) }]) {
      const response = await respond(cookie, listed.placeId, id, body);
      expect(response.status, JSON.stringify(body).slice(0, 30)).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_response" });
    }
    expect((await stored(id)).providerResponse).toBeUndefined();
    expect((await respond(cookie, listed.placeId, id, { text: "x".repeat(2000) })).status).toBe(200);
  });

  it("does not leak other Providers' cases: 404 for a case of another place or a missing one, 403 on a place it does not own", async () => {
    const { listed, cookie } = await claimedProvider();
    const other = await seedProvider(server.firestore);
    const othersCase = await seedViolation({ placeId: other.placeId });
    const missing = await respond(cookie, listed.placeId, "tidak-ada", { text: "Halo" });
    const crossed = await respond(cookie, listed.placeId, othersCase, { text: "Halo" });
    const notMine = await respond(cookie, other.placeId, othersCase, { text: "Halo" });

    expect(missing.status).toBe(404);
    expect(crossed.status).toBe(404);
    expect(await crossed.json()).toEqual(await missing.json());
    expect(notMine.status).toBe(403);
    expect((await stored(othersCase)).providerResponse).toBeUndefined();
  });

  it("shows the response to admins in the queue", async () => {
    const { listed, cookie } = await claimedProvider();
    const id = await seedViolation({ placeId: listed.placeId });
    expect((await respond(cookie, listed.placeId, id, { text: "Tidak ada diskon testimoni." })).status).toBe(200);

    const response = await server.get("/admin/api/queue", { headers: { cookie: await adminCookie() } });
    const queue = (await response.json()) as AdminQueueResponse;
    const item = queue.items.find((entry) => entry.kind === "policyViolation");
    expect(item?.violation?.providerResponse).toMatchObject({ text: "Tidak ada diskon testimoni." });
  });
});
