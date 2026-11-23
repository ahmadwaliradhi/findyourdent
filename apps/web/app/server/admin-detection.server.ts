// The admin's view of a detection hold (spec 09 part 2): the Provider's other Testimonies
// in the D1 window and whether each account has written about any other Provider.
// Admin only: nothing here may reach an author's or the public's response.
import { COLLECTIONS, type DetectionRuleCode, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { LINKED_TEXT_PREVIEW_CHARS, type QueueDetection } from "~/lib/admin-queue";
import { iso } from "./admin-common.server.ts";
import { DETECTION_LOOKBACK_MS, VELOCITY_DAY_WINDOW_MS } from "./detection.ts";

export interface DetectionHold {
  id: string;
  testimony: TestimonyDoc;
  ruleCodes: DetectionRuleCode[];
}

function preview(text: string): string {
  return text.length > LINKED_TEXT_PREVIEW_CHARS ? `${text.slice(0, LINKED_TEXT_PREVIEW_CHARS - 1).trimEnd()}…` : text;
}

/**
 * Detection views by held Testimony id. One query per hold for its Provider's window and
 * one per distinct author (across every hold) for the Providers they wrote about.
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
      const [authorWroteAboutOtherProviders, ...flags] = await Promise.all([
        elsewhere(testimony.authorUid, testimony.placeId),
        ...linked.map(({ t }) => elsewhere(t.authorUid, testimony.placeId)),
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
          })),
        },
      ];
    }),
  );
  return new Map(views);
}
