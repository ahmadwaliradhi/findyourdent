import { readImpactCounter } from "~/server/impact.server";
import type { Route } from "./+types/dampak";

/**
 * Public read-only impact counter (spec 04), for the landing page and the deck:
 * GET /dampak -> { testimoniesPublished, kotaCovered, verifiedVisits, listedProviders, guidanceSessionsCompleted }.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const counts = await readImpactCounter(context.firestore);
  return Response.json(counts, { headers: { "Cache-Control": "public, max-age=60" } });
}
