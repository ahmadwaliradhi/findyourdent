// Listed Provider page data (spec 02), first-party content only: the stored
// name, Region and type, aggregates, published Testimonies, price signals and
// owner facts. No Places call; the Google block loads in the browser (T10).
import {
  type AspectRatings,
  COLLECTIONS,
  type ProcedureCode,
  type ProviderDoc,
  type ProviderType,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import type { Firestore } from "firebase-admin/firestore";
import type { PublicPriceList } from "~/lib/price-lists";
import type { OwnerFacts } from "~/lib/provider";
import { regionLabel } from "~/lib/regions";
import type { PriceSignal } from "~/lib/shortlist";
import { jakartaDate } from "../../server/quota.ts";
import { currentPriceLists, publicPriceList } from "./price-lists.server.ts";
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
  /** Median price paid (two or more), with its source and date. */
  priceSignals: PriceSignal[];
  /** The owner's confirmed Price List, every row, second to prices paid (spec 05). */
  priceList?: PublicPriceList;
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
    ...(facts.services?.length ? { services: facts.services } : {}),
  };
  return Object.keys(owner).length > 0 ? owner : undefined;
}

/** Without a Guidance there is no Cost Estimate: the median price paid per procedure; the Price List is shown in full apart. */
function priceSignals(doc: ProviderDoc): PriceSignal[] {
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
  return signals;
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
  const priceList = (await currentPriceLists(firestore, [doc])).get(placeId);

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
      // Only the current claimant's reply: a revoked Claim's replies stop showing.
      ...(t.reply?.status === "published" && doc.claimStatus === "claimed" && t.reply.claimId === doc.claimId
        ? { reply: t.reply.text }
        : {}),
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
      priceSignals: priceSignals(doc),
      ...(priceList ? { priceList: publicPriceList(priceList) } : {}),
      ...(owner ? { owner } : {}),
      googleMapsUri: placeMapsUrl(doc.name, placeId),
    },
    testimonies,
  };
}
