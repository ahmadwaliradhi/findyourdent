// Attaching a Proof of Visit to a published Testimony later (spec 09, issue #131) through
// the web API: Moderation runs in proof-only mode (no text or photo screening, nothing
// public changes), the same proof decision applies, an accepted proof makes the
// Testimony a Proven Testimony, and a Testimony gets at most three proof attempts,
// counting the one sent with it.
import type { ModerationDecision, ProofOfVisitExtraction } from "@findyourdent/contracts";
import { COLLECTIONS, IMPACT_COUNTERS, type ProviderDoc, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminQueueResponse } from "../../app/lib/admin-queue.ts";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type {
  ProofAttachResponse,
  TestimonyApiError,
  TestimonyStoredResponse,
  TestimonySubmission,
} from "../../app/lib/testimony.ts";
import { AgentUnavailableError } from "../../server/adapters/agent.ts";
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
const TEXT = "Dokternya sabar menjelaskan pilihan tambalan dan ruangannya bersih.";

function submission(overrides: Partial<TestimonySubmission> = {}): TestimonySubmission {
  return {
    placeId: PLACE,
    providerName: "Klinik Gigi Ceria",
    region: { provinceCode: "31", regencyCode: "31.71" },
    ratings: { service: 5, hygiene: 4, materialsEquipment: 3 },
    text: TEXT,
    visitMonth: "2026-09",
    procedureCode: "scaling",
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

/** What the agent read off a proof; by default a matching receipt dated in the visit month. */
function read(overrides: Partial<ProofOfVisitExtraction> = {}): ProofOfVisitExtraction {
  return {
    readable: true,
    isProofOfVisit: true,
    clinicNameOnProof: "Klinik Gigi Ceria",
    proofDate: "2026-09-12",
    totalRupiah: 300_000,
    clinicNameMatches: true,
    ...overrides,
  };
}
const MISMATCH = read({ clinicNameOnProof: "Klinik Lain", clinicNameMatches: false });

/** The answer the agent gives in proof-only mode. */
const proofOnly = (proofOfVisit: ProofOfVisitExtraction): ModerationDecision => ({
  ...PUBLISH,
  confidence: 1,
  proofOfVisit,
});

const moderateWith = (decision: unknown) => server.fakes.agent.respondToModerationWith(decision);

async function receipt(): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: "#f5f5dc" } })
    .jpeg()
    .toBuffer();
}

async function receiptFile(): Promise<File> {
  return new File([new Uint8Array(await receipt())], "struk.jpg", { type: "image/jpeg" });
}

const withAppCheck = (cookie?: string) => ({
  ...(cookie ? { cookie } : {}),
  [APP_CHECK_HEADER]: server.appCheckToken(),
});

/** Posts a Testimony (published unless `moderation` holds it), with a proof when `proof` is set. */
async function post(
  email: string,
  options: { moderation?: ModerationDecision; proof?: boolean } = {},
): Promise<{ id: string; cookie: string }> {
  moderateWith(options.moderation ?? PUBLISH);
  const cookie = await server.signInWithGoogle(email);
  const form = new FormData();
  form.set("testimony", JSON.stringify(submission()));
  if (options.proof) form.set("proof", await receiptFile());
  const response = await fetch(new URL("/api/testimonies", server.baseUrl), {
    method: "POST",
    headers: withAppCheck(cookie),
    body: form,
  });
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  const { testimonyId } = (await response.json()) as TestimonyStoredResponse;
  return { id: testimonyId, cookie };
}

async function attach(id: string, cookie: string | undefined, file?: File | null): Promise<Response> {
  const form = new FormData();
  if (file !== null) form.set("proof", file ?? (await receiptFile()));
  return fetch(new URL(`/api/testimonies/${id}/proof`, server.baseUrl), {
    method: "POST",
    headers: withAppCheck(cookie),
    body: form,
  });
}

async function attachOk(id: string, cookie: string): Promise<ProofAttachResponse> {
  const response = await attach(id, cookie);
  if (response.status !== 200) throw new Error(`attach failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as ProofAttachResponse;
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

async function count(collection: string): Promise<number> {
  return (await server.firestore.collection(collection).count().get()).data().count;
}

async function proofFiles(): Promise<string[]> {
  const [files] = await server.uploads.getFiles({ prefix: "proof-of-visit/" });
  return files.map((file) => file.name);
}

const agentCalls = () => server.fakes.agent.moderationCalls;

async function myTestimoniesPage(cookie: string): Promise<string> {
  const page = await fetch(new URL("/testimoni-saya", server.baseUrl), { headers: { cookie } });
  return page.text();
}

describe("POST /api/testimonies/:id/proof: accepted", () => {
  it("makes the Testimony Proven without re-screening it or changing anything public", async () => {
    const { id, cookie } = await post("pasien@example.com");
    const before = await testimony(id);
    expect(before.verifiedVisit).toBe(false);
    expect((await provider())?.aggregates.verifiedVisitCount).toBe(0);
    const decisionsBefore = await count(COLLECTIONS.moderationDecisions);

    moderateWith(proofOnly(read()));
    const body = await attachOk(id, cookie);

    expect(body).toMatchObject({
      testimonyId: id,
      verifiedVisit: true,
      proof: { result: "accepted" },
      proofAttemptsLeft: 2,
    });
    expect(body.proof.message).toContain("Kunjungan terbukti");

    const call = agentCalls().at(-1);
    expect(call).toMatchObject({
      subjectType: "proofOfVisit",
      language: "id",
      visitMonth: "2026-09",
      typedProviderName: "Klinik Gigi Ceria",
      proofOfVisit: { mimeType: "image/jpeg" },
    });
    expect(call).not.toHaveProperty("text");
    expect(call).not.toHaveProperty("photos");
    expect(call).not.toHaveProperty("procedureCode");
    expect(call).not.toHaveProperty("authorFixRound");

    const stored = await testimony(id);
    expect(stored).toMatchObject({
      status: "published",
      text: TEXT,
      displayName: "Siti R.",
      verifiedVisit: true,
      proofAttempts: 1,
      moderationDecisionId: before.moderationDecisionId,
      publishedAt: before.publishedAt,
    });
    expect(stored.proofOfVisit).toMatchObject({
      result: "accepted",
      extracted: { clinicName: "Klinik Gigi Ceria", proofDate: "2026-09-12", totalRupiah: 300_000 },
    });
    expect(stored.proofOfVisit).not.toHaveProperty("filePath");
    expect(stored).not.toHaveProperty("pendingRevision");
    // An attach writes no moderation decision: only the one from posting exists.
    expect(await count(COLLECTIONS.moderationDecisions)).toBe(decisionsBefore);
    const decisions = await server.firestore
      .collection(COLLECTIONS.moderationDecisions)
      .where("subjectId", "==", id)
      .get();
    expect(decisions.docs.map((doc) => doc.id)).toEqual([before.moderationDecisionId]);
    expect((await provider())?.aggregates.verifiedVisitCount).toBe(1);
    expect(await counter("verifiedVisits")).toBe(1);
    expect(await proofFiles()).toEqual([]);
  });

  it("leaves a pending edit of the Testimony waiting as it was", async () => {
    const { id, cookie } = await post("pasien@example.com");
    moderateWith(HOLD);
    const form = new FormData();
    form.set("testimony", JSON.stringify(submission({ text: `${TEXT} Diperbarui.` })));
    const edited = await fetch(new URL(`/api/testimonies/${id}`, server.baseUrl), {
      method: "POST",
      headers: withAppCheck(cookie),
      body: form,
    });
    expect(edited.status).toBe(200);
    const revision = (await testimony(id)).pendingRevision;
    expect(revision?.status).toBe("held");

    moderateWith(proofOnly(read()));
    expect((await attachOk(id, cookie)).verifiedVisit).toBe(true);

    const stored = await testimony(id);
    expect(stored.text).toBe(TEXT);
    expect(stored.pendingRevision).toEqual(revision);
    expect(stored.verifiedVisit).toBe(true);
  });
});

describe("POST /api/testimonies/:id/proof: pending and rejected", () => {
  it("keeps a proof the check sends to the team, published and unproven, in the admin proof queue", async () => {
    const { id, cookie } = await post("pasien@example.com");

    moderateWith(proofOnly(MISMATCH));
    const body = await attachOk(id, cookie);

    expect(body).toMatchObject({ verifiedVisit: false, proof: { result: "pending" }, proofAttemptsLeft: 2 });
    expect(body.proof.message).toContain("tim FindYourDent");
    const stored = await testimony(id);
    expect(stored.status).toBe("published");
    expect(stored.verifiedVisit).toBe(false);
    const files = await proofFiles();
    expect(files).toHaveLength(1);
    expect(stored.proofOfVisit).toMatchObject({ result: "pending", reasons: ["nameMismatch"], filePath: files[0] });
    expect((await provider())?.aggregates.verifiedVisitCount).toBe(0);
    expect(await counter("verifiedVisits")).toBe(0);

    const admin = await server.signInWithGoogle(ADMIN_EMAILS[0] as string);
    const queue = await server.get("/admin/api/queue", { headers: { cookie: admin } });
    const items = ((await queue.json()) as AdminQueueResponse).items.filter((item) => item.kind === "proofReview");
    expect(items).toEqual([
      expect.objectContaining({ id, proof: expect.objectContaining({ reasons: ["nameMismatch"] }) }),
    ]);
  });

  it("refuses another proof while one is with the team, keeping the pending one and its file", async () => {
    const { id, cookie } = await post("pasien@example.com", {
      moderation: { ...PUBLISH, proofOfVisit: MISMATCH },
      proof: true,
    });
    const before = await testimony(id);
    const files = await proofFiles();
    expect(files).toHaveLength(1);
    expect(await myTestimoniesPage(cookie)).not.toContain("Lampirkan bukti kunjungan");
    const calls = agentCalls().length;

    const response = await attach(id, cookie);

    expect(response.status).toBe(409);
    const body = (await response.json()) as TestimonyApiError;
    expect(body.error).toBe("proof_pending");
    expect(body.message).toContain("tim FindYourDent");
    expect(agentCalls()).toHaveLength(calls);
    expect(await proofFiles()).toEqual(files);
    expect(await testimony(id)).toEqual(before);
  });

  it("rejects a file that is not a proof, deletes it and says why", async () => {
    const { id, cookie } = await post("pasien@example.com");

    moderateWith(proofOnly(read({ isProofOfVisit: false })));
    const body = await attachOk(id, cookie);

    expect(body).toMatchObject({
      verifiedVisit: false,
      proof: { result: "rejected", reason: "notAProof" },
      proofAttemptsLeft: 2,
    });
    expect(body.proof.message).toContain("bukan kuitansi");
    expect((await testimony(id)).proofOfVisit).toMatchObject({ result: "rejected", reason: "notAProof" });
    expect(await proofFiles()).toEqual([]);
  });

  it("sends the proof to the team as notChecked when the agent fails", async () => {
    const { id, cookie } = await post("pasien@example.com");

    moderateWith(new AgentUnavailableError("agent responded 503", 503));
    const body = await attachOk(id, cookie);

    expect(body).toMatchObject({ verifiedVisit: false, proof: { result: "pending" } });
    const stored = await testimony(id);
    expect(stored.status).toBe("published");
    expect(stored.proofOfVisit).toMatchObject({ result: "pending", reasons: ["notChecked"] });
    expect(await proofFiles()).toHaveLength(1);
  });

  it("refuses a request without a proof file", async () => {
    const { id, cookie } = await post("pasien@example.com");
    const calls = agentCalls().length;

    const response = await attach(id, cookie, null);

    expect(response.status).toBe(400);
    const body = (await response.json()) as TestimonyApiError;
    expect(body.error).toBe("invalid_file");
    expect(body.fieldErrors?.proof).toBeTruthy();
    expect(agentCalls()).toHaveLength(calls);
    expect((await testimony(id)).proofAttempts).toBeUndefined();
  });
});

describe("POST /api/testimonies/:id/proof: attempt limit", () => {
  it("allows three proofs counting the one sent with the Testimony, then refuses before storing or checking", async () => {
    const { id, cookie } = await post("pasien@example.com", {
      moderation: { ...PUBLISH, proofOfVisit: read({ isProofOfVisit: false }) },
      proof: true,
    });
    expect((await testimony(id)).proofAttempts).toBe(1);

    moderateWith(proofOnly(read({ proofDate: "2024-03-02" })));
    expect((await attachOk(id, cookie)).proofAttemptsLeft).toBe(1);

    moderateWith(proofOnly(read({ readable: false })));
    const third = await attachOk(id, cookie);
    expect(third).toMatchObject({ proof: { result: "rejected", reason: "unreadable" }, proofAttemptsLeft: 0 });
    expect(await proofFiles()).toEqual([]);
    const afterThird = await testimony(id);
    expect(afterThird.proofAttempts).toBe(3);

    expect(await myTestimoniesPage(cookie)).toContain("3 kesempatan");

    const calls = agentCalls().length;
    const fourth = await attach(id, cookie);
    expect(fourth.status).toBe(409);
    const body = (await fourth.json()) as TestimonyApiError;
    expect(body.error).toBe("proof_attempts_used");
    expect(body.message).toContain("3 kesempatan");
    expect(agentCalls()).toHaveLength(calls);
    expect(await proofFiles()).toEqual([]);
    expect(await testimony(id)).toEqual(afterThird);
  });

  it("ignores and deletes a proof sent with an edit once the attempts are used, keeping the edit", async () => {
    const { id, cookie } = await post("pasien@example.com");
    for (let i = 0; i < 3; i++) {
      moderateWith(proofOnly(read({ readable: false })));
      await attachOk(id, cookie);
    }
    expect((await testimony(id)).proofAttempts).toBe(3);

    moderateWith({ ...PUBLISH, proofOfVisit: read() });
    const form = new FormData();
    form.set("testimony", JSON.stringify(submission({ text: `${TEXT} Diperbarui.` })));
    form.set("proof", await receiptFile());
    const response = await fetch(new URL(`/api/testimonies/${id}`, server.baseUrl), {
      method: "POST",
      headers: withAppCheck(cookie),
      body: form,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as TestimonyStoredResponse;
    expect(body).toMatchObject({ status: "published", verifiedVisit: false, proof: { result: "attemptsUsed" } });
    expect(body.proof?.message).toContain("3 kesempatan");
    expect(agentCalls().at(-1)?.proofOfVisit).toBeUndefined();
    const stored = await testimony(id);
    expect(stored.text).toBe(`${TEXT} Diperbarui.`);
    expect(stored.proofAttempts).toBe(3);
    expect(stored.proofOfVisit).toMatchObject({ result: "rejected", reason: "unreadable" });
    expect(stored.verifiedVisit).toBe(false);
    expect(await proofFiles()).toEqual([]);
  });

  it("counts a proof sent with an edit as an attempt", async () => {
    const { id, cookie } = await post("pasien@example.com");
    moderateWith({ ...PUBLISH, proofOfVisit: read({ readable: false }) });
    const form = new FormData();
    form.set("testimony", JSON.stringify(submission()));
    form.set("proof", await receiptFile());
    const edited = await fetch(new URL(`/api/testimonies/${id}`, server.baseUrl), {
      method: "POST",
      headers: withAppCheck(cookie),
      body: form,
    });
    expect(edited.status).toBe(200);
    expect((await testimony(id)).proofAttempts).toBe(1);

    moderateWith(proofOnly(MISMATCH));
    expect((await attachOk(id, cookie)).proofAttemptsLeft).toBe(1);
  });
});

describe("POST /api/testimonies/:id/proof: who and which Testimony", () => {
  it("refuses anyone but the author the way an edit does, storing and checking nothing", async () => {
    const { id } = await post("pasien@example.com");
    const other = await server.signInWithGoogle("lain@example.com");
    const calls = agentCalls().length;

    const response = await attach(id, other);
    const form = new FormData();
    form.set("testimony", JSON.stringify(submission()));
    const edit = await fetch(new URL(`/api/testimonies/${id}`, server.baseUrl), {
      method: "POST",
      headers: withAppCheck(other),
      body: form,
    });

    expect(response.status).toBe(edit.status);
    expect(response.status).toBe(403);
    expect(((await response.json()) as TestimonyApiError).error).toBe(((await edit.json()) as TestimonyApiError).error);
    expect(agentCalls()).toHaveLength(calls);
    expect(await proofFiles()).toEqual([]);
    expect((await testimony(id)).proofOfVisit).toBeUndefined();
  });

  it("refuses a signed-out request", async () => {
    const { id } = await post("pasien@example.com");
    const response = await attach(id, undefined);
    expect(response.status).toBe(401);
    expect(((await response.json()) as TestimonyApiError).error).toBe("sign_in_required");
  });

  it("refuses a Testimony that is not published", async () => {
    const { id, cookie } = await post("pasien@example.com", { moderation: HOLD });
    const calls = agentCalls().length;

    const response = await attach(id, cookie);

    expect(response.status).toBe(409);
    const body = (await response.json()) as TestimonyApiError;
    expect(body.error).toBe("not_published");
    expect(body.message).toBeTruthy();
    expect(agentCalls()).toHaveLength(calls);
    expect(await proofFiles()).toEqual([]);
  });

  it("refuses a Testimony that is already Proven", async () => {
    const { id, cookie } = await post("pasien@example.com", {
      moderation: { ...PUBLISH, proofOfVisit: read() },
      proof: true,
    });
    expect((await testimony(id)).verifiedVisit).toBe(true);
    const calls = agentCalls().length;

    const response = await attach(id, cookie);

    expect(response.status).toBe(409);
    expect(((await response.json()) as TestimonyApiError).error).toBe("already_proven");
    expect(agentCalls()).toHaveLength(calls);
    expect(await proofFiles()).toEqual([]);
    expect(await counter("verifiedVisits")).toBe(1);
  });

  it("offers the attach control on Testimoni saya only for a published Testimony without accepted proof", async () => {
    const { cookie } = await post("pasien@example.com");
    expect(await myTestimoniesPage(cookie)).toContain("Lampirkan bukti kunjungan");

    const proven = await post("terbukti@example.com", {
      moderation: { ...PUBLISH, proofOfVisit: read() },
      proof: true,
    });
    expect(await myTestimoniesPage(proven.cookie)).not.toContain("Lampirkan bukti kunjungan");
  });
});
