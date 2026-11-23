import { attachProof } from "~/server/testimonies.server";
import type { Route } from "./+types/api.testimonies.$testimonyId.proof";

const notAllowed = () => Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });

/**
 * Web API, author only: POST /api/testimonies/:testimonyId/proof, multipart with one
 * `proof` file (spec 09, attach proof later). 200 ProofAttachResponse, or a TestimonyApiError.
 */
export function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") return notAllowed();
  return attachProof(context, request, params.testimonyId);
}

export function loader() {
  return notAllowed();
}
