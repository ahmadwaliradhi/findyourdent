// The admin's view of a detection hold (spec 09 part 2): the Provider's other Testimonies
// in the D1 window and whether each account has written about any other Provider.
// Admin only: nothing here may reach an author's or the public's response.
import {
  COLLECTIONS,
  type DetectionRuleCode,
  type SubmissionSignalDoc,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { LINKED_TEXT_PREVIEW_CHARS, type QueueDetection, type QueueSharedDeviceAccount } from "~/lib/admin-queue";
import { iso } from "./admin-common.server.ts";
import { DETECTION_LOOKBACK_MS, sharedDeviceLinks, VELOCITY_DAY_WINDOW_MS } from "./detection.ts";

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

  /** D1: the Provider's other Testimonies (not deleted) in the lookback window, oldest first. */
  const velocityLinked = async (id: string, testimony: TestimonyDoc, heldMs: number) => {
    const window = await testimonies
      .where("placeId", "==", testimony.placeId)
      .where("createdAt", ">", Timestamp.fromMillis(heldMs - DETECTION_LOOKBACK_MS))
      .where("createdAt", "<=", testimony.createdAt)
      .orderBy("createdAt")
      .get();
    return window.docs
      .filter((doc) => doc.id !== id && doc.get("status") !== "deleted")
      .map((doc) => ({ id: doc.id, t: doc.data() as TestimonyDoc }));
  };

  /**
   * D3: the other accounts' signals at the Provider that share the held Testimony's IP or
   * browser hash, oldest first. Nothing when the held Testimony's signal is gone (its TTL).
   */
  const sharedDevice = async (id: string, testimony: TestimonyDoc): Promise<QueueSharedDeviceAccount[]> => {
    const signals = firestore.collection(COLLECTIONS.submissionSignals);
    const [held, place] = await Promise.all([
      signals.doc(id).get(),
      signals.where("placeId", "==", testimony.placeId).get(),
    ]);
    if (!held.exists) return [];
    const mine = held.data() as SubmissionSignalDoc;
    const byTestimony = new Map(place.docs.map((doc) => [doc.id, doc.data() as SubmissionSignalDoc] as const));
    const links = sharedDeviceLinks(
      mine,
      place.docs
        .filter((doc) => doc.id !== id)
        .map((doc) => ({ ...(doc.data() as SubmissionSignalDoc), testimonyId: doc.id })),
      mine.authorUid,
    ).sort(
      (a, b) =>
        (byTestimony.get(a.testimonyId)?.createdAt.toMillis() ?? 0) -
        (byTestimony.get(b.testimonyId)?.createdAt.toMillis() ?? 0),
    );
    return Promise.all(
      links.map(async (link): Promise<QueueSharedDeviceAccount> => {
        const [linkedTestimony, wrote] = await Promise.all([
          testimonies.doc(link.testimonyId).get(),
          elsewhere(link.authorUid, testimony.placeId),
        ]);
        const t = linkedTestimony.data() as TestimonyDoc | undefined;
        return {
          testimonyId: link.testimonyId,
          displayName: t?.displayName ?? "",
          // A Testimony that is gone counts as deleted: its signal still links the account.
          status: t?.status ?? "deleted",
          sharedIp: link.sharedIp,
          sharedBrowser: link.sharedBrowser,
          wroteAboutOtherProviders: wrote,
        };
      }),
    );
  };

  const views = await Promise.all(
    holds.map(async ({ id, testimony, ruleCodes }): Promise<[string, QueueDetection]> => {
      const heldMs = testimony.createdAt.toMillis();
      const linked = ruleCodes.includes("D1") ? await velocityLinked(id, testimony, heldMs) : [];
      const [authorWroteAboutOtherProviders, ...flags] = await Promise.all([
        elsewhere(testimony.authorUid, testimony.placeId),
        ...linked.map(({ t }) => elsewhere(t.authorUid, testimony.placeId)),
      ]);
      const shared = ruleCodes.includes("D3") ? await sharedDevice(id, testimony) : undefined;
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
          ...(shared ? { sharedDevice: shared } : {}),
        },
      ];
    }),
  );
  return new Map(views);
}
