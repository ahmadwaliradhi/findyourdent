import { deleteTestimony, editTestimony } from "~/server/testimonies.server";
import type { Route } from "./+types/api.testimonies.$testimonyId";

const notAllowed = () =>
  Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST, DELETE" } });

/**
 * Web API, author only:
 * - POST /api/testimonies/:testimonyId: edit (same multipart body as create), 200 TestimonySubmitResponse;
 * - DELETE /api/testimonies/:testimonyId: delete permanently, 200 { testimonyId, status: "deleted" }.
 */
export function action({ request, params, context }: Route.ActionArgs) {
  if (request.method === "POST") return editTestimony(context, request, params.testimonyId);
  if (request.method === "DELETE") return deleteTestimony(context, request, params.testimonyId);
  return notAllowed();
}

export function loader() {
  return notAllowed();
}
