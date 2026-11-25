// Submission signals and D3 sharedDevice (spec 09 part 2) through the web API: each
// submission and edit stores salted hashes of the client IP and the browser id; another
// account's submission for the same Provider that shares either hash is held.
import type { ModerationDecision } from "@findyourdent/contracts";
import {
  COLLECTIONS,
  type ModerationDecisionDoc,
  type SubmissionSignalDoc,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminQueueResponse, QueueItem } from "../../app/lib/admin-queue.ts";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type { TestimonyStoredResponse, TestimonySubmission } from "../../app/lib/testimony.ts";
import { SUBMISSION_SIGNAL_TTL_MS } from "../../app/server/submission-signals.ts";
import { readBrowserState, writeBrowserState } from "../../server/browser-state.ts";
import { seedProvider } from "../support/fixtures.ts";
import { ADMIN_EMAILS, startTestServer, type TestServer } from "../support/harness.ts";

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

/** The standard held message (id), the same one a model error gets. */
const HELD_MESSAGE = "Terima kasih! Testimoni Anda sedang ditinjau tim FindYourDent, biasanya dalam 24 jam.";

/** The rule code as a word, so a random Firestore id that contains "D3" does not match. */
const RULE_CODE = /\bD3\b/;

const IP_A = "203.0.113.50";
const IP_B = "203.0.113.51";
const IP_C = "203.0.113.52";

const HOLD: ModerationDecision = {
  decision: "hold",
  ruleCodes: ["r2_accusation_as_fact"],
  flaggedSpans: [],
  confidence: 0.9,
  authorMessage: "Testimoni Anda ditinjau tim.",
};

const PHONE_TEXT = "Dokternya sabar. Hubungi saja 0812-3456-7890 untuk janji. Ruangannya bersih.";

function submission(placeId: string, overrides: Partial<TestimonySubmission> = {}): TestimonySubmission {
  return {
    placeId,
    ratings: { service: 5, hygiene: 4, materialsEquipment: 3 },
    text: "Dokternya sabar menjelaskan pilihan tambalan dan ruangannya bersih.",
    visitMonth: "2026-09",
    displayName: "Siti R.",
    consent: { honestExperience: true, noOthersPersonalData: true },
    ...overrides,
  };
}

let patients = 0;

/** A new signed-in Patient on a browser of their own (no earlier cookie). */
function newPatient(): Promise<string> {
  patients += 1;
  return server.signInWithGoogle(`pasien${patients}@example.com`);
}

/** A second Patient signing in on the browser that `cookie` belongs to. */
function patientOnSameBrowser(cookie: string): Promise<string> {
  patients += 1;
  return server.signInWithGoogle(`pasien${patients}@example.com`, { cookie });
}

function formOf(body: TestimonySubmission): FormData {
  const form = new FormData();
  form.set("testimony", JSON.stringify(body));
  return form;
}

/** `ip`: the client address as the app sees it (one trusted proxy hop); default: one per cookie. */
function headersOf(cookie: string, ip?: string): Headers {
  const headers = new Headers({ cookie, [APP_CHECK_HEADER]: server.appCheckToken() });
  if (ip) headers.set("x-forwarded-for", ip);
  return headers;
}

async function post(body: TestimonySubmission, cookie: string, ip?: string): Promise<Response> {
  return fetch(new URL("/api/testimonies", server.baseUrl), {
    method: "POST",
    headers: headersOf(cookie, ip),
    body: formOf(body),
  });
}

async function edit(testimonyId: string, body: TestimonySubmission, cookie: string, ip?: string): Promise<Response> {
  return fetch(new URL(`/api/testimonies/${testimonyId}`, server.baseUrl), {
    method: "POST",
    headers: headersOf(cookie, ip),
    body: formOf(body),
  });
}

async function remove(testimonyId: string, cookie: string): Promise<Response> {
  return fetch(new URL(`/api/testimonies/${testimonyId}`, server.baseUrl), {
    method: "DELETE",
    headers: headersOf(cookie),
  });
}

async function created(body: TestimonySubmission, cookie: string, ip?: string): Promise<TestimonyStoredResponse> {
  const response = await post(body, cookie, ip);
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as TestimonyStoredResponse;
}

/** Every signal of a Testimony (its submission and each stored edit), oldest first. */
async function signalsOf(testimonyId: string): Promise<SubmissionSignalDoc[]> {
  const snapshot = await server.firestore
    .collection(COLLECTIONS.submissionSignals)
    .where("testimonyId", "==", testimonyId)
    .get();
  return snapshot.docs
    .map((doc) => doc.data() as SubmissionSignalDoc)
    .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
}

/** The signal of a Testimony's submission. */
const signalOf = async (testimonyId: string) => (await signalsOf(testimonyId))[0];

async function testimony(id: string): Promise<TestimonyDoc> {
  return (await server.firestore.collection(COLLECTIONS.testimonies).doc(id).get()).data() as TestimonyDoc;
}

async function decisionOf(testimonyId: string): Promise<ModerationDecisionDoc> {
  const { moderationDecisionId } = await testimony(testimonyId);
  const snapshot = await server.firestore
    .collection(COLLECTIONS.moderationDecisions)
    .doc(moderationDecisionId ?? "")
    .get();
  return snapshot.data() as ModerationDecisionDoc;
}

describe("what is stored for each submission", () => {
  it("keeps only hashes, the place, the account and a 90-day expiry", async () => {
    const provider = await seedProvider(server.firestore);
    const cookie = await newPatient();
    const { bid } = await readBrowserState(cookie);
    expect(bid).toBeTruthy();

    const body = await created(submission(provider.placeId), cookie, IP_A);
    const signal = await signalOf(body.testimonyId);

    expect(signal).toBeDefined();
    expect(Object.keys(signal ?? {}).sort()).toEqual(
      ["authorUid", "browserIdHash", "createdAt", "expiresAt", "ipHash", "placeId", "testimonyId"].sort(),
    );
    expect(signal?.testimonyId).toBe(body.testimonyId);
    expect(signal?.placeId).toBe(provider.placeId);
    expect(signal?.authorUid).toBe((await testimony(body.testimonyId)).authorUid);
    expect(signal?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(signal?.browserIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(signal?.ipHash).not.toBe(signal?.browserIdHash);

    const json = JSON.stringify(signal);
    expect(json).not.toContain(IP_A);
    expect(json).not.toContain(bid as string);
    // Nor in the log lines.
    for (const line of server.logs) {
      expect(line).not.toContain(IP_A);
      expect(line).not.toContain(bid as string);
    }

    const created_ = signal?.createdAt.toMillis() ?? 0;
    expect((signal?.expiresAt.toMillis() ?? 0) - created_).toBe(SUBMISSION_SIGNAL_TTL_MS);
    expect(Math.abs(created_ - Date.now())).toBeLessThan(60_000);
  });

  it("hashes the same IP the same way on another submission, and another IP differently", async () => {
    const one = await seedProvider(server.firestore);
    const two = await seedProvider(server.firestore);
    const cookie = await newPatient();
    const first = await created(submission(one.placeId), cookie, IP_A);
    const second = await created(submission(two.placeId), cookie, IP_A);
    const third = await created(submission(await seedProvider(server.firestore).then((p) => p.placeId)), cookie, IP_B);
    const [a, b, c] = await Promise.all([first, second, third].map((body) => signalOf(body.testimonyId)));
    expect(a?.ipHash).toBe(b?.ipHash);
    expect(a?.browserIdHash).toBe(b?.browserIdHash);
    expect(c?.ipHash).not.toBe(a?.ipHash);
    expect(c?.browserIdHash).toBe(a?.browserIdHash);
  });

  it("is written for a Testimony Moderation holds, which D3 does not touch", async () => {
    const provider = await seedProvider(server.firestore);
    server.fakes.agent.respondToModerationWith(HOLD);
    const body = await created(submission(provider.placeId), await newPatient(), IP_A);
    expect(body.status).toBe("held");
    expect(await signalOf(body.testimonyId)).toBeDefined();
  });

  it("stores nothing when the answer is authorFix", async () => {
    const provider = await seedProvider(server.firestore);
    const response = await post(submission(provider.placeId, { text: PHONE_TEXT }), await newPatient(), IP_A);
    expect(response.status).toBe(200);
    const count = await server.firestore.collection(COLLECTIONS.submissionSignals).count().get();
    expect(count.data().count).toBe(0);
  });

  it("is not readable through the public API", async () => {
    const provider = await seedProvider(server.firestore);
    const cookie = await newPatient();
    const body = await created(submission(provider.placeId), cookie, IP_A);
    const signal = await signalOf(body.testimonyId);
    const page = await fetch(new URL("/testimoni-saya", server.baseUrl), { headers: { cookie } });
    const html = await page.text();
    expect(html).not.toContain(signal?.ipHash as string);
    expect(html).not.toContain(signal?.browserIdHash as string);
  });
});

describe("the browser id", () => {
  it("is minted at sign-in and kept when another account signs in on the same browser", async () => {
    const first = await newPatient();
    const second = await patientOnSameBrowser(first);
    const one = await readBrowserState(first);
    const two = await readBrowserState(second);
    expect(one.bid).toBeTruthy();
    expect(two.bid).toBe(one.bid);
    expect(two.auth).not.toBe(one.auth);
  });

  it("is different on another browser", async () => {
    const one = await readBrowserState(await newPatient());
    const two = await readBrowserState(await newPatient());
    expect(one.bid).not.toBe(two.bid);
  });

  it("is minted at submission for a cookie that has none, and set on the response", async () => {
    const provider = await seedProvider(server.firestore);
    const signedIn = await newPatient();
    const old = (await writeBrowserState({ auth: (await readBrowserState(signedIn)).auth })).split(";")[0] as string;
    expect((await readBrowserState(old)).bid).toBeUndefined();

    const response = await post(submission(provider.placeId), old, IP_A);
    expect(response.status).toBe(201);
    const body = (await response.json()) as TestimonyStoredResponse;
    const setCookie = response.headers.getSetCookie().map((line) => line.split(";")[0] as string);
    expect(setCookie).toHaveLength(1);
    const minted = await readBrowserState(setCookie[0]);
    expect(minted.bid).toBeTruthy();
    expect(minted.auth).toBe((await readBrowserState(old)).auth);
    expect((await signalOf(body.testimonyId))?.browserIdHash).toMatch(/^[0-9a-f]{64}$/);

    // The cookie the browser now has sends the same id on the next submission.
    const next = await seedProvider(server.firestore);
    const again = await created(submission(next.placeId), setCookie[0] as string, IP_A);
    expect((await signalOf(again.testimonyId))?.browserIdHash).toBe((await signalOf(body.testimonyId))?.browserIdHash);
  });

  it("sets no cookie on a submission that already has one", async () => {
    const provider = await seedProvider(server.firestore);
    const response = await post(submission(provider.placeId), await newPatient(), IP_A);
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

/** Marks every signal of a Testimony as expired, as if its TTL had passed but the delete had not run. */
async function expireSignalsOf(testimonyId: string): Promise<void> {
  const snapshot = await server.firestore
    .collection(COLLECTIONS.submissionSignals)
    .where("testimonyId", "==", testimonyId)
    .get();
  expect(snapshot.size).toBeGreaterThan(0);
  await Promise.all(snapshot.docs.map((doc) => doc.ref.update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) })));
}

describe("D3 sharedDevice", () => {
  it("does not count another account's signal that has expired but is not deleted yet", async () => {
    const provider = await seedProvider(server.firestore);
    const first = await created(submission(provider.placeId), await newPatient(), IP_A);
    await expireSignalsOf(first.testimonyId);

    const body = await created(submission(provider.placeId), await newPatient(), IP_A);
    expect(body.status).toBe("published");
    expect((await decisionOf(body.testimonyId)).detectionRuleCodes).toBeUndefined();
  });

  it("holds another account on the same IP from a different browser", async () => {
    const provider = await seedProvider(server.firestore);
    const first = await created(submission(provider.placeId), await newPatient(), IP_A);
    expect(first.status).toBe("published");

    const response = await post(submission(provider.placeId), await newPatient(), IP_A);
    expect(response.status).toBe(201);
    const raw = await response.text();
    expect(raw).not.toMatch(RULE_CODE);
    const body = JSON.parse(raw) as TestimonyStoredResponse;
    expect(body.status).toBe("held");
    expect(body.message).toBe(HELD_MESSAGE);

    expect((await testimony(body.testimonyId)).status).toBe("held");
    expect((await testimony(body.testimonyId)).publishedAt).toBeUndefined();
    const decision = await decisionOf(body.testimonyId);
    expect(decision.decision).toBe("hold");
    expect(decision.detectionRuleCodes).toEqual(["D3"]);
    expect(decision.ruleCodes).toEqual([]);
    expect(server.logs.some((line) => line.includes('"held_by_detection"'))).toBe(true);
    // The held one's own signal is stored too, so a third account on the device is held.
    expect(await signalOf(body.testimonyId)).toBeDefined();
  });

  it("holds another account on the same browser from a different IP", async () => {
    const provider = await seedProvider(server.firestore);
    const cookie = await newPatient();
    expect((await created(submission(provider.placeId), cookie, IP_A)).status).toBe("published");

    // The same browser, a second Google account, on mobile data.
    const second = await patientOnSameBrowser(cookie);
    const body = await created(submission(provider.placeId), second, IP_B);
    expect(body.status).toBe("held");
    expect(body.message).toBe(HELD_MESSAGE);
    expect((await decisionOf(body.testimonyId)).detectionRuleCodes).toEqual(["D3"]);
  });

  it("publishes another account on a different IP and browser", async () => {
    const provider = await seedProvider(server.firestore);
    expect((await created(submission(provider.placeId), await newPatient(), IP_A)).status).toBe("published");
    const body = await created(submission(provider.placeId), await newPatient(), IP_B);
    expect(body.status).toBe("published");
    expect((await decisionOf(body.testimonyId)).detectionRuleCodes).toBeUndefined();
  });

  it("does not hold on a shared device at another Provider", async () => {
    const one = await seedProvider(server.firestore);
    const two = await seedProvider(server.firestore);
    await created(submission(one.placeId), await newPatient(), IP_A);
    const body = await created(submission(two.placeId), await newPatient(), IP_A);
    expect(body.status).toBe("published");
  });

  it("still counts the signal of a Testimony its author deleted", async () => {
    const provider = await seedProvider(server.firestore);
    const cookie = await newPatient();
    const first = await created(submission(provider.placeId), cookie, IP_A);
    expect((await remove(first.testimonyId, cookie)).status).toBe(200);
    expect(await signalOf(first.testimonyId)).toBeDefined();

    const body = await created(submission(provider.placeId), await newPatient(), IP_A);
    expect(body.status).toBe("held");
    expect((await decisionOf(body.testimonyId)).detectionRuleCodes).toEqual(["D3"]);
  });

  it("does not count the author's own deleted Testimony against a new one from the same device", async () => {
    const provider = await seedProvider(server.firestore);
    const cookie = await newPatient();
    const first = await created(submission(provider.placeId), cookie, IP_A);
    expect((await remove(first.testimonyId, cookie)).status).toBe(200);
    const again = await created(submission(provider.placeId), cookie, IP_A);
    expect(again.status).toBe("published");
  });

  it("leaves a Moderation hold as Moderation decided, without D3", async () => {
    const provider = await seedProvider(server.firestore);
    await created(submission(provider.placeId), await newPatient(), IP_A);
    server.fakes.agent.respondToModerationWith(HOLD);
    const body = await created(submission(provider.placeId), await newPatient(), IP_A);
    expect(body.status).toBe("held");
    const decision = await decisionOf(body.testimonyId);
    expect(decision.ruleCodes).toEqual(["r2_accusation_as_fact"]);
    expect(decision.detectionRuleCodes).toBeUndefined();
  });

  it("lists D1 then D3 when a burst also shares a device", async () => {
    const provider = await seedProvider(server.firestore);
    await created(submission(provider.placeId), await newPatient(), IP_A);
    await created(submission(provider.placeId), await newPatient(), IP_B);
    const body = await created(submission(provider.placeId), await newPatient(), IP_A);
    expect(body.status).toBe("held");
    expect((await decisionOf(body.testimonyId)).detectionRuleCodes).toEqual(["D1", "D3"]);
  });
});

describe("the same account", () => {
  it("is not held for editing from the same device, and the edit adds a second signal", async () => {
    const provider = await seedProvider(server.firestore);
    const cookie = await newPatient();
    const first = await created(submission(provider.placeId), cookie, IP_A);
    const [before] = await signalsOf(first.testimonyId);

    const response = await edit(
      first.testimonyId,
      submission(provider.placeId, {
        text: "Dokternya sabar, tambalannya rapi dan ruangannya bersih.",
      }),
      cookie,
      IP_A,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as TestimonyStoredResponse;
    expect(body.status).toBe("published");
    expect((await decisionOf(first.testimonyId)).detectionRuleCodes).toBeUndefined();

    const signals = await signalsOf(first.testimonyId);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toEqual(before);
    expect(signals[1]?.ipHash).toBe(before?.ipHash);
    expect(signals[1]?.browserIdHash).toBe(before?.browserIdHash);
    expect(signals[1]?.expiresAt.toMillis()).toBeGreaterThanOrEqual(before?.expiresAt.toMillis() ?? 0);
  });

  it("keeps the submission's signal when an edit comes from another device", async () => {
    const provider = await seedProvider(server.firestore);
    const cookie = await newPatient();
    const first = await created(submission(provider.placeId), cookie, IP_A);
    const [before] = await signalsOf(first.testimonyId);

    const response = await edit(first.testimonyId, submission(provider.placeId), cookie, IP_C);
    expect(response.status).toBe(200);
    const signals = await signalsOf(first.testimonyId);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toEqual(before);
    expect(signals[1]?.ipHash).not.toBe(before?.ipHash);
    expect(signals[1]?.browserIdHash).toBe(before?.browserIdHash);
  });

  it("cannot erase the match by editing from a new device", async () => {
    const provider = await seedProvider(server.firestore);
    const cookieA = await newPatient();
    const first = await created(submission(provider.placeId, { displayName: "Budi S." }), cookieA, IP_A);
    expect((await edit(first.testimonyId, submission(provider.placeId), cookieA, IP_C)).status).toBe(200);

    // Another account on the device A first used is still held.
    const held = await created(submission(provider.placeId), await newPatient(), IP_A);
    expect(held.status).toBe("held");
    expect((await decisionOf(held.testimonyId)).detectionRuleCodes).toEqual(["D3"]);

    // The queue lists A once, with the network of the submission.
    const links = (await queueItemOf(held.testimonyId))?.detection?.sharedDevice;
    expect(links).toEqual([expect.objectContaining({ testimonyId: first.testimonyId, sharedIp: true })]);
  });

  it("mints and sets a browser id when an edit comes from a cookie that has none", async () => {
    const provider = await seedProvider(server.firestore);
    const cookie = await newPatient();
    const first = await created(submission(provider.placeId), cookie, IP_A);
    const old = (await writeBrowserState({ auth: (await readBrowserState(cookie)).auth })).split(";")[0] as string;

    const response = await edit(first.testimonyId, submission(provider.placeId), old, IP_A);
    expect(response.status).toBe(200);
    const setCookie = response.headers.getSetCookie().map((line) => line.split(";")[0] as string);
    expect((await readBrowserState(setCookie[0])).bid).toBeTruthy();
  });

  it("writes no signal for an edit answered with authorFix", async () => {
    const provider = await seedProvider(server.firestore);
    const cookie = await newPatient();
    const first = await created(submission(provider.placeId), cookie, IP_A);
    const before = await signalOf(first.testimonyId);
    const response = await edit(first.testimonyId, submission(provider.placeId, { text: PHONE_TEXT }), cookie, IP_C);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe("needsAuthorFix");
    expect(await signalsOf(first.testimonyId)).toEqual([before]);
  });
});

describe("D3 hold: the author edits", () => {
  async function d3Hold() {
    const provider = await seedProvider(server.firestore);
    await created(submission(provider.placeId), await newPatient(), IP_A);
    const cookie = await newPatient();
    const held = await created(submission(provider.placeId), cookie, IP_A);
    expect(held.status).toBe("held");
    return { provider, cookie, testimonyId: held.testimonyId };
  }

  it("keeps D3 when the edit is still held, without showing it", async () => {
    const { provider, cookie, testimonyId } = await d3Hold();
    const response = await edit(
      testimonyId,
      submission(provider.placeId, {
        text: "Dokternya sabar, tambalannya rapi dan ruangannya bersih.",
      }),
      cookie,
      IP_A,
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toMatch(RULE_CODE);
    expect((JSON.parse(raw) as TestimonyStoredResponse).status).toBe("held");
    expect(await decisionOf(testimonyId)).toMatchObject({
      decision: "hold",
      detectionRuleCodes: ["D3"],
    });
  });

  it("keeps D3 when Moderation holds the edit for its own reasons", async () => {
    const { provider, cookie, testimonyId } = await d3Hold();
    server.fakes.agent.respondToModerationWith(HOLD);
    const response = await edit(testimonyId, submission(provider.placeId), cookie, IP_A);
    expect(response.status).toBe(200);
    expect(await decisionOf(testimonyId)).toMatchObject({
      ruleCodes: ["r2_accusation_as_fact"],
      detectionRuleCodes: ["D3"],
    });
  });
});

// Admin queue: the accounts linked by a D3 hold ----------------------------------------

async function queueItemOf(testimonyId: string): Promise<QueueItem | undefined> {
  const cookie = await server.signInWithGoogle(ADMIN_EMAILS[0] as string);
  const response = await server.get("/admin/api/queue", { headers: { cookie } });
  if (response.status !== 200) throw new Error(`queue failed: ${response.status} ${await response.text()}`);
  const queue = (await response.json()) as AdminQueueResponse;
  return queue.items.find((item) => item.kind === "held" && item.subjectId === testimonyId);
}

describe("admin queue: a D3 hold", () => {
  it("lists the other account on the same browser, without the same network", async () => {
    const provider = await seedProvider(server.firestore);
    const cookie = await newPatient();
    const first = await created(submission(provider.placeId, { displayName: "Budi S." }), cookie, IP_A);
    const held = await created(
      submission(provider.placeId, { displayName: "Citra W." }),
      await patientOnSameBrowser(cookie),
      IP_B,
    );

    const detection = (await queueItemOf(held.testimonyId))?.detection;
    expect(detection?.ruleCodes).toEqual(["D3"]);
    expect(detection?.sharedDevice).toEqual([
      {
        testimonyId: first.testimonyId,
        displayName: "Budi S.",
        status: "published",
        sharedIp: false,
        sharedBrowser: true,
        wroteAboutOtherProviders: false,
      },
    ]);
    expect(detection?.linked).toEqual([]);
  });

  it("lists the other account on the same network, without the same browser", async () => {
    const provider = await seedProvider(server.firestore);
    const first = await created(submission(provider.placeId), await newPatient(), IP_A);
    const held = await created(submission(provider.placeId), await newPatient(), IP_A);

    const detection = (await queueItemOf(held.testimonyId))?.detection;
    expect(detection?.sharedDevice).toEqual([
      expect.objectContaining({
        testimonyId: first.testimonyId,
        sharedIp: true,
        sharedBrowser: false,
      }),
    ]);
  });

  it("says whether the linked account wrote about another Provider", async () => {
    const provider = await seedProvider(server.firestore);
    const elsewhere = await seedProvider(server.firestore);
    const cookie = await newPatient();
    await created(submission(elsewhere.placeId), cookie, IP_A);
    await created(submission(provider.placeId), cookie, IP_A);
    const held = await created(submission(provider.placeId), await newPatient(), IP_A);

    const links = (await queueItemOf(held.testimonyId))?.detection?.sharedDevice ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]?.wroteAboutOtherProviders).toBe(true);
  });

  it("still lists a linked account whose Testimony was deleted, as deleted", async () => {
    const provider = await seedProvider(server.firestore);
    const cookie = await newPatient();
    const first = await created(submission(provider.placeId), cookie, IP_A);
    expect((await remove(first.testimonyId, cookie)).status).toBe(200);
    const held = await created(submission(provider.placeId), await newPatient(), IP_A);

    const links = (await queueItemOf(held.testimonyId))?.detection?.sharedDevice;
    expect(links).toEqual([expect.objectContaining({ testimonyId: first.testimonyId, status: "deleted" })]);
  });

  it("shows an empty list, not an error, when the held Testimony's signal has expired", async () => {
    const provider = await seedProvider(server.firestore);
    await created(submission(provider.placeId), await newPatient(), IP_A);
    const held = await created(submission(provider.placeId), await newPatient(), IP_A);
    const own = await server.firestore
      .collection(COLLECTIONS.submissionSignals)
      .where("testimonyId", "==", held.testimonyId)
      .get();
    await Promise.all(own.docs.map((doc) => doc.ref.delete()));

    const detection = (await queueItemOf(held.testimonyId))?.detection;
    expect(detection?.ruleCodes).toEqual(["D3"]);
    expect(detection?.sharedDevice).toEqual([]);
  });

  it("does not list a linked account whose signals have expired but are not deleted yet", async () => {
    const provider = await seedProvider(server.firestore);
    const first = await created(submission(provider.placeId), await newPatient(), IP_A);
    const held = await created(submission(provider.placeId), await newPatient(), IP_A);
    expect((await queueItemOf(held.testimonyId))?.detection?.sharedDevice).toHaveLength(1);

    await expireSignalsOf(first.testimonyId);
    expect((await queueItemOf(held.testimonyId))?.detection?.sharedDevice).toEqual([]);
  });

  it("lists linked accounts by when they first submitted, one row each, even after an edit", async () => {
    const provider = await seedProvider(server.firestore);
    const cookieA = await newPatient();
    const first = await created(submission(provider.placeId, { displayName: "Budi S." }), cookieA, IP_A);
    const second = await created(submission(provider.placeId, { displayName: "Citra W." }), await newPatient(), IP_A);
    expect(second.status).toBe("held");
    // A edits last, from the same network: A still came first.
    expect((await edit(first.testimonyId, submission(provider.placeId), cookieA, IP_A)).status).toBe(200);
    const held = await created(submission(provider.placeId), await newPatient(), IP_A);

    const links = (await queueItemOf(held.testimonyId))?.detection?.sharedDevice ?? [];
    expect(links.map((link) => link.testimonyId)).toEqual([first.testimonyId, second.testimonyId]);
  });

  it("matches a linked account through any signal of the held Testimony", async () => {
    const provider = await seedProvider(server.firestore);
    const first = await created(submission(provider.placeId, { displayName: "Budi S." }), await newPatient(), IP_A);
    // The held one's submission shares nothing with A, but its author later edits from A's network.
    const second = await created(submission(provider.placeId), await newPatient(), IP_B);
    const cookie = await newPatient();
    const held = await created(submission(provider.placeId, { displayName: "Citra W." }), cookie, IP_A);
    expect(second.status).toBe("published");
    expect(held.status).toBe("held");
    expect((await edit(held.testimonyId, submission(provider.placeId), cookie, IP_B)).status).toBe(200);

    const links = (await queueItemOf(held.testimonyId))?.detection?.sharedDevice ?? [];
    expect(links.map((link) => link.testimonyId).sort()).toEqual([first.testimonyId, second.testimonyId].sort());
  });

  it("shows the velocity list and the linked accounts when D1 and D3 both hold", async () => {
    const provider = await seedProvider(server.firestore);
    await created(submission(provider.placeId), await newPatient(), IP_A);
    await created(submission(provider.placeId), await newPatient(), IP_B);
    const held = await created(submission(provider.placeId), await newPatient(), IP_A);

    const detection = (await queueItemOf(held.testimonyId))?.detection;
    expect(detection?.ruleCodes).toEqual(["D1", "D3"]);
    expect(detection?.linked).toHaveLength(2);
    expect(detection?.sharedDevice).toHaveLength(1);
  });

  it("sends no hash to the page, and nothing about it to the author", async () => {
    const provider = await seedProvider(server.firestore);
    const first = await created(submission(provider.placeId, { displayName: "Budi S." }), await newPatient(), IP_A);
    const cookie = await newPatient();
    const held = await created(submission(provider.placeId, { displayName: "Citra W." }), cookie, IP_A);

    const adminCookie = await server.signInWithGoogle(ADMIN_EMAILS[0] as string);
    const raw = await (await server.get("/admin/api/queue", { headers: { cookie: adminCookie } })).text();
    for (const id of [first.testimonyId, held.testimonyId]) {
      const signal = await signalOf(id);
      expect(raw).not.toContain(signal?.ipHash as string);
      expect(raw).not.toContain(signal?.browserIdHash as string);
    }

    const asAuthor = await server.get("/admin/api/queue", { headers: { cookie } });
    expect(asAuthor.status).toBe(403);
    const mine = await fetch(new URL("/testimoni-saya", server.baseUrl), { headers: { cookie } });
    const html = await mine.text();
    expect(html).not.toContain("Budi S.");
    expect(html).not.toMatch(RULE_CODE);
  });
});
