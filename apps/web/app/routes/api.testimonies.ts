import { createTestimony } from "~/server/testimonies.server";
import type { Route } from "./+types/api.testimonies";

const notAllowed = () => Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });

/**
 * Web API: POST /api/testimonies, multipart (`testimony` JSON + `photos` + `proof`).
 * 201 TestimonySubmitResponse, or a TestimonyApiError.
 */
export function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return notAllowed();
  return createTestimony(context, request);
}

export function loader() {
  return notAllowed();
}
