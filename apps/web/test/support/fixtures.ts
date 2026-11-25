// Emulator fixture data that follows the Firestore data model (packages/contracts/src/firestore.ts).
import { COLLECTIONS, type ProviderDoc, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { normalizeName } from "../../app/lib/normalize-name.ts";
import { DETECTION_LOOKBACK_MS } from "../../app/server/detection.ts";

type Writable<T> = {
  [K in keyof T]: NonNullable<T[K]> extends { toDate(): Date } ? Date | Extract<T[K], undefined> : T[K];
};
export type ProviderFixture = Writable<ProviderDoc>;
export type TestimonyFixture = Writable<TestimonyDoc>;

let sequence = 0;

/** The app's own name normalisation, so fixtures match what the directory searches. */
export const normalizeForFixture = normalizeName;

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

/**
 * Moves a stored Testimony's submission out of the detection window (spec 09 part 2), as
 * if it had come in weeks ago. For tests that post several Testimonies for one Provider
 * through the API and are not about bursts: without it the third would be held.
 */
export async function submittedBeforeDetectionWindow(firestore: Firestore, testimonyId: string): Promise<void> {
  const DAY_MS = 24 * 60 * 60 * 1000;
  await firestore
    .collection(COLLECTIONS.testimonies)
    .doc(testimonyId)
    .update({ createdAt: new Date(Date.now() - DETECTION_LOOKBACK_MS - DAY_MS) });
}

/**
 * Testimony texts no two of which are near-duplicates under D2 similarity (spec 09 part 2).
 * For tests that post several Testimonies for one Provider through the API and are not
 * about templates: the same text twice would be held.
 */
export const DISTINCT_TESTIMONY_TEXTS = [
  "Dokternya sabar menjelaskan pilihan tambalan dan ruangannya bersih.",
  "Antrean cukup lama, tapi perawatnya ramah dan biaya dijelaskan di awal.",
  "Scaling di sini cepat; gusi saya tidak berdarah lagi setelah dua minggu.",
  "Parkir sempit sekali. Untung resepsionis membantu mengatur jadwal ulang.",
  "Anak saya takut ke dokter gigi, namun drg. yang menangani pandai membujuk.",
  "Harga cabut geraham bungsu wajar, kontrol pascaoperasi pun gratis.",
  "Kursi periksa nyaman, alat tampak steril, ada TV kecil di langit-langit.",
  "Pemasangan behel rapi; tiap bulan kawat diganti tanpa biaya tambahan.",
] as const;

/** Each sentence alone, then each pair: 36 texts, none above 0.6 similar to another. */
const DISTINCT_TEXTS: readonly string[] = [
  ...DISTINCT_TESTIMONY_TEXTS,
  ...DISTINCT_TESTIMONY_TEXTS.flatMap((first, i) =>
    DISTINCT_TESTIMONY_TEXTS.slice(i + 1).map((second) => `${first} ${second}`),
  ),
];

/** The nth distinct text, cycling after 36: keep a test's posts for one Provider below that. */
export function distinctTestimonyText(n: number): string {
  return DISTINCT_TEXTS[n % DISTINCT_TEXTS.length] as string;
}
