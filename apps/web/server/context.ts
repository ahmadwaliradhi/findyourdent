import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { type AgentAdapter, createHttpAgentAdapter, createMetadataIdTokenSource } from "./adapters/agent.ts";
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
  /** Logger bound to this request's request_id. */
  logger: Logger;
  /** Cloud Run trace id, else a random one; also sent back as X-Request-Id. */
  requestId: string;
  config: {
    production: boolean;
    /** Signs shareable Guidance links (app/server/share.server.ts). */
    shareLinkSecret: string;
  };
}

/** The per-process part of the context; createApp adds the per-request fields. */
export type BaseContext = Omit<WebContext, "requestId">;

declare module "react-router" {
  interface AppLoadContext extends WebContext {}
}

/** Production wiring from environment variables. Tests build their own WebContext with fakes. */
export function createContextFromEnv(env: NodeJS.ProcessEnv = process.env): BaseContext {
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
      // Real Places and Gemini adapters arrive with specs 02, 03 and 05.
      places: createFakePlacesAdapter(),
      gemini: createFakeGeminiAdapter(),
    },
    firestore: initFirebaseAdmin(env)?.firestore ?? null,
    logger,
    config: { production: env.NODE_ENV === "production", shareLinkSecret },
  };
}
