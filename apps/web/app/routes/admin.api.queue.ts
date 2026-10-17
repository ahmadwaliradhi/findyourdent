import { adminQueueResponse } from "~/server/admin-queue.server";
import type { Route } from "./+types/admin.api.queue";

/** Admin API: GET /admin/api/queue, an AdminQueueResponse. Allowlisted admins only (server/auth.ts gate). */
export function loader({ request, context }: Route.LoaderArgs) {
  return adminQueueResponse(context, request);
}
