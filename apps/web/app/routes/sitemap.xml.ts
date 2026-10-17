import { COLLECTIONS } from "@findyourdent/contracts/firestore";
import { providerPath } from "~/lib/paths";
import type { Route } from "./+types/sitemap.xml";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * XML sitemap (spec 04): the landing page, the directory and every Listed
 * Provider page, as absolute URLs on the origin the request came in on.
 * Reads only document ids from `providers`; no Places call.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const origin = new URL(request.url).origin;
  const paths = ["/", "/direktori"];
  if (context.firestore) {
    const providers = await context.firestore.collection(COLLECTIONS.providers).select().get();
    for (const doc of providers.docs) paths.push(providerPath(doc.id));
  }
  const urls = paths.map((path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
