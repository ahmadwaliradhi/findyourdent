import { reportTestimony } from "~/server/reports.server";
import type { Route } from "./+types/api.testimonies.$testimonyId.reports";

const notAllowed = () => Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });

/**
 * Web API: POST /api/testimonies/:testimonyId/reports with a ReportRequest. Anyone may
 * report; App Check and a per-browser hourly limit apply. 201 ReportResponse.
 */
export function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") return notAllowed();
  return reportTestimony(context, request, params.testimonyId);
}

export function loader() {
  return notAllowed();
}
