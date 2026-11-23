import { proofFileResponse } from "~/server/proof-review.server";
import type { Route } from "./+types/admin.proofs.$testimonyId.file";

/** The private file of a pending Proof of Visit, for allowlisted admins only (server/auth.ts gate). */
export function loader({ params, context }: Route.LoaderArgs) {
  return proofFileResponse(context, params.testimonyId);
}
