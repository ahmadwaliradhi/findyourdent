import { adminActionResponse } from "~/server/admin-queue.server";
import type { Route } from "./+types/admin.api.actions";

const notAllowed = () => Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });

/**
 * Admin API: POST /admin/api/actions with an AdminActionRequest. Allowlisted admins
 * only (server/auth.ts gate); every action is logged in adminActions. 200 AdminActionResponse.
 */
export function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return notAllowed();
  return adminActionResponse(context, request);
}

export function loader() {
  return notAllowed();
}
