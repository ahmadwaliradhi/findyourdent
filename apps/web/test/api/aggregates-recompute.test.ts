// The one-off release job that recomputes every Listed Provider's aggregates under
// spec 09's rule (only Proven Testimonies count), with no grandfathering.
import { COLLECTIONS, type ProviderAggregates, type ProviderDoc } from "@findyourdent/contracts/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recomputeAllAggregates } from "../../server/aggregates-recompute.ts";
import { silentLogger } from "../../server/logger.ts";
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

async function aggregatesOf(placeId: string): Promise<ProviderAggregates> {
  const snapshot = await server.firestore.collection(COLLECTIONS.providers).doc(placeId).get();
  return (snapshot.data() as ProviderDoc).aggregates;
}

/** What a Provider held under the old rule: every published Testimony counted. */
const OLD_RULE: ProviderAggregates = {
  testimonyCount: 2,
  verifiedVisitCount: 0,
  averages: { service: 4, hygiene: 5, materialsEquipment: 4 },
  procedurePrices: { scaling: { count: 2, medianRupiah: 250_000, minRupiah: 200_000, maxRupiah: 300_000 } },
};

const run = () => recomputeAllAggregates({ firestore: server.firestore, logger: silentLogger });

describe("aggregates recompute job", () => {
  it("takes the scores and price stats away from a Provider with only unproven Testimonies", async () => {
    const provider = await seedProvider(server.firestore, { aggregates: OLD_RULE });
    for (const price of [200_000, 300_000]) {
      await seedTestimony(server.firestore, provider, { procedureCode: "scaling", pricePaidRupiah: price });
    }

    const summary = await run();

    expect(await aggregatesOf(provider.placeId)).toEqual({
      testimonyCount: 2,
      verifiedVisitCount: 0,
      averages: null,
      procedurePrices: {},
      paymentMethodCounts: { pribadi: 0, bpjs: 0, asuransi: 0, insurers: {} },
    });
    expect(summary).toEqual({ providers: 1, changed: 1 });
  });

  it("keeps Testimonies accepted under the old rule as Proven, and ignores ones not published", async () => {
    const provider = await seedProvider(server.firestore, { aggregates: OLD_RULE });
    for (const service of [5, 4, 3]) {
      // Accepted under the old 24-month rule: no fingerprint, no file, still Proven.
      await seedTestimony(server.firestore, provider, {
        verifiedVisit: true,
        ratings: { service, hygiene: 4, materialsEquipment: 4 },
        proofOfVisit: { result: "accepted", checkedAt: new Date() as never },
      });
    }
    await seedTestimony(server.firestore, provider, { ratings: { service: 1, hygiene: 1, materialsEquipment: 1 } });
    await seedTestimony(server.firestore, provider, { status: "held", verifiedVisit: true });

    await run();

    expect(await aggregatesOf(provider.placeId)).toEqual({
      testimonyCount: 4,
      verifiedVisitCount: 3,
      averages: { service: 4, hygiene: 4, materialsEquipment: 4 },
      procedurePrices: {},
      paymentMethodCounts: { pribadi: 0, bpjs: 0, asuransi: 0, insurers: {} },
    });
  });

  it("recomputes every Listed Provider and leaves correct ones as they are", async () => {
    const stale = await seedProvider(server.firestore, { aggregates: OLD_RULE });
    await seedTestimony(server.firestore, stale);
    const empty = await seedProvider(server.firestore);
    const before = await server.firestore.collection(COLLECTIONS.providers).doc(empty.placeId).get();

    expect(await run()).toEqual({ providers: 2, changed: 1 });

    const after = await server.firestore.collection(COLLECTIONS.providers).doc(empty.placeId).get();
    expect(after.updateTime?.isEqual(before.updateTime as never)).toBe(true);
    expect((await aggregatesOf(stale.placeId)).averages).toBeNull();
    // Running it again changes nothing.
    expect(await run()).toEqual({ providers: 2, changed: 0 });
  });
});
