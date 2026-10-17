import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestServer, type TestServer } from "../support/harness.ts";

const COMPLAINT = "RAHASIA gusi berdarah setiap sikat gigi";
const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
});

beforeEach(async () => {
  await server.reset();
});

function parsedLogs(): Record<string, unknown>[] {
  return server.logs.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("structured logs", () => {
  it("tag every line of a request with the Cloud Run trace id as request_id, and never the body", async () => {
    const response = await server.post(
      "/api/guidance?q=RAHASIA",
      { complaintText: COMPLAINT, language: "id" },
      { headers: { "x-cloud-trace-context": `${TRACE_ID}/1;o=1` } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(TRACE_ID);

    // The access line is written when the response finishes, which can be just after fetch resolves.
    await vi.waitFor(() =>
      expect(parsedLogs()).toContainEqual(
        expect.objectContaining({
          message: "request",
          request_id: TRACE_ID,
          method: "POST",
          path: "/api/guidance",
          status: 200,
        }),
      ),
    );
    expect(parsedLogs()).toContainEqual(
      expect.objectContaining({ message: "guidance", outcome: "ok", request_id: TRACE_ID }),
    );
    expect(server.logs.join("\n")).not.toContain("RAHASIA");
  });

  it("make up a request id when there is no trace header", async () => {
    const response = await fetch(new URL("/health", server.baseUrl));

    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f]{32}$/);
    await vi.waitFor(() =>
      expect(parsedLogs()).toContainEqual(
        expect.objectContaining({ message: "request", request_id: requestId, path: "/health", status: 200 }),
      ),
    );
  });
});
