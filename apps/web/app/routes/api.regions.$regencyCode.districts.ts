import { districtsOf } from "~/server/districts.server";
import type { Route } from "./+types/api.regions.$regencyCode.districts";

/**
 * The kecamatan of one kota/kabupaten, for the Kecamatan select of the Region fields (spec 08):
 * GET /api/regions/31.71/districts -> { districts: [{ code: "31.71.01", name: "Gambir" }, ...] }.
 * The list only changes with a new Kemendagri decree, so browsers and the CDN may keep it a day.
 */
export function loader({ params }: Route.LoaderArgs) {
  const districts = districtsOf(params.regencyCode);
  if (!districts) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ districts }, { headers: { "Cache-Control": "public, max-age=86400" } });
}
