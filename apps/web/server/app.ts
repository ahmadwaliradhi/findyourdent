import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";
import type { ServerBuild } from "react-router";
import type { ViteDevServer } from "vite";
import { adminGate, type SignedInUser } from "./auth.ts";
import type { SharedContext } from "./context.ts";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type CreateAppOptions = (
  | { mode: "development"; vite: ViteDevServer; context: () => SharedContext }
  | { mode: "production"; build: ServerBuild; context: () => SharedContext }
) & {
  /**
   * Proxies in front that append to X-Forwarded-For (Cloud Run: 1; behind Firebase
   * Hosting: 2). `req.ip` is read that many hops from the right, so a client cannot
   * pick its own IP for the per-IP ceiling. Default 1.
   */
  trustProxyHops?: number;
};

/**
 * The one Express app for local dev, tests and Cloud Run. The admin allowlist gate
 * runs here, ahead of the React Router handler; App Check and rate limits run in
 * each paid route (app/server/protection.server.ts), which knows its own limits.
 */
export function createApp(options: CreateAppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", options.trustProxyHops ?? 1);
  app.use(compression());

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(adminGate(options.context));

  let build: ServerBuild | (() => Promise<ServerBuild>);
  if (options.mode === "development") {
    app.use(options.vite.middlewares);
    build = () => options.vite.ssrLoadModule("virtual:react-router/server-build") as Promise<ServerBuild>;
  } else {
    const client = path.join(webRoot, "build/client");
    app.use("/assets", express.static(path.join(client, "assets"), { immutable: true, maxAge: "1y" }));
    app.use(express.static(client, { maxAge: "1h" }));
    build = options.build;
  }

  app.use(
    createRequestHandler({
      build,
      mode: options.mode,
      getLoadContext: (req, res) => ({
        ...options.context(),
        clientIp: req.ip ?? "unknown",
        admin: (res.locals.admin as SignedInUser | undefined) ?? null,
      }),
    }),
  );
  return app;
}
