import type { GuidanceRequest, ShortlistReasonsRequest } from "@findyourdent/contracts";

/**
 * Port to the agent service (services/agent). The web service is the only caller;
 * the browser never reaches the agent directly. Returns the raw JSON body: the
 * caller validates it against the GuidanceResponse contract.
 */
export interface AgentAdapter {
  requestGuidance(request: GuidanceRequest, options?: AgentCallOptions): Promise<unknown>;
  /** The caller validates the body against the ShortlistReasonsResponse contract. */
  requestShortlistReasons(request: ShortlistReasonsRequest, options?: AgentCallOptions): Promise<unknown>;
}

export interface AgentCallOptions {
  /** Sent as X-Request-Id, so the agent service logs the same id as the web service. */
  requestId?: string;
}

export class AgentUnavailableError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AgentUnavailableError";
    this.status = status;
  }
}

export interface HttpAgentAdapterOptions {
  baseUrl: string;
  timeoutMs?: number;
  /**
   * Shorter than the Guidance timeout: the Shortlist is shown with templated reasons
   * rather than held for Gemini (spec 02).
   */
  reasonsTimeoutMs?: number;
  fetch?: typeof fetch;
  /**
   * Identity token for the agent service URL. On Cloud Run the agent service only
   * accepts calls that carry one for the fyd-web service account (spec 00).
   */
  idToken?: () => Promise<string>;
}

/**
 * Real adapter: POST {AGENT_URL}/v1/guidance and /v1/shortlist-reasons. Never logs or
 * echoes the request body.
 */
export function createHttpAgentAdapter(options: HttpAgentAdapterOptions): AgentAdapter {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const reasonsTimeoutMs = options.reasonsTimeoutMs ?? 12_000;
  const doFetch = options.fetch ?? fetch;

  async function post(path: string, body: unknown, timeout: number, { requestId }: AgentCallOptions) {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (requestId) headers["x-request-id"] = requestId;
    let response: Response;
    try {
      if (options.idToken) headers.authorization = `Bearer ${await options.idToken()}`;
      response = await doFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "unknown";
      throw new AgentUnavailableError(`agent request failed: ${reason}`);
    }
    if (!response.ok) {
      throw new AgentUnavailableError(`agent responded ${response.status}`, response.status);
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new AgentUnavailableError("agent returned a non-JSON body", response.status);
    }
  }

  return {
    requestGuidance(request, callOptions = {}) {
      return post("/v1/guidance", request, timeoutMs, callOptions);
    },
    requestShortlistReasons(request, callOptions = {}) {
      return post("/v1/shortlist-reasons", request, reasonsTimeoutMs, callOptions);
    },
  };
}

export interface MetadataIdTokenOptions {
  /** The agent service URL; Cloud Run checks the token was minted for it. */
  audience: string;
  fetch?: typeof fetch;
  now?: () => number;
}

const METADATA_IDENTITY =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
/** Fetch a fresh token this long before the cached one expires. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function expiresAtMs(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as { exp?: unknown };
  if (typeof payload.exp !== "number") throw new Error("identity token has no exp");
  return payload.exp * 1000;
}

/**
 * Identity tokens for the service's own service account (fyd-web on Cloud Run),
 * from the metadata server. Tokens last an hour; one is cached until five minutes
 * before it expires.
 */
export function createMetadataIdTokenSource(options: MetadataIdTokenOptions): () => Promise<string> {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const url = `${METADATA_IDENTITY}?audience=${encodeURIComponent(options.audience)}`;
  let cached: { token: string; refreshAt: number } | undefined;

  return async () => {
    if (cached && now() < cached.refreshAt) return cached.token;
    const response = await doFetch(url, { headers: { "Metadata-Flavor": "Google" } });
    if (!response.ok) throw new Error(`metadata server responded ${response.status}`);
    const token = (await response.text()).trim();
    cached = { token, refreshAt: expiresAtMs(token) - REFRESH_MARGIN_MS };
    return token;
  };
}
