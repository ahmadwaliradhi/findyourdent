import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../support/harness.ts";

// The transparency page "Cara kami memverifikasi testimoni" (spec 09, ADR-0011).

const PATH = "/verifikasi-testimoni";

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

async function get(path: string, cookie?: string): Promise<{ status: number; html: string }> {
  const response = await fetch(new URL(path, server.baseUrl), cookie ? { headers: { cookie } } : undefined);
  return { status: response.status, html: await response.text() };
}

/** The `__session` cookie the language toggle sets for English. */
async function englishCookie(): Promise<string> {
  const toggle = await fetch(new URL("/language", server.baseUrl), {
    method: "POST",
    body: new URLSearchParams({ lang: "en", redirectTo: PATH }),
    redirect: "manual",
  });
  return (toggle.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/** The text a reader sees in the page's main landmark, tags stripped and entities decoded. */
function mainText(html: string): string {
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? "";
  return main
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The only numbers the policy publishes: the minimum of 3 Proven Testimonies, the 7 days a
 * doubtful proof file may be kept, and the 12-month age limit of a receipt. Any other number
 * (a burst count, a time window, a similarity or hash distance) would leak a detection threshold.
 */
const PUBLISHED_NUMBERS = ["3", "7", "12"];

describe(`GET ${PATH}`, () => {
  it("server-renders the verification rules and the Testimony policy in Indonesian, indexable", async () => {
    const { status, html } = await get(PATH);

    expect(status).toBe(200);
    expect(html).toMatch(/<html[^>]*lang="id"/);
    expect(html).toContain("<title>Cara kami memverifikasi testimoni | FindYourDent</title>");
    expect(html).not.toMatch(/<meta name="robots"/);
    expect(html).toMatch(/<meta name="description" content="[^"]+"/);
    expect(html).toMatch(new RegExp(`<meta property="og:url" content="${server.baseUrl}${PATH}"`));

    const text = mainText(html);
    expect(text).toContain("Cara kami memverifikasi testimoni");
    // Only Proven Testimonies count, toward scores, ranking and prices.
    expect(text).toContain("Hanya Testimoni terbukti yang dihitung");
    expect(text).toMatch(/Kunjungan terbukti/);
    expect(text).toMatch(/Belum terbukti/);
    expect(text).toMatch(/urutan Direktori/);
    expect(text).toMatch(/statistik harga/);
    // The minimum before a star average.
    expect(text).toContain("Minimal 3 Testimoni terbukti");
    expect(text).toContain("Belum cukup testimoni terbukti");
    // How a Proof of Visit is checked, and how long its file is kept.
    expect(text).toMatch(/nama klinik/);
    expect(text).toMatch(/kurang dari 12 bulan/);
    expect(text).toMatch(/langsung dihapus/);
    expect(text).toMatch(/paling lama 7 hari/);
    // The policy.
    expect(text).toContain("FindYourDent tidak pernah membayar atau memberi imbalan untuk Testimoni.");
    expect(text).toMatch(/tidak boleh menawarkan apa pun sebagai imbalan/);
    expect(text).toMatch(/hanya Pasien tertentu/);
    expect(text).toMatch(/ditampilkan secara publik/);
    expect(text).toMatch(/Pelanggaran kebijakan testimoni/);
  });

  it("switches to English with the language toggle", async () => {
    const { status, html } = await get(PATH, await englishCookie());

    expect(status).toBe(200);
    expect(html).toMatch(/<html[^>]*lang="en"/);
    const text = mainText(html);
    expect(text).toContain("How we verify Testimonies");
    expect(text).toContain("Only Testimonies with a verified visit count");
    expect(text).toContain("At least 3 verified Testimonies");
    expect(text).toContain("FindYourDent never pays for or rewards Testimonies.");
  });

  it("is linked from the footer of every page and from the Testimony form", async () => {
    const link = new RegExp(`<a [^>]*href="${PATH}"[^>]*>Cara kami memverifikasi testimoni</a>`);

    for (const path of ["/", "/direktori", PATH]) {
      const footer = (await get(path)).html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
      expect(footer, path).toMatch(link);
    }
    const form = (await get("/ceritakan")).html.match(/<main[^>]*>[\s\S]*?<\/main>/)?.[0] ?? "";
    expect(form).toMatch(link);
  });

  it("states no detection threshold: the only numbers are the published policy numbers", async () => {
    for (const cookie of [undefined, await englishCookie()]) {
      const text = mainText((await get(PATH, cookie)).html);

      const numbers = new Set(text.match(/\d+(?:[.,]\d+)?/g) ?? []);
      expect([...numbers].sort()).toEqual([...PUBLISHED_NUMBERS].sort());
      expect(text).not.toMatch(/hamming|jaccard|trigram|persen|percent|%/i);
    }
  });
});
