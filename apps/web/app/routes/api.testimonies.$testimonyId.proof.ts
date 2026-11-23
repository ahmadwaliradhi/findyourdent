import { attachProof } from "~/server/testimonies.server";
import type { Route } from "./+types/api.testimonies.$testimonyId.proof";

const notAllowed = () => Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });

/**
 * Web API, author only: POST /api/testimonies/:testimonyId/proof attaches a Proof of
 * Visit (multipart field `proof`) to a published Testimony, 200 TestimonyProofResponse.
 */
export function action({ request, params, context }: Route.ActionArgs) {
  if (request.method === "POST") return attachProof(context, request, params.testimonyId);
  return notAllowed();
}

export function loader() {
  return notAllowed();
}
