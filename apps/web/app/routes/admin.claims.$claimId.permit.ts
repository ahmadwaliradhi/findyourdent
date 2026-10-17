import { permitResponse } from "~/server/claims.server";
import type { Route } from "./+types/admin.claims.$claimId.permit";

/** The private permit of a submitted Claim, for allowlisted admins only (server/auth.ts gate). */
export function loader({ params, context }: Route.LoaderArgs) {
  return permitResponse(context, params.claimId);
}
