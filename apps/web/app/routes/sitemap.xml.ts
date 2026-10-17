import { sitemapPaths, sitemapXml } from "~/server/sitemap.server";
import type { Route } from "./+types/sitemap.xml";

/** Absolute URLs on the origin the request came in on. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const xml = sitemapXml(new URL(request.url).origin, await sitemapPaths(context.firestore));
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
