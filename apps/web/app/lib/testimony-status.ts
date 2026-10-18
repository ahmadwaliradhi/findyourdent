import type { TestimonyStatus } from "@findyourdent/contracts/firestore";
import { CircleCheck, Clock, EyeOff, type LucideIcon, OctagonAlert, PencilLine } from "lucide-react";

export type TestimonyStatusBadge = { variant: "success" | "warning" | "info" | "danger"; icon: LucideIcon };

/**
 * The Badge tone and icon for a Testimony status, so every status shows an icon with its word
 * and never relies on color alone: live, waiting on the author, waiting on the team, hidden
 * after a report, or not shown.
 */
export function testimonyStatusBadge(status: TestimonyStatus): TestimonyStatusBadge {
  switch (status) {
    case "published":
      return { variant: "success", icon: CircleCheck };
    case "needsAuthorFix":
      return { variant: "warning", icon: PencilLine };
    case "submitted":
    case "held":
      return { variant: "info", icon: Clock };
    case "hidden":
      return { variant: "info", icon: EyeOff };
    case "rejected":
    case "removed":
    case "deleted":
      return { variant: "danger", icon: OctagonAlert };
  }
}
