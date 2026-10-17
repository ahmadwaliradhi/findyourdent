// Emulator fixture data that follows the Firestore data model (packages/contracts/src/firestore.ts).
import { COLLECTIONS, type ProviderDoc, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import type { Firestore } from "firebase-admin/firestore";

type Writable<T> = {
  [K in keyof T]: NonNullable<T[K]> extends { toDate(): Date } ? Date | Extract<T[K], undefined> : T[K];
};
export type ProviderFixture = Writable<ProviderDoc>;
export type TestimonyFixture = Writable<TestimonyDoc>;

let sequence = 0;

/** Lower-cased, accents and punctuation stripped, single spaces. */
export function normalizeForFixture(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Writes a Listed Provider (document id = placeId) and returns it. */
export async function seedProvider(
  firestore: Firestore,
  overrides: Partial<ProviderFixture> = {},
): Promise<ProviderFixture> {
  sequence += 1;
  const name = overrides.name ?? `Klinik Gigi Fixture ${sequence}`;
  const now = new Date();
  const provider: ProviderFixture = {
    placeId: `place-fixture-${sequence}`,
    name,
    nameSource: "testimonyAuthor",
    nameNormalized: normalizeForFixture(name),
    region: { provinceCode: "31", regencyCode: "31.71" },
    providerType: "klinik",
    providerTypeSource: "inferred",
    claimStatus: "unclaimed",
    aggregates: { testimonyCount: 0, verifiedVisitCount: 0, averages: null, procedurePrices: {} as never },
    listedBy: "testimony",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await firestore.collection(COLLECTIONS.providers).doc(provider.placeId).set(provider);
  return provider;
}

/**
 * Writes a Testimony for a Provider, copying its Region and type as the posting
 * flow does, and returns it with its id. Defaults to published.
 */
export async function seedTestimony(
  firestore: Firestore,
  provider: Pick<ProviderFixture, "placeId" | "region" | "providerType">,
  overrides: Partial<TestimonyFixture> = {},
): Promise<TestimonyFixture & { id: string }> {
  sequence += 1;
  const now = new Date(Date.now() - (1000 - (sequence % 1000)) * 60_000);
  const testimony: TestimonyFixture = {
    placeId: provider.placeId,
    region: provider.region,
    providerType: provider.providerType,
    ratings: { service: 4, hygiene: 5, materialsEquipment: 4 },
    text: `Pengalaman fixture nomor ${sequence}: dokternya sabar dan menjelaskan biaya di awal.`,
    visitMonth: "2026-09",
    photoPaths: [],
    authorUid: `uid-fixture-${sequence}`,
    displayName: `Pasien ${sequence}`,
    status: "published",
    verifiedVisit: false,
    consent: { termsVersion: "2026-10", acceptedAt: now as never },
    authorFixRounds: 0,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    ...overrides,
  };
  const ref = await firestore.collection(COLLECTIONS.testimonies).add(testimony);
  return { ...testimony, id: ref.id };
}
