import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  fieldsKey,
  fileSha256,
  fingerprintMatch,
  fingerprintOf,
  hammingDistance,
  perceptualHash,
  REUSE_MAX_HAMMING_BITS,
} from "../../app/server/proof-fingerprint.ts";

/** A receipt-like photo: printed lines of text, rules and a stamp, so the hash has structure to work on. */
function receiptSvg(clinic: string, total: string, stampX: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">
  <rect width="600" height="900" fill="#f4f1ea"/>
  <text x="40" y="80" font-family="sans-serif" font-size="40" fill="#111">${clinic}</text>
  <rect x="40" y="110" width="520" height="4" fill="#333"/>
  <text x="40" y="200" font-family="monospace" font-size="28" fill="#222">Scaling gigi</text>
  <text x="40" y="260" font-family="monospace" font-size="28" fill="#222">Tambal komposit</text>
  <rect x="40" y="620" width="520" height="4" fill="#333"/>
  <text x="40" y="700" font-family="sans-serif" font-size="44" fill="#000">TOTAL ${total}</text>
  <circle cx="${stampX}" cy="800" r="60" fill="#3355aa" opacity="0.6"/>
</svg>`;
}

const receiptJpeg = (svg: string, quality = 90) => sharp(Buffer.from(svg)).jpeg({ quality }).toBuffer();

/** A picture with nothing in common with a receipt: dark, with shapes in other places. */
const otherPhotoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <rect width="800" height="600" fill="#1d2b1f"/>
  <circle cx="620" cy="160" r="120" fill="#f2c94c"/>
  <rect x="0" y="420" width="800" height="180" fill="#6b8f3a"/>
  <polygon points="80,420 260,140 440,420" fill="#8a8a8a"/>
</svg>`;

describe("perceptualHash", () => {
  it("gives 16 lowercase hex chars, the same for the same bytes", async () => {
    const photo = await receiptJpeg(receiptSvg("Klinik Gigi Senyum Sehat", "Rp350.000", 460));
    const hash = await perceptualHash(photo);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(await perceptualHash(photo)).toBe(hash);
  });

  it("stays within the reuse threshold when the same picture is resized and re-encoded at low quality", async () => {
    const svg = receiptSvg("Klinik Gigi Senyum Sehat", "Rp350.000", 460);
    const original = await receiptJpeg(svg);
    const recompressed = await sharp(original).resize(300).jpeg({ quality: 35 }).toBuffer();
    const asPng = await sharp(original).resize(450).png().toBuffer();
    const a = await perceptualHash(original);
    expect(hammingDistance(a, await perceptualHash(recompressed))).toBeLessThanOrEqual(REUSE_MAX_HAMMING_BITS);
    expect(hammingDistance(a, await perceptualHash(asPng))).toBeLessThanOrEqual(REUSE_MAX_HAMMING_BITS);
  });

  it("follows EXIF orientation, so a phone photo stored sideways matches the upright one", async () => {
    const upright = await receiptJpeg(receiptSvg("Klinik Gigi Senyum Sehat", "Rp350.000", 460));
    // Pixels turned a quarter left, with EXIF saying to turn them back right.
    const sideways = await sharp(upright).rotate(-90).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect(hammingDistance(await perceptualHash(upright), await perceptualHash(sideways))).toBeLessThanOrEqual(
      REUSE_MAX_HAMMING_BITS,
    );
  });

  it("puts a genuinely different picture beyond the reuse threshold", async () => {
    const receipt = await receiptJpeg(receiptSvg("Klinik Gigi Senyum Sehat", "Rp350.000", 460));
    const other = await sharp(Buffer.from(otherPhotoSvg)).jpeg().toBuffer();
    expect(hammingDistance(await perceptualHash(receipt), await perceptualHash(other))).toBeGreaterThan(
      REUSE_MAX_HAMMING_BITS,
    );
  });

  it("puts another receipt with the same paper and layout beyond the reuse threshold", async () => {
    const receipt = await receiptJpeg(receiptSvg("Klinik Gigi Senyum Sehat", "Rp350.000", 460));
    const another = await receiptJpeg(receiptSvg("Apotek Lain Jaya Makmur", "Rp1.200.000", 120));
    expect(hammingDistance(await perceptualHash(receipt), await perceptualHash(another))).toBeGreaterThan(
      REUSE_MAX_HAMMING_BITS,
    );
  });
});

describe("hammingDistance", () => {
  it("counts the differing bits of two 64-bit hashes", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance("0000000000000000", "000000000000000f")).toBe(4);
    expect(hammingDistance("ffffffffffffffff", "0000000000000000")).toBe(64);
    expect(hammingDistance("8000000000000001", "0000000000000000")).toBe(2);
  });
});

describe("fileSha256", () => {
  it("is the lowercase hex SHA-256 of the bytes", () => {
    expect(fileSha256(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("fieldsKey", () => {
  const facts = { clinicName: "Klinik Gigi Senyum Sehat", proofDate: "2026-08-14", totalRupiah: 350_000 };

  it("is absent unless the clinic name, date and total were all read", () => {
    expect(fieldsKey(undefined)).toBeUndefined();
    expect(fieldsKey({ ...facts, clinicName: undefined })).toBeUndefined();
    expect(fieldsKey({ ...facts, proofDate: undefined })).toBeUndefined();
    expect(fieldsKey({ ...facts, totalRupiah: undefined })).toBeUndefined();
  });

  it("keeps a zero total, which was read", () => {
    expect(fieldsKey({ ...facts, totalRupiah: 0 })).toBeDefined();
  });

  it("ignores case, accents, punctuation and spacing in the clinic name", () => {
    expect(fieldsKey({ ...facts, clinicName: "  KLINIK gígi, Senyum-Sehat. " })).toBe(fieldsKey(facts));
  });

  it("differs when the date or the total differs", () => {
    const key = fieldsKey(facts);
    expect(fieldsKey({ ...facts, proofDate: "2026-08-15" })).not.toBe(key);
    expect(fieldsKey({ ...facts, totalRupiah: 350_001 })).not.toBe(key);
    expect(fieldsKey({ ...facts, clinicName: "Klinik Gigi Senyum Ceria" })).not.toBe(key);
  });
});

describe("fingerprintOf", () => {
  const facts = { clinicName: "Klinik Gigi Senyum Sehat", proofDate: "2026-08-14", totalRupiah: 350_000 };

  it("hashes a PDF's bytes and adds the facts key", async () => {
    const bytes = Buffer.from("%PDF-1.4 receipt");
    expect(await fingerprintOf({ bytes, mimeType: "application/pdf" }, facts)).toEqual({
      fileSha256: fileSha256(bytes),
      fieldsKey: fieldsKey(facts),
    });
  });

  it("perceptually hashes an image, without a facts key when nothing was read", async () => {
    const bytes = await receiptJpeg(receiptSvg("Klinik Gigi Senyum Sehat", "Rp350.000", 460));
    expect(await fingerprintOf({ bytes, mimeType: "image/jpeg" }, undefined)).toEqual({
      perceptualHash: await perceptualHash(bytes),
    });
  });
});

describe("fingerprintMatch", () => {
  const hash = "00000000000000ff";

  it("lists every way two fingerprints match", () => {
    expect(
      fingerprintMatch(
        { fieldsKey: "k", fileSha256: "aa", perceptualHash: hash },
        { fieldsKey: "k", fileSha256: "aa", perceptualHash: hash },
      ),
    ).toEqual(["fieldsKey", "fileHash", "perceptualHash"]);
  });

  it("is empty when nothing matches, and absent fields never match", () => {
    expect(fingerprintMatch({ fieldsKey: "k" }, { fieldsKey: "j" })).toEqual([]);
    expect(fingerprintMatch({}, {})).toEqual([]);
    expect(fingerprintMatch({ fileSha256: "aa" }, { perceptualHash: hash })).toEqual([]);
  });

  it("matches images up to 10 differing bits, not 11", () => {
    expect(fingerprintMatch({ perceptualHash: "0000000000000000" }, { perceptualHash: "00000000000003ff" })).toEqual([
      "perceptualHash",
    ]);
    expect(fingerprintMatch({ perceptualHash: "0000000000000000" }, { perceptualHash: "00000000000007ff" })).toEqual(
      [],
    );
  });
});
