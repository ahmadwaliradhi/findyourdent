// The signed-in journeys need saved Google sessions (an author, and an allowlisted
// admin for the admin journey) and a place to write about. Checked before they start, so a missing step fails with what to do.
import { existsSync, readFileSync } from "node:fs";
import { ADMIN_SESSION_PATH, AUTHOR_SESSION_PATH, DEPLOYED_BASE_URL, PLACE_ID_ENV } from "./env.ts";

interface StorageState {
  cookies: { name: string; value: string; domain: string }[];
}

const SESSIONS = {
  author: { path: AUTHOR_SESSION_PATH, login: "pnpm --filter web e2e:deployed:login" },
  admin: { path: ADMIN_SESSION_PATH, login: "pnpm --filter web e2e:deployed:login:admin" },
};
type Role = keyof typeof SESSIONS;

function sessionCookie(role: Role): string {
  const { path, login } = SESSIONS[role];
  if (!existsSync(path)) throw new Error(`No saved ${role} session. Run \`${login}\`.`);
  const state = JSON.parse(readFileSync(path, "utf8")) as StorageState;
  const host = new URL(DEPLOYED_BASE_URL).hostname;
  const cookie = state.cookies.find((c) => c.name === "__session" && host.endsWith(c.domain.replace(/^\./, "")));
  if (!cookie) throw new Error(`The saved ${role} session has no __session cookie for ${host}. Run \`${login}\`.`);
  return cookie.value;
}

async function fetchWithSession(role: Role, path: string): Promise<Response> {
  return fetch(`${DEPLOYED_BASE_URL}${path}`, {
    headers: { cookie: `__session=${sessionCookie(role)}` },
    redirect: "manual",
  });
}

const expired = (role: Role) => `The saved ${role} session has expired. Run \`${SESSIONS[role].login}\` again.`;

/** A saved, live author session and a place to write about. */
export async function checkAuthorAndPlace() {
  if (!process.env[PLACE_ID_ENV]) {
    throw new Error(`Set ${PLACE_ID_ENV} to the place id of a Listed Provider the signed-in account has visited.`);
  }
  // Signed out, 'Testimoni saya' redirects to the sign-in page.
  const response = await fetchWithSession("author", "/testimoni-saya");
  if (response.status >= 300 && response.status < 400) throw new Error(expired("author"));
  if (!response.ok) throw new Error(`GET /testimoni-saya answered ${response.status}`);
}

/** A saved, live admin session for an account on the allowlist. */
export async function checkAdmin() {
  // The admin JSON API answers 401 signed out and 403 for an account off the allowlist.
  const response = await fetchWithSession("admin", "/admin/api/queue");
  if (response.status === 401) throw new Error(expired("admin"));
  if (response.status === 403) {
    throw new Error("The saved admin account is not on the allowlist (secret admin-emails). Sign in as an admin.");
  }
  if (!response.ok) throw new Error(`GET /admin/api/queue answered ${response.status}`);
}
