import { type App, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";

/** A Cloud Storage bucket handle (firebase-admin does not export the class type itself). */
export type Bucket = ReturnType<Storage["bucket"]>;

export interface FirebaseHandles {
  app: App;
  firestore: Firestore;
  auth: Auth;
  /** The private uploads bucket; UPLOADS_BUCKET, else `<project>-uploads` (infra/gcp/setup.sh). */
  uploads: Bucket;
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
  const uploads = getStorage(app).bucket(env.UPLOADS_BUCKET || `${projectId}-uploads`);
  return { app, firestore: getFirestore(app), auth: getAuth(app), uploads, projectId };
}
