import { proofFileResponse } from "~/server/proof-review.server";
import type { Route } from "./+types/admin.proofs.$testimonyId";

/** A Proof of Visit waiting for the team, for allowlisted admins only (server/auth.ts gate). */
export function loader({ params, context }: Route.LoaderArgs) {
  return proofFileResponse(context, params.testimonyId);
}
