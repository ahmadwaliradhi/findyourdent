import { describe, expect, it } from "vitest";
import { newBrowserId, readBrowserState, updateBrowserState } from "../../server/browser-state.ts";

const cookiePair = (setCookie: string) => setCookie.split(";")[0] ?? "";

describe("browser id in the __session cookie", () => {
  it("is read back from the cookie", async () => {
    const setCookie = await updateBrowserState(null, { bid: "bid-1" });
    expect((await readBrowserState(cookiePair(setCookie))).bid).toBe("bid-1");
  });

  it("lives a year, like the language and the sign-in", async () => {
    const setCookie = await updateBrowserState(null, { bid: "bid-1" });
    expect(setCookie).toMatch(/Max-Age=31536000/);
  });

  it("survives clearing the sign-in", async () => {
    const signedIn = cookiePair(await updateBrowserState(null, { bid: "bid-1", auth: "session" }));
    const signedOut = cookiePair(await updateBrowserState(signedIn, { auth: undefined }));
    expect(await readBrowserState(signedOut)).toEqual({ bid: "bid-1" });
  });

  it("is ignored when it is not a string", async () => {
    const setCookie = await updateBrowserState(null, { bid: 7 as unknown as string });
    expect((await readBrowserState(cookiePair(setCookie))).bid).toBeUndefined();
  });

  it("is a new opaque id each time", () => {
    const ids = new Set(Array.from({ length: 20 }, newBrowserId));
    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  });
});
