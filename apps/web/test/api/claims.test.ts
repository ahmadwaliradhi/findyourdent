// Claims, owner facts and replies (spec 05, T17) through the web API: the Claim
// state machine, the permit document deleted on every decision, the admin queue with
// the live Google phone (never stored), owner facts and replies screened by
// Moderation, and no route that lets a claimed Provider delete or hide a Testimony.
import type { ModerationDecision } from "@findyourdent/contracts";
import {
  type AdminActionDoc,
  type ClaimDoc,
  COLLECTIONS,
  type ModerationDecisionDoc,
  type ProviderDoc,
  type TestimonyDoc,
  type TestimonyReportDoc,
} from "@findyourdent/contracts/firestore";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminActionRequest, AdminQueueResponse } from "../../app/lib/admin-queue.ts";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type { ClaimSubmission, OwnerFactsSubmission } from "../../app/lib/claims.ts";
import { AgentUnavailableError } from "../../server/adapters/agent.ts";
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

const OWNER = "drg.sari@example.com";
const GOOGLE_PHONE = "(031) 5012345";

let permitBytes: Buffer;
beforeAll(async () => {
  permitBytes = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#f5f5f5" } })
    .png()
    .toBuffer();
});

interface ClaimInit {
  cookie?: string;
  claim?: Partial<ClaimSubmission>;
  permit?: { bytes: Uint8Array; type: string; name?: string } | null;
}

function postClaim(placeId: string, init: ClaimInit = {}) {
  const form = new FormData();
  form.set("claim", JSON.stringify({ role: "owner", contactPhone: "0812-1111-2222", ...init.claim }));
  const permit: ClaimInit["permit"] =
    init.permit === undefined ? { bytes: permitBytes, type: "image/png" } : init.permit;
  if (permit)
    form.set("permit", new File([new Uint8Array(permit.bytes)], permit.name ?? "sip.png", { type: permit.type }));
  return fetch(new URL(`/api/providers/${placeId}/claims`, server.baseUrl), {
    method: "POST",
    headers: { ...(init.cookie ? { cookie: init.cookie } : {}), [APP_CHECK_HEADER]: server.appCheckToken() },
    body: form,
  });
}

async function submitClaim(placeId: string, init: ClaimInit = {}): Promise<{ claimId: string; cookie: string }> {
  const cookie = init.cookie ?? (await server.signInWithGoogle(OWNER));
  const response = await postClaim(placeId, { ...init, cookie });
  if (response.status !== 201) throw new Error(`claim failed: ${response.status} ${await response.text()}`);
  return { claimId: ((await response.json()) as { claimId: string }).claimId, cookie };
}

const adminCookie = () => server.signInWithGoogle(ADMIN_EMAILS[0] as string);

const act = (cookie: string, body: AdminActionRequest) =>
  server.post("/admin/api/actions", body, { headers: { cookie } });

async function queue(cookie: string): Promise<AdminQueueResponse> {
  const response = await server.get("/admin/api/queue", { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as AdminQueueResponse;
}

async function claim(id: string): Promise<ClaimDoc> {
  return (await server.firestore.collection(COLLECTIONS.claims).doc(id).get()).data() as ClaimDoc;
}

async function provider(placeId: string): Promise<ProviderDoc | undefined> {
  return (await server.firestore.collection(COLLECTIONS.providers).doc(placeId).get()).data() as
    | ProviderDoc
    | undefined;
}

async function testimony(id: string): Promise<TestimonyDoc> {
  return (await server.firestore.collection(COLLECTIONS.testimonies).doc(id).get()).data() as TestimonyDoc;
}

async function fileExists(path: string): Promise<boolean> {
  const [exists] = await server.uploads.file(path).exists();
  return exists;
}

/** A Listed Provider with an approved Claim by OWNER; returns the owner's cookie. */
async function claimedProvider(overrides: Parameters<typeof seedProvider>[1] = {}) {
  const listed = await seedProvider(server.firestore, overrides);
  const { claimId, cookie } = await submitClaim(listed.placeId);
  const admin = await adminCookie();
  expect((await act(admin, { action: "approveClaim", subjectId: claimId })).status).toBe(200);
  return { listed, claimId, cookie, admin };
}

const FACTS: OwnerFactsSubmission = {
  name: "Klinik Gigi Sari Dental",
  providerType: "klinik",
  region: { provinceCode: "35", regencyCode: "35.78" },
  address: "Jl. Raya Darmo 12, Surabaya",
  phone: "(031) 5012345",
  whatsapp: "0812-1111-2222",
  openingHours: "Senin-Jumat 09.00-20.00",
  services: ["scaling", "tooth_filling"],
};

const HOLD: ModerationDecision = {
  decision: "hold",
  ruleCodes: ["promotional_wording"],
  flaggedSpans: [{ start: 0, end: 7, text: "Terbaik", ruleCode: "promotional_wording" }],
  confidence: 0.9,
  authorMessage: "Ditahan untuk ditinjau.",
};

describe("POST /api/providers/:placeId/claims", () => {
  it("asks a signed-out claimant to sign in", async () => {
    const listed = await seedProvider(server.firestore);
    const response = await postClaim(listed.placeId);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "sign_in_required" });
  });

  it("stores a submitted Claim with the permit in the private bucket", async () => {
    const listed = await seedProvider(server.firestore);
    const cookie = await server.signInWithGoogle(OWNER);
    const response = await postClaim(listed.placeId, { cookie, claim: { role: "manager" } });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { claimId: string; status: string; message: string };
    expect(body).toMatchObject({ status: "submitted" });
    expect(body.message).toMatch(/hari kerja/);
    const stored = await claim(body.claimId);
    expect(stored).toMatchObject({
      placeId: listed.placeId,
      role: "manager",
      contactPhone: "0812-1111-2222",
      status: "submitted",
    });
    expect(stored.permitDocumentPath).toMatch(new RegExp(`^claims/${body.claimId}/`));
    expect(await fileExists(stored.permitDocumentPath as string)).toBe(true);
  });

  it("refuses a file that is not an image or PDF", async () => {
    const listed = await seedProvider(server.firestore);
    const cookie = await server.signInWithGoogle(OWNER);
    const response = await postClaim(listed.placeId, {
      cookie,
      permit: { bytes: new TextEncoder().encode("not a permit"), type: "image/png" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_file" });
    expect((await server.firestore.collection(COLLECTIONS.claims).get()).size).toBe(0);
  });

  it("refuses a Claim without a permit or with an unknown role", async () => {
    const listed = await seedProvider(server.firestore);
    const cookie = await server.signInWithGoogle(OWNER);
    expect((await postClaim(listed.placeId, { cookie, permit: null })).status).toBe(400);
    expect((await postClaim(listed.placeId, { cookie, claim: { role: "patient" as never } })).status).toBe(400);
    expect((await postClaim(listed.placeId, { cookie, claim: { contactPhone: "-- () --" } })).status).toBe(400);
  });

  it("allows one active Claim per place, and a new one after a rejection", async () => {
    const listed = await seedProvider(server.firestore);
    const { claimId } = await submitClaim(listed.placeId);
    const other = await server.signInWithGoogle("manajer@example.com");

    const second = await postClaim(listed.placeId, { cookie: other });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "claim_exists" });

    const admin = await adminCookie();
    expect((await act(admin, { action: "rejectClaim", subjectId: claimId, reason: "SIP tidak terbaca" })).status).toBe(
      200,
    );
    expect((await postClaim(listed.placeId, { cookie: other })).status).toBe(201);
  });

  it("needs the name and Region for a place that is not Listed", async () => {
    const cookie = await server.signInWithGoogle(OWNER);
    const missing = await postClaim("ChIJ-belum-listed", { cookie });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: "invalid_claim" });

    const ok = await postClaim("ChIJ-belum-listed", {
      cookie,
      claim: { providerName: "Klinik Gigi Baru", region: { provinceCode: "35", regencyCode: "35.78" } },
    });
    expect(ok.status).toBe(201);
    // Nothing is Listed until the Claim is approved.
    expect(await provider("ChIJ-belum-listed")).toBeUndefined();
  });
});

describe("Claims in the admin queue", () => {
  it("shows the permit and the live Google listing phone, which is never stored", async () => {
    const listed = await seedProvider(server.firestore);
    const { claimId } = await submitClaim(listed.placeId);
    server.fakes.places.respondWithGoogleBlock({
      displayName: "Klinik Google",
      types: ["dentist"],
      nationalPhoneNumber: GOOGLE_PHONE,
    });

    const admin = await adminCookie();
    const { items } = await queue(admin);
    const item = items.find((i) => i.kind === "claim");
    expect(item).toMatchObject({
      id: claimId,
      subjectId: claimId,
      claim: {
        placeId: listed.placeId,
        providerName: listed.name,
        listed: true,
        role: "owner",
        contactPhone: "0812-1111-2222",
        googlePhone: GOOGLE_PHONE,
        permitUrl: `/admin/claims/${claimId}/permit`,
      },
    });

    const permit = await server.get(`/admin/claims/${claimId}/permit`, { headers: { cookie: admin } });
    expect(permit.status).toBe(200);
    expect(permit.headers.get("cache-control")).toBe("private, no-store");
    expect((await permit.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const owner = await server.signInWithGoogle(OWNER);
    expect((await server.get(`/admin/claims/${claimId}/permit`, { headers: { cookie: owner } })).status).toBe(403);

    const everything = await Promise.all(
      Object.values(COLLECTIONS).map(async (name) => (await server.firestore.collection(name).get()).docs),
    );
    expect(JSON.stringify(everything.flat().map((doc) => doc.data()))).not.toContain(GOOGLE_PHONE);
  });

  it("only lets allowlisted admins decide a Claim", async () => {
    const listed = await seedProvider(server.firestore);
    const { claimId, cookie } = await submitClaim(listed.placeId);
    expect((await act(cookie, { action: "approveClaim", subjectId: claimId })).status).toBe(403);
    expect((await claim(claimId)).status).toBe("submitted");
  });
});

describe("Claim decisions", () => {
  it("approves: the page is claimed, the permit deleted, the decision logged", async () => {
    const listed = await seedProvider(server.firestore);
    const { claimId } = await submitClaim(listed.placeId);
    const path = (await claim(claimId)).permitDocumentPath as string;
    const admin = await adminCookie();

    expect((await act(admin, { action: "approveClaim", subjectId: claimId })).status).toBe(200);

    const stored = await claim(claimId);
    expect(stored).toMatchObject({ status: "approved", reviewedBy: ADMIN_EMAILS[0] });
    expect(stored.permitDocumentPath).toBeUndefined();
    expect(stored.reviewedAt).toBeDefined();
    expect(await fileExists(path)).toBe(false);
    expect(await provider(listed.placeId)).toMatchObject({ claimStatus: "claimed", claimId });

    const actions = await server.firestore.collection(COLLECTIONS.adminActions).get();
    expect(actions.docs.map((d) => d.data() as AdminActionDoc)).toEqual([
      expect.objectContaining({
        action: "approveClaim",
        subjectType: "claim",
        subjectId: claimId,
        placeId: listed.placeId,
        adminEmail: ADMIN_EMAILS[0],
        fromStatus: "submitted",
        toStatus: "approved",
      }),
    ]);
    // A decided Claim leaves the queue.
    expect((await queue(admin)).items.filter((i) => i.kind === "claim")).toEqual([]);
  });

  it("rejects with a reason the claimant sees, and deletes the permit", async () => {
    const listed = await seedProvider(server.firestore);
    const { claimId } = await submitClaim(listed.placeId);
    const path = (await claim(claimId)).permitDocumentPath as string;
    const admin = await adminCookie();

    const noReason = await act(admin, { action: "rejectClaim", subjectId: claimId });
    expect(noReason.status).toBe(400);
    expect(await fileExists(path)).toBe(true);

    expect(
      (await act(admin, { action: "rejectClaim", subjectId: claimId, reason: "Nama di SIP berbeda" })).status,
    ).toBe(200);
    const stored = await claim(claimId);
    expect(stored).toMatchObject({ status: "rejected", rejectionReason: "Nama di SIP berbeda" });
    expect(stored.permitDocumentPath).toBeUndefined();
    expect(await fileExists(path)).toBe(false);
    expect(await provider(listed.placeId)).toMatchObject({ claimStatus: "unclaimed" });
  });

  it("revokes an approved Claim, and refuses moves the state machine does not have", async () => {
    const { listed, claimId, admin } = await claimedProvider();

    expect((await act(admin, { action: "rejectClaim", subjectId: claimId, reason: "x" })).status).toBe(409);
    expect((await act(admin, { action: "revokeClaim", subjectId: claimId })).status).toBe(400);
    expect((await act(admin, { action: "revokeClaim", subjectId: claimId, reason: "Bukan pemilik" })).status).toBe(200);

    expect(await claim(claimId)).toMatchObject({ status: "revoked" });
    const after = await provider(listed.placeId);
    expect(after?.claimStatus).toBe("unclaimed");
    expect(after?.claimId).toBeUndefined();
    expect(after?.ownerFacts).toBeUndefined();
    expect((await act(admin, { action: "approveClaim", subjectId: claimId })).status).toBe(409);
  });

  it("makes a place that was not Listed a Listed Provider on approval", async () => {
    const cookie = await server.signInWithGoogle(OWNER);
    const { claimId } = await submitClaim("ChIJ-belum-listed", {
      cookie,
      claim: { providerName: "drg. Sari Wulandari", region: { provinceCode: "35", regencyCode: "35.78" } },
    });
    const admin = await adminCookie();
    expect((await act(admin, { action: "approveClaim", subjectId: claimId })).status).toBe(200);

    expect(await provider("ChIJ-belum-listed")).toMatchObject({
      placeId: "ChIJ-belum-listed",
      name: "drg. Sari Wulandari",
      nameSource: "claim",
      region: { provinceCode: "35", regencyCode: "35.78" },
      providerType: "privateDentist",
      providerTypeSource: "inferred",
      claimStatus: "claimed",
      claimId,
      listedBy: "claim",
      aggregates: { testimonyCount: 0, verifiedVisitCount: 0, averages: null },
    });
    expect(server.fakes.places.coordinatesCalls).toEqual(["ChIJ-belum-listed"]);
  });

  it("lists a claimed place Google types as a hospital as a hospital", async () => {
    server.fakes.places.respondWithCoordinates({
      ok: true,
      location: { lat: -7.2684, lng: 112.7584 },
      types: ["hospital", "health"],
    });
    const cookie = await server.signInWithGoogle(OWNER);
    const { claimId } = await submitClaim("ChIJ-rs-belum-listed", {
      cookie,
      claim: { providerName: "RS Gigi dan Mulut", region: { provinceCode: "35", regencyCode: "35.78" } },
    });
    expect((await act(await adminCookie(), { action: "approveClaim", subjectId: claimId })).status).toBe(200);

    expect(await provider("ChIJ-rs-belum-listed")).toMatchObject({
      providerType: "hospital",
      providerTypeSource: "inferred",
    });
  });

  it("keeps the optional kecamatan of a place that was not Listed, so it appears under that kecamatan", async () => {
    const cookie = await server.signInWithGoogle(OWNER);
    const region = { provinceCode: "35", regencyCode: "35.78", districtCode: "35.78.08" };
    const { claimId } = await submitClaim("ChIJ-di-gubeng", {
      cookie,
      claim: { providerName: "Klinik Gigi Gubeng", region },
    });
    const admin = await adminCookie();
    expect((await act(admin, { action: "approveClaim", subjectId: claimId })).status).toBe(200);

    expect((await provider("ChIJ-di-gubeng"))?.region).toEqual(region);
  });
});

describe("POST /api/providers/:placeId/owner-facts", () => {
  it("refuses anyone but the approved claimant", async () => {
    const { listed } = await claimedProvider();
    const stranger = await server.signInWithGoogle("pesaing@example.com");
    const response = await server.post(`/api/providers/${listed.placeId}/owner-facts`, FACTS, {
      headers: { cookie: stranger },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "not_owner" });
    expect((await provider(listed.placeId))?.ownerFacts).toBeUndefined();
  });

  it("refuses the claimant while the Claim is still submitted", async () => {
    const listed = await seedProvider(server.firestore);
    const { cookie } = await submitClaim(listed.placeId);
    const response = await server.post(`/api/providers/${listed.placeId}/owner-facts`, FACTS, { headers: { cookie } });
    expect(response.status).toBe(403);
  });

  it("publishes clean facts, which replace the typed name and the inferred type", async () => {
    const { listed, cookie } = await claimedProvider({ name: "klinik sari", providerTypeSource: "inferred" });
    const t = await seedTestimony(server.firestore, listed);

    const response = await server.post(`/api/providers/${listed.placeId}/owner-facts`, FACTS, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "published" });

    const [request] = server.fakes.agent.moderationCalls;
    expect(request).toMatchObject({ subjectType: "providerFacts", language: "id" });
    expect(request?.text).toContain("Klinik Gigi Sari Dental");
    expect(request?.text).toContain("Jl. Raya Darmo 12, Surabaya");
    expect(request?.text).toContain("Senin-Jumat 09.00-20.00");

    const after = (await provider(listed.placeId)) as ProviderDoc;
    expect(after).toMatchObject({
      name: "Klinik Gigi Sari Dental",
      nameSource: "claim",
      nameNormalized: "klinik gigi sari dental",
      providerType: "klinik",
      providerTypeSource: "claimed",
      region: { provinceCode: "35", regencyCode: "35.78" },
      ownerFacts: {
        address: FACTS.address,
        phone: FACTS.phone,
        whatsapp: FACTS.whatsapp,
        openingHours: FACTS.openingHours,
        services: FACTS.services,
        moderationStatus: "published",
      },
    });
    // Testimonies copy the Region for feed filters.
    expect((await testimony(t.id)).region).toEqual({ provinceCode: "35", regencyCode: "35.78" });

    const decisions = await server.firestore.collection(COLLECTIONS.moderationDecisions).get();
    expect(decisions.docs.map((d) => d.data() as ModerationDecisionDoc)).toEqual([
      expect.objectContaining({ subjectType: "providerFacts", subjectId: listed.placeId, decision: "publish" }),
    ]);
  });

  it("holds facts on any rule hit, keeps the published ones live, and lets the admin publish them", async () => {
    const { listed, cookie, admin } = await claimedProvider();
    await server.post(`/api/providers/${listed.placeId}/owner-facts`, FACTS, { headers: { cookie } });
    server.fakes.agent.respondToModerationWith(HOLD);

    const response = await server.post(
      `/api/providers/${listed.placeId}/owner-facts`,
      { ...FACTS, name: "Terbaik Dental", address: "Jl. Baru 1" },
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "held" });

    const held = (await provider(listed.placeId)) as ProviderDoc;
    expect(held.name).toBe(FACTS.name);
    expect(held.ownerFacts).toMatchObject({ address: FACTS.address, moderationStatus: "published" });
    expect(held.pendingOwnerFacts).toMatchObject({ name: "Terbaik Dental", moderationStatus: "held" });
    expect(await (await server.get(`/tempat/${listed.placeId}`)).text()).toContain(FACTS.address);

    const item = (await queue(admin)).items.find((i) => i.kind === "ownerFacts");
    expect(item).toMatchObject({
      subjectId: listed.placeId,
      ownerFacts: {
        placeId: listed.placeId,
        currentName: FACTS.name,
        facts: { name: "Terbaik Dental", address: "Jl. Baru 1" },
      },
    });
    expect(item?.ownerFacts?.moderation?.ruleCodes).toEqual(["promotional_wording"]);

    expect((await act(admin, { action: "publishOwnerFacts", subjectId: listed.placeId })).status).toBe(200);
    const after = (await provider(listed.placeId)) as ProviderDoc;
    expect(after).toMatchObject({
      name: "Terbaik Dental",
      nameSource: "claim",
      ownerFacts: { address: "Jl. Baru 1", moderationStatus: "published" },
    });
    expect(after.pendingOwnerFacts).toBeUndefined();
  });

  it("drops held facts the admin rejects", async () => {
    const { listed, cookie, admin } = await claimedProvider();
    server.fakes.agent.respondToModerationWith(HOLD);
    await server.post(`/api/providers/${listed.placeId}/owner-facts`, FACTS, { headers: { cookie } });

    expect((await act(admin, { action: "rejectOwnerFacts", subjectId: listed.placeId })).status).toBe(400);
    expect(
      (await act(admin, { action: "rejectOwnerFacts", subjectId: listed.placeId, reason: "Promosi" })).status,
    ).toBe(200);
    const after = (await provider(listed.placeId)) as ProviderDoc;
    expect(after.pendingOwnerFacts).toBeUndefined();
    expect(after.ownerFacts).toBeUndefined();
    expect(after.name).toBe(listed.name);
  });

  it("holds the facts with model_error when the agent fails", async () => {
    const { listed, cookie } = await claimedProvider();
    server.fakes.agent.respondToModerationWith(new AgentUnavailableError("down", 503));

    const response = await server.post(`/api/providers/${listed.placeId}/owner-facts`, FACTS, { headers: { cookie } });
    expect(await response.json()).toMatchObject({ status: "held" });
    const decisions = await server.firestore.collection(COLLECTIONS.moderationDecisions).get();
    expect(decisions.docs[0]?.data()).toMatchObject({ ruleCodes: ["model_error"], model: "fallback" });
  });

  it("refuses invalid facts", async () => {
    const { listed, cookie } = await claimedProvider();
    const response = await server.post(
      `/api/providers/${listed.placeId}/owner-facts`,
      { ...FACTS, providerType: "spa", services: ["botox"] },
      { headers: { cookie } },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_facts" });
    expect(server.fakes.agent.moderationCalls).toEqual([]);
  });
});

describe("POST /api/testimonies/:testimonyId/reply", () => {
  it("publishes one reply per Testimony; sending again edits it", async () => {
    const { listed, cookie, claimId } = await claimedProvider();
    const t = await seedTestimony(server.firestore, listed);

    const first = await server.post(
      `/api/testimonies/${t.id}/reply`,
      { text: "Terima kasih atas masukannya." },
      { headers: { cookie } },
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "published" });
    expect(server.fakes.agent.moderationCalls[0]).toMatchObject({ subjectType: "reply" });

    await server.post(
      `/api/testimonies/${t.id}/reply`,
      { text: "Terima kasih, kami perbaiki." },
      { headers: { cookie } },
    );
    const stored = await testimony(t.id);
    expect(stored.reply).toMatchObject({ text: "Terima kasih, kami perbaiki.", claimId, status: "published" });
    // The Testimony itself is untouched.
    expect(stored).toMatchObject({ status: "published", text: t.text });

    const page = await server.get(`/tempat/${listed.placeId}`);
    expect(await page.text()).toContain("Terima kasih, kami perbaiki.");
  });

  it("refuses a reply from anyone but the claimant of that place", async () => {
    const { listed } = await claimedProvider();
    const t = await seedTestimony(server.firestore, listed);
    const other = await seedProvider(server.firestore);
    const otherTestimony = await seedTestimony(server.firestore, other);
    const stranger = await server.signInWithGoogle("pesaing@example.com");
    const owner = await server.signInWithGoogle(OWNER);

    expect(
      (await server.post(`/api/testimonies/${t.id}/reply`, { text: "Halo" }, { headers: { cookie: stranger } })).status,
    ).toBe(403);
    expect(
      (
        await server.post(
          `/api/testimonies/${otherTestimony.id}/reply`,
          { text: "Halo" },
          { headers: { cookie: owner } },
        )
      ).status,
    ).toBe(403);
    expect((await testimony(t.id)).reply).toBeUndefined();
  });

  it("holds a reply on any rule hit until the admin publishes it", async () => {
    const { listed, cookie, admin } = await claimedProvider();
    const t = await seedTestimony(server.firestore, listed);
    server.fakes.agent.respondToModerationWith(HOLD);

    const response = await server.post(
      `/api/testimonies/${t.id}/reply`,
      { text: "Terbaik di Surabaya, diskon 50%!" },
      { headers: { cookie } },
    );
    expect(await response.json()).toMatchObject({ status: "held" });
    expect((await testimony(t.id)).reply?.status).toBe("held");
    expect(await (await server.get(`/tempat/${listed.placeId}`)).text()).not.toContain("diskon 50%");

    const item = (await queue(admin)).items.find((i) => i.kind === "reply");
    expect(item).toMatchObject({ subjectId: t.id, reply: { text: "Terbaik di Surabaya, diskon 50%!" } });
    expect((await act(admin, { action: "publishReply", subjectId: t.id })).status).toBe(200);
    expect((await testimony(t.id)).reply?.status).toBe("published");
  });

  it("stops showing a reply once its Claim is revoked", async () => {
    const { listed, cookie, admin, claimId } = await claimedProvider();
    const t = await seedTestimony(server.firestore, listed);
    await server.post(`/api/testimonies/${t.id}/reply`, { text: "Balasan pemilik lama." }, { headers: { cookie } });

    await act(admin, { action: "revokeClaim", subjectId: claimId, reason: "Bukan pemilik" });
    expect(await (await server.get(`/tempat/${listed.placeId}`)).text()).not.toContain("Balasan pemilik lama.");
  });
});

describe("A revoked Claim's held reply", () => {
  it("cannot be published", async () => {
    const { listed, cookie, admin, claimId } = await claimedProvider();
    const t = await seedTestimony(server.firestore, listed);
    server.fakes.agent.respondToModerationWith(HOLD);
    await server.post(`/api/testimonies/${t.id}/reply`, { text: "Terbaik!" }, { headers: { cookie } });
    await act(admin, { action: "revokeClaim", subjectId: claimId, reason: "Bukan pemilik" });

    expect((await act(admin, { action: "publishReply", subjectId: t.id })).status).toBe(409);
    expect((await act(admin, { action: "rejectReply", subjectId: t.id, reason: "Klaim dicabut" })).status).toBe(200);
  });
});

describe("A claimed Provider can never delete or hide a Testimony", () => {
  it("has no route that removes or hides one", async () => {
    const { listed, cookie } = await claimedProvider();
    const t = await seedTestimony(server.firestore, listed);

    const remove = await fetch(new URL(`/api/testimonies/${t.id}`, server.baseUrl), {
      method: "DELETE",
      headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
    });
    expect(remove.ok).toBe(false);

    const edit = new FormData();
    edit.set("testimony", JSON.stringify({ text: "diubah pemilik" }));
    const editResponse = await fetch(new URL(`/api/testimonies/${t.id}`, server.baseUrl), {
      method: "POST",
      headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
      body: edit,
    });
    expect(editResponse.ok).toBe(false);

    for (const action of ["hide", "remove", "reject"] as const) {
      expect((await act(cookie, { action, subjectId: t.id, reason: "tidak benar" })).status).toBe(403);
    }

    // A reply is the Provider's own words beside the Testimony, never instead of it.
    await server.post(`/api/testimonies/${t.id}/reply`, { text: "Kami tanggapi." }, { headers: { cookie } });

    expect(await testimony(t.id)).toMatchObject({ status: "published", text: t.text });
  });

  it("files a claimed Provider's personal-data report without hiding the Testimony", async () => {
    const { listed, cookie } = await claimedProvider();
    const t = await seedTestimony(server.firestore, listed);

    const response = await server.post(
      `/api/testimonies/${t.id}/reports`,
      { category: "personalData", details: "Menyebut nama staf." },
      { headers: { cookie } },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ hidden: false });
    expect((await testimony(t.id)).status).toBe("published");
    const reports = await server.firestore.collection(COLLECTIONS.testimonyReports).get();
    expect(reports.docs.map((d) => d.data() as TestimonyReportDoc)).toEqual([
      expect.objectContaining({ reporterRole: "claimedProvider", hidTestimony: false, status: "open" }),
    ]);
  });
});
