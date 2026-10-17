import type { GuidanceRequest } from "@findyourdent/contracts";

/**
 * Port to the agent service (services/agent). The web service is the only caller;
 * the browser never reaches the agent directly. Returns the raw JSON body: the
 * caller validates it against the GuidanceResponse contract.
 */
export interface AgentAdapter {
  requestGuidance(request: GuidanceRequest): Promise<unknown>;
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
  fetch?: typeof fetch;
}

/** Real adapter: POST {AGENT_URL}/v1/guidance. Never logs or echoes the request body. */
export function createHttpAgentAdapter(options: HttpAgentAdapterOptions): AgentAdapter {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const doFetch = options.fetch ?? fetch;

  return {
    async requestGuidance(request) {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/v1/guidance`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs),
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
    },
  };
}
