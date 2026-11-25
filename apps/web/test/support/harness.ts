import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Firestore } from "firebase-admin/firestore";
import { createServer } from "vite";
import { APP_CHECK_HEADER } from "../../app/lib/app-check.ts";
import { NO_FIREBASE } from "../../app/lib/firebase-config.ts";
import {
  createFakeAgentAdapter,
  createFakeAppCheckVerifier,
  createFakeGeminiAdapter,
  createFakePlacesAdapter,
  type FakeAgentAdapter,
  type FakeAppCheckVerifier,
  type FakeGeminiAdapter,
  type FakePlacesAdapter,
} from "../../server/adapters/fakes.ts";
import { createApp } from "../../server/app.ts";
import { type BaseContext, DEFAULT_RATE_LIMITS, type RateLimits } from "../../server/context.ts";
import { type Bucket, initFirebaseAdmin } from "../../server/firebase.ts";
import type { LogFields, Logger } from "../../server/logger.ts";
import { createFirestoreRateLimiter } from "../../server/rate-limit.ts";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface Fakes {
  agent: FakeAgentAdapter;
  places: FakePlacesAdapter;
  gemini: FakeGeminiAdapter;
  appCheck: FakeAppCheckVerifier;
}

/** The admin allowlist every test server runs with. */
export const ADMIN_EMAILS = ["admin.satu@example.com", "admin.dua@example.com"];

export interface PostInit extends RequestInit {
  /** App Check token header. Defaults to one valid token per test; null sends none. */
  appCheckToken?: string | null;
}

export interface TestServer {
  baseUrl: string;
  fakes: Fakes;
  firestore: Firestore;
  /** The uploads bucket in the Storage emulator. */
  uploads: Bucket;
  /** Every log line written by the app since the last reset, serialised. */
  logs: string[];
  /** The clock the rate limiter reads; starts at the real time on every reset. */
  clock: { advance(seconds: number): void };
  /** Override rate limits until the next reset. */
  setLimits(limits: Partial<RateLimits>): void;
  /** Spot-check sample rate until the next reset (default 0, so tests are deterministic). */
  setSpotCheckRate(rate: number): void;
  /** Fresh fakes, empty logs, default limits, empty emulator Firestore, Auth and uploads bucket. */
  reset(): Promise<void>;
  /** A Firebase ID token from the Auth emulator, as the browser gets right after signing in. */
  emulatorIdToken(user: { email: string; provider: "google.com" | "password" }): Promise<string>;
  /**
   * Signs in with Google through /auth/session and returns the `cookie` header to send.
   * `cookie` is a browser's existing cookie, as when a second account signs in on the
   * same browser (the browser id stays).
   */
  signInWithGoogle(email: string, options?: { cookie?: string }): Promise<string>;
  /** A new valid App Check token, as a different browser would have. */
  appCheckToken(): string;
  post(pathname: string, body: unknown, init?: PostInit): Promise<Response>;
  /** A GET as the page's own fetch sends it: with an App Check token unless told otherwise. */
  get(pathname: string, init?: PostInit): Promise<Response>;
  close(): Promise<void>;
}

/** A made-up IPv4 address (documentation range 198.18.0.0/15) that is the same for the same cookie. */
function deviceIpOf(cookie: string): string {
  const [a = 0, b = 0, c = 0] = createHash("sha256").update(cookie).digest();
  return `198.${18 + (a % 2)}.${b}.${c || 1}`;
}

function freshFakes(): Fakes {
  return {
    agent: createFakeAgentAdapter(),
    places: createFakePlacesAdapter(),
    gemini: createFakeGeminiAdapter(),
    appCheck: createFakeAppCheckVerifier(),
  };
}

async function clearEmulators(projectId: string, uploads: Bucket) {
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
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) await uploads.deleteFiles({ force: true });
}

async function emulatorIdToken(user: { email: string; provider: "google.com" | "password" }): Promise<string> {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!authHost) throw new Error("FIREBASE_AUTH_EMULATOR_HOST is not set");
  const endpoint = (method: string) =>
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=demo-api-key`;
  // The emulator takes an unsigned Google ID token in place of a real Google sign-in.
  const googleIdToken = JSON.stringify({
    sub: `google-${user.email.toLowerCase()}`,
    email: user.email,
    email_verified: true,
  });
  const response =
    user.provider === "google.com"
      ? await fetch(endpoint("signInWithIdp"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
            requestUri: "http://localhost",
            returnSecureToken: true,
          }),
        })
      : await fetch(endpoint("signUp"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: user.email, password: "test-password-1", returnSecureToken: true }),
        });
  if (!response.ok) throw new Error(`emulator sign-in failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { idToken: string }).idToken;
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
  let defaultToken = fakes.appCheck.issueToken();
  const logs: string[] = [];
  const record =
    (severity: string) =>
    (message: string, fields: LogFields = {}) => {
      logs.push(JSON.stringify({ severity, message, ...fields }));
    };
  const logger: Logger = { info: record("INFO"), warn: record("WARNING"), error: record("ERROR") };

  let nowMs = Date.now();
  let limits = { ...DEFAULT_RATE_LIMITS };
  let spotCheckRate = 0;
  const rateLimiter = createFirestoreRateLimiter(firebase.firestore, { salt: "test-salt", now: () => nowMs });

  const context = (): BaseContext => ({
    adapters: fakes,
    firestore: firebase.firestore,
    auth: firebase.auth,
    uploads: firebase.uploads,
    rateLimiter,
    logger,
    config: {
      production: false,
      limits,
      adminEmails: ADMIN_EMAILS,
      firebaseWeb: NO_FIREBASE,
      shareLinkSecret: "test-share-link-secret",
      signalSalt: "test-signal-salt",
      spotCheckRate,
    },
  });

  const app = createApp({ mode: "development", vite, context });
  // Every request would come from 127.0.0.1, which makes two accounts look like one device.
  // A request that carries a `__session` cookie and no X-Forwarded-For gets an address
  // derived from that cookie, so each browser state is its own device. A test that needs
  // a shared or a different IP sends X-Forwarded-For itself (the app trusts one proxy hop).
  // Requests without a cookie stay on 127.0.0.1, which the per-IP rate-limit tests rely on.
  const front = express();
  front.use((req, _res, next) => {
    if (!req.headers["x-forwarded-for"] && req.headers.cookie)
      req.headers["x-forwarded-for"] = deviceIpOf(req.headers.cookie);
    next();
  });
  front.use(app);
  const server = await new Promise<ReturnType<typeof front.listen>>((resolve) => {
    const s = front.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const post: TestServer["post"] = (pathname, body, { appCheckToken = defaultToken, ...init } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (appCheckToken !== null && !headers.has(APP_CHECK_HEADER)) headers.set(APP_CHECK_HEADER, appCheckToken);
    return fetch(new URL(pathname, baseUrl), { method: "POST", ...init, headers, body: JSON.stringify(body) });
  };

  const get: TestServer["get"] = (pathname, { appCheckToken = defaultToken, ...init } = {}) => {
    const headers = new Headers(init.headers);
    if (appCheckToken !== null && !headers.has(APP_CHECK_HEADER)) headers.set(APP_CHECK_HEADER, appCheckToken);
    return fetch(new URL(pathname, baseUrl), { ...init, headers });
  };

  return {
    baseUrl,
    get fakes() {
      return fakes;
    },
    firestore: firebase.firestore,
    uploads: firebase.uploads,
    logs,
    async reset() {
      fakes = freshFakes();
      defaultToken = fakes.appCheck.issueToken();
      nowMs = Date.now();
      limits = { ...DEFAULT_RATE_LIMITS };
      spotCheckRate = 0;
      logs.length = 0;
      await clearEmulators(firebase.projectId, firebase.uploads);
    },
    clock: {
      advance(seconds) {
        nowMs += seconds * 1000;
      },
    },
    setLimits(overrides) {
      limits = { ...limits, ...overrides };
    },
    setSpotCheckRate(rate) {
      spotCheckRate = rate;
    },
    emulatorIdToken,
    async signInWithGoogle(email, { cookie } = {}) {
      const idToken = await emulatorIdToken({ email, provider: "google.com" });
      const response = await post("/auth/session", { idToken }, cookie ? { headers: { cookie } } : {});
      if (!response.ok) throw new Error(`sign-in failed: ${response.status}`);
      return response.headers.get("set-cookie")?.split(";")[0] ?? "";
    },
    appCheckToken() {
      return fakes.appCheck.issueToken();
    },
    post,
    get,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await vite.close();
    },
  };
}
