// Testimony Policy Violation cases (spec 09 part 2, issue #137 slice 1) through the admin
// API: open with evidence, notify the Provider, confirm after the 7-day window or dismiss.
// Every move is logged in `adminActions`; only allowlisted admins reach any of it.
import {
  type AdminActionDoc,
  type ClaimDoc,
  COLLECTIONS,
  type PolicyViolationDoc,
  type TestimonyReportDoc,
} from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminActionRequest, AdminActionResponse, AdminQueueResponse } from "../../app/lib/admin-queue.ts";
import { seedProvider, seedTestimony } from "../support/fixtures.ts";
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

const DAY_MS = 24 * 60 * 60 * 1000;
const GOOGLE_PHONE = "(031) 5012345";

const adminCookie = () => server.signInWithGoogle(ADMIN_EMAILS[0] as string);

const act = (cookie: string, body: AdminActionRequest) =>
  server.post("/admin/api/actions", body, { headers: { cookie } });

async function queue(cookie: string): Promise<AdminQueueResponse> {
  const response = await server.get("/admin/api/queue", { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as AdminQueueResponse;
}

async function violation(id: string): Promise<PolicyViolationDoc> {
  return (await server.firestore.collection(COLLECTIONS.policyViolations).doc(id).get()).data() as PolicyViolationDoc;
}

async function adminActions(): Promise<AdminActionDoc[]> {
  const snapshot = await server.firestore.collection(COLLECTIONS.adminActions).orderBy("createdAt").get();
  return snapshot.docs.map((doc) => doc.data() as AdminActionDoc);
}

/** A Claim document for `placeId` in the given status, as the Provider's `claimId` points at. */
async function seedClaim(placeId: string, status: ClaimDoc["status"]): Promise<string> {
  const now = new Date();
  const ref = await server.firestore.collection(COLLECTIONS.claims).add({
    placeId,
    claimantUid: "claimant-uid",
    role: "owner",
    contactPhone: "0812-1111-2222",
    status,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

async function claimedPlace(claimStatus: ClaimDoc["status"] = "approved") {
  const provider = await seedProvider(server.firestore);
  const claimId = await seedClaim(provider.placeId, claimStatus);
  await server.firestore
    .collection(COLLECTIONS.providers)
    .doc(provider.placeId)
    .update({ claimStatus: "claimed", claimId });
  return provider;
}

async function seedReport(placeId: string, testimonyId: string): Promise<string> {
  const doc: Omit<TestimonyReportDoc, "createdAt"> & { createdAt: Date } = {
    testimonyId,
    placeId,
    category: "incentive",
    reporterRole: "public",
    hidTestimony: false,
    status: "open",
    createdAt: new Date(),
  };
  return (await server.firestore.collection(COLLECTIONS.testimonyReports).add(doc)).id;
}

/** An unclaimed Listed Provider with a Testimony and a report on it. */
async function unclaimedPlace() {
  const provider = await seedProvider(server.firestore);
  const testimony = await seedTestimony(server.firestore, provider);
  const reportId = await seedReport(provider.placeId, testimony.id);
  return { provider, testimony, reportId };
}

const PERIOD = { reportIds: [], detectionHoldIds: [], suspectedFrom: "2026-08-01", suspectedTo: "2026-10-31" };

async function open(
  cookie: string,
  placeId: string,
  violation: Partial<NonNullable<AdminActionRequest["violation"]>> = {},
  reason: string | null = "Dua pelapor menyebut diskon untuk testimoni.",
) {
  return act(cookie, {
    action: "openViolation",
    subjectId: placeId,
    ...(reason ? { reason } : {}),
    violation: { ...PERIOD, ...violation },
  });
}

async function opened(cookie: string, placeId: string, evidence = {}): Promise<string> {
  const response = await open(cookie, placeId, evidence);
  expect(response.status).toBe(200);
  const body = (await response.json()) as AdminActionResponse;
  expect(body.violationId).toBeTruthy();
  return body.violationId as string;
}

describe("violation case: open", () => {
  it("creates an open case with the evidence, and logs it against the new case", async () => {
    const { provider, testimony, reportId } = await unclaimedPlace();
    const admin = await adminCookie();

    const response = await open(admin, provider.placeId, {
      reportIds: [reportId],
      detectionHoldIds: [testimony.id],
      notes: "Papan di klinik: ulasan bintang lima dapat potongan.",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as AdminActionResponse;

    expect(await violation(body.violationId as string)).toMatchObject({
      placeId: provider.placeId,
      status: "open",
      evidence: {
        reportIds: [reportId],
        detectionHoldIds: [testimony.id],
        notes: "Papan di klinik: ulasan bintang lima dapat potongan.",
        privateEvidencePaths: [],
      },
      suspectedPeriod: { from: "2026-08-01", to: "2026-10-31" },
      openedBy: expect.any(String),
    });
    expect(await adminActions()).toEqual([
      expect.objectContaining({
        action: "openViolation",
        subjectType: "policyViolation",
        subjectId: body.violationId,
        placeId: provider.placeId,
        toStatus: "open",
        reason: "Dua pelapor menyebut diskon untuk testimoni.",
        adminEmail: ADMIN_EMAILS[0],
      }),
    ]);
    expect(body.actionId).toBeTruthy();
  });

  it("needs a reason", async () => {
    const { provider } = await unclaimedPlace();
    expect((await open(await adminCookie(), provider.placeId, {}, null)).status).toBe(400);
    expect((await server.firestore.collection(COLLECTIONS.policyViolations).get()).size).toBe(0);
    expect(await adminActions()).toEqual([]);
  });

  it("refuses a second case while one is open or notified, but allows one after a decision", async () => {
    const { provider } = await unclaimedPlace();
    const admin = await adminCookie();
    const first = await opened(admin, provider.placeId);

    expect((await open(admin, provider.placeId)).status).toBe(409);
    expect((await act(admin, { action: "notifyViolation", subjectId: first, reason: "Telepon" })).status).toBe(200);
    expect((await open(admin, provider.placeId)).status).toBe(409);
    expect((await act(admin, { action: "dismissViolation", subjectId: first, reason: "Tidak terbukti" })).status).toBe(
      200,
    );
    expect((await open(admin, provider.placeId)).status).toBe(200);
  });

  it("refuses evidence that belongs to another place", async () => {
    const { provider } = await unclaimedPlace();
    const other = await unclaimedPlace();
    const admin = await adminCookie();

    expect((await open(admin, provider.placeId, { reportIds: [other.reportId] })).status).toBe(400);
    expect((await open(admin, provider.placeId, { detectionHoldIds: [other.testimony.id] })).status).toBe(400);
    expect((await open(admin, provider.placeId, { reportIds: ["no-such-report"] })).status).toBe(400);
    expect((await server.firestore.collection(COLLECTIONS.policyViolations).get()).size).toBe(0);
  });

  it("refuses a place nobody has a Provider or Testimony for, and badly formed input", async () => {
    const { provider } = await unclaimedPlace();
    const admin = await adminCookie();

    expect((await open(admin, "place-unknown")).status).toBe(404);
    expect(
      (await open(admin, provider.placeId, { suspectedFrom: "2026-11-01", suspectedTo: "2026-10-01" })).status,
    ).toBe(400);
    expect((await open(admin, provider.placeId, { suspectedFrom: "2026-02-30" })).status).toBe(400);
    expect((await open(admin, provider.placeId, { suspectedTo: "31-10-2026" })).status).toBe(400);
    expect((await open(admin, provider.placeId, { notes: "x".repeat(1001) })).status).toBe(400);
    expect((await open(admin, provider.placeId, { reportIds: ["bad/id"] })).status).toBe(400);
    expect(
      (await open(admin, provider.placeId, { reportIds: Array.from({ length: 51 }, (_, i) => `r${i}`) })).status,
    ).toBe(400);
    const missing = await act(admin, { action: "openViolation", subjectId: provider.placeId, reason: "Alasan" });
    expect(missing.status).toBe(400);
    expect((await server.firestore.collection(COLLECTIONS.policyViolations).get()).size).toBe(0);
  });

  it("opens a case on a place with Testimonies but no Provider document", async () => {
    const provider = await seedProvider(server.firestore);
    await seedTestimony(server.firestore, provider);
    await server.firestore.collection(COLLECTIONS.providers).doc(provider.placeId).delete();
    expect((await open(await adminCookie(), provider.placeId)).status).toBe(200);
  });
});

describe("violation case: notify, confirm, dismiss", () => {
  it("notifies an unclaimed Provider by phone with the call note, and gives it seven days", async () => {
    const { provider } = await unclaimedPlace();
    const admin = await adminCookie();
    const id = await opened(admin, provider.placeId);

    const before = Date.now();
    const response = await act(admin, {
      action: "notifyViolation",
      subjectId: id,
      reason: "Menelepon resepsionis 10:15.",
    });
    expect(response.status).toBe(200);

    const doc = await violation(id);
    expect(doc).toMatchObject({
      status: "providerNotified",
      notifiedVia: "phone",
      phoneContactNote: "Menelepon resepsionis 10:15.",
    });
    const notifiedAt = doc.notifiedAt?.toMillis() as number;
    expect(notifiedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(doc.responseDueAt?.toMillis()).toBe(notifiedAt + 7 * DAY_MS);
    expect((await adminActions()).at(-1)).toMatchObject({
      action: "notifyViolation",
      fromStatus: "open",
      toStatus: "providerNotified",
      reason: "Menelepon resepsionis 10:15.",
    });
  });

  it("notifies a claimed Provider in its owner pages, with no phone note", async () => {
    const provider = await claimedPlace();
    await seedTestimony(server.firestore, provider);
    const admin = await adminCookie();
    const id = await opened(admin, provider.placeId);

    expect(
      (await act(admin, { action: "notifyViolation", subjectId: id, reason: "Pemberitahuan dikirim." })).status,
    ).toBe(200);
    const doc = await violation(id);
    expect(doc.notifiedVia).toBe("ownerPages");
    expect(doc.phoneContactNote).toBeUndefined();
  });

  it("notifies by phone when the Provider says claimed but its Claim is no longer approved", async () => {
    const provider = await claimedPlace("rejected");
    await seedTestimony(server.firestore, provider);
    const admin = await adminCookie();
    const id = await opened(admin, provider.placeId);

    expect(
      (await act(admin, { action: "notifyViolation", subjectId: id, reason: "Menelepon resepsionis." })).status,
    ).toBe(200);
    expect(await violation(id)).toMatchObject({ notifiedVia: "phone", phoneContactNote: "Menelepon resepsionis." });
  });

  it("refuses to notify twice, or after a decision", async () => {
    const { provider } = await unclaimedPlace();
    const admin = await adminCookie();
    const id = await opened(admin, provider.placeId);
    const notify: AdminActionRequest = { action: "notifyViolation", subjectId: id, reason: "Telepon" };

    expect((await act(admin, notify)).status).toBe(200);
    expect((await act(admin, notify)).status).toBe(409);
    expect((await act(admin, { action: "dismissViolation", subjectId: id, reason: "Selesai" })).status).toBe(200);
    expect((await act(admin, notify)).status).toBe(409);
    expect(await adminActions()).toHaveLength(3);
  });

  it("refuses to confirm inside the window and leaves the case as it was", async () => {
    const { provider } = await unclaimedPlace();
    const admin = await adminCookie();
    const id = await opened(admin, provider.placeId);
    await act(admin, { action: "notifyViolation", subjectId: id, reason: "Telepon" });
    const before = await violation(id);

    const response = await act(admin, { action: "confirmViolation", subjectId: id, reason: "Terbukti" });
    expect(response.status).toBe(409);
    expect(await violation(id)).toEqual(before);
    expect(await adminActions()).toHaveLength(2);
  });

  it("confirms after the window, recording who, when and why", async () => {
    const { provider } = await unclaimedPlace();
    const admin = await adminCookie();
    const id = await opened(admin, provider.placeId);
    await act(admin, { action: "notifyViolation", subjectId: id, reason: "Telepon" });
    await server.firestore
      .collection(COLLECTIONS.policyViolations)
      .doc(id)
      .update({ responseDueAt: Timestamp.fromMillis(Date.now() - 1000) });

    const response = await act(admin, {
      action: "confirmViolation",
      subjectId: id,
      reason: "Tidak ada tanggapan; bukti kuat.",
    });
    expect(response.status).toBe(200);

    expect(await violation(id)).toMatchObject({
      status: "confirmed",
      decisionReason: "Tidak ada tanggapan; bukti kuat.",
      decidedBy: expect.any(String),
      decidedAt: expect.anything(),
    });
    expect((await adminActions()).at(-1)).toMatchObject({
      action: "confirmViolation",
      subjectType: "policyViolation",
      subjectId: id,
      fromStatus: "providerNotified",
      toStatus: "confirmed",
      reason: "Tidak ada tanggapan; bukti kuat.",
    });
    // Nothing is decided twice.
    expect((await act(admin, { action: "confirmViolation", subjectId: id, reason: "Lagi" })).status).toBe(409);
    expect((await act(admin, { action: "dismissViolation", subjectId: id, reason: "Lagi" })).status).toBe(409);
  });

  it("refuses to confirm a case that was never notified", async () => {
    const { provider } = await unclaimedPlace();
    const admin = await adminCookie();
    const id = await opened(admin, provider.placeId);

    expect((await act(admin, { action: "confirmViolation", subjectId: id, reason: "Terbukti" })).status).toBe(409);
    expect((await violation(id)).status).toBe("open");
  });

  it("dismisses from open, and from providerNotified inside the window", async () => {
    const first = await unclaimedPlace();
    const second = await unclaimedPlace();
    const admin = await adminCookie();

    const fromOpen = await opened(admin, first.provider.placeId);
    expect((await act(admin, { action: "dismissViolation", subjectId: fromOpen, reason: "Salah paham." })).status).toBe(
      200,
    );
    expect(await violation(fromOpen)).toMatchObject({
      status: "dismissed",
      decisionReason: "Salah paham.",
      decidedBy: expect.any(String),
    });

    const fromNotified = await opened(admin, second.provider.placeId);
    await act(admin, { action: "notifyViolation", subjectId: fromNotified, reason: "Telepon" });
    expect(
      (await act(admin, { action: "dismissViolation", subjectId: fromNotified, reason: "Penjelasan diterima." }))
        .status,
    ).toBe(200);
    const log = await adminActions();
    expect(log.filter((entry) => entry.action === "dismissViolation")).toEqual([
      expect.objectContaining({ fromStatus: "open", toStatus: "dismissed", reason: "Salah paham." }),
      expect.objectContaining({
        fromStatus: "providerNotified",
        toStatus: "dismissed",
        reason: "Penjelasan diterima.",
      }),
    ]);
  });

  it("needs a reason for every move, and 404s an unknown case", async () => {
    const { provider } = await unclaimedPlace();
    const admin = await adminCookie();
    const id = await opened(admin, provider.placeId);

    for (const action of ["notifyViolation", "confirmViolation", "dismissViolation"] as const) {
      expect((await act(admin, { action, subjectId: id })).status).toBe(400);
    }
    expect((await violation(id)).status).toBe("open");
    expect((await act(admin, { action: "dismissViolation", subjectId: "no-such-case", reason: "Alasan" })).status).toBe(
      404,
    );
  });
});

describe("violation case: who may use it", () => {
  it("refuses a signed-out visitor and a signed-in non-admin, and changes nothing", async () => {
    const { provider } = await unclaimedPlace();
    const patient = await server.signInWithGoogle("pasien@example.com");
    const body: AdminActionRequest = {
      action: "openViolation",
      subjectId: provider.placeId,
      reason: "Alasan",
      violation: PERIOD,
    };

    expect((await server.post("/admin/api/actions", body)).status).toBe(401);
    expect((await act(patient, body)).status).toBe(403);
    expect((await server.firestore.collection(COLLECTIONS.policyViolations).get()).size).toBe(0);
    expect(await adminActions()).toEqual([]);

    const id = await opened(await adminCookie(), provider.placeId);
    const notify: AdminActionRequest = { action: "notifyViolation", subjectId: id, reason: "Telepon" };
    expect((await server.post("/admin/api/actions", notify)).status).toBe(401);
    expect((await act(patient, notify)).status).toBe(403);
    expect((await violation(id)).status).toBe("open");
  });
});

describe("admin queue: violation cases", () => {
  it("lists an open case with a 24-hour target, with the live Google phone for an unclaimed place", async () => {
    const { provider, reportId } = await unclaimedPlace();
    server.fakes.places.respondWithGoogleBlock({
      displayName: "Klinik Google",
      types: ["dentist"],
      nationalPhoneNumber: GOOGLE_PHONE,
    });
    const admin = await adminCookie();
    const id = await opened(admin, provider.placeId, { reportIds: [reportId], notes: "Catatan" });

    const item = (await queue(admin)).items.find((i) => i.kind === "policyViolation");
    expect(item).toMatchObject({
      id,
      subjectId: id,
      overdue: false,
      violation: {
        placeId: provider.placeId,
        providerName: provider.name,
        claimed: false,
        status: "open",
        evidence: { reportIds: [reportId], detectionHoldIds: [], notes: "Catatan", privateEvidenceCount: 0 },
        suspectedPeriod: { from: "2026-08-01", to: "2026-10-31" },
        windowOver: false,
        googlePhone: GOOGLE_PHONE,
        googleDisplayName: "Klinik Google",
      },
    });
    const created = Date.parse(item?.createdAt as string);
    expect(Date.parse(item?.dueAt as string)).toBe(created + DAY_MS);
    // The phone is shown, never stored.
    expect(JSON.stringify(await violation(id))).not.toContain(GOOGLE_PHONE);
  });

  it("lists a notified case due at the end of the response window, and marks the window over", async () => {
    const { provider } = await unclaimedPlace();
    const admin = await adminCookie();
    const id = await opened(admin, provider.placeId);
    await act(admin, { action: "notifyViolation", subjectId: id, reason: "Menelepon resepsionis." });
    const doc = await violation(id);

    let item = (await queue(admin)).items.find((i) => i.kind === "policyViolation");
    expect(item?.dueAt).toBe((doc.responseDueAt as Timestamp).toDate().toISOString());
    expect(item?.violation).toMatchObject({
      status: "providerNotified",
      notifiedVia: "phone",
      phoneContactNote: "Menelepon resepsionis.",
      responseDueAt: item?.dueAt,
      windowOver: false,
    });

    await server.firestore
      .collection(COLLECTIONS.policyViolations)
      .doc(id)
      .update({ responseDueAt: Timestamp.fromMillis(Date.now() - 1000) });
    item = (await queue(admin)).items.find((i) => i.kind === "policyViolation");
    expect(item?.violation?.windowOver).toBe(true);
    expect(item?.overdue).toBe(true);
  });

  it("shows a claimed place without a Google phone, and drops decided cases", async () => {
    const provider = await claimedPlace();
    await seedTestimony(server.firestore, provider);
    const admin = await adminCookie();
    const id = await opened(admin, provider.placeId);

    const item = (await queue(admin)).items.find((i) => i.kind === "policyViolation");
    expect(item?.violation).toMatchObject({ claimed: true });
    expect(item?.violation?.googlePhone).toBeUndefined();
    expect(server.fakes.places.detailsCalls).toEqual([]);

    await act(admin, { action: "dismissViolation", subjectId: id, reason: "Selesai" });
    expect((await queue(admin)).items.filter((i) => i.kind === "policyViolation")).toEqual([]);
  });
});
