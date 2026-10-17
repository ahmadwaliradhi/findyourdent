import type express from "express";
import type { Auth } from "firebase-admin/auth";
import { readBrowserState, updateBrowserState } from "./browser-state.ts";
import type { BaseContext } from "./context.ts";

/** Google is the only sign-in provider (spec 00). */
export const GOOGLE_PROVIDER = "google.com";

const SESSION_DAYS = 5;

export interface SignedInUser {
  uid: string;
  email: string | null;
}

export type SessionOutcome =
  | { ok: true; setCookie: string }
  | { ok: false; status: 401 | 403; error: "invalid_token" | "google_only" | "stale_sign_in" };

/**
 * Exchanges a fresh Google sign-in (a Firebase ID token) for a session cookie.
 * No email or phone verification follows.
 */
export async function createSession(
  auth: Auth,
  idToken: string,
  cookieHeader: string | null | undefined,
  nowMs = Date.now(),
): Promise<SessionOutcome> {
  let decoded: Awaited<ReturnType<Auth["verifyIdToken"]>>;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch {
    return { ok: false, status: 401, error: "invalid_token" };
  }
  if (decoded.firebase.sign_in_provider !== GOOGLE_PROVIDER) return { ok: false, status: 403, error: "google_only" };
  // A session cookie only from a sign-in made just now, so a leaked old ID token cannot mint one.
  if (nowMs / 1000 - decoded.auth_time > 5 * 60) return { ok: false, status: 401, error: "stale_sign_in" };

  const expiresIn = SESSION_DAYS * 24 * 60 * 60 * 1000;
  const value = await auth.createSessionCookie(idToken, { expiresIn });
  // Kept in the one `__session` cookie beside the language and Guidance session id.
  return { ok: true, setCookie: await updateBrowserState(cookieHeader, { auth: value }) };
}

/** Set-Cookie that signs out, keeping the language toggle and the Guidance session. */
export function clearSession(cookieHeader: string | null | undefined): Promise<string> {
  return updateBrowserState(cookieHeader, { auth: undefined });
}

/** The signed-in Google account behind the request's session cookie, or null. */
export async function readSession(
  auth: Auth | null,
  cookieHeader: string | null | undefined,
): Promise<SignedInUser | null> {
  if (!auth) return null;
  const value = (await readBrowserState(cookieHeader)).auth;
  if (!value) return null;
  try {
    const decoded = await auth.verifySessionCookie(value, true);
    if (decoded.firebase.sign_in_provider !== GOOGLE_PROVIDER) return null;
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    return null;
  }
}

/** Allowlist match, ignoring case and surrounding spaces. */
export function isAdmin(user: SignedInUser | null, adminEmails: readonly string[]): boolean {
  const email = user?.email?.trim().toLowerCase();
  return Boolean(email) && adminEmails.some((allowed) => allowed.trim().toLowerCase() === email);
}

// Case-insensitive, like React Router's own route matching.
const ADMIN_PATH = /^\/admin(?:[./]|$)/i;
// The admin JSON API answers 401 rather than sending a fetch to the sign-in page.
const ADMIN_API_PATH = /^\/admin\/api(?:[./]|$)/i;

/**
 * Express gate in front of every admin URL: the page, its `.data` requests,
 * nested routes and actions. React Router only sees allowlisted admins, and
 * finds them in `res.locals.admin`.
 */
export function adminGate(context: () => BaseContext): express.RequestHandler {
  return async (req, res, next) => {
    if (!ADMIN_PATH.test(req.path)) return next();
    const { auth, config } = context();
    const user = await readSession(auth, req.headers.cookie);
    if (isAdmin(user, config.adminEmails)) {
      res.locals.admin = user;
      return next();
    }
    if (!user && req.method === "GET" && !req.path.endsWith(".data") && !ADMIN_API_PATH.test(req.path)) {
      return res.redirect(302, `/signin?redirectTo=${encodeURIComponent(req.originalUrl)}`);
    }
    res
      .status(user ? 403 : 401)
      .type("text/plain")
      .send(user ? "Akses ditolak / Access denied" : "Masuk dulu / Sign in first");
  };
}
