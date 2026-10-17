import { type App, getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

export interface FirebaseHandles {
  app: App;
  firestore: Firestore;
  projectId: string;
}

/**
 * Initialises firebase-admin. Against the emulators when FIRESTORE_EMULATOR_HOST is
 * set (firebase-admin reads the *_EMULATOR_HOST variables itself); against the real
 * project only when FIREBASE_ENABLED=true (Cloud Run, application default credentials).
 * Returns null otherwise so local UI work needs no Firebase at all.
 */
export function initFirebaseAdmin(env: NodeJS.ProcessEnv = process.env): FirebaseHandles | null {
  const useEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  if (!useEmulator && env.FIREBASE_ENABLED !== "true") return null;

  const projectId = env.GCLOUD_PROJECT ?? env.GOOGLE_CLOUD_PROJECT ?? "demo-findyourdent";
  const app = getApps().find((a) => a.name === "[DEFAULT]") ?? initializeApp({ projectId });
  return { app, firestore: getFirestore(app), projectId };
}
