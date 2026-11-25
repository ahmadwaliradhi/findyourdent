// Submission signals in Firestore (spec 09 part 2): the device behind a Testimony
// submission or edit, written in the transaction that stores it and read by detection (D3).
// The hashing is in submission-signals.ts; only hashes are stored or logged.
import { COLLECTIONS, type SubmissionSignalDoc } from "@findyourdent/contracts/firestore";
import { type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import { newBrowserId, readBrowserState, updateBrowserState } from "../../server/browser-state.ts";
import type { OtherSignal } from "./detection.ts";
import { type SubmissionSignalHashes, signalExpiresAtMs, submissionSignalHashes } from "./submission-signals.ts";

/** The device behind one request: its hashes, and a Set-Cookie when its browser id is new. */
export interface SubmissionDevice {
  hashes: SubmissionSignalHashes;
  /** Set only when the cookie had no browser id (it predates it): the success response sends this. */
  setCookie?: string;
}

/**
 * The hashes of the request's client IP and browser id. A cookie without a browser id gets
 * one minted here, so the signal has one and the browser keeps it from now on.
 */
export async function submissionDevice(context: AppLoadContext, request: Request): Promise<SubmissionDevice> {
  const cookieHeader = request.headers.get("cookie");
  const existing = (await readBrowserState(cookieHeader)).bid;
  const browserId = existing ?? newBrowserId();
  // An address that is not known must never match another one.
  const known = context.clientIp && context.clientIp !== "unknown";
  const ip = known ? context.clientIp : `unknown:${crypto.randomUUID()}`;
  return {
    hashes: submissionSignalHashes(context.config.signalSalt, { ip, browserId }),
    ...(existing ? {} : { setCookie: await updateBrowserState(cookieHeader, { bid: browserId }) }),
  };
}

const signals = (firestore: Firestore) => firestore.collection(COLLECTIONS.submissionSignals);

/**
 * Every signal for the Provider, as a transaction read (so before any write). Signals of
 * deleted Testimonies count too: a buzzer may delete. The TTL bounds the set.
 */
export async function readPlaceSignals(tx: Transaction, firestore: Firestore, placeId: string): Promise<OtherSignal[]> {
  const snapshot = await tx.get(signals(firestore).where("placeId", "==", placeId));
  return snapshot.docs.map((doc) => {
    const { authorUid, ipHash, browserIdHash } = doc.data() as SubmissionSignalDoc;
    return { authorUid, ipHash, browserIdHash };
  });
}

/**
 * Writes the signal for a stored submission or edit, keyed by Testimony: an edit
 * overwrites it with the edit's device and a fresh 90 days.
 */
export function writeSubmissionSignal(
  tx: Transaction,
  firestore: Firestore,
  input: {
    testimonyId: string;
    placeId: string;
    authorUid: string;
    hashes: SubmissionSignalHashes;
  },
): void {
  const nowMs = Date.now();
  const doc: SubmissionSignalDoc = {
    testimonyId: input.testimonyId,
    placeId: input.placeId,
    authorUid: input.authorUid,
    ...input.hashes,
    createdAt: Timestamp.fromMillis(nowMs),
    expiresAt: Timestamp.fromMillis(signalExpiresAtMs(nowMs)),
  };
  tx.set(signals(firestore).doc(input.testimonyId), doc);
}
