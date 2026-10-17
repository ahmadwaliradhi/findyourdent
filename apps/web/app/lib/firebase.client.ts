import type { FirebaseApp } from "firebase/app";
import type { AppCheck } from "firebase/app-check";
import type { FirebaseWebApp, PublicFirebaseConfig } from "./firebase-config";

// The Firebase SDK loads only when a page needs it, to keep the first load light on slow phones.
let app: Promise<FirebaseApp> | null = null;
let appCheck: Promise<AppCheck> | null = null;

function firebaseApp(config: FirebaseWebApp): Promise<FirebaseApp> {
  app ??= import("firebase/app").then(({ getApps, initializeApp }) => {
    const { apiKey, authDomain, projectId, appId } = config;
    return getApps()[0] ?? initializeApp({ apiKey, authDomain, projectId, appId });
  });
  // A failed load (a dropped connection) is retried on the next call instead of cached.
  app.catch(() => {
    app = null;
  });
  return app;
}

/**
 * An App Check token for the paid web API routes. Outside production the
 * configured debug token stands in for reCAPTCHA. Resolves to "" when App Check
 * is not configured; the server then refuses the request.
 */
export async function getAppCheckToken(config: PublicFirebaseConfig): Promise<string> {
  if (config.appCheckDebugToken) return config.appCheckDebugToken;
  if (!config.app?.recaptchaSiteKey) return "";
  const siteKey = config.app.recaptchaSiteKey;
  appCheck ??= Promise.all([firebaseApp(config.app), import("firebase/app-check")]).then(
    ([firebase, { initializeAppCheck, ReCaptchaEnterpriseProvider }]) =>
      initializeAppCheck(firebase, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      }),
  );
  appCheck.catch(() => {
    appCheck = null;
  });
  const [instance, { getToken }] = await Promise.all([appCheck, import("firebase/app-check")]);
  return (await getToken(instance)).token;
}

/**
 * One Google tap: a popup sign-in, then the server swaps the ID token for its own
 * session cookie. The browser keeps no Firebase session of its own.
 */
export async function signInWithGoogle(config: FirebaseWebApp): Promise<void> {
  const [firebase, { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithPopup, signOut }] = await Promise.all([
    firebaseApp(config),
    import("firebase/auth"),
  ]);
  const auth = getAuth(firebase);
  if (config.authEmulatorUrl && !auth.emulatorConfig) {
    connectAuthEmulator(auth, config.authEmulatorUrl, { disableWarnings: true });
  }
  const credential = await signInWithPopup(auth, new GoogleAuthProvider());
  const idToken = await credential.user.getIdToken();
  try {
    const response = await fetch("/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!response.ok) throw new Error(`session ${response.status}`);
  } finally {
    await signOut(auth);
  }
}
