import { randomBytes } from "node:crypto";
import type { App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { PublicFirebaseConfig } from "../app/lib/firebase-config.ts";
import { type AgentAdapter, createHttpAgentAdapter, createMetadataIdTokenSource } from "./adapters/agent.ts";
import {
  type AppCheckVerifier,
  createDebugAppCheckVerifier,
  createFirebaseAppCheckVerifier,
} from "./adapters/app-check.ts";
import { createFakeAgentAdapter, createFakeGeminiAdapter, createFakePlacesAdapter } from "./adapters/fakes.ts";
import type { GeminiAdapter } from "./adapters/gemini.ts";
import { createGooglePlacesAdapter, type PlacesAdapter } from "./adapters/places.ts";
import type { SignedInUser } from "./auth.ts";
import { initFirebaseAdmin } from "./firebase.ts";
import { type Logger, logger } from "./logger.ts";
import { createFirestoreDailyQuota, createMemoryDailyQuota } from "./quota.ts";
import { createFirestoreRateLimiter, createMemoryRateLimiter, type RateLimiter } from "./rate-limit.ts";

/** Rate limits from spec 00. Each can be overridden by the environment variable named beside it. */
export interface RateLimits {
  /** Per App Check token and per session. RATE_LIMIT_GUIDANCE_PER_HOUR */
  guidanceSessionsPerHour: number;
  /** Per App Check token and per session. RATE_LIMIT_PLACES_PER_HOUR */
  placesPerHour: number;
  /** Per signed-in account. RATE_LIMIT_TESTIMONIES_PER_DAY */
  testimoniesPerDay: number;
  /** High on purpose: Indonesian mobile carriers put many people behind one IP. RATE_LIMIT_IP_PER_HOUR */
  ipPerHour: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  guidanceSessionsPerHour: 10,
  placesPerHour: 30,
  testimoniesPerDay: 5,
  ipPerHour: 300,
};

/** Everything server code reaches through React Router's load context. */
export interface WebContext {
  adapters: {
    agent: AgentAdapter;
    places: PlacesAdapter;
    gemini: GeminiAdapter;
    appCheck: AppCheckVerifier;
  };
  /** null when Firebase is not configured (plain local UI work). */
  firestore: Firestore | null;
  /** null when Firebase is not configured. */
  auth: Auth | null;
  rateLimiter: RateLimiter;
  /** Set only on admin URLs, after the allowlist gate (server/auth.ts) let the request through. */
  admin: SignedInUser | null;
  /** The caller's IP as Express resolved it (`trust proxy`); used only for the per-IP ceiling. */
  clientIp: string;
  /** Logger bound to this request's request_id. */
  logger: Logger;
  /** Cloud Run trace id, else a random one; also sent back as X-Request-Id. */
  requestId: string;
  config: {
    production: boolean;
    limits: RateLimits;
    /** Admin allowlist (ADMIN_EMAILS, from the `admin-emails` secret): the team's two Google accounts. */
    adminEmails: string[];
    /** Public values the browser needs for Google sign-in and App Check. */
    firebaseWeb: PublicFirebaseConfig;
    /** Signs shareable Guidance links (app/server/share.server.ts). */
    shareLinkSecret: string;
  };
}

/** The per-process part of the context; createApp adds the per-request fields. */
export type BaseContext = Omit<WebContext, "requestId" | "clientIp" | "admin">;

declare module "react-router" {
  interface AppLoadContext extends WebContext {}
}

/** Wiring from environment variables. Tests build their own context with fakes. */
export function createContextFromEnv(env: NodeJS.ProcessEnv = process.env): BaseContext {
  const firebase = initFirebaseAdmin(env);
  const production = env.NODE_ENV === "production";
  if (production && !env.RATE_LIMIT_SALT) {
    throw new Error("RATE_LIMIT_SALT must be set in production (secret rate-limit-salt)");
  }
  const agentUrl = (env.AGENT_URL ?? "http://localhost:8000").replace(/\/+$/, "");
  // On Cloud Run (AGENT_AUTH=id_token) every call carries a fyd-web identity token.
  const idToken = env.AGENT_AUTH === "id_token" ? createMetadataIdTokenSource({ audience: agentUrl }) : undefined;
  const agent =
    env.AGENT_ADAPTER === "fake" ? createFakeAgentAdapter() : createHttpAgentAdapter({ baseUrl: agentUrl, idToken });
  let shareLinkSecret = env.SHARE_LINK_SECRET;
  if (!shareLinkSecret) {
    // A per-process secret works locally; on Cloud Run, links would break across
    // instances and restarts, so production needs the secret set.
    shareLinkSecret = randomBytes(32).toString("base64url");
    if (env.NODE_ENV === "production") logger.warn("config", { outcome: "share_link_secret_missing" });
  }
  return {
    adapters: {
      agent,
      places: placesAdapter(env, firebase?.firestore ?? null),
      // The real Gemini adapter arrives with specs 03 and 05.
      gemini: createFakeGeminiAdapter(),
      appCheck: appCheckVerifier(env, production, firebase?.app ?? null),
    },
    firestore: firebase?.firestore ?? null,
    auth: firebase?.auth ?? null,
    rateLimiter: rateLimiter(env.RATE_LIMIT_SALT, firebase?.firestore ?? null),
    logger,
    config: {
      production,
      limits: rateLimitsFromEnv(env),
      adminEmails: (env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean),
      firebaseWeb: firebaseWebFromEnv(env, production, firebase?.projectId ?? null),
      shareLinkSecret,
    },
  };
}

/**
 * Real Places only with a key (the `places-api-key` secret) and PLACES_ADAPTER not
 * set to fake. Daily caps count in Firestore so every instance shares them.
 */
function placesAdapter(env: NodeJS.ProcessEnv, firestore: Firestore | null): PlacesAdapter {
  if (env.PLACES_ADAPTER === "fake" || !env.PLACES_API_KEY) return createFakePlacesAdapter();
  const quota = firestore ? createFirestoreDailyQuota(firestore) : createMemoryDailyQuota();
  return createGooglePlacesAdapter({ apiKey: env.PLACES_API_KEY, quota });
}

/**
 * Production always verifies real App Check tokens. Elsewhere APP_CHECK_DEBUG_TOKEN,
 * when set, is the one token accepted, so local runs and CI need no reCAPTCHA.
 */
function appCheckVerifier(env: NodeJS.ProcessEnv, production: boolean, app: App | null): AppCheckVerifier {
  const debugToken = env.APP_CHECK_DEBUG_TOKEN ?? "";
  if (!production && debugToken) return createDebugAppCheckVerifier(debugToken);
  if (production && debugToken) logger.warn("APP_CHECK_DEBUG_TOKEN is ignored in production");
  if (app) return createFirebaseAppCheckVerifier(app);
  // No Firebase and no debug token: every paid route refuses, which is the safe default.
  return createDebugAppCheckVerifier("");
}

function rateLimiter(configuredSalt: string | undefined, firestore: Firestore | null): RateLimiter {
  // Outside production a random per-process salt is fine: one process, one set of counters.
  const salt = configuredSalt || crypto.randomUUID();
  return firestore ? createFirestoreRateLimiter(firestore, { salt }) : createMemoryRateLimiter({ salt });
}

function rateLimitsFromEnv(env: NodeJS.ProcessEnv): RateLimits {
  const read = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };
  return {
    guidanceSessionsPerHour: read("RATE_LIMIT_GUIDANCE_PER_HOUR", DEFAULT_RATE_LIMITS.guidanceSessionsPerHour),
    placesPerHour: read("RATE_LIMIT_PLACES_PER_HOUR", DEFAULT_RATE_LIMITS.placesPerHour),
    testimoniesPerDay: read("RATE_LIMIT_TESTIMONIES_PER_DAY", DEFAULT_RATE_LIMITS.testimoniesPerDay),
    ipPerHour: read("RATE_LIMIT_IP_PER_HOUR", DEFAULT_RATE_LIMITS.ipPerHour),
  };
}

function firebaseWebFromEnv(
  env: NodeJS.ProcessEnv,
  production: boolean,
  projectId: string | null,
): PublicFirebaseConfig {
  const appCheckDebugToken = production ? null : env.APP_CHECK_DEBUG_TOKEN || null;
  const authEmulatorHost = production ? undefined : env.FIREBASE_AUTH_EMULATOR_HOST;
  // The Auth emulator accepts any API key.
  const apiKey = env.FIREBASE_WEB_API_KEY ?? (authEmulatorHost ? "demo-api-key" : undefined);
  if (!apiKey || !projectId) return { app: null, appCheckDebugToken };
  return {
    app: {
      apiKey,
      projectId,
      authDomain: env.FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
      appId: env.FIREBASE_WEB_APP_ID ?? "",
      recaptchaSiteKey: env.RECAPTCHA_SITE_KEY ?? "",
      authEmulatorUrl: authEmulatorHost ? `http://${authEmulatorHost}` : null,
    },
    appCheckDebugToken,
  };
}
