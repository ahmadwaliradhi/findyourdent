import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";
import type { AppLoadContext, ServerBuild } from "react-router";
import type { ViteDevServer } from "vite";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type CreateAppOptions =
  | { mode: "development"; vite: ViteDevServer; context: () => AppLoadContext }
  | { mode: "production"; build: ServerBuild; context: () => AppLoadContext };

/**
 * The one Express app for local dev, tests and Cloud Run. Cross-cutting middleware
 * (App Check verification, rate limits) belongs here, ahead of the React Router handler.
 */
export function createApp(options: CreateAppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(compression());

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

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
      getLoadContext: () => options.context(),
    }),
  );
  return app;
}
