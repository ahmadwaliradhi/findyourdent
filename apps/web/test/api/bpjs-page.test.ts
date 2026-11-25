import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../support/harness.ts";

// The BPJS Kesehatan and dental care page (spec 07 follow-up to #84; facts file §1, §2, §6).

const BPJS_PATH = "/bpjs";

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

describe(`GET ${BPJS_PATH}`, () => {
  it("renders server-side in Indonesian, indexable, with its own title", async () => {
    const page = await fetchPage(BPJS_PATH);

    expect(page.status).toBe(200);
    expect(page.html).toMatch(/<html[^>]*lang="id"/);
    expect(page.html).toMatch(/<h1[^>]*>BPJS Kesehatan dan perawatan gigi<\/h1>/);
    expect(page.html).toMatch(/<title>BPJS Kesehatan dan perawatan gigi \| FindYourDent<\/title>/);
    expect(page.html).toMatch(/<meta name="description" content="[^"]+"/);
    expect(page.html).not.toMatch(/<meta[^>]+name="robots"/);
  });

  it("switches to English with the language toggle", async () => {
    const page = await fetchPage(BPJS_PATH, "en");

    expect(page.html).toMatch(/<html[^>]*lang="en"/);
    expect(page.html).toMatch(/<h1[^>]*>BPJS Kesehatan and dental care<\/h1>/);
    expect(page.html).toMatch(/<title>BPJS Kesehatan and dental care \| FindYourDent<\/title>/);
  });

  it("says covered care happens at the registered FKTP, that any clinic with a card is not covered, and what needs a referral", async () => {
    const body = text((await fetchPage(BPJS_PATH)).html);

    expect(body).toContain("FKTP tempat Anda terdaftar");
    expect(body).toContain("kartu BPJS tidak berarti ditanggung");
    expect(body).toContain("Rp1.000.000");
    expect(body).toContain("rujukan");
    expect(body).toContain("saluran akar");
    expect(body).toContain("Mobile JKN");
    expect(body).toContain("setelah 3 bulan");
    expect(body).toContain("Cara bayar pasien");
    expect(body).toContain("bukan apa yang diterima tempat itu");
  });

  it("does not promise a scaling frequency, in either language", async () => {
    for (const language of [undefined, "en"] as const) {
      const body = text((await fetchPage(BPJS_PATH, language)).html);
      expect(body).not.toMatch(/(1|satu|once)\s*(x|kali|a|per)?\s*(setahun|year|tahun)/i);
    }
  });

  it("lists its regulation sources", async () => {
    const html = (await fetchPage(BPJS_PATH)).html;

    expect(html).toContain("Permenkes 3/2023");
    expect(html).toContain("Perpres 82/2018");
    expect(html).toContain("Perpres 59/2024");
    expect(html).toContain("https://peraturan.bpk.go.id/Details/275518/permenkes-no-3-tahun-2023");
  });

  it("carries the educational disclaimer and an #fktp anchor", async () => {
    const html = (await fetchPage(BPJS_PATH)).html;

    expect(text(html)).toContain("bukan diagnosis");
    expect(html).toMatch(/<section[^>]+id="fktp"/);
  });

  it("is in the sitemap", async () => {
    const xml = await (await fetch(new URL("/sitemap.xml", server.baseUrl))).text();

    expect(xml).toContain(`<loc>${server.baseUrl}${BPJS_PATH}</loc>`);
  });
});
