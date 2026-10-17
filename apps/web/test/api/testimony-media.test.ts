import { COLLECTIONS, type TestimonyDoc } from "@findyourdent/contracts/firestore";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testimonyPhotoUrl } from "../../app/lib/testimony-photos.ts";
import {
  deleteTestimonyMedia,
  readTestimonyFiles,
  storeTestimonyMedia,
  type TestimonyFiles,
} from "../../app/server/testimony-media.server.ts";
import { startTestServer, type TestServer } from "../support/harness.ts";

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

/** A photo as a phone takes it: big, rotated by EXIF orientation, with GPS coordinates. */
async function phonePhotoWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#7fb3d5" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: "PhoneCo", Model: "Snap 9" },
      IFD3: {
        GPSLatitudeRef: "S",
        GPSLatitude: "7/1 16/1 3000/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "112/1 45/1 0/1",
      },
    })
    .toBuffer();
}

const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

async function readFiles(photos: Buffer[], proof?: { bytes: Buffer; type: string }): Promise<TestimonyFiles> {
  const form = new FormData();
  for (const [i, bytes] of photos.entries()) {
    form.append("photos", new File([new Uint8Array(bytes)], `foto-${i}.jpg`, { type: "image/jpeg" }));
  }
  if (proof) form.set("proof", new File([new Uint8Array(proof.bytes)], "bukti", { type: proof.type }));
  const parsed = await readTestimonyFiles(form, { existingPhotoCount: 0 });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.fieldErrors));
  return parsed.files;
}

async function download(path: string): Promise<Buffer> {
  const [bytes] = await server.uploads.file(path).download();
  return bytes;
}

describe("storeTestimonyMedia", () => {
  it("stores photos with EXIF (GPS included) stripped, upright and scaled down", async () => {
    const original = await phonePhotoWithGps();
    const originalMeta = await sharp(original).metadata();
    expect(originalMeta.exif?.includes(Buffer.from("PhoneCo"))).toBe(true);
    expect(originalMeta.orientation).toBe(6);

    const stored = await storeTestimonyMedia(server.uploads, "t-exif", await readFiles([original]));

    expect(stored.photoPaths).toHaveLength(1);
    expect(stored.photoPaths[0]).toMatch(/^testimonies\/t-exif\/photos\/[0-9a-f-]{36}\.jpg$/);
    expect(stored.proofPath).toBeUndefined();
    const bytes = await download(stored.photoPaths[0] as string);
    const meta = await sharp(bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(bytes.includes(Buffer.from("PhoneCo"))).toBe(false);
    // Orientation 6 means rotate 90°: the stored photo is portrait, longest edge 1600 px.
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 1067, height: 1600 });
    const [objectMeta] = await server.uploads.file(stored.photoPaths[0] as string).getMetadata();
    expect(objectMeta.contentType).toBe("image/jpeg");
  });

  it("stores a PDF Proof of Visit privately under proof-of-visit/, never under photos", async () => {
    const stored = await storeTestimonyMedia(
      server.uploads,
      "t-proof",
      await readFiles([], { bytes: pdf, type: "application/pdf" }),
    );
    expect(stored.photoPaths).toEqual([]);
    expect(stored.proofPath).toMatch(/^proof-of-visit\/t-proof\/[0-9a-f-]{36}\.pdf$/);
    expect(await download(stored.proofPath as string)).toEqual(pdf);
    const [photoObjects] = await server.uploads.getFiles({ prefix: "testimonies/t-proof/" });
    expect(photoObjects).toEqual([]);
  });

  it("strips EXIF from an image Proof of Visit too", async () => {
    const stored = await storeTestimonyMedia(
      server.uploads,
      "t-proof-image",
      await readFiles([], { bytes: await phonePhotoWithGps(), type: "image/jpeg" }),
    );
    expect(stored.proofPath).toMatch(/^proof-of-visit\/t-proof-image\/[0-9a-f-]{36}\.jpg$/);
    expect((await sharp(await download(stored.proofPath as string)).metadata()).exif).toBeUndefined();
  });
});

describe("deleteTestimonyMedia", () => {
  it("deletes stored objects and ignores ones already gone", async () => {
    const stored = await storeTestimonyMedia(server.uploads, "t-del", await readFiles([await phonePhotoWithGps()]));
    const path = stored.photoPaths[0] as string;
    await deleteTestimonyMedia(server.uploads, [path, "testimonies/t-del/photos/missing.jpg"]);
    const [exists] = await server.uploads.file(path).exists();
    expect(exists).toBe(false);
  });
});

describe("GET testimony photo", () => {
  const AUTHOR = "penulis@example.com";

  async function seed(status: TestimonyDoc["status"], authorUid = "uid-other") {
    const stored = await storeTestimonyMedia(server.uploads, "t-photo", await readFiles([await phonePhotoWithGps()]));
    const now = Timestamp.now();
    const doc: TestimonyDoc = {
      placeId: "ChIJ-photo",
      region: { provinceCode: "35", regencyCode: "35.78" },
      providerType: "klinik",
      authorUid,
      displayName: "Siti R.",
      status,
      verifiedVisit: false,
      consent: { termsVersion: "2026-10", acceptedAt: now },
      authorFixRounds: 0,
      ratings: { service: 5, hygiene: 4, materialsEquipment: 4 },
      text: "Bersih dan ramah.",
      visitMonth: "2026-09",
      photoPaths: stored.photoPaths,
      createdAt: now,
      updatedAt: now,
    };
    await server.firestore.collection(COLLECTIONS.testimonies).doc("t-photo").set(doc);
    return stored.photoPaths[0] as string;
  }

  it("serves a published Testimony's photo to anyone, cacheable", async () => {
    const path = await seed("published");
    const response = await server.get(testimonyPhotoUrl("t-photo", path), { appCheckToken: null });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toMatch(/public/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(await download(path));
  });

  it("is 404 for a photo not in a published Testimony, or a path that is not a photo", async () => {
    for (const status of ["held", "submitted", "hidden", "removed", "deleted"] as const) {
      const path = await seed(status);
      const response = await server.get(testimonyPhotoUrl("t-photo", path), { appCheckToken: null });
      expect(response.status, status).toBe(404);
    }
    await seed("published");
    expect((await server.get("/foto/t-photo/00000000-0000-0000-0000-000000000000.jpg")).status).toBe(404);
    expect((await server.get("/foto/nope/00000000-0000-0000-0000-000000000000.jpg")).status).toBe(404);
    expect((await server.get("/foto/t-photo/..%2F..%2Fproof-of-visit")).status).toBe(404);
  });

  it("serves the author their own photo in any state but deleted, never cached publicly", async () => {
    const cookie = await server.signInWithGoogle(AUTHOR);
    const { uid } = await getAuth().getUserByEmail(AUTHOR);
    const path = await seed("held", uid);

    const asAuthor = await server.get(testimonyPhotoUrl("t-photo", path), { headers: { cookie } });
    expect(asAuthor.status).toBe(200);
    expect(asAuthor.headers.get("cache-control")).toMatch(/private/);

    const stranger = await server.signInWithGoogle("orang.lain@example.com");
    expect((await server.get(testimonyPhotoUrl("t-photo", path), { headers: { cookie: stranger } })).status).toBe(404);

    await server.firestore.collection(COLLECTIONS.testimonies).doc("t-photo").update({ status: "deleted" });
    expect((await server.get(testimonyPhotoUrl("t-photo", path), { headers: { cookie } })).status).toBe(404);
  });
});
