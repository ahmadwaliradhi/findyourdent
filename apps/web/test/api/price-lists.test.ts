// Price Lists (spec 05, T18) through the web API: only the approved claimant uploads,
// the agent's rows come back for review (or no rows and a retry message), only
// confirmed rows are stored with their source and dates, the original stays private
// for 30 days, and the Provider page shows the list with its date.
import { COLLECTIONS, type PriceListDoc } from "@findyourdent/contracts/firestore";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminActionRequest } from "../../app/lib/admin-queue.ts";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import type { PriceListConfirmation, PriceListUploadResponse } from "../../app/lib/price-lists.ts";
import { AgentUnavailableError } from "../../server/adapters/agent.ts";
import { STUB_PRICE_LIST_EXTRACTION } from "../../server/adapters/fakes.ts";
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

const OWNER = "drg.sari@example.com";
const DAY_MS = 24 * 60 * 60 * 1000;
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nDaftar harga Klinik Sari\n%%EOF");

let photoBytes: Buffer;
beforeAll(async () => {
  // A JPEG carrying EXIF (camera make and GPS), which must never be stored or sent on.
  photoBytes = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#fafafa" } })
    .withExif({ IFD0: { Make: "PhoneCam" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "7/1 15/1 0/1" } })
    .jpeg()
    .toBuffer();
});

type Upload = { bytes: Uint8Array; type: string; name: string };
const pdf = (): Upload => ({ bytes: PDF_BYTES, type: "application/pdf", name: "harga.pdf" });
const photo = (name = "harga.jpg"): Upload => ({ bytes: photoBytes, type: "image/jpeg", name });

function postUpload(placeId: string, files: Upload[], cookie?: string) {
  const form = new FormData();
  for (const file of files)
    form.append("files", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  return fetch(new URL(`/api/providers/${placeId}/price-lists`, server.baseUrl), {
    method: "POST",
    headers: { ...(cookie ? { cookie } : {}), [APP_CHECK_HEADER]: server.appCheckToken() },
    body: form,
  });
}

const confirm = (placeId: string, priceListId: string, body: PriceListConfirmation, cookie: string) =>
  server.post(`/api/providers/${placeId}/price-lists/${priceListId}`, body, { headers: { cookie } });

const act = (cookie: string, body: AdminActionRequest) =>
  server.post("/admin/api/actions", body, { headers: { cookie } });

/** A Listed Provider with an approved Claim by OWNER; returns the owner's cookie. */
async function claimedProvider() {
  const listed = await seedProvider(server.firestore, { name: "Klinik Gigi Sari" });
  const cookie = await server.signInWithGoogle(OWNER);
  const form = new FormData();
  form.set("claim", JSON.stringify({ role: "owner", contactPhone: "0812-1111-2222" }));
  form.set("permit", new File([new Uint8Array(photoBytes)], "sip.jpg", { type: "image/jpeg" }));
  const claimed = await fetch(new URL(`/api/providers/${listed.placeId}/claims`, server.baseUrl), {
    method: "POST",
    headers: { cookie, [APP_CHECK_HEADER]: server.appCheckToken() },
    body: form,
  });
  expect(claimed.status).toBe(201);
  const { claimId } = (await claimed.json()) as { claimId: string };
  const admin = await server.signInWithGoogle(ADMIN_EMAILS[0] as string);
  expect((await act(admin, { action: "approveClaim", subjectId: claimId })).status).toBe(200);
  return { placeId: listed.placeId, claimId, cookie, admin };
}

async function upload(placeId: string, files: Upload[], cookie: string) {
  const response = await postUpload(placeId, files, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as PriceListUploadResponse;
}

async function priceLists(placeId: string): Promise<Array<PriceListDoc & { id: string }>> {
  const snapshot = await server.firestore.collection(COLLECTIONS.priceLists).where("placeId", "==", placeId).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as PriceListDoc) }));
}

async function storedFiles(prefix: string): Promise<string[]> {
  const [files] = await server.uploads.getFiles({ prefix });
  return files.map((file) => file.name);
}

/** The stub rows without the model's confidence: what an owner confirms unchanged. */
const confirmedRows = () =>
  STUB_PRICE_LIST_EXTRACTION.kind === "ok"
    ? STUB_PRICE_LIST_EXTRACTION.rows.map(({ confidence: _, ...row }) => row)
    : [];

describe("POST /api/providers/:placeId/price-lists", () => {
  it("asks a signed-out visitor to sign in", async () => {
    const listed = await seedProvider(server.firestore);
    const response = await postUpload(listed.placeId, [pdf()]);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "sign_in_required" });
  });

  it("refuses anyone but the approved claimant, before calling the agent", async () => {
    const { placeId } = await claimedProvider();
    const other = await server.signInWithGoogle("bukan.pemilik@example.com");

    const response = await postUpload(placeId, [pdf()], other);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "not_owner" });
    expect(server.fakes.agent.extractionCalls).toHaveLength(0);
  });

  it("reads a PDF into rows for review and stores no row before confirmation", async () => {
    const { placeId, cookie } = await claimedProvider();

    const result = await upload(placeId, [pdf()], cookie);

    expect(result).toMatchObject({
      kind: "ok",
      rows: STUB_PRICE_LIST_EXTRACTION.kind === "ok" ? STUB_PRICE_LIST_EXTRACTION.rows : [],
    });
    const [call] = server.fakes.agent.extractionCalls;
    expect(call).toEqual({
      pdf: { mimeType: "application/pdf", dataBase64: Buffer.from(PDF_BYTES).toString("base64") },
    });
    const [draft] = await priceLists(placeId);
    expect(draft).toMatchObject({ status: "draft", rows: [], source: "ownerPriceList" });
    expect(draft?.confirmedAt).toBeUndefined();
  });

  it("keeps the original privately for 30 days", async () => {
    const { placeId, cookie } = await claimedProvider();

    const result = await upload(placeId, [pdf()], cookie);

    const [draft] = await priceLists(placeId);
    if (result.kind !== "ok" || !draft) throw new Error("expected a draft");
    const paths = draft.originalDocumentPaths ?? [];
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(new RegExp(`^priceLists/${result.priceListId}/`));
    expect(await storedFiles(`priceLists/${result.priceListId}/`)).toEqual(paths);
    const keptFor = (draft.originalDeleteAfter?.toMillis() ?? 0) - (draft.uploadedAt.toMillis() ?? 0);
    expect(Math.round(keptFor / DAY_MS)).toBe(30);
  });

  it("sends up to five photos to the agent with every metadata block stripped", async () => {
    const { placeId, cookie } = await claimedProvider();

    await upload(placeId, [photo("1.jpg"), photo("2.jpg")], cookie);

    const images = server.fakes.agent.extractionCalls[0]?.images ?? [];
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.mimeType).toBe("image/jpeg");
      const metadata = await sharp(Buffer.from(image.dataBase64, "base64")).metadata();
      expect(metadata.exif).toBeUndefined();
    }
  });

  it.each([
    ["six photos", () => Array.from({ length: 6 }, (_, i) => photo(`${i}.jpg`))],
    ["a PDF and a photo", () => [pdf(), photo()]],
    ["two PDFs", () => [pdf(), pdf()]],
    ["a text file", () => [{ bytes: new TextEncoder().encode("Scaling 300rb"), type: "text/plain", name: "a.txt" }]],
    ["nothing", () => []],
  ])("refuses %s", async (_, files) => {
    const { placeId, cookie } = await claimedProvider();

    const response = await postUpload(placeId, files(), cookie);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_file" });
    expect(server.fakes.agent.extractionCalls).toHaveLength(0);
  });

  it.each([
    ["the agent could not read it", { kind: "failed", retryMessage: "Coba lagi." }],
    ["the agent is down", new AgentUnavailableError("agent responded 503", 503)],
    ["the agent answer is invalid", { kind: "ok", rows: [{ procedureText: "Scaling" }] }],
  ])("returns no rows and a retry message when %s, and keeps nothing", async (_, answer) => {
    const { placeId, cookie } = await claimedProvider();
    server.fakes.agent.respondToExtractionWith(answer);

    const result = await upload(placeId, [pdf()], cookie);

    expect(result.kind).toBe("failed");
    expect(result).not.toHaveProperty("rows");
    expect(result.kind === "failed" && result.message).toBeTruthy();
    expect(await priceLists(placeId)).toEqual([]);
    expect(await storedFiles("priceLists/")).toEqual([]);
  });
});

describe("POST /api/providers/:placeId/price-lists/:priceListId", () => {
  async function uploaded() {
    const owner = await claimedProvider();
    const result = await upload(owner.placeId, [pdf()], owner.cookie);
    if (result.kind !== "ok") throw new Error("expected rows");
    return { ...owner, priceListId: result.priceListId };
  }

  it("stores only the rows the owner confirmed, edited, added and deleted, with source and dates", async () => {
    const { placeId, priceListId, cookie } = await uploaded();
    const [scaling, filling] = confirmedRows();
    const rows = [
      { ...scaling, maxRupiah: 350_000 },
      // The low-confidence Bleaching row is deleted; a row is added by hand.
      { procedureText: "Cabut gigi susu", minRupiah: 150_000, maxRupiah: 150_000, unit: "per_tooth" },
      filling,
    ] as PriceListConfirmation["rows"];

    const response = await confirm(placeId, priceListId, { rows }, cookie);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "current" });
    const [list] = await priceLists(placeId);
    expect(list).toMatchObject({ status: "current", source: "ownerPriceList", rows });
    expect(list?.confirmedAt?.toMillis()).toBeGreaterThanOrEqual(list?.uploadedAt.toMillis() ?? Infinity);
  });

  it("replaces the previous list, so old prices disappear", async () => {
    const first = await uploaded();
    await confirm(first.placeId, first.priceListId, { rows: confirmedRows() }, first.cookie);
    const second = await upload(first.placeId, [pdf()], first.cookie);
    if (second.kind !== "ok") throw new Error("expected rows");

    const rows = [{ procedureText: "Scaling", minRupiah: 400_000, maxRupiah: 400_000, unit: "per_visit" as const }];
    expect((await confirm(first.placeId, second.priceListId, { rows }, first.cookie)).status).toBe(200);

    const lists = await priceLists(first.placeId);
    expect(lists.find((l) => l.id === first.priceListId)?.status).toBe("replaced");
    expect(lists.filter((l) => l.status === "current").map((l) => l.id)).toEqual([second.priceListId]);
  });

  it.each([
    ["no rows", []],
    [
      "a minimum above the maximum",
      [{ procedureText: "Scaling", minRupiah: 500_000, maxRupiah: 300_000, unit: "per_visit" }],
    ],
    [
      "an unknown procedure code",
      [{ procedureCode: "made_up", procedureText: "X", minRupiah: 1, maxRupiah: 1, unit: "per_visit" }],
    ],
    ["an unknown unit", [{ procedureText: "Scaling", minRupiah: 1, maxRupiah: 1, unit: "per_hour" }]],
    ["an empty procedure", [{ procedureText: " ", minRupiah: 1, maxRupiah: 1, unit: "per_visit" }]],
    ["a fractional price", [{ procedureText: "Scaling", minRupiah: 1.5, maxRupiah: 2, unit: "per_visit" }]],
  ])("refuses %s", async (_, rows) => {
    const { placeId, priceListId, cookie } = await uploaded();

    const response = await confirm(placeId, priceListId, { rows } as unknown as PriceListConfirmation, cookie);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_rows" });
    expect((await priceLists(placeId))[0]?.status).toBe("draft");
  });

  it("refuses another account and a revoked claimant", async () => {
    const { placeId, priceListId, cookie, claimId, admin } = await uploaded();
    const other = await server.signInWithGoogle("bukan.pemilik@example.com");
    expect((await confirm(placeId, priceListId, { rows: confirmedRows() }, other)).status).toBe(403);

    expect((await act(admin, { action: "revokeClaim", subjectId: claimId, reason: "Salah setuju" })).status).toBe(200);
    expect((await confirm(placeId, priceListId, { rows: confirmedRows() }, cookie)).status).toBe(403);
    expect((await priceLists(placeId))[0]?.status).toBe("draft");
  });

  it("refuses a list that is already confirmed", async () => {
    const { placeId, priceListId, cookie } = await uploaded();
    expect((await confirm(placeId, priceListId, { rows: confirmedRows() }, cookie)).status).toBe(200);

    expect((await confirm(placeId, priceListId, { rows: confirmedRows() }, cookie)).status).toBe(404);
  });
});

describe("Price List on the Provider page", () => {
  async function page(placeId: string): Promise<string> {
    return (await fetch(new URL(`/tempat/${placeId}`, server.baseUrl))).text();
  }

  it("shows every confirmed row with its source and confirmation date", async () => {
    const { placeId, priceListId, cookie } = await (async () => {
      const owner = await claimedProvider();
      const result = await upload(owner.placeId, [pdf()], owner.cookie);
      if (result.kind !== "ok") throw new Error("expected rows");
      return { ...owner, priceListId: result.priceListId };
    })();
    await confirm(placeId, priceListId, { rows: confirmedRows() }, cookie);

    const html = await page(placeId);

    expect(html).toContain("Daftar harga dari pemilik");
    expect(html).toContain("Bleaching");
    expect(html).toContain("Tambal gigi komposit");
    expect(html).not.toContain("mungkin sudah berubah");
  });

  it("marks a list confirmed more than 12 months ago as possibly outdated", async () => {
    const { placeId, priceListId, cookie } = await (async () => {
      const owner = await claimedProvider();
      const result = await upload(owner.placeId, [pdf()], owner.cookie);
      if (result.kind !== "ok") throw new Error("expected rows");
      return { ...owner, priceListId: result.priceListId };
    })();
    await confirm(placeId, priceListId, { rows: confirmedRows() }, cookie);
    await server.firestore
      .collection(COLLECTIONS.priceLists)
      .doc(priceListId)
      .update({ confirmedAt: new Date(Date.now() - 400 * DAY_MS) });

    expect(await page(placeId)).toContain("mungkin sudah berubah");
  });

  it("stops showing the list once the Claim is revoked", async () => {
    const owner = await claimedProvider();
    const result = await upload(owner.placeId, [pdf()], owner.cookie);
    if (result.kind !== "ok") throw new Error("expected rows");
    await confirm(owner.placeId, result.priceListId, { rows: confirmedRows() }, owner.cookie);

    await act(owner.admin, { action: "revokeClaim", subjectId: owner.claimId, reason: "Salah setuju" });

    expect(await page(owner.placeId)).not.toContain("Daftar harga dari pemilik");
  });
});
