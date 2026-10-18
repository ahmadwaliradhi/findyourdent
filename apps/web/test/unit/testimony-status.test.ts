import { describe, expect, it } from "vitest";
import { testimonyStatusTone } from "~/lib/testimony-status";

describe("testimonyStatusTone", () => {
  it("shows a published Testimony as success, a taken-down one as danger, and every other status as pending", () => {
    expect(testimonyStatusTone("published")).toBe("success");
    for (const status of ["rejected", "removed", "deleted"] as const)
      expect(testimonyStatusTone(status)).toBe("danger");
    for (const status of ["submitted", "needsAuthorFix", "held", "hidden"] as const) {
      expect(testimonyStatusTone(status)).toBe("warning");
    }
  });
});
