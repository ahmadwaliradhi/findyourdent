// Receipt-like JPEGs for Proof of Visit tests (spec 09). The Proof Fingerprint's
// perceptual hash sees an image at 32x32 pixels, where two solid colours, or two mostly
// blank receipts, look alike. Each receipt here prints a logo block and line items whose
// places and lengths follow its label, so receipts with different labels never look
// alike, and `nearCopy` is the same receipt photographed again.
import sharp from "sharp";

/** Numbers in [0, 1) that always come out the same for a label (FNV-1a seed, then an LCG). */
function drawsFor(label: string, count: number): number[] {
  let seed = 0x811c9dc5;
  for (const char of label) seed = Math.imul(seed ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return Array.from({ length: count }, () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 2 ** 32;
  });
}

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (char) => `&#${char.codePointAt(0)};`);

/**
 * A 480x640 receipt: the label printed on top and eight thick line items whose place,
 * length and grey follow the label (thick, so they show at 32x32).
 */
export async function receiptJpeg(label: string): Promise<Buffer> {
  const draws = drawsFor(label, 64);
  const next = () => draws.pop() ?? 0;
  const items = Array.from({ length: 8 }, (_, i) => {
    const grey = Math.round(next() * 200);
    const x = Math.round(next() * 240);
    const width = Math.min(120 + Math.round(next() * 220), 480 - x);
    return `<rect x="${x}" y="${100 + i * 66}" width="${width}" height="50" fill="rgb(${grey},${grey},${grey})"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640">
    <rect width="100%" height="100%" fill="#fdfcf7"/>
    <text x="24" y="48" font-size="26" font-family="sans-serif">${escapeXml(label)}</text>
    ${items}
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

/** The same receipt photographed again: 1% cropped off each edge, 5% brighter, saved at a lower quality. */
export async function nearCopy(jpeg: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(jpeg).metadata();
  const dx = Math.round(width * 0.01);
  const dy = Math.round(height * 0.01);
  return sharp(jpeg)
    .extract({ left: dx, top: dy, width: width - 2 * dx, height: height - 2 * dy })
    .modulate({ brightness: 1.05 })
    .jpeg({ quality: 75 })
    .toBuffer();
}
