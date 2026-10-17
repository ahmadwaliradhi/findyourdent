import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import { type AgentAdapter, createHttpAgentAdapter } from "./adapters/agent.ts";
import { createFakeAgentAdapter, createFakeGeminiAdapter, createFakePlacesAdapter } from "./adapters/fakes.ts";
import type { GeminiAdapter } from "./adapters/gemini.ts";
import type { PlacesAdapter } from "./adapters/places.ts";
import { initFirebaseAdmin } from "./firebase.ts";
import { type Logger, logger } from "./logger.ts";

/** Everything server code reaches through React Router's load context. */
export interface WebContext {
  adapters: {
    agent: AgentAdapter;
    places: PlacesAdapter;
    gemini: GeminiAdapter;
  };
  /** null when Firebase is not configured (plain local UI work). */
  firestore: Firestore | null;
  logger: Logger;
  config: {
    production: boolean;
    /** Signs shareable Guidance links (app/server/share.server.ts). */
    shareLinkSecret: string;
  };
}

declare module "react-router" {
  interface AppLoadContext extends WebContext {}
}

/** Production wiring from environment variables. Tests build their own WebContext with fakes. */
export function createContextFromEnv(env: NodeJS.ProcessEnv = process.env): AppLoadContext {
  const agent =
    env.AGENT_ADAPTER === "fake"
      ? createFakeAgentAdapter()
      : createHttpAgentAdapter({ baseUrl: env.AGENT_URL ?? "http://localhost:8000" });
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
      // Real Places and Gemini adapters arrive with specs 02, 03 and 05.
      places: createFakePlacesAdapter(),
      gemini: createFakeGeminiAdapter(),
    },
    firestore: initFirebaseAdmin(env)?.firestore ?? null,
    logger,
    config: { production: env.NODE_ENV === "production", shareLinkSecret },
  };
}
