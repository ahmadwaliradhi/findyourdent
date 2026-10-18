import { CircleCheck, Clock, EyeOff, OctagonAlert, PencilLine } from "lucide-react";
import { describe, expect, it } from "vitest";
import { testimonyStatusBadge } from "~/lib/testimony-status";

describe("testimonyStatusBadge", () => {
  it("shows a published Testimony as live, with a check", () => {
    expect(testimonyStatusBadge("published")).toEqual({ variant: "success", icon: CircleCheck });
  });

  it("asks the author to act on a Testimony that needs their fix, with a pencil", () => {
    expect(testimonyStatusBadge("needsAuthorFix")).toEqual({ variant: "warning", icon: PencilLine });
  });

  it("shows a Testimony still being checked or reviewed as waiting, with a clock", () => {
    for (const status of ["submitted", "held"] as const) {
      expect(testimonyStatusBadge(status)).toEqual({ variant: "info", icon: Clock });
    }
  });

  it("shows a Testimony hidden after a report as hidden, with a crossed-out eye", () => {
    expect(testimonyStatusBadge("hidden")).toEqual({ variant: "info", icon: EyeOff });
  });

  it("shows a Testimony that is not shown for good as danger, with a stop sign", () => {
    for (const status of ["rejected", "removed", "deleted"] as const) {
      expect(testimonyStatusBadge(status)).toEqual({ variant: "danger", icon: OctagonAlert });
    }
  });
});
