// XML sitemap (spec 04). Reads only document ids from `providers`; no Places call.
import { COLLECTIONS } from "@findyourdent/contracts/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { providerPath } from "~/lib/paths";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** The landing page, the directory and every Listed Provider page. */
export async function sitemapPaths(firestore: Firestore | null): Promise<string[]> {
  const paths = ["/", "/direktori"];
  if (!firestore) return paths;
  const providers = await firestore.collection(COLLECTIONS.providers).select().get();
  for (const doc of providers.docs) paths.push(providerPath(doc.id));
  return paths;
}

/** A sitemap of absolute URLs on `origin`. */
export function sitemapXml(origin: string, paths: string[]): string {
  const urls = paths.map((path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
