import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Firestore } from "firebase-admin/firestore";
import type { AppLoadContext } from "react-router";
import { createServer } from "vite";
import {
  createFakeAgentAdapter,
  createFakeGeminiAdapter,
  createFakePlacesAdapter,
  type FakeAgentAdapter,
  type FakeGeminiAdapter,
  type FakePlacesAdapter,
} from "../../server/adapters/fakes.ts";
import { createApp } from "../../server/app.ts";
import { initFirebaseAdmin } from "../../server/firebase.ts";
import type { LogFields, Logger } from "../../server/logger.ts";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface Fakes {
  agent: FakeAgentAdapter;
  places: FakePlacesAdapter;
  gemini: FakeGeminiAdapter;
}

export interface TestServer {
  baseUrl: string;
  fakes: Fakes;
  firestore: Firestore;
  /** Every log line written by the app since the last reset, serialised. */
  logs: string[];
  /** Fresh fakes, empty logs, empty emulator Firestore and Auth. */
  reset(): Promise<void>;
  post(pathname: string, body: unknown, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

function freshFakes(): Fakes {
  return { agent: createFakeAgentAdapter(), places: createFakePlacesAdapter(), gemini: createFakeGeminiAdapter() };
}

async function clearEmulators(projectId: string) {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const requests: Promise<Response>[] = [];
  if (firestoreHost) {
    requests.push(
      fetch(`http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
        method: "DELETE",
      }),
    );
  }
  if (authHost) {
    requests.push(fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" }));
  }
  for (const response of await Promise.all(requests)) {
    if (!response.ok) throw new Error(`emulator reset failed: ${response.status} ${response.url}`);
  }
}

/**
 * Starts the real Express app (server/app.ts) with the React Router handler served
 * through Vite's dev middleware, on a random port, with fake Places, agent and
 * Gemini adapters and firebase-admin pointed at the emulators.
 */
export async function startTestServer(): Promise<TestServer> {
  const firebase = initFirebaseAdmin();
  if (!firebase || !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is not set: run the API tests with `pnpm --filter web test`.");
  }

  const vite = await createServer({
    root: webRoot,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
  });

  let fakes = freshFakes();
  const logs: string[] = [];
  const record =
    (severity: string) =>
    (message: string, fields: LogFields = {}) => {
      logs.push(JSON.stringify({ severity, message, ...fields }));
    };
  const logger: Logger = { info: record("INFO"), warn: record("WARNING"), error: record("ERROR") };

  const context = (): AppLoadContext => ({
    adapters: fakes,
    firestore: firebase.firestore,
    logger,
    config: { production: false, shareLinkSecret: "test-share-link-secret" },
  });

  const app = createApp({ mode: "development", vite, context });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    get fakes() {
      return fakes;
    },
    firestore: firebase.firestore,
    logs,
    async reset() {
      fakes = freshFakes();
      logs.length = 0;
      await clearEmulators(firebase.projectId);
    },
    post(pathname, body, init = {}) {
      return fetch(new URL(pathname, baseUrl), {
        method: "POST",
        ...init,
        headers: { "content-type": "application/json", ...init.headers },
        body: JSON.stringify(body),
      });
    },
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await vite.close();
    },
  };
}
