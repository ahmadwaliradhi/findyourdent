// Detection at submission (spec 09 part 2) through the web API: D1 velocity holds a
// burst of Testimonies for one Provider. Detection only turns Moderation's publish into
// hold, the author reads the standard held message, and the rule code is admin-only.
import type { ModerationDecision } from "@findyourdent/contracts";
import {
  COLLECTIONS,
  type ModerationDecisionDoc,
  type ProviderDoc,
  type TestimonyDoc,
} from "@findyourdent/contracts/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type AdminActionRequest,
  type AdminQueueResponse,
  LINKED_TEXT_PREVIEW_CHARS,
  type QueueItem,
} from "../../app/lib/admin-queue.ts";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type { TestimonyStoredResponse, TestimonySubmission } from "../../app/lib/testimony.ts";
import { VELOCITY_DAY_THRESHOLD } from "../../app/server/detection.ts";
import { type ProviderFixture, seedProvider, seedTestimony, type TestimonyFixture } from "../support/fixtures.ts";
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

/**
 * The rule code as a word. A bare substring check would also match a random Firestore
 * id (testimonyId, links) that happens to contain "D1".
 */
const RULE_CODE = /\bD1\b/;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);

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

/** A new signed-in Patient's cookie (one Testimony per Patient per Provider). */
function newPatient(): Promise<string> {
  patients += 1;
  return server.signInWithGoogle(`pasien${patients}@example.com`);
}

async function post(body: TestimonySubmission, cookie?: string): Promise<Response> {
  cookie ??= await newPatient();
  const form = new FormData();
  form.set("testimony", JSON.stringify(body));
  const headers = new Headers({ cookie, [APP_CHECK_HEADER]: server.appCheckToken() });
  return fetch(new URL("/api/testimonies", server.baseUrl), { method: "POST", headers, body: form });
}

/** The author edits their Testimony. */
async function edit(testimonyId: string, body: TestimonySubmission, cookie: string): Promise<Response> {
  const form = new FormData();
  form.set("testimony", JSON.stringify(body));
  const headers = new Headers({ cookie, [APP_CHECK_HEADER]: server.appCheckToken() });
  return fetch(new URL(`/api/testimonies/${testimonyId}`, server.baseUrl), { method: "POST", headers, body: form });
}

async function postOk(body: TestimonySubmission): Promise<TestimonyStoredResponse> {
  const response = await post(body);
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as TestimonyStoredResponse;
}

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

async function aggregates(placeId: string) {
  const snapshot = await server.firestore.collection(COLLECTIONS.providers).doc(placeId).get();
  return (snapshot.data() as ProviderDoc).aggregates;
}

/** Seeds one Testimony for the Provider per age, each submitted that long ago. */
async function seedSubmitted(provider: ProviderFixture, ages: number[], overrides: Partial<TestimonyFixture> = {}) {
  for (const age of ages) {
    const at = ago(age);
    await seedTestimony(server.firestore, provider, { createdAt: at, updatedAt: at, publishedAt: at, ...overrides });
  }
}

describe("D1 velocity: 3 within 24 hours", () => {
  it("publishes the 2nd Testimony for a Provider within 24 hours", async () => {
    const provider = await seedProvider(server.firestore);
    await seedSubmitted(provider, [2 * HOUR]);
    const body = await postOk(submission(provider.placeId));
    expect(body.status).toBe("published");
    const decision = await decisionOf(body.testimonyId);
    expect(decision.decision).toBe("publish");
    expect(decision.detectionRuleCodes).toBeUndefined();
  });

  it("holds the 3rd within 24 hours with the standard held message and an admin-only D1", async () => {
    server.setSpotCheckRate(1);
    const provider = await seedProvider(server.firestore);
    const first = await postOk(submission(provider.placeId));
    const second = await postOk(submission(provider.placeId));
    expect([first.status, second.status]).toEqual(["published", "published"]);
    const before = await aggregates(provider.placeId);
    expect(before.testimonyCount).toBe(2);

    const response = await post(submission(provider.placeId));
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
    expect(decision.detectionRuleCodes).toEqual(["D1"]);
    // The agent's own codes stay as returned (the stub publish has none).
    expect(decision.ruleCodes).toEqual([]);
    expect(decision.spotCheck).toBe(false);
    expect(decision.spotCheckConfirmed).toBeUndefined();
    expect(await aggregates(provider.placeId)).toEqual(before);

    expect(server.logs.some((line) => line.includes('"held_by_detection"'))).toBe(true);
  });

  it("does not show D1 on the author's Testimoni saya", async () => {
    const provider = await seedProvider(server.firestore, { name: "Klinik Ramai" });
    await seedSubmitted(provider, [HOUR, 2 * HOUR]);
    const cookie = await newPatient();
    const created = await post(submission(provider.placeId), cookie);
    expect(((await created.json()) as TestimonyStoredResponse).status).toBe("held");

    const page = await fetch(new URL("/testimoni-saya", server.baseUrl), { headers: { cookie } });
    const html = await page.text();
    expect(html).toContain("Klinik Ramai");
    expect(html).toContain("Sedang ditinjau tim");
    expect(html).not.toMatch(RULE_CODE);
    expect(html).not.toContain("detectionRuleCodes");
  });
});

describe("D1 velocity: 5 within 7 days", () => {
  it("holds the 5th within 7 days when the earlier ones are older than 24 hours", async () => {
    const provider = await seedProvider(server.firestore);
    await seedSubmitted(provider, [2 * DAY, 3 * DAY, 4 * DAY]);
    const fourth = await postOk(submission(provider.placeId));
    expect(fourth.status).toBe("published");

    // The 4th is fresh, so move it out of the 24-hour window to test the 7-day rule alone.
    const backdated = ago(30 * HOUR);
    await server.firestore.collection(COLLECTIONS.testimonies).doc(fourth.testimonyId).update({ createdAt: backdated });
    const fifth = await postOk(submission(provider.placeId));
    expect(fifth.status).toBe("held");
    expect(fifth.message).toBe(HELD_MESSAGE);
    expect((await decisionOf(fifth.testimonyId)).detectionRuleCodes).toEqual(["D1"]);
  });

  it("does not count Testimonies 7 days old or older", async () => {
    const provider = await seedProvider(server.firestore);
    await seedSubmitted(provider, [2 * DAY, 3 * DAY, 4 * DAY, 7 * DAY + HOUR, 20 * DAY]);
    const body = await postOk(submission(provider.placeId));
    expect(body.status).toBe("published");
  });
});

describe("D1 velocity: what counts", () => {
  it("does not hold a Testimony for another Provider", async () => {
    const busy = await seedProvider(server.firestore);
    const quiet = await seedProvider(server.firestore);
    await seedSubmitted(busy, [HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR]);
    const body = await postOk(submission(quiet.placeId));
    expect(body.status).toBe("published");
    expect((await decisionOf(body.testimonyId)).detectionRuleCodes).toBeUndefined();
  });

  it("does not count deleted Testimonies", async () => {
    const provider = await seedProvider(server.firestore);
    await seedSubmitted(provider, [HOUR]);
    await seedSubmitted(provider, [2 * HOUR, 3 * HOUR], { status: "deleted" });
    const body = await postOk(submission(provider.placeId));
    expect(body.status).toBe("published");
  });

  it("counts held and rejected Testimonies", async () => {
    const provider = await seedProvider(server.firestore);
    await seedSubmitted(provider, [HOUR], { status: "held" });
    await seedSubmitted(provider, [2 * HOUR], { status: "rejected" });
    const body = await postOk(submission(provider.placeId));
    expect(body.status).toBe("held");
  });

  it("counts Testimonies for a place that is not Listed yet", async () => {
    const placeId = "ChIJ-not-listed-yet";
    const typed = { providerName: "Klinik Baru", region: { provinceCode: "31", regencyCode: "31.71" } };
    const first = await postOk(submission(placeId, typed));
    const second = await postOk(submission(placeId, typed));
    // The first published and Listed it; the second publishes as the 2nd within 24 hours.
    expect([first.status, second.status]).toEqual(["published", "published"]);
    const third = await postOk(submission(placeId, typed));
    expect(third.status).toBe("held");
  });
});

describe("D1 velocity: a burst sent at once", () => {
  it("holds the submissions past the threshold even when they arrive concurrently", async () => {
    const provider = await seedProvider(server.firestore);
    const cookies = await Promise.all(Array.from({ length: VELOCITY_DAY_THRESHOLD }, () => newPatient()));
    // All of them leave Moderation (publish) at the same moment, as a burst would.
    server.fakes.agent.answerModerationTogether(VELOCITY_DAY_THRESHOLD);
    const responses = await Promise.all(cookies.map((cookie) => post(submission(provider.placeId), cookie)));
    expect(responses.map((response) => response.status)).toEqual(cookies.map(() => 201));
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as TestimonyStoredResponse[];

    const published = bodies.filter((body) => body.status === "published");
    const held = bodies.filter((body) => body.status === "held");
    expect(published).toHaveLength(VELOCITY_DAY_THRESHOLD - 1);
    expect(held).toHaveLength(1);
    for (const body of held) {
      expect(body.message).toBe(HELD_MESSAGE);
      expect((await decisionOf(body.testimonyId)).detectionRuleCodes).toEqual(["D1"]);
      expect((await testimony(body.testimonyId)).status).toBe("held");
    }
    for (const body of published) expect((await decisionOf(body.testimonyId)).detectionRuleCodes).toBeUndefined();
    expect((await aggregates(provider.placeId)).testimonyCount).toBe(VELOCITY_DAY_THRESHOLD - 1);
  });
});

describe("D1 velocity: only Moderation's publish", () => {
  it("leaves a Moderation hold as Moderation decided, without D1", async () => {
    const provider = await seedProvider(server.firestore);
    await seedSubmitted(provider, [HOUR, 2 * HOUR]);
    server.fakes.agent.respondToModerationWith(HOLD);
    const body = await postOk(submission(provider.placeId));
    expect(body.status).toBe("held");
    expect(body.message).not.toBe(HELD_MESSAGE);
    const decision = await decisionOf(body.testimonyId);
    expect(decision.ruleCodes).toEqual(["r2_accusation_as_fact"]);
    expect(decision.detectionRuleCodes).toBeUndefined();
  });

  it("answers an authorFix as before, storing nothing", async () => {
    const provider = await seedProvider(server.firestore);
    await seedSubmitted(provider, [HOUR, 2 * HOUR]);
    const response = await post(submission(provider.placeId, { text: PHONE_TEXT }));
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(JSON.parse(raw).status).toBe("needsAuthorFix");
    expect(raw).not.toMatch(RULE_CODE);
    const decisions = await server.firestore.collection(COLLECTIONS.moderationDecisions).count().get();
    expect(decisions.data().count).toBe(0);
  });
});

// Admin queue: the linked Testimonies behind a D1 hold ---------------------------------

async function queue(cookie?: string): Promise<AdminQueueResponse> {
  cookie ??= await server.signInWithGoogle(ADMIN_EMAILS[0] as string);
  const response = await server.get("/admin/api/queue", { headers: { cookie } });
  if (response.status !== 200) throw new Error(`queue failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as AdminQueueResponse;
}

async function queueItemOf(testimonyId: string): Promise<QueueItem | undefined> {
  return (await queue()).items.find((item) => item.kind === "held" && item.subjectId === testimonyId);
}

describe("admin queue: a D1 hold", () => {
  it("lists the Provider's Testimonies from the 7 days before it, oldest first", async () => {
    const provider = await seedProvider(server.firestore);
    const other = await seedProvider(server.firestore);
    const at = (age: number, overrides: Partial<TestimonyFixture> = {}) =>
      seedTestimony(server.firestore, provider, { createdAt: ago(age), updatedAt: ago(age), ...overrides });
    const old = await at(8 * DAY);
    const threeDays = await at(3 * DAY);
    const twoHours = await at(2 * HOUR, { status: "rejected" });
    await at(90 * 60 * 1000, { status: "deleted" });
    const oneHour = await at(HOUR);
    await seedTestimony(server.firestore, other, { createdAt: ago(HOUR), updatedAt: ago(HOUR) });

    const body = await postOk(submission(provider.placeId));
    expect(body.status).toBe("held");

    const item = await queueItemOf(body.testimonyId);
    expect(item?.detection?.ruleCodes).toEqual(["D1"]);
    expect(item?.detection?.linked).toEqual([
      expect.objectContaining({
        id: threeDays.id,
        displayName: threeDays.displayName,
        status: "published",
        withinDay: false,
      }),
      expect.objectContaining({ id: twoHours.id, status: "rejected", withinDay: true }),
      expect.objectContaining({ id: oneHour.id, status: "published", withinDay: true }),
    ]);
    expect(item?.detection?.linked.map((linked) => linked.id)).not.toContain(old.id);
    const [first] = item?.detection?.linked ?? [];
    expect(first?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(Date.parse(first?.createdAt ?? "")).toBeLessThan(Date.parse(item?.detection?.linked[1]?.createdAt ?? ""));
    expect(first?.textPreview).toBe(threeDays.text);
  });

  it("cuts a long linked Testimony's text to the preview length", async () => {
    const provider = await seedProvider(server.firestore);
    const long = "Dokternya sabar dan ruangannya bersih sekali. ".repeat(10);
    expect(long.length).toBeGreaterThan(LINKED_TEXT_PREVIEW_CHARS);
    const linked = await seedTestimony(server.firestore, provider, {
      createdAt: ago(HOUR),
      updatedAt: ago(HOUR),
      text: long,
    });
    await seedSubmitted(provider, [2 * HOUR]);
    const body = await postOk(submission(provider.placeId));
    expect(body.status).toBe("held");

    const preview = (await queueItemOf(body.testimonyId))?.detection?.linked.find(
      (l) => l.id === linked.id,
    )?.textPreview;
    expect(preview?.length).toBeLessThanOrEqual(LINKED_TEXT_PREVIEW_CHARS);
    expect(preview?.endsWith("…")).toBe(true);
    expect(long.startsWith(preview?.slice(0, -1) ?? "x")).toBe(true);
  });

  it("says whether each account also wrote about another Provider", async () => {
    const provider = await seedProvider(server.firestore);
    const other = await seedProvider(server.firestore);
    const recent = { createdAt: ago(HOUR), updatedAt: ago(HOUR) };
    const traveller = await seedTestimony(server.firestore, provider, { ...recent, authorUid: "uid-traveller" });
    await seedTestimony(server.firestore, other, { authorUid: "uid-traveller", status: "held" });
    const local = await seedTestimony(server.firestore, provider, { ...recent, authorUid: "uid-local" });
    // A deleted Testimony elsewhere does not count.
    await seedTestimony(server.firestore, other, { authorUid: "uid-local", status: "deleted" });

    // The held Testimony's author first wrote about the other Provider.
    const cookie = await newPatient();
    const elsewhere = await post(submission(other.placeId), cookie);
    expect(elsewhere.status).toBe(201);
    const response = await post(submission(provider.placeId), cookie);
    const body = (await response.json()) as TestimonyStoredResponse;
    expect(body.status).toBe("held");

    const detection = (await queueItemOf(body.testimonyId))?.detection;
    expect(detection?.authorWroteAboutOtherProviders).toBe(true);
    const flags = Object.fromEntries(detection?.linked.map((l) => [l.id, l.wroteAboutOtherProviders]) ?? []);
    expect(flags).toEqual({ [traveller.id]: true, [local.id]: false });
  });

  it("says when the held Testimony's author wrote about this Provider only", async () => {
    const provider = await seedProvider(server.firestore);
    await seedSubmitted(provider, [HOUR, 2 * HOUR]);
    const body = await postOk(submission(provider.placeId));
    expect(body.status).toBe("held");
    expect((await queueItemOf(body.testimonyId))?.detection?.authorWroteAboutOtherProviders).toBe(false);
  });

  it("shows D1 to the admin on the decision and in the history", async () => {
    const provider = await seedProvider(server.firestore);
    await seedSubmitted(provider, [HOUR, 2 * HOUR]);
    const body = await postOk(submission(provider.placeId));
    const testimony = (await queueItemOf(body.testimonyId))?.testimony;
    expect(testimony?.moderation).toMatchObject({ decision: "hold", ruleCodes: [], detectionRuleCodes: ["D1"] });
    expect(testimony?.history).toEqual([expect.objectContaining({ kind: "moderation", label: "hold", detail: "D1" })]);
  });

  it("gives a hold Moderation made no detection view", async () => {
    const provider = await seedProvider(server.firestore);
    await seedSubmitted(provider, [HOUR, 2 * HOUR]);
    server.fakes.agent.respondToModerationWith(HOLD);
    const body = await postOk(submission(provider.placeId));
    const item = await queueItemOf(body.testimonyId);
    expect(item?.testimony?.moderation?.ruleCodes).toEqual(["r2_accusation_as_fact"]);
    expect(item?.testimony?.moderation).not.toHaveProperty("detectionRuleCodes");
    expect(item).not.toHaveProperty("detection");
  });

  it("keeps the detection view from anyone but an admin", async () => {
    const provider = await seedProvider(server.firestore);
    await seedSubmitted(provider, [HOUR, 2 * HOUR]);
    const cookie = await newPatient();
    const created = await post(submission(provider.placeId), cookie);
    expect(((await created.json()) as TestimonyStoredResponse).status).toBe("held");

    expect((await server.get("/admin/api/queue")).status).toBe(401);
    const asAuthor = await server.get("/admin/api/queue", { headers: { cookie } });
    expect(asAuthor.status).toBe(403);
    expect(await asAuthor.text()).not.toMatch(RULE_CODE);
    const adminPage = await server.get("/admin", { headers: { cookie } });
    expect(adminPage.status).toBe(403);
    expect(await adminPage.text()).not.toMatch(RULE_CODE);
  });
});

// Editing a D1 hold -------------------------------------------------------------------

const act = async (body: AdminActionRequest) => {
  const cookie = await server.signInWithGoogle(ADMIN_EMAILS[0] as string);
  return server.post("/admin/api/actions", body, { headers: { cookie } });
};

/** A D1 hold by a new Patient: the 3rd within 24 hours. Returns its id and the author's cookie. */
async function d1Hold(provider: ProviderFixture) {
  await seedSubmitted(provider, [HOUR, 2 * HOUR]);
  const cookie = await newPatient();
  const created = (await (await post(submission(provider.placeId), cookie)).json()) as TestimonyStoredResponse;
  expect(created.status).toBe("held");
  return { testimonyId: created.testimonyId, cookie };
}

describe("D1 hold: the author edits", () => {
  it("keeps D1, the linked Testimonies and the admin view when Moderation publishes the edit", async () => {
    const provider = await seedProvider(server.firestore, { name: "Klinik Ramai" });
    const { testimonyId, cookie } = await d1Hold(provider);
    const firstDecisionId = (await testimony(testimonyId)).moderationDecisionId;

    const response = await edit(
      testimonyId,
      submission(provider.placeId, { text: "Dokternya sabar, tambalannya rapi dan ruangannya bersih." }),
      cookie,
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toMatch(RULE_CODE);
    expect((JSON.parse(raw) as TestimonyStoredResponse).status).toBe("held");

    const after = await testimony(testimonyId);
    expect(after.status).toBe("held");
    expect(after.moderationDecisionId).not.toBe(firstDecisionId);
    const decision = await decisionOf(testimonyId);
    expect(decision).toMatchObject({ decision: "hold", detectionRuleCodes: ["D1"] });

    const item = await queueItemOf(testimonyId);
    expect(item?.detection?.ruleCodes).toEqual(["D1"]);
    expect(item?.detection?.linked).toHaveLength(2);
    expect(item?.testimony?.moderation).toMatchObject({ decision: "hold", detectionRuleCodes: ["D1"] });

    const page = await fetch(new URL("/testimoni-saya", server.baseUrl), { headers: { cookie } });
    const html = await page.text();
    expect(html).toContain("Klinik Ramai");
    expect(html).not.toMatch(RULE_CODE);
    expect(html).not.toContain("detectionRuleCodes");
  });

  it("keeps D1 when Moderation holds the edit for its own reasons", async () => {
    const provider = await seedProvider(server.firestore);
    const { testimonyId, cookie } = await d1Hold(provider);
    server.fakes.agent.respondToModerationWith(HOLD);
    const response = await edit(testimonyId, submission(provider.placeId), cookie);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toMatch(RULE_CODE);
    expect(await decisionOf(testimonyId)).toMatchObject({
      decision: "hold",
      ruleCodes: ["r2_accusation_as_fact"],
      detectionRuleCodes: ["D1"],
    });
    expect((await queueItemOf(testimonyId))?.detection?.ruleCodes).toEqual(["D1"]);
  });

  it("does not carry D1 once an admin has published it", async () => {
    const provider = await seedProvider(server.firestore);
    const { testimonyId, cookie } = await d1Hold(provider);
    expect((await act({ action: "publish", subjectId: testimonyId })).status).toBe(200);
    expect((await testimony(testimonyId)).status).toBe("published");

    // An edit of the published Testimony that Moderation holds waits as a revision.
    server.fakes.agent.respondToModerationWith(HOLD);
    const response = await edit(testimonyId, submission(provider.placeId), cookie);
    expect(response.status).toBe(200);
    const after = await testimony(testimonyId);
    expect(after.pendingRevision?.status).toBe("held");
    const revisionDecision = (
      await server.firestore
        .collection(COLLECTIONS.moderationDecisions)
        .doc(after.pendingRevision?.moderationDecisionId ?? "")
        .get()
    ).data() as ModerationDecisionDoc;
    expect(revisionDecision.detectionRuleCodes).toBeUndefined();

    const queued = (await queue()).items.filter((item) => item.subjectId === testimonyId);
    for (const item of queued) {
      expect(item).not.toHaveProperty("detection");
      expect(item.testimony?.moderation).not.toHaveProperty("detectionRuleCodes");
    }
  });

  it("does not carry D1 after an admin sent it back to the author", async () => {
    const provider = await seedProvider(server.firestore);
    const { testimonyId, cookie } = await d1Hold(provider);
    const sendBack = await act({ action: "sendBackToAuthor", subjectId: testimonyId, reason: "Mohon perjelas." });
    expect(sendBack.status).toBe(200);
    const response = await edit(testimonyId, submission(provider.placeId), cookie);
    expect(response.status).toBe(200);
    expect(await decisionOf(testimonyId)).not.toHaveProperty("detectionRuleCodes");
  });
});
