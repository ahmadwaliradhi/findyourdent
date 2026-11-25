// A confirmed Testimony Policy Violation (spec 09 part 2, issue #138): the public badge for
// 6 months, and the Testimonies published in the suspected period left out of the
// aggregates (but still readable and labelled). The badge end job removes the badge and
// recomputes the aggregates; the exclusion stays. Driven through the admin API; the
// directory row and Provider page are read through their loaders against the emulator.
import {
  COLLECTIONS,
  type PolicyViolationDoc,
  type ProviderDoc,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminActionRequest, AdminActionResponse } from "../../app/lib/admin-queue.ts";
import type { FeedItem } from "../../app/lib/feed.ts";
import { badgeUntilMs } from "../../app/lib/policy-violations.ts";
import { loadDirectory } from "../../app/server/directory.server.ts";
import { loadProviderPage } from "../../app/server/provider-page.server.ts";
import { silentLogger } from "../../server/logger.ts";
import { endExpiredViolationBadges } from "../../server/violation-badge-expiry.ts";
import { seedProvider, seedTestimony, type TestimonyFixture } from "../support/fixtures.ts";
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
const PERIOD = { suspectedFrom: "2026-08-01", suspectedTo: "2026-10-31" };
const ratings = (n: number) => ({ service: n, hygiene: n, materialsEquipment: n });

const adminCookie = () => server.signInWithGoogle(ADMIN_EMAILS[0] as string);
const act = (cookie: string, body: AdminActionRequest) =>
  server.post("/admin/api/actions", body, { headers: { cookie } });

async function provider(placeId: string): Promise<ProviderDoc> {
  return (await server.firestore.collection(COLLECTIONS.providers).doc(placeId).get()).data() as ProviderDoc;
}
async function violation(id: string): Promise<PolicyViolationDoc> {
  return (await server.firestore.collection(COLLECTIONS.policyViolations).doc(id).get()).data() as PolicyViolationDoc;
}
async function testimony(id: string): Promise<TestimonyDoc> {
  return (await server.firestore.collection(COLLECTIONS.testimonies).doc(id).get()).data() as TestimonyDoc;
}

/** Opens a case on the place, notifies it, and moves the response window into the past. */
async function notifiedCase(admin: string, placeId: string): Promise<string> {
  const opened = await act(admin, {
    action: "openViolation",
    subjectId: placeId,
    reason: "Laporan insentif.",
    violation: { reportIds: [], detectionHoldIds: [], ...PERIOD },
  });
  expect(opened.status).toBe(200);
  const id = ((await opened.json()) as AdminActionResponse).violationId as string;
  expect((await act(admin, { action: "notifyViolation", subjectId: id, reason: "Telepon" })).status).toBe(200);
  await server.firestore
    .collection(COLLECTIONS.policyViolations)
    .doc(id)
    .update({ responseDueAt: Timestamp.fromMillis(Date.now() - 1000) });
  return id;
}

const confirm = (admin: string, id: string) =>
  act(admin, { action: "confirmViolation", subjectId: id, reason: "Terbukti." });

/**
 * A Provider with three Proven Testimonies outside the suspected period (rating 5) and
 * three inside it (rating 1, priced), one of the inside ones hidden, plus an unproven one
 * inside. Boundaries are Jakarta dates: 31 Oct 23:59 is in, 1 Nov 00:00 is out.
 */
async function place() {
  const p = await seedProvider(server.firestore);
  const at = (iso: string) => ({ publishedAt: new Date(iso) as never });
  const proven = (n: number, extra: Partial<TestimonyFixture> = {}) => ({
    verifiedVisit: true,
    ratings: ratings(n),
    ...extra,
  });
  const outside = [
    await seedTestimony(server.firestore, p, proven(5, at("2026-07-31T16:59:00Z"))), // 31 Jul 23:59 Jakarta
    await seedTestimony(server.firestore, p, proven(5, at("2026-10-31T17:00:00Z"))), // 1 Nov 00:00 Jakarta
    await seedTestimony(server.firestore, p, proven(5, at("2026-11-05T03:00:00Z"))),
  ];
  const inside = [
    await seedTestimony(
      server.firestore,
      p,
      proven(1, { ...at("2026-07-31T17:00:00Z"), procedureCode: "scaling", pricePaidRupiah: 100_000 }), // 1 Aug 00:00 Jakarta
    ),
    await seedTestimony(
      server.firestore,
      p,
      proven(1, { ...at("2026-10-31T16:59:00Z"), procedureCode: "scaling", pricePaidRupiah: 300_000 }), // 31 Oct 23:59 Jakarta
    ),
    await seedTestimony(server.firestore, p, { ...at("2026-09-15T03:00:00Z"), ratings: ratings(2) }), // unproven
    await seedTestimony(server.firestore, p, proven(1, { ...at("2026-09-20T03:00:00Z"), status: "hidden" })),
  ];
  // The stored aggregates start as they were before the case: all six Proven and the unproven counted.
  await server.firestore
    .collection(COLLECTIONS.providers)
    .doc(p.placeId)
    .update({
      aggregates: {
        testimonyCount: 6,
        verifiedVisitCount: 5,
        averages: ratings(3.4),
        procedurePrices: { scaling: { count: 2, medianRupiah: 200_000, minRupiah: 100_000, maxRupiah: 300_000 } },
        paymentMethodCounts: { pribadi: 0, bpjs: 0, asuransi: 0, insurers: {} },
      },
    });
  return { p, outside, inside };
}

const DIRECTORY = { filters: { verifiedOnly: false }, q: "", sort: "testimoni" as const };

describe("confirming a violation case", () => {
  it("marks the Testimonies published in the period, leaves the rest, and recomputes without them", async () => {
    const { p, outside, inside } = await place();
    const admin = await adminCookie();
    const id = await notifiedCase(admin, p.placeId);

    expect((await confirm(admin, id)).status).toBe(200);

    for (const t of inside) expect((await testimony(t.id)).excludedByViolation).toBe(id);
    for (const t of outside) expect((await testimony(t.id)).excludedByViolation).toBeUndefined();

    // Published only: 3 outside + 3 inside (the hidden one is not published, the 2 priced ones and the unproven are).
    expect((await provider(p.placeId)).aggregates).toEqual({
      testimonyCount: 6,
      verifiedVisitCount: 3,
      averages: ratings(5),
      procedurePrices: {},
      paymentMethodCounts: { pribadi: 0, bpjs: 0, asuransi: 0, insurers: {} },
    });

    const decided = (await violation(id)).decidedAt as Timestamp;
    expect(await violation(id)).toMatchObject({
      status: "confirmed",
      badgeUntil: Timestamp.fromMillis(badgeUntilMs(decided.toMillis())),
    });
    expect([...((await violation(id)).excludedTestimonyIds ?? [])].sort()).toEqual(inside.map((t) => t.id).sort());
    expect((await provider(p.placeId)).violationBadge).toEqual({
      violationId: id,
      badgeUntil: Timestamp.fromMillis(badgeUntilMs(decided.toMillis())),
    });
  });

  it("shows the badge on the directory row and the Provider page, with excluded Testimonies still readable and labelled", async () => {
    const { p, inside } = await place();
    const admin = await adminCookie();
    const id = await notifiedCase(admin, p.placeId);
    await confirm(admin, id);

    const [row] = await loadDirectory(server.firestore, DIRECTORY);
    expect(row?.placeId).toBe(p.placeId);
    expect(row?.violationBadgeUntil).toBe(
      (await provider(p.placeId)).violationBadge?.badgeUntil.toDate().toISOString(),
    );

    const page = await loadProviderPage(server.firestore, p.placeId);
    expect(page?.provider.violationBadgeUntil).toBe(row?.violationBadgeUntil);
    const flagged = page?.testimonies.filter((t) => t.excludedByViolation).map((t) => t.id);
    // The hidden one is not published, so it is not on the page.
    expect(flagged?.sort()).toEqual(
      inside
        .filter((t) => t.status === "published")
        .map((t) => t.id)
        .sort(),
    );
    expect(page?.testimonies).toHaveLength(6);

    const feed = (await (await fetch(new URL("/api/feed", server.baseUrl))).json()) as { items: FeedItem[] };
    expect(
      feed.items
        .filter((i) => i.excludedByViolation)
        .map((i) => i.id)
        .sort(),
    ).toEqual(flagged?.sort());
  });

  it("shows no badge when the date has passed, even before the end job has run", async () => {
    const { p } = await place();
    const admin = await adminCookie();
    const id = await notifiedCase(admin, p.placeId);
    await confirm(admin, id);
    const until = (await provider(p.placeId)).violationBadge?.badgeUntil.toMillis() as number;

    const [row] = await loadDirectory(server.firestore, { ...DIRECTORY, nowMs: until - 1 });
    expect(row?.violationBadgeUntil).not.toBeNull();
    const [later] = await loadDirectory(server.firestore, { ...DIRECTORY, nowMs: until });
    expect(later?.violationBadgeUntil).toBeNull();
    expect((await loadProviderPage(server.firestore, p.placeId, until))?.provider.violationBadgeUntil).toBeNull();
  });

  it("still marks the Testimonies when the place has no Provider document", async () => {
    const p = await seedProvider(server.firestore);
    const t = await seedTestimony(server.firestore, p, { publishedAt: new Date("2026-09-15T03:00:00Z") as never });
    const admin = await adminCookie();
    const id = await notifiedCase(admin, p.placeId);
    await server.firestore.collection(COLLECTIONS.providers).doc(p.placeId).delete();

    expect((await confirm(admin, id)).status).toBe(200);

    expect((await testimony(t.id)).excludedByViolation).toBe(id);
    expect((await violation(id)).excludedTestimonyIds).toEqual([t.id]);
  });

  it("gives the badge to a Provider first Listed after the confirm", async () => {
    const p = await seedProvider(server.firestore);
    // Only a held Testimony at the place when the case is opened, so no Provider document.
    const held = await seedTestimony(server.firestore, p, { status: "held" });
    await server.firestore
      .collection(COLLECTIONS.testimonies)
      .doc(held.id)
      .update({ publishedAt: FieldValue.delete(), proposedProviderName: "Klinik Gigi Baru" });
    await server.firestore.collection(COLLECTIONS.providers).doc(p.placeId).delete();
    const admin = await adminCookie();
    const id = await notifiedCase(admin, p.placeId);
    expect((await confirm(admin, id)).status).toBe(200);
    const { badgeUntil } = await violation(id);

    expect((await act(admin, { action: "publish", subjectId: held.id, reason: "Sesuai." })).status).toBe(200);

    expect((await provider(p.placeId)).violationBadge).toEqual({ violationId: id, badgeUntil });
  });

  it("changes nothing when the case is dismissed", async () => {
    const { p, inside } = await place();
    const admin = await adminCookie();
    const id = await notifiedCase(admin, p.placeId);
    const before = (await provider(p.placeId)).aggregates;

    expect((await act(admin, { action: "dismissViolation", subjectId: id, reason: "Tidak terbukti." })).status).toBe(
      200,
    );

    for (const t of inside) expect((await testimony(t.id)).excludedByViolation).toBeUndefined();
    const after = await provider(p.placeId);
    expect(after.aggregates).toEqual(before);
    expect(after.violationBadge).toBeUndefined();
    expect((await violation(id)).badgeUntil).toBeUndefined();
  });
});

describe("violation badge end job", () => {
  it("leaves a running badge alone, then removes it after 6 months and recomputes with the exclusion kept", async () => {
    const { p, inside } = await place();
    const admin = await adminCookie();
    const id = await notifiedCase(admin, p.placeId);
    await confirm(admin, id);
    const until = (await provider(p.placeId)).violationBadge?.badgeUntil.toMillis() as number;
    const run = (nowMs: number) =>
      endExpiredViolationBadges({ firestore: server.firestore, logger: silentLogger, now: () => nowMs });

    expect(await run(until - DAY_MS)).toEqual({ ended: 0, failed: 0 });
    expect((await provider(p.placeId)).violationBadge).toBeDefined();

    // Make the stored aggregates stale, so the end job's recompute is visible.
    await server.firestore
      .collection(COLLECTIONS.providers)
      .doc(p.placeId)
      .update({ "aggregates.verifiedVisitCount": 99 });
    expect(await run(until)).toEqual({ ended: 1, failed: 0 });

    const ended = await provider(p.placeId);
    expect(ended.violationBadge).toBeUndefined();
    expect(ended.aggregates).toMatchObject({ testimonyCount: 6, verifiedVisitCount: 3, averages: ratings(5) });
    expect((await violation(id)).badgeEndedAt).toBeDefined();
    for (const t of inside) expect((await testimony(t.id)).excludedByViolation).toBe(id);
    expect((await loadDirectory(server.firestore, DIRECTORY))[0]?.violationBadgeUntil).toBeNull();
    expect((await loadProviderPage(server.firestore, p.placeId))?.provider.violationBadgeUntil).toBeNull();

    // Nothing is ended twice.
    expect(await run(until + DAY_MS)).toEqual({ ended: 0, failed: 0 });
  });
});
