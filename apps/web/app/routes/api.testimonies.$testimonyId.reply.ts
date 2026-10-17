import { saveReplyResponse } from "~/server/claims.server";
import type { Route } from "./+types/api.testimonies.$testimonyId.reply";

const notAllowed = () => Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });

/**
 * Web API: POST /api/testimonies/:testimonyId/reply with ReplySubmission, by the
 * approved claimant of the Testimony's place only. One reply per Testimony: sending
 * again edits it. 200 OwnerContentResponse or a ClaimApiError. There is no DELETE.
 */
export function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") return notAllowed();
  return saveReplyResponse(context, request, params.testimonyId);
}

export function loader() {
  return notAllowed();
}
