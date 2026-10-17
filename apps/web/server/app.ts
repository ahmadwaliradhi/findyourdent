import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";
import type { ServerBuild } from "react-router";
import type { ViteDevServer } from "vite";
import type { BaseContext } from "./context.ts";
import { withFields } from "./logger.ts";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type CreateAppOptions =
  | { mode: "development"; vite: ViteDevServer; context: () => BaseContext }
  | { mode: "production"; build: ServerBuild; context: () => BaseContext };

const TRACE_ID = /^[0-9a-f]{32}$/i;

/**
 * The trace id Cloud Run puts on every request (X-Cloud-Trace-Context, or W3C
 * traceparent), so a search for it finds both our lines and Cloud Run's request
 * log entry; a random id otherwise.
 */
function requestIdOf(req: express.Request): string {
  const cloud = req.get("x-cloud-trace-context")?.split("/")[0];
  if (cloud && TRACE_ID.test(cloud)) return cloud.toLowerCase();
  const w3c = req.get("traceparent")?.split("-")[1];
  if (w3c && TRACE_ID.test(w3c)) return w3c.toLowerCase();
  return crypto.randomUUID().replaceAll("-", "");
}

/**
 * The one Express app for local dev, tests and Cloud Run. Cross-cutting middleware
 * (App Check verification, rate limits) belongs here, ahead of the React Router handler.
 */
export function createApp(options: CreateAppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(compression());

  // One access line per request: id, method, path (no query string), status and
  // timing. Never headers or bodies (spec 00, UU 27/2022).
  app.use((req, res, next) => {
    const requestId = requestIdOf(req);
    const started = performance.now();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    res.on("finish", () => {
      options.context().logger.info("request", {
        request_id: requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Math.round((performance.now() - started) * 10) / 10,
      });
    });
    next();
  });

  // Not /healthz: Cloud Run reserves some paths ending in "z".
  app.get("/health", (_req, res) => {
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
      getLoadContext: (_req, res) => {
        const base = options.context();
        const requestId = String(res.locals.requestId);
        return { ...base, requestId, logger: withFields(base.logger, { request_id: requestId }) };
      },
    }),
  );
  return app;
}
