// Testimony reports and the admin queue (spec 03, T14) through the web API:
// hide-on-report, admin-only actions, the adminActions log, the 10% spot-check
// sample, and aggregates and counters on removal.
import {
  type AdminActionDoc,
  COLLECTIONS,
  IMPACT_COUNTERS,
  type ProviderDoc,
  type TestimonyDoc,
  type TestimonyReportDoc,
} from "@findyourdent/contracts/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminActionRequest, AdminQueueResponse } from "../../app/lib/admin-queue.ts";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type { TestimonySubmission, TestimonySubmitResponse } from "../../app/lib/testimony.ts";
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

/** Posts a Testimony as a new Patient; returns its id. */
async function postTestimony(email: string, overrides: Partial<TestimonySubmission> = {}): Promise<string> {
  const cookie = await server.signInWithGoogle(email);
  const form = new FormData();
  form.set("testimony", JSON.stringify(submission(overrides)));
  const response = await fetch(new URL("/api/testimonies", server.baseUrl), {
    method: "POST",
    headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
    body: form,
  });
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as TestimonySubmitResponse).testimonyId;
}

const report = (testimonyId: string, body: unknown, init: { cookie?: string; appCheck?: boolean } = {}) =>
  server.post(`/api/testimonies/${testimonyId}/reports`, body, {
    ...(init.appCheck === false ? { appCheckToken: null } : {}),
    headers: init.cookie ? { cookie: init.cookie } : {},
  });

async function testimony(id: string): Promise<TestimonyDoc> {
  return (await server.firestore.collection(COLLECTIONS.testimonies).doc(id).get()).data() as TestimonyDoc;
}

async function provider(placeId = PLACE): Promise<ProviderDoc | undefined> {
  return (await server.firestore.collection(COLLECTIONS.providers).doc(placeId).get()).data() as
    | ProviderDoc
    | undefined;
}

async function reports(): Promise<TestimonyReportDoc[]> {
  const snapshot = await server.firestore.collection(COLLECTIONS.testimonyReports).get();
  return snapshot.docs.map((doc) => doc.data() as TestimonyReportDoc);
}

async function counter(key: keyof typeof IMPACT_COUNTERS): Promise<number> {
  const snapshot = await server.firestore.collection(COLLECTIONS.counters).doc(IMPACT_COUNTERS[key]).get();
  return (snapshot.get("value") as number | undefined) ?? 0;
}

describe("POST /api/testimonies/:id/reports", () => {
  it.each(["personalData", "threat"] as const)("hides the Testimony at once on a %s report", async (category) => {
    const id = await postTestimony("pasien@example.com");
    expect(await counter("testimoniesPublished")).toBe(1);

    const response = await report(id, { category, details: "Ada nomor HP dokter." });
    expect(response.status).toBe(201);

    expect((await testimony(id)).status).toBe("hidden");
    expect(await reports()).toEqual([
      expect.objectContaining({
        testimonyId: id,
        placeId: PLACE,
        category,
        details: "Ada nomor HP dokter.",
        reporterRole: "public",
        hidTestimony: true,
        status: "open",
      }),
    ]);
    // Hidden is not public: aggregates and counter drop with it.
    expect((await provider())?.aggregates.testimonyCount).toBe(0);
    expect(await counter("testimoniesPublished")).toBe(0);
  });
});

describe("POST /api/testimonies/:id/reports: other cases", () => {
  it("keeps the Testimony public on a spam report but queues the report", async () => {
    const id = await postTestimony("pasien@example.com");
    const response = await report(id, { category: "spam" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ hidden: false });
    expect((await testimony(id)).status).toBe("published");
    expect(await reports()).toEqual([
      expect.objectContaining({ category: "spam", hidTestimony: false, status: "open" }),
    ]);
  });

  it("records the reporter when signed in", async () => {
    const id = await postTestimony("pasien@example.com");
    const cookie = await server.signInWithGoogle("pembaca@example.com");
    await report(id, { category: "falseClaim" }, { cookie });
    expect((await reports())[0]?.reporterUid).toEqual(expect.any(String));
  });

  it("refuses an unknown category, a held Testimony and a request without App Check", async () => {
    const id = await postTestimony("pasien@example.com");
    expect((await report(id, { category: "boring" })).status).toBe(400);
    expect((await report(id, { category: "spam" }, { appCheck: false })).status).toBe(401);

    server.setTestimonyModeration("hold");
    const held = await postTestimony("lain@example.com", { placeId: "ChIJ-lain" });
    expect((await report(held, { category: "spam" })).status).toBe(404);
    expect((await report("does-not-exist", { category: "spam" })).status).toBe(404);
    expect(await reports()).toEqual([]);
  });
});

// Admin queue -----------------------------------------------------------------------

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

describe("admin API: who may use it", () => {
  it("refuses a signed-out visitor and a Patient, and changes nothing", async () => {
    const id = await postTestimony("pasien@example.com");
    const patient = await server.signInWithGoogle("pasien@example.com");

    expect((await server.get("/admin/api/queue")).status).toBe(401);
    expect((await server.get("/admin/api/queue", { headers: { cookie: patient } })).status).toBe(403);
    const removeBody: AdminActionRequest = { action: "remove", subjectId: id, reason: "Saya penulisnya." };
    expect((await server.post("/admin/api/actions", removeBody)).status).toBe(401);
    expect((await act(patient, removeBody)).status).toBe(403);

    expect((await testimony(id)).status).toBe("published");
    expect(await adminActions()).toEqual([]);
  });
});

describe("admin queue", () => {
  it("shows a held Testimony with its rule codes, history and the 24-hour target", async () => {
    server.setTestimonyModeration("hold");
    const id = await postTestimony("pasien@example.com");
    const { items } = await queue(await adminCookie());

    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item).toMatchObject({ kind: "held", subjectId: id, overdue: false });
    expect(Date.parse(item?.dueAt ?? "") - Date.parse(item?.createdAt ?? "")).toBe(24 * 60 * 60 * 1000);
    expect(item?.testimony).toMatchObject({
      id,
      providerName: "Klinik Gigi Ceria",
      text: submission().text,
      moderation: { decision: "hold", ruleCodes: ["low_confidence"], flaggedSpans: [] },
    });
    expect(item?.testimony?.history.map((entry) => entry.kind)).toEqual(["moderation"]);
  });

  it("groups open reports by Testimony, hidden ones first", async () => {
    const id = await postTestimony("pasien@example.com");
    const other = await postTestimony("lain@example.com", { placeId: "ChIJ-lain" });
    await report(other, { category: "spam" });
    await report(id, { category: "threat" });
    await report(id, { category: "falseClaim", details: "Saya tidak percaya." });

    const { items } = await queue(await adminCookie());
    expect(items.map((item) => [item.kind, item.subjectId])).toEqual([
      ["report", id],
      ["report", other],
    ]);
    expect(items[0]?.testimony?.status).toBe("hidden");
    expect(items[0]?.reports?.map((r) => r.category).sort()).toEqual(["falseClaim", "threat"]);
  });

  it("puts a 10% sample of auto-published Testimonies in the queue", async () => {
    server.setSpotCheckRate(1);
    const sampled = await postTestimony("pasien@example.com");
    server.setSpotCheckRate(0);
    await postTestimony("lain@example.com", { placeId: "ChIJ-lain" });

    const cookie = await adminCookie();
    const { items } = await queue(cookie);
    expect(items.map((item) => [item.kind, item.subjectId])).toEqual([["spotCheck", sampled]]);

    const confirm = await act(cookie, { action: "spotCheckConfirm", subjectId: items[0]?.id ?? "" });
    expect(confirm.status).toBe(200);
    expect((await queue(cookie)).items).toEqual([]);
    expect((await testimony(sampled)).status).toBe("published");
    expect(await adminActions()).toEqual([
      expect.objectContaining({ action: "spotCheckConfirm", subjectType: "moderationDecision" }),
    ]);
  });
});

describe("admin queue: nothing gets stuck", () => {
  it("keeps a Testimony hidden from a spot check in the queue until published or removed", async () => {
    server.setSpotCheckRate(1);
    const id = await postTestimony("pasien@example.com");
    const cookie = await adminCookie();
    expect((await act(cookie, { action: "hide", subjectId: id, reason: "Perlu dicek lagi." })).status).toBe(200);

    const { items } = await queue(cookie);
    expect(items.map((item) => [item.kind, item.subjectId])).toEqual([["hidden", id]]);
    expect((await act(cookie, { action: "remove", subjectId: id, reason: "Fitnah." })).status).toBe(200);
    expect((await queue(cookie)).items).toEqual([]);
  });

  it("samples only Testimonies that Moderation actually published", async () => {
    server.setTestimonyModeration("hold");
    const id = await postTestimony("pasien@example.com");
    const cookie = await adminCookie();
    await act(cookie, { action: "reject", subjectId: id, reason: "Tuduhan tanpa bukti." });

    // Moderation now says publish, but an edit of a rejected Testimony stays with the admin.
    server.setTestimonyModeration("publish");
    server.setSpotCheckRate(1);
    const author = await server.signInWithGoogle("pasien@example.com");
    const form = new FormData();
    form.set("testimony", JSON.stringify(submission({ text: "Sudah saya perbaiki." })));
    await fetch(new URL(`/api/testimonies/${id}`, server.baseUrl), {
      method: "POST",
      headers: { cookie: author, [APP_CHECK_HEADER]: server.appCheckToken() },
      body: form,
    });
    expect((await testimony(id)).status).toBe("held");

    await act(cookie, { action: "publish", subjectId: id });
    expect((await queue(cookie)).items).toEqual([]);
  });
});

describe("admin actions on a held Testimony", () => {
  it("publishes it, makes the place Listed, counts it and logs who, when and why", async () => {
    server.setTestimonyModeration("hold");
    const id = await postTestimony("pasien@example.com");
    const cookie = await adminCookie();

    const response = await act(cookie, { action: "publish", subjectId: id });
    expect(response.status).toBe(200);

    expect((await testimony(id)).status).toBe("published");
    expect((await provider())?.name).toBe("Klinik Gigi Ceria");
    expect((await provider())?.aggregates.testimonyCount).toBe(1);
    expect(await counter("testimoniesPublished")).toBe(1);
    const [logged] = await adminActions();
    expect(logged).toMatchObject({
      action: "publish",
      subjectType: "testimony",
      subjectId: id,
      placeId: PLACE,
      adminEmail: ADMIN_EMAILS[0],
      adminUid: expect.any(String),
      fromStatus: "held",
      toStatus: "published",
    });
    expect(logged?.createdAt).toBeDefined();
    expect((await queue(cookie)).items).toEqual([]);
  });

  it("rejects only with a reason, which the author sees", async () => {
    server.setTestimonyModeration("hold");
    const id = await postTestimony("pasien@example.com");
    const cookie = await adminCookie();

    expect((await act(cookie, { action: "reject", subjectId: id })).status).toBe(400);
    expect((await testimony(id)).status).toBe("held");

    expect((await act(cookie, { action: "reject", subjectId: id, reason: "Tuduhan tanpa bukti." })).status).toBe(200);
    expect(await testimony(id)).toMatchObject({ status: "rejected", adminReason: "Tuduhan tanpa bukti." });
    expect(await adminActions()).toEqual([
      expect.objectContaining({ action: "reject", reason: "Tuduhan tanpa bukti.", toStatus: "rejected" }),
    ]);
  });

  it("sends it back to the author with a reason", async () => {
    server.setTestimonyModeration("hold");
    const id = await postTestimony("pasien@example.com");
    const response = await act(await adminCookie(), {
      action: "sendBackToAuthor",
      subjectId: id,
      reason: "Hapus nama perawat.",
    });
    expect(response.status).toBe(200);
    expect(await testimony(id)).toMatchObject({ status: "needsAuthorFix", adminReason: "Hapus nama perawat." });
  });

  it("refuses a move the state machine does not allow", async () => {
    server.setTestimonyModeration("hold");
    const id = await postTestimony("pasien@example.com");
    const response = await act(await adminCookie(), { action: "hide", subjectId: id, reason: "Coba." });
    expect(response.status).toBe(409);
    expect(await adminActions()).toEqual([]);
  });
});

describe("admin actions on a published or reported Testimony", () => {
  it("removes it, recomputes aggregates and the counter, and resolves its reports", async () => {
    const id = await postTestimony("pasien@example.com");
    await postTestimony("lain@example.com");
    await report(id, { category: "falseClaim" });
    expect((await provider())?.aggregates.testimonyCount).toBe(2);

    const response = await act(await adminCookie(), { action: "remove", subjectId: id, reason: "Bukan kunjungan." });
    expect(response.status).toBe(200);

    expect(await testimony(id)).toMatchObject({ status: "removed", adminReason: "Bukan kunjungan." });
    expect((await provider())?.aggregates.testimonyCount).toBe(1);
    expect(await counter("testimoniesPublished")).toBe(1);
    expect(await reports()).toEqual([expect.objectContaining({ status: "resolved", resolution: "removed" })]);
  });

  it("removes a hidden Testimony without counting it twice", async () => {
    const id = await postTestimony("pasien@example.com");
    await report(id, { category: "personalData" });
    await act(await adminCookie(), { action: "remove", subjectId: id, reason: "Ada nomor HP." });
    expect((await testimony(id)).status).toBe("removed");
    expect(await counter("testimoniesPublished")).toBe(0);
    expect((await provider())?.aggregates.testimonyCount).toBe(0);
  });

  it("puts a hidden Testimony back and keeps its reports as resolved", async () => {
    const id = await postTestimony("pasien@example.com");
    await report(id, { category: "threat" });
    const response = await act(await adminCookie(), { action: "publish", subjectId: id });
    expect(response.status).toBe(200);
    expect((await testimony(id)).status).toBe("published");
    expect(await counter("testimoniesPublished")).toBe(1);
    expect((await provider())?.aggregates.testimonyCount).toBe(1);
    expect(await reports()).toEqual([expect.objectContaining({ status: "resolved", resolution: "kept" })]);
  });

  it("hides a published Testimony and dismisses a report", async () => {
    const id = await postTestimony("pasien@example.com");
    await report(id, { category: "spam" });
    const cookie = await adminCookie();
    const [reportItem] = (await queue(cookie)).items;
    const reportId = reportItem?.reports?.[0]?.id ?? "";

    expect((await act(cookie, { action: "dismissReport", subjectId: reportId })).status).toBe(200);
    expect(await reports()).toEqual([expect.objectContaining({ status: "resolved", resolution: "dismissed" })]);

    expect((await act(cookie, { action: "hide", subjectId: id, reason: "Perlu dicek." })).status).toBe(200);
    expect((await testimony(id)).status).toBe("hidden");
    expect((await adminActions()).map((a) => a.action).sort()).toEqual(["dismissReport", "hide"]);
  });
});

describe("admin actions on a held edit of a published Testimony", () => {
  it("publishes the edit over the public version", async () => {
    const id = await postTestimony("pasien@example.com");
    server.setTestimonyModeration("hold");
    const cookie = await server.signInWithGoogle("pasien@example.com");
    const form = new FormData();
    form.set("testimony", JSON.stringify(submission({ text: "Versi baru." })));
    await fetch(new URL(`/api/testimonies/${id}`, server.baseUrl), {
      method: "POST",
      headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
      body: form,
    });

    const admin = await adminCookie();
    const [item] = (await queue(admin)).items;
    expect(item).toMatchObject({ kind: "revision", subjectId: id });
    expect(item?.testimony?.revision?.text).toBe("Versi baru.");

    expect((await act(admin, { action: "publish", subjectId: id })).status).toBe(200);
    const stored = await testimony(id);
    expect(stored.status).toBe("published");
    expect(stored.text).toBe("Versi baru.");
    expect(stored.pendingRevision).toBeUndefined();
  });
});

describe("name corrections", () => {
  it("applies a suggested name to the Listed Provider", async () => {
    await postTestimony("pasien@example.com");
    const cookie = await server.signInWithGoogle("lain@example.com");
    const suggested = await server.post(
      `/api/providers/${PLACE}/name-corrections`,
      { suggestedName: "Klinik Gigi Ceria Sentosa" },
      { headers: { cookie } },
    );
    expect(suggested.status).toBe(201);

    const admin = await adminCookie();
    const [item] = (await queue(admin)).items;
    expect(item).toMatchObject({ kind: "nameCorrection", correction: { suggestedName: "Klinik Gigi Ceria Sentosa" } });

    expect((await act(admin, { action: "applyNameCorrection", subjectId: item?.subjectId ?? "" })).status).toBe(200);
    expect(await provider()).toMatchObject({ name: "Klinik Gigi Ceria Sentosa" });
    expect((await queue(admin)).items).toEqual([]);
    expect(await adminActions()).toEqual([
      expect.objectContaining({ action: "applyNameCorrection", subjectType: "nameCorrection" }),
    ]);
  });
});

describe("admin page", () => {
  it("renders the queue with Gemini's rule codes, the target and the actions", async () => {
    server.setTestimonyModeration("hold");
    await postTestimony("pasien@example.com");
    const response = await server.get("/admin", { headers: { cookie: await adminCookie() } });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Testimoni ditahan");
    expect(html).toContain("Klinik Gigi Ceria");
    expect(html).toContain("low_confidence");
    expect(html).toContain("Target ");
    expect(html).toContain("Tayangkan");
    expect(html).toContain("Kembalikan ke penulis");
  });
});

describe("Provider page", () => {
  it("offers a Report button on each Testimony", async () => {
    await postTestimony("pasien@example.com");
    const html = await (await server.get(`/tempat/${PLACE}`)).text();
    expect(html).toContain("Laporkan");
  });
});
