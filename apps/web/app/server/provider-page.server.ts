// Listed Provider page data (spec 02), first-party content only: the stored
// name, Region and type, aggregates and published Testimonies. No Places call.
import {
  type AspectRatings,
  COLLECTIONS,
  type ProcedureCode,
  type ProviderDoc,
  type ProviderType,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { regionLabel } from "~/lib/regions";

/** Published Testimonies shown on the page; older ones wait for pagination. */
export const PROVIDER_PAGE_TESTIMONY_LIMIT = 100;

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
    };
  });

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
    },
    testimonies,
  };
}
