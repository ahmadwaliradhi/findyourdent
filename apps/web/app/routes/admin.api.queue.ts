import { loadAdminQueue } from "~/server/admin-queue.server";
import type { Route } from "./+types/admin.api.queue";

/** Admin API: GET /admin/api/queue, an AdminQueueResponse. Allowlisted admins only (server/auth.ts gate). */
export async function loader({ context }: Route.LoaderArgs) {
  if (!context.admin) return Response.json({ error: "not_allowed" }, { status: 403 });
  if (!context.firestore) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json(await loadAdminQueue(context.firestore), { headers: { "Cache-Control": "no-store" } });
}
