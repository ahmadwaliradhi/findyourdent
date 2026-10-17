import type { AppLoadContext } from "react-router";
import { getI18n } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import { APP_CHECK_HEADER } from "~/lib/app-check";
import type { RateLimitRule } from "../../server/rate-limit.ts";

export type ProtectionErrorCode = "app_check_required" | "rate_limited";

export type ProtectionOutcome =
  | { ok: true }
  | { ok: false; status: 401 | 429; error: ProtectionErrorCode; retryAfterSeconds?: number };

/**
 * What a paid request may trigger, each with its own counters:
 * - `guidance`: a new Guidance session (a Gemini call);
 * - `guidanceFollowUp`: the answer to its one follow-up question, counted apart
 *   so a session with a follow-up still costs one of the hourly sessions;
 * - `places`: a Places-backed request (Shortlist, Provider detail, picker);
 * - `testimony`: a Testimony submission by a signed-in account.
 */
export type PaidRoute = "guidance" | "guidanceFollowUp" | "places" | "testimony";

export interface PaidRequest {
  request: Request;
  route: PaidRoute;
  /** Opaque Guidance session id from the __session cookie. Required for guidance and places. */
  sessionId?: string;
  /** Signed-in account. Required for testimony. */
  uid?: string;
  /** Token from the form body, for routes that take a form post instead of fetch. */
  formToken?: FormDataEntryValue | null;
}

/**
 * A follow-up answer counts apart only inside an existing session; a request that
 * claims to be a follow-up from a brand-new session is charged as a new session.
 */
export function guidanceRoute(followUpAnswer: unknown, newSession: boolean): PaidRoute {
  return followUpAnswer && !newSession ? "guidanceFollowUp" : "guidance";
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

function rulesFor(context: AppLoadContext, paid: PaidRequest, appCheckToken: string): RateLimitRule[] {
  const { limits } = context.config;
  const rules: RateLimitRule[] = [
    { scope: "ip", key: context.clientIp, route: "all", limit: limits.ipPerHour, windowSeconds: HOUR },
  ];
  const perBrowser = (limit: number) => {
    rules.push({ scope: "appCheck", key: appCheckToken, route: paid.route, limit, windowSeconds: HOUR });
    if (paid.sessionId) {
      rules.push({ scope: "session", key: paid.sessionId, route: paid.route, limit, windowSeconds: HOUR });
    }
  };
  switch (paid.route) {
    case "guidance":
    case "guidanceFollowUp":
      perBrowser(limits.guidanceSessionsPerHour);
      break;
    case "places":
      perBrowser(limits.placesPerHour);
      break;
    case "testimony":
      if (!paid.uid) throw new Error("testimony rate limit needs a signed-in uid");
      rules.push({
        scope: "user",
        key: paid.uid,
        route: paid.route,
        limit: limits.testimoniesPerDay,
        windowSeconds: DAY,
      });
      break;
  }
  return rules;
}

/**
 * Gate for every web API route that can trigger Places, Gemini or a write:
 * App Check first, then the rate limits. Call it before parsing or validating
 * anything else, so a refused request never reaches an adapter.
 */
export async function protectPaidRequest(context: AppLoadContext, paid: PaidRequest): Promise<ProtectionOutcome> {
  const fromHeader = paid.request.headers.get(APP_CHECK_HEADER);
  const token = fromHeader || (typeof paid.formToken === "string" ? paid.formToken : "");
  if (!token || !(await context.adapters.appCheck.verify(token))) {
    context.logger.warn("protection", { outcome: "app_check_required", route: paid.route });
    return { ok: false, status: 401, error: "app_check_required" };
  }

  const limited = await context.rateLimiter.consume(rulesFor(context, paid, token));
  if (!limited.ok) {
    context.logger.warn("protection", { outcome: "rate_limited", route: paid.route, scope: limited.scope });
    return { ok: false, status: 429, error: "rate_limited", retryAfterSeconds: limited.retryAfterSeconds };
  }
  return { ok: true };
}

type Refusal = Extract<ProtectionOutcome, { ok: false }>;

export function setRetryAfter(headers: Headers, refusal: Refusal): void {
  if (refusal.retryAfterSeconds !== undefined) headers.set("Retry-After", String(refusal.retryAfterSeconds));
}

/** JSON refusal for fetch callers: the error code plus the friendly message in the Patient's language. */
export async function protectionRefusalResponse(request: Request, refusal: Refusal): Promise<Response> {
  const language = await detectLanguage(request);
  const message = getI18n(language).getFixedT(language)(`errors.${refusal.error}`);
  const headers = new Headers();
  setRetryAfter(headers, refusal);
  return Response.json({ error: refusal.error, message }, { status: refusal.status, headers });
}
