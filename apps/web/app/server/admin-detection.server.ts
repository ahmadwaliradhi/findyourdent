// The admin's view of a detection hold (spec 09 part 2): the Provider's other Testimonies
// in the D1 window, the one most similar to it on a D2 hold, each one's similarity, and
// whether each account has written about any other Provider.
// Admin only: nothing here may reach an author's or the public's response.
import { COLLECTIONS, type DetectionRuleCode, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { LINKED_TEXT_PREVIEW_CHARS, type QueueDetection, type QueueSimilarTestimony } from "~/lib/admin-queue";
import { iso } from "./admin-common.server.ts";
import {
  DETECTION_LOOKBACK_MS,
  SIMILARITY_COMPARED_STATUSES,
  trigramSimilarity,
  VELOCITY_DAY_WINDOW_MS,
} from "./detection.ts";

export interface DetectionHold {
  id: string;
  testimony: TestimonyDoc;
  ruleCodes: DetectionRuleCode[];
}

function preview(text: string): string {
  return text.length > LINKED_TEXT_PREVIEW_CHARS ? `${text.slice(0, LINKED_TEXT_PREVIEW_CHARS - 1).trimEnd()}…` : text;
}

/**
 * Detection views by held Testimony id. One query per hold for its Provider's window, one
 * more per D2 hold for its Provider's published and held Testimonies, and one per distinct
 * author (across every hold) for the Providers they wrote about.
 */
export async function loadDetectionViews(
  firestore: Firestore,
  holds: readonly DetectionHold[],
): Promise<Map<string, QueueDetection>> {
  const testimonies = firestore.collection(COLLECTIONS.testimonies);
  const placesByAuthor = new Map<string, Promise<Set<string>>>();
  /** The Providers an account has a Testimony (not deleted) for. */
  const placesOf = (uid: string): Promise<Set<string>> => {
    let pending = placesByAuthor.get(uid);
    if (!pending) {
      pending = testimonies
        .where("authorUid", "==", uid)
        .get()
        .then(
          (snapshot) =>
            new Set(snapshot.docs.filter((doc) => doc.get("status") !== "deleted").map((doc) => doc.get("placeId"))),
        );
      placesByAuthor.set(uid, pending);
    }
    return pending;
  };
  const elsewhere = async (uid: string, placeId: string) => [...(await placesOf(uid))].some((id) => id !== placeId);

  /** D2: the Provider's published or held Testimony most similar to the held one now, if any. */
  const mostSimilar = async (heldId: string, held: TestimonyDoc): Promise<QueueSimilarTestimony | undefined> => {
    const comparable = await testimonies
      .where("placeId", "==", held.placeId)
      .where("status", "in", [...SIMILARITY_COMPARED_STATUSES])
      .get();
    let best: { id: string; testimony: TestimonyDoc; similarity: number } | undefined;
    for (const doc of comparable.docs) {
      if (doc.id === heldId) continue;
      const testimony = doc.data() as TestimonyDoc;
      const similarity = trigramSimilarity(held.text, testimony.text);
      if (!best || similarity > best.similarity) best = { id: doc.id, testimony, similarity };
    }
    if (!best) return undefined;
    return {
      id: best.id,
      displayName: best.testimony.displayName,
      status: best.testimony.status,
      createdAt: iso(best.testimony.createdAt),
      textPreview: preview(best.testimony.text),
      wroteAboutOtherProviders: await elsewhere(best.testimony.authorUid, held.placeId),
      similarity: best.similarity,
    };
  };

  const views = await Promise.all(
    holds.map(async ({ id, testimony, ruleCodes }): Promise<[string, QueueDetection]> => {
      const heldMs = testimony.createdAt.toMillis();
      const window = await testimonies
        .where("placeId", "==", testimony.placeId)
        .where("createdAt", ">", Timestamp.fromMillis(heldMs - DETECTION_LOOKBACK_MS))
        .where("createdAt", "<=", testimony.createdAt)
        .orderBy("createdAt")
        .get();
      const linked = window.docs
        .filter((doc) => doc.id !== id && doc.get("status") !== "deleted")
        .map((doc) => ({ id: doc.id, t: doc.data() as TestimonyDoc }));
      const [similar, [authorWroteAboutOtherProviders, ...flags]] = await Promise.all([
        ruleCodes.includes("D2") ? mostSimilar(id, testimony) : undefined,
        Promise.all([
          elsewhere(testimony.authorUid, testimony.placeId),
          ...linked.map(({ t }) => elsewhere(t.authorUid, testimony.placeId)),
        ]),
      ]);
      return [
        id,
        {
          ruleCodes,
          authorWroteAboutOtherProviders: authorWroteAboutOtherProviders === true,
          linked: linked.map(({ id: linkedId, t }, index) => ({
            id: linkedId,
            displayName: t.displayName,
            status: t.status,
            createdAt: iso(t.createdAt),
            withinDay: heldMs - t.createdAt.toMillis() < VELOCITY_DAY_WINDOW_MS,
            textPreview: preview(t.text),
            wroteAboutOtherProviders: flags[index] === true,
            similarity: trigramSimilarity(testimony.text, t.text),
          })),
          ...(similar ? { similar } : {}),
        },
      ];
    }),
  );
  return new Map(views);
}
