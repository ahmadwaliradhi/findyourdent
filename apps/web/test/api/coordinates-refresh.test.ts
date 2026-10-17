import { COLLECTIONS, type ProviderDoc } from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { refreshCoordinates } from "../../server/coordinates-refresh.ts";
import { silentLogger } from "../../server/logger.ts";
import { seedProvider } from "../support/fixtures.ts";
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

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-20T03:00:00Z");

function fetchedDaysAgo(days: number) {
  return { lat: -6.2, lng: 106.8, fetchedAt: Timestamp.fromMillis(NOW - days * DAY_MS) } as never;
}

async function locationOf(placeId: string) {
  const snapshot = await server.firestore.collection(COLLECTIONS.providers).doc(placeId).get();
  return (snapshot.data() as ProviderDoc).location;
}

function run() {
  return refreshCoordinates({
    firestore: server.firestore,
    places: server.fakes.places,
    logger: silentLogger,
    now: () => NOW,
  });
}

describe("coordinate refresh job", () => {
  it("deletes coordinates older than 30 days when the refresh fails, and keeps younger ones", async () => {
    await seedProvider(server.firestore, { placeId: "place-stale", location: fetchedDaysAgo(31) });
    await seedProvider(server.firestore, { placeId: "place-due", location: fetchedDaysAgo(26) });
    server.fakes.places.respondWithCoordinates({ ok: false, reason: "unavailable" });

    await run();

    expect(await locationOf("place-stale")).toBeUndefined();
    expect(await locationOf("place-due")).toMatchObject({ lat: -6.2, lng: 106.8 });
  });

  it("refreshes due coordinates and fills missing ones with today's date, leaving fresh ones alone", async () => {
    await seedProvider(server.firestore, { placeId: "place-due", location: fetchedDaysAgo(26) });
    await seedProvider(server.firestore, { placeId: "place-fresh", location: fetchedDaysAgo(3) });
    await seedProvider(server.firestore, { placeId: "place-missing" });
    server.fakes.places.respondWithCoordinates({ ok: true, location: { lat: -7.25, lng: 112.75 } });

    await run();

    expect([...server.fakes.places.coordinatesCalls].sort()).toEqual(["place-due", "place-missing"]);
    for (const placeId of ["place-due", "place-missing"]) {
      const location = await locationOf(placeId);
      expect(location).toMatchObject({ lat: -7.25, lng: 112.75 });
      expect(location?.fetchedAt.toMillis()).toBe(NOW);
    }
    expect(await locationOf("place-fresh")).toMatchObject({ lat: -6.2, lng: 106.8 });
  });

  it("stops calling Places once the cap is reached, still deleting what is older than 30 days", async () => {
    await seedProvider(server.firestore, { placeId: "place-stale-a", location: fetchedDaysAgo(33) });
    await seedProvider(server.firestore, { placeId: "place-stale-b", location: fetchedDaysAgo(32) });
    await seedProvider(server.firestore, { placeId: "place-due", location: fetchedDaysAgo(27) });
    server.fakes.places.respondWithCoordinates({ ok: false, reason: "cap_reached" });

    await run();

    expect(server.fakes.places.coordinatesCalls).toEqual(["place-stale-a"]);
    expect(await locationOf("place-stale-a")).toBeUndefined();
    expect(await locationOf("place-stale-b")).toBeUndefined();
    expect(await locationOf("place-due")).toMatchObject({ lat: -6.2, lng: 106.8 });
  });

  it("asks Places for at most seven a run, oldest first, leaving the rest of the daily cap to new Listed Providers", async () => {
    await seedProvider(server.firestore, { placeId: "place-missing" });
    for (let days = 26; days <= 33; days += 1) {
      await seedProvider(server.firestore, { placeId: `place-${days}`, location: fetchedDaysAgo(days) });
    }
    server.fakes.places.respondWithCoordinates({ ok: true, location: { lat: -7.25, lng: 112.75 } });

    await run();

    expect(server.fakes.places.coordinatesCalls).toEqual([
      "place-33",
      "place-32",
      "place-31",
      "place-30",
      "place-29",
      "place-28",
      "place-27",
    ]);
    expect(await locationOf("place-26")).toMatchObject({ lat: -6.2, lng: 106.8 });
    expect(await locationOf("place-missing")).toBeUndefined();
  });
});
