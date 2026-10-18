import type { TestimonyStatus } from "@findyourdent/contracts/firestore";

/**
 * The status Badge tone for a Testimony, so every status shows an icon with its word:
 * published is success, taken down is danger, anything still being decided is pending.
 */
export function testimonyStatusTone(status: TestimonyStatus): "success" | "warning" | "danger" {
  if (status === "published") return "success";
  if (status === "rejected" || status === "removed" || status === "deleted") return "danger";
  return "warning";
}
