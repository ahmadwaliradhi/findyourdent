import { useRouteLoaderData } from "react-router";

/** Public Firebase web app values. None of them is a secret. */
export interface FirebaseWebApp {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  /** reCAPTCHA Enterprise site key App Check uses (score-based, no puzzle). */
  recaptchaSiteKey: string;
  /** Set outside production when the Auth emulator is running. */
  authEmulatorUrl: string | null;
}

/** What the browser needs for Google sign-in and App Check, sent by the root loader. */
export interface PublicFirebaseConfig {
  /** null when Firebase is not configured (plain local UI work). */
  app: FirebaseWebApp | null;
  /** Outside production only: sent as the App Check token instead of calling reCAPTCHA. */
  appCheckDebugToken: string | null;
}

export const NO_FIREBASE: PublicFirebaseConfig = { app: null, appCheckDebugToken: null };

export function useFirebaseConfig(): PublicFirebaseConfig {
  const root = useRouteLoaderData("root") as { firebase?: PublicFirebaseConfig } | undefined;
  return root?.firebase ?? NO_FIREBASE;
}
