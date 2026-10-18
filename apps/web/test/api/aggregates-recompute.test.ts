// The one-off release job (spec 09): every Listed Provider's aggregates recomputed
// under "only Proven Testimonies count", with no grandfathering.
import { COLLECTIONS, type ProviderDoc, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recomputeAggregates } from "../../server/aggregates-recompute.ts";
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

const run = () => recomputeAggregates({ firestore: server.firestore, logger: silentLogger });

async function listed(placeId: string): Promise<ProviderDoc> {
  return (await server.firestore.collection(COLLECTIONS.providers).doc(placeId).get()).data() as ProviderDoc;
}

/** Aggregates as the old rule stored them: every published Testimony counted. */
const OLD_RULE = {
  testimonyCount: 3,
  verifiedVisitCount: 1,
  averages: { service: 4.33, hygiene: 4.33, materialsEquipment: 4 },
  procedurePrices: { scaling: { count: 3, medianRupiah: 200_000, minRupiah: 100_000, maxRupiah: 300_000 } },
};

describe("release recompute job", () => {
  it("drops the averages and prices that came from unproven Testimonies", async () => {
    const provider = await seedProvider(server.firestore, { placeId: "place-unproven", aggregates: OLD_RULE as never });
    await seedTestimony(server.firestore, provider, {
      ratings: { service: 5, hygiene: 5, materialsEquipment: 5 },
      procedureCode: "scaling",
      pricePaidRupiah: 100_000,
    });
    await seedTestimony(server.firestore, provider, { procedureCode: "scaling", pricePaidRupiah: 300_000 });
    await seedTestimony(server.firestore, provider, {
      verifiedVisit: true,
      procedureCode: "scaling",
      pricePaidRupiah: 200_000,
    });
    // Not published: never counted.
    await seedTestimony(server.firestore, provider, { status: "held", verifiedVisit: true });

    const summary = await run();

    expect((await listed("place-unproven")).aggregates).toEqual({
      testimonyCount: 3,
      verifiedVisitCount: 1,
      averages: null,
      procedurePrices: { scaling: { count: 1, medianRupiah: 200_000, minRupiah: 200_000, maxRupiah: 200_000 } },
    });
    expect(summary).toEqual({ providers: 1, changed: 1, failed: 0 });
  });

  it("keeps stars from Testimonies accepted under the old 24-month rule, and leaves the Testimonies alone", async () => {
    const provider = await seedProvider(server.firestore, { placeId: "place-proven", aggregates: OLD_RULE as never });
    const accepted = { result: "accepted" as const, checkedAt: new Date("2025-01-10T00:00:00Z") as never };
    const proven = [];
    for (const service of [5, 4, 3]) {
      proven.push(
        await seedTestimony(server.firestore, provider, {
          verifiedVisit: true,
          proofOfVisit: accepted,
          visitMonth: "2024-12",
          ratings: { service, hygiene: 4, materialsEquipment: 4 },
        }),
      );
    }
    await seedTestimony(server.firestore, provider, { ratings: { service: 1, hygiene: 1, materialsEquipment: 1 } });

    await run();

    expect((await listed("place-proven")).aggregates).toEqual({
      testimonyCount: 4,
      verifiedVisitCount: 3,
      averages: { service: 4, hygiene: 4, materialsEquipment: 4 },
      procedurePrices: {},
    });
    for (const { id } of proven) {
      const stored = (await server.firestore.collection(COLLECTIONS.testimonies).doc(id).get()).data() as TestimonyDoc;
      expect(stored).toMatchObject({ verifiedVisit: true, proofOfVisit: { result: "accepted" } });
    }
  });

  it("changes nothing on a second run, nor for a Provider already right", async () => {
    const provider = await seedProvider(server.firestore, { placeId: "place-stale", aggregates: OLD_RULE as never });
    await seedTestimony(server.firestore, provider);
    // Listed by a Claim, no Testimonies: already right.
    await seedProvider(server.firestore, { placeId: "place-claimed", listedBy: "claim" });

    expect(await run()).toEqual({ providers: 2, changed: 1, failed: 0 });
    const updatedAt = (await listed("place-stale")).updatedAt.toMillis();

    expect(await run()).toEqual({ providers: 2, changed: 0, failed: 0 });
    expect((await listed("place-stale")).updatedAt.toMillis()).toBe(updatedAt);
  });

  it("repairs aggregates stored without the Proven count", async () => {
    const legacy = {
      testimonyCount: 1,
      averages: { service: 4, hygiene: 5, materialsEquipment: 4 },
      procedurePrices: {},
    };
    const provider = await seedProvider(server.firestore, { placeId: "place-legacy", aggregates: legacy as never });
    await seedTestimony(server.firestore, provider);

    await run();

    expect((await listed("place-legacy")).aggregates).toEqual({
      testimonyCount: 1,
      verifiedVisitCount: 0,
      averages: null,
      procedurePrices: {},
    });
  });
});
