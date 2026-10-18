// The proof expiry job (spec 09, ticket #129): a Proof of Visit nobody decided within
// 7 days becomes `rejected` (`expired`) and its file is deleted. Never an accept.
import { COLLECTIONS, type ProofOfVisitRecord, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "../../server/logger.ts";
import { expireProofs } from "../../server/proof-expiry.ts";
import { seedProvider, seedTestimony } from "../support/fixtures.ts";
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

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse("2026-11-20T03:00:00Z");

/** A Testimony whose proof (by default waiting for the team) was checked `checkedAgoMs` ago, a file in the bucket. */
async function waitingProof(checkedAgoMs: number, overrides: Partial<ProofOfVisitRecord> = {}) {
  const provider = await seedProvider(server.firestore);
  const proofOfVisit: ProofOfVisitRecord = {
    result: "pending",
    reasons: ["nameMismatch"],
    checkedAt: Timestamp.fromMillis(NOW - checkedAgoMs),
    clinicNameOnProof: "Klinik Gigi Sentosa",
    proofDate: "2026-11-02",
    attempts: 1,
    ...overrides,
  };
  if (proofOfVisit.result !== "pending") delete proofOfVisit.reasons;
  const { id } = await seedTestimony(server.firestore, provider, { proofOfVisit: proofOfVisit as never });
  await server.uploads.file(`proof-of-visit/${id}/struk.jpg`).save(Buffer.from("receipt"));
  if (proofOfVisit.result !== "rejected") {
    await fingerprints().doc(id).set({
      testimonyId: id,
      placeId: provider.placeId,
      perceptualHash: "c3a5f00f0ff0a5c3",
      createdAt: proofOfVisit.checkedAt,
    });
  }
  return id;
}

const fingerprints = () => server.firestore.collection(COLLECTIONS.proofFingerprints);
const hasFingerprint = async (id: string) => (await fingerprints().doc(id).get()).exists;

async function proofOf(id: string): Promise<{ proofOfVisit?: ProofOfVisitRecord; verifiedVisit: boolean }> {
  const snapshot = await server.firestore.collection(COLLECTIONS.testimonies).doc(id).get();
  return snapshot.data() as TestimonyDoc;
}

async function storedObjects(prefix: string): Promise<string[]> {
  const [files] = await server.uploads.getFiles({ prefix });
  return files.map((file) => file.name);
}

const run = () =>
  expireProofs({ firestore: server.firestore, uploads: server.uploads, logger: silentLogger, now: () => NOW });

describe("proof expiry job", () => {
  it("rejects a proof waiting more than 7 days as expired and deletes its file and fingerprint; a younger one waits on", async () => {
    const old = await waitingProof(7 * DAY_MS + 60_000);
    const young = await waitingProof(5 * DAY_MS);

    const summary = await run();

    expect(summary).toEqual({ expired: 1, failed: 0 });
    const expired = await proofOf(old);
    expect(expired.verifiedVisit).toBe(false);
    expect(expired.proofOfVisit).toMatchObject({
      result: "rejected",
      reason: "expired",
      clinicNameOnProof: "Klinik Gigi Sentosa",
      attempts: 1,
    });
    expect(expired.proofOfVisit?.reasons).toBeUndefined();
    expect(await storedObjects(`proof-of-visit/${old}/`)).toEqual([]);
    expect(await hasFingerprint(old)).toBe(false);

    expect((await proofOf(young)).proofOfVisit?.result).toBe("pending");
    expect(await storedObjects(`proof-of-visit/${young}/`)).toHaveLength(1);
    expect(await hasFingerprint(young)).toBe(true);
  });

  it("runs hourly, so it also expires a proof that would pass 7 days before the next run", async () => {
    const almost = await waitingProof(7 * DAY_MS - 30 * 60_000);
    const later = await waitingProof(7 * DAY_MS - 2 * HOUR_MS);

    await run();

    expect((await proofOf(almost)).proofOfVisit).toMatchObject({ result: "rejected", reason: "expired" });
    expect((await proofOf(later)).proofOfVisit?.result).toBe("pending");
  });

  it("leaves decided proofs alone and never accepts one", async () => {
    const accepted = await waitingProof(30 * DAY_MS, { result: "accepted" });
    const rejected = await waitingProof(30 * DAY_MS, { result: "rejected", reason: "tooOld" });
    const old = await waitingProof(9 * DAY_MS);

    expect(await run()).toEqual({ expired: 1, failed: 0 });

    expect((await proofOf(accepted)).proofOfVisit?.result).toBe("accepted");
    expect(await hasFingerprint(accepted)).toBe(true);
    expect((await proofOf(rejected)).proofOfVisit).toMatchObject({ result: "rejected", reason: "tooOld" });
    expect(await proofOf(old)).toMatchObject({ verifiedVisit: false, proofOfVisit: { result: "rejected" } });
  });
});
