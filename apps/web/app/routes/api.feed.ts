import { parseListingFilters } from "~/lib/listing-filters";
import { FeedCursorError, loadFeedPage } from "~/server/feed.server";
import type { Route } from "./+types/api.feed";

/**
 * Web API: GET /api/feed?<filter params>&cursor=... returns { items, nextCursor }.
 * Public and free (Firestore only, no Places), so no App Check gate.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  if (!context.firestore) return Response.json({ items: [], nextCursor: null });
  try {
    const page = await loadFeedPage(context.firestore, parseListingFilters(params), params.get("cursor") ?? undefined);
    return Response.json(page);
  } catch (error) {
    if (error instanceof FeedCursorError) return Response.json({ error: "invalid_cursor" }, { status: 400 });
    throw error;
  }
}
