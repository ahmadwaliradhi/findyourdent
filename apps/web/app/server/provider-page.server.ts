// Listed Provider page data (spec 02), first-party content only: the stored
// name, Region and type, aggregates, published Testimonies, price signals and
// owner facts. No Places call; the Google block loads in the browser (T10).
import {
  type AspectRatings,
  COLLECTIONS,
  type PriceListDoc,
  type ProcedureCode,
  type ProviderDoc,
  type ProviderType,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import type { Firestore } from "firebase-admin/firestore";
import type { OwnerFacts } from "~/lib/provider";
import { regionLabel } from "~/lib/regions";
import type { PriceSignal } from "~/lib/shortlist";
import { jakartaDate } from "../../server/quota.ts";
import { whatsappUri } from "./provider.server.ts";
import { placeMapsUrl } from "./shortlist.server.ts";

/** Published Testimonies shown on the page; older ones wait for pagination. */
export const PROVIDER_PAGE_TESTIMONY_LIMIT = 100;
/** A median price paid is shown only with at least this many Testimony prices (spec 02). */
const MIN_PRICES_FOR_MEDIAN = 2;

export interface ProviderSummary {
  placeId: string;
  name: string;
  area: string;
  providerType: ProviderType;
  providerTypeInferred: boolean;
  claimed: boolean;
  testimonyCount: number;
  verifiedVisitCount: number;
  averages: AspectRatings | null;
  /** Median price paid (two or more) and the owner's Price List, each with its source and date. */
  priceSignals: PriceSignal[];
  /** Owner facts from an approved Claim, once moderation published them. */
  owner?: OwnerFacts;
  /** Built without an API call, so the page always links to Google Maps. */
  googleMapsUri: string;
}

export interface PublicTestimony {
  id: string;
  displayName: string;
  ratings: AspectRatings;
  text: string;
  visitMonth: string;
  procedureCode?: ProcedureCode;
  pricePaidRupiah?: number;
  verifiedVisit: boolean;
  /** The claimed Provider's published reply. */
  reply?: string;
}

function ownerFacts(doc: ProviderDoc): OwnerFacts | undefined {
  const facts = doc.ownerFacts;
  if (doc.claimStatus !== "claimed" || facts?.moderationStatus !== "published") return undefined;
  const whatsapp = whatsappUri(facts.whatsapp);
  const owner: OwnerFacts = {
    ...(facts.address ? { address: facts.address } : {}),
    ...(facts.phone ? { phone: facts.phone } : {}),
    ...(whatsapp ? { whatsappUri: whatsapp } : {}),
    ...(facts.website ? { website: facts.website } : {}),
    ...(facts.openingHours ? { openingHours: facts.openingHours } : {}),
  };
  return Object.keys(owner).length > 0 ? owner : undefined;
}

/** Without a Guidance there is no Cost Estimate: median price paid, then the Price List, per procedure. */
function priceSignals(doc: ProviderDoc, priceList: PriceListDoc | undefined): PriceSignal[] {
  const signals: PriceSignal[] = [];
  for (const [code, paid] of Object.entries(doc.aggregates.procedurePrices)) {
    if (paid.count < MIN_PRICES_FOR_MEDIAN) continue;
    signals.push({
      procedureCode: code as ProcedureCode,
      source: "testimonies",
      minRupiah: paid.medianRupiah,
      maxRupiah: paid.medianRupiah,
      asOf: jakartaDate(doc.updatedAt.toMillis()),
    });
  }
  if (priceList) {
    for (const row of priceList.rows) {
      if (!row.procedureCode) continue;
      signals.push({
        procedureCode: row.procedureCode,
        source: "priceList",
        minRupiah: row.minRupiah,
        maxRupiah: row.maxRupiah,
        asOf: jakartaDate(priceList.confirmedAt.toMillis()),
      });
    }
  }
  return signals;
}

async function currentPriceList(firestore: Firestore, placeId: string): Promise<PriceListDoc | undefined> {
  const snapshot = await firestore
    .collection(COLLECTIONS.priceLists)
    .where("placeId", "==", placeId)
    .where("status", "==", "current")
    .limit(1)
    .get();
  return snapshot.docs[0]?.data() as PriceListDoc | undefined;
}

/** null when the place is not a Listed Provider. */
export async function loadProviderPage(
  firestore: Firestore,
  placeId: string,
): Promise<{ provider: ProviderSummary; testimonies: PublicTestimony[] } | null> {
  const [providerSnapshot, testimonySnapshot] = await Promise.all([
    firestore.collection(COLLECTIONS.providers).doc(placeId).get(),
    firestore
      .collection(COLLECTIONS.testimonies)
      .where("placeId", "==", placeId)
      .where("status", "==", "published")
      .orderBy("publishedAt", "desc")
      .limit(PROVIDER_PAGE_TESTIMONY_LIMIT)
      .get(),
  ]);
  if (!providerSnapshot.exists) return null;
  const doc = providerSnapshot.data() as ProviderDoc;
  const priceList = doc.claimStatus === "claimed" ? await currentPriceList(firestore, placeId) : undefined;

  const testimonies: PublicTestimony[] = testimonySnapshot.docs.map((snapshot) => {
    const t = snapshot.data() as TestimonyDoc;
    return {
      id: snapshot.id,
      displayName: t.displayName,
      ratings: t.ratings,
      text: t.text,
      visitMonth: t.visitMonth,
      procedureCode: t.procedureCode,
      pricePaidRupiah: t.pricePaidRupiah,
      verifiedVisit: t.verifiedVisit === true,
      ...(t.reply?.status === "published" ? { reply: t.reply.text } : {}),
    };
  });
  const owner = ownerFacts(doc);

  return {
    provider: {
      placeId,
      name: doc.name,
      area: regionLabel(doc.region),
      providerType: doc.providerType,
      providerTypeInferred: doc.providerTypeSource === "inferred",
      claimed: doc.claimStatus === "claimed",
      testimonyCount: doc.aggregates.testimonyCount,
      verifiedVisitCount: doc.aggregates.verifiedVisitCount,
      averages: doc.aggregates.averages,
      priceSignals: priceSignals(doc, priceList),
      ...(owner ? { owner } : {}),
      googleMapsUri: placeMapsUrl(doc.name, placeId),
    },
    testimonies,
  };
}
