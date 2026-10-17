import { COLLECTIONS, type TestimonyStatus } from "@findyourdent/contracts/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type ImpactCounts,
  recordListedProviderCreated,
  recordTestimonyTransition,
} from "../../app/server/impact.server.ts";
import { STUB_GUIDANCE_RESPONSE } from "../../server/adapters/fakes.ts";
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

async function impact(): Promise<ImpactCounts> {
  const response = await fetch(new URL("/dampak", server.baseUrl));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/application\/json/);
  return (await response.json()) as ImpactCounts;
}

/** What a posting, Moderation or admin flow does: change the Testimony and the counter in one transaction. */
async function changeTestimony(
  firestore: Firestore,
  id: string,
  change: { status?: TestimonyStatus; verifiedVisit?: boolean },
): Promise<void> {
  const ref = firestore.collection(COLLECTIONS.testimonies).doc(id);
  await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const before = { status: snapshot.get("status"), verifiedVisit: snapshot.get("verifiedVisit") };
    const after = { ...before, ...change };
    tx.update(ref, change);
    recordTestimonyTransition(firestore, tx, before, after);
  });
}

describe("GET /dampak", () => {
  it("reads zero everywhere before anything happened", async () => {
    const response = await fetch(new URL("/dampak", server.baseUrl));

    expect(response.headers.get("cache-control")).toMatch(/public.*max-age=60/);
    expect(await response.json()).toEqual({
      testimoniesPublished: 0,
      kotaCovered: 0,
      verifiedVisits: 0,
      listedProviders: 0,
      guidanceSessionsCompleted: 0,
    });
  });

  it("rises when a Testimony is published and falls when it is removed, hidden or deleted", async () => {
    const provider = await seedProvider(server.firestore);
    const plain = await seedTestimony(server.firestore, provider, { status: "submitted" });
    const verified = await seedTestimony(server.firestore, provider, { status: "held", verifiedVisit: true });
    const third = await seedTestimony(server.firestore, provider, { status: "submitted" });

    await changeTestimony(server.firestore, plain.id, { status: "published" });
    await changeTestimony(server.firestore, verified.id, { status: "published" });
    await changeTestimony(server.firestore, third.id, { status: "published" });
    expect(await impact()).toMatchObject({ testimoniesPublished: 3, verifiedVisits: 1 });

    await changeTestimony(server.firestore, verified.id, { status: "removed" });
    expect(await impact()).toMatchObject({ testimoniesPublished: 2, verifiedVisits: 0 });

    await changeTestimony(server.firestore, plain.id, { status: "hidden" });
    await changeTestimony(server.firestore, third.id, { status: "deleted" });
    expect(await impact()).toMatchObject({ testimoniesPublished: 0, verifiedVisits: 0 });
  });

  it("counts Kunjungan terbukti granted on a Testimony that is already published", async () => {
    const provider = await seedProvider(server.firestore);
    const testimony = await seedTestimony(server.firestore, provider, { status: "submitted" });
    await changeTestimony(server.firestore, testimony.id, { status: "published" });

    await changeTestimony(server.firestore, testimony.id, { verifiedVisit: true });

    expect(await impact()).toMatchObject({ testimoniesPublished: 1, verifiedVisits: 1 });
  });

  it("counts Listed Providers created and the distinct kota/kabupaten they cover", async () => {
    const created = async (regencyCode: string) => {
      await server.firestore.runTransaction(async (tx) => {
        const ref = server.firestore.collection(COLLECTIONS.providers).doc(`place-${regencyCode}-${Math.random()}`);
        tx.set(ref, { placeId: ref.id, region: { provinceCode: regencyCode.slice(0, 2), regencyCode } });
        recordListedProviderCreated(server.firestore, tx);
      });
    };
    await created("35.78");
    await created("35.78");
    await created("31.71");

    expect(await impact()).toMatchObject({ listedProviders: 3, kotaCovered: 2 });
    expect(server.fakes.places.calls).toEqual([]);
  });

  it("counts a Guidance session when it ends in a Guidance card or an Emergency Escalation, not on a follow-up question", async () => {
    const complaint = { complaintText: "Gigi geraham kiri bawah nyut-nyutan sejak tiga hari", language: "id" };

    server.fakes.agent.respondWith({ kind: "followUp", question: "Apakah gusinya bengkak?", quickReplies: ["Ya"] });
    expect((await server.post("/api/guidance", complaint)).status).toBe(200);
    expect(await impact()).toMatchObject({ guidanceSessionsCompleted: 0 });

    server.fakes.agent.respondWith(STUB_GUIDANCE_RESPONSE);
    expect((await server.post("/api/guidance", complaint)).status).toBe(200);
    server.fakes.agent.respondWith({
      kind: "emergency",
      reason: "Bengkak di wajah disertai demam bisa berarti infeksi yang menyebar.",
      redFlags: ["facial_or_neck_swelling", "fever"],
      hospitalSearch: { providerType: "hospital", requiresEmergencyDepartment: true },
    });
    expect((await server.post("/api/guidance", complaint)).status).toBe(200);

    expect(await impact()).toMatchObject({ guidanceSessionsCompleted: 2 });
    expect(server.fakes.places.calls).toEqual([]);
  });
});

describe("landing page", () => {
  it("server-renders the counter and a first-party link preview", async () => {
    const provider = await seedProvider(server.firestore);
    const testimony = await seedTestimony(server.firestore, provider, { status: "submitted" });
    await changeTestimony(server.firestore, testimony.id, { status: "published" });

    const response = await fetch(new URL("/", server.baseUrl));
    const html = await response.text();

    expect(html).toContain('data-testid="impact-counter"');
    expect(html).toMatch(/data-counter="testimoniesPublished"[^>]*>1</);
    expect(html).toContain('property="og:title"');
    expect(html).toContain(`property="og:url" content="${server.baseUrl}/"`);
    expect(server.fakes.places.calls).toEqual([]);
  });
});
