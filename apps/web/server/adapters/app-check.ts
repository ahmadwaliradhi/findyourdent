import type { App } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";

/**
 * Port to Firebase App Check (reCAPTCHA Enterprise, score-based). Every web API
 * route that can trigger Places, Gemini or a write verifies the caller's token
 * before doing anything else (spec 00).
 */
export interface AppCheckVerifier {
  /** True only for a token App Check issued to this project's web app. Never throws. */
  verify(token: string): Promise<boolean>;
}

/** Real verifier: firebase-admin checks the JWT signature, audience and expiry. */
export function createFirebaseAppCheckVerifier(app: App): AppCheckVerifier {
  const appCheck = getAppCheck(app);
  return {
    async verify(token) {
      try {
        await appCheck.verifyToken(token);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Local and CI verifier: accepts exactly APP_CHECK_DEBUG_TOKEN, which the browser
 * sends instead of calling reCAPTCHA. Never wired in production (server/context.ts).
 */
export function createDebugAppCheckVerifier(debugToken: string): AppCheckVerifier {
  return {
    async verify(token) {
      return debugToken.length > 0 && token === debugToken;
    },
  };
}
