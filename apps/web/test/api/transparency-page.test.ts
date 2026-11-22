import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../support/harness.ts";

// The transparency page "Cara kami memverifikasi testimoni" (spec 09, issue #125).

const TRANSPARENCY_PATH = "/verifikasi-testimoni";

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

async function fetchPage(path: string, language?: "en"): Promise<{ status: number; html: string }> {
  let cookie: string | undefined;
  if (language) {
    const toggle = await fetch(new URL("/language", server.baseUrl), {
      method: "POST",
      body: new URLSearchParams({ lang: language, redirectTo: path }),
      redirect: "manual",
    });
    cookie = toggle.headers.get("set-cookie")?.split(";")[0];
  }
  const response = await fetch(new URL(path, server.baseUrl), { headers: cookie ? { cookie } : {} });
  return { status: response.status, html: await response.text() };
}

/** Text of a page plus its meta description: scripts, styles and tags dropped, common entities decoded. */
function text(page: string): string {
  const description = page.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
  return `${description} ${page.replace(/^[\s\S]*?<body[^>]*>/, "")}`
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe(`GET ${TRANSPARENCY_PATH}`, () => {
  it("renders server-side in Indonesian and is indexable", async () => {
    const page = await fetchPage(TRANSPARENCY_PATH);

    expect(page.status).toBe(200);
    expect(page.html).toMatch(/<html[^>]*lang="id"/);
    expect(page.html).toMatch(/<h1[^>]*>Cara kami memverifikasi testimoni<\/h1>/);
    expect(page.html).not.toMatch(/<meta[^>]+name="robots"/);
  });

  it("states what counts, how proof is checked and kept, the minimum of three, and the policy", async () => {
    const body = text((await fetchPage(TRANSPARENCY_PATH)).html);

    expect(body).toContain("Hanya Testimoni terbukti yang dihitung");
    expect(body).toContain("nilai, urutan, dan harga");
    expect(body).toContain("Bukti Kunjungan");
    expect(body).toContain("dihapus segera setelah diperiksa");
    expect(body).toContain("paling lama 7 hari");
    expect(body).toContain("minimal tiga Testimoni terbukti");
    expect(body).toContain("FindYourDent tidak pernah membayar");
    expect(body).toContain("tidak boleh menawarkan imbalan apa pun");
    expect(body).toContain("hanya kepada pasien tertentu");
    expect(body).toContain("ditampilkan secara publik");
  });

  it("switches to English with the language toggle", async () => {
    const page = await fetchPage(TRANSPARENCY_PATH, "en");

    expect(page.html).toMatch(/<html[^>]*lang="en"/);
    expect(page.html).toMatch(/<h1[^>]*>How we verify Testimonies<\/h1>/);
    expect(text(page.html)).toContain("Only Proven Testimonies count");
  });

  it("names no detection threshold, in either language", async () => {
    // The detection thresholds of spec 09 part 2 (velocity, similarity, image reuse) stay private.
    const thresholds = [
      /\b24\s*(jam|hours?)\b/i,
      /\b(sehari|1\s*hari|one day|a day)\b/i,
      /\b(3|tiga|three)\s+(atau lebih|or more)/i,
      /\b(5|lima|five)\s+(atau lebih|or more|testimoni|testimonies)/i,
      /\b0[.,]8\b/,
      /\b80\s*%/,
      /\b10\s*bit/i,
      /hamming/i,
      /jaccard/i,
      /trigram/i,
    ];
    for (const language of [undefined, "en"] as const) {
      const body = text((await fetchPage(TRANSPARENCY_PATH, language)).html);
      for (const threshold of thresholds) expect(body).not.toMatch(threshold);
    }
  });

  it("is linked from the footer and from the Testimony form", async () => {
    const link = new RegExp(`<a[^>]+href="${TRANSPARENCY_PATH}"`);

    const formLink = new RegExp(`<a[^>]+href="${TRANSPARENCY_PATH}"[^>]*>Cara kami memverifikasi testimoni</a>`);

    expect((await fetchPage("/")).html).toMatch(link);
    const form = (await fetchPage("/ceritakan")).html;
    // The form's own link sits in the Proof of Visit field, before the footer.
    const proofField = form.slice(form.indexOf("Bukti kunjungan (opsional, pribadi)"), form.indexOf("<footer"));
    expect(proofField).toMatch(formLink);
  });

  it("is in the sitemap", async () => {
    const xml = await (await fetch(new URL("/sitemap.xml", server.baseUrl))).text();

    expect(xml).toContain(`<loc>${server.baseUrl}${TRANSPARENCY_PATH}</loc>`);
  });
});
