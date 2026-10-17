import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { TESTIMONY_LIMITS } from "../../app/lib/testimony.ts";
import { readTestimonyFiles } from "../../app/server/testimony-media.server.ts";

let jpeg: Buffer;
let png: Buffer;
let webp: Buffer;
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

beforeAll(async () => {
  const image = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#4a90d9" } });
  jpeg = await image().jpeg().toBuffer();
  png = await image().png().toBuffer();
  webp = await image().webp().toBuffer();
});

function file(bytes: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function form(parts: { photos?: File[]; proof?: File }): FormData {
  const data = new FormData();
  data.set("testimony", "{}");
  for (const photo of parts.photos ?? []) data.append("photos", photo);
  if (parts.proof) data.set("proof", parts.proof);
  return data;
}

describe("readTestimonyFiles", () => {
  it("accepts up to four JPEG, PNG or WebP photos and one PDF Proof of Visit", async () => {
    const photos = [
      file(jpeg, "a.jpg", "image/jpeg"),
      file(png, "b.png", "image/png"),
      file(webp, "c.webp", "image/webp"),
      file(jpeg, "d.jpg", "image/jpeg"),
    ];
    const parsed = await readTestimonyFiles(form({ photos, proof: file(pdf, "struk.pdf", "application/pdf") }), {
      existingPhotoCount: 0,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.files.photos).toHaveLength(4);
    expect(parsed.files.proof?.name).toBe("struk.pdf");
  });

  it("accepts a form with no files, ignoring empty file inputs", async () => {
    const data = form({});
    data.append("photos", new File([], "", { type: "application/octet-stream" }));
    data.set("proof", new File([], "", { type: "application/octet-stream" }));
    const parsed = await readTestimonyFiles(data, { existingPhotoCount: 0 });
    expect(parsed).toEqual({ ok: true, files: { photos: [], proof: null } });
  });

  it("refuses more photos than the four allowed, counting the ones already kept", async () => {
    const photos = [file(jpeg, "a.jpg", "image/jpeg"), file(jpeg, "b.jpg", "image/jpeg")];
    const parsed = await readTestimonyFiles(form({ photos }), { existingPhotoCount: 3 });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.fieldErrors)).toEqual(["photos"]);

    const five = Array.from({ length: 5 }, (_, i) => file(jpeg, `${i}.jpg`, "image/jpeg"));
    expect((await readTestimonyFiles(form({ photos: five }), { existingPhotoCount: 0 })).ok).toBe(false);
  });

  it("refuses a photo that is too big", async () => {
    const big = Buffer.concat([jpeg, Buffer.alloc(TESTIMONY_LIMITS.photoMaxBytes)]);
    const parsed = await readTestimonyFiles(form({ photos: [file(big, "big.jpg", "image/jpeg")] }), {
      existingPhotoCount: 0,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.fieldErrors.photos).toBeTruthy();
  });

  it("refuses a Proof of Visit that is too big or not an image or PDF", async () => {
    const big = Buffer.concat([pdf, Buffer.alloc(TESTIMONY_LIMITS.proofMaxBytes)]);
    const tooBig = await readTestimonyFiles(form({ proof: file(big, "big.pdf", "application/pdf") }), {
      existingPhotoCount: 0,
    });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(Object.keys(tooBig.fieldErrors)).toEqual(["proof"]);

    const text = await readTestimonyFiles(form({ proof: file(Buffer.from("hello"), "a.txt", "text/plain") }), {
      existingPhotoCount: 0,
    });
    expect(text.ok).toBe(false);
  });

  it("refuses a photo whose bytes do not match its declared type", async () => {
    const mislabelled = await readTestimonyFiles(form({ photos: [file(pdf, "photo.jpg", "image/jpeg")] }), {
      existingPhotoCount: 0,
    });
    expect(mislabelled.ok).toBe(false);
    if (!mislabelled.ok) expect(mislabelled.fieldErrors.photos).toBeTruthy();

    // A PNG labelled as JPEG is still a real image of an allowed type: accepted as what it is.
    const pngAsJpeg = await readTestimonyFiles(form({ photos: [file(png, "photo.jpg", "image/jpeg")] }), {
      existingPhotoCount: 0,
    });
    expect(pngAsJpeg.ok).toBe(true);
  });

  it("refuses a PDF sent as a photo even when labelled as a PDF", async () => {
    const parsed = await readTestimonyFiles(form({ photos: [file(pdf, "a.pdf", "application/pdf")] }), {
      existingPhotoCount: 0,
    });
    expect(parsed.ok).toBe(false);
  });

  it("gives messages in the Patient's language", async () => {
    const five = Array.from({ length: 5 }, (_, i) => file(jpeg, `${i}.jpg`, "image/jpeg"));
    const id = await readTestimonyFiles(form({ photos: five }), { existingPhotoCount: 0 });
    const en = await readTestimonyFiles(form({ photos: five }), { existingPhotoCount: 0, language: "en" });
    if (id.ok || en.ok) throw new Error("expected refusal");
    expect(id.fieldErrors.photos).not.toBe(en.fieldErrors.photos);
  });
});
