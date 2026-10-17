import type { TestimonyStatus } from "@findyourdent/contracts/firestore";
import { describe, expect, it } from "vitest";
import {
  canAuthorEdit,
  canTransition,
  TESTIMONY_STATUSES,
  type TransitionActor,
} from "../../app/server/testimony-state.ts";

// Spec 03 "Testimony states", written out edge by edge as the independent source of truth.
const ALLOWED: ReadonlyArray<[TestimonyStatus, TestimonyStatus, TransitionActor]> = [
  // Moderation decides a submission.
  ["submitted", "published", "system"],
  ["submitted", "needsAuthorFix", "system"],
  ["submitted", "held", "system"],
  // The author resubmits after fixing, after a hold or after a rejection.
  ["needsAuthorFix", "submitted", "author"],
  ["held", "submitted", "author"],
  ["rejected", "submitted", "author"],
  // The admin decides a held Testimony, or sends it back to the author.
  ["held", "published", "admin"],
  ["held", "rejected", "admin"],
  ["held", "needsAuthorFix", "admin"],
  // A personal data or threat report hides a published Testimony at once; the admin may hide too.
  ["published", "hidden", "system"],
  ["published", "hidden", "admin"],
  // The admin decides a hidden Testimony, and only the admin removes.
  ["hidden", "published", "admin"],
  ["hidden", "removed", "admin"],
  ["published", "removed", "admin"],
  // The author deletes from any state.
  ["submitted", "deleted", "author"],
  ["published", "deleted", "author"],
  ["needsAuthorFix", "deleted", "author"],
  ["held", "deleted", "author"],
  ["rejected", "deleted", "author"],
  ["hidden", "deleted", "author"],
  ["removed", "deleted", "author"],
];

const ACTORS: TransitionActor[] = ["author", "admin", "system"];

describe("canTransition", () => {
  it.each(ALLOWED)("allows %s → %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(true);
  });

  it("refuses every other edge", () => {
    const allowed = new Set(ALLOWED.map(([from, to, actor]) => `${from}>${to}>${actor}`));
    const refused: string[] = [];
    for (const from of TESTIMONY_STATUSES) {
      for (const to of TESTIMONY_STATUSES) {
        for (const actor of ACTORS) {
          const key = `${from}>${to}>${actor}`;
          if (!allowed.has(key) && canTransition(from, to, actor)) refused.push(key);
        }
      }
    }
    expect(refused).toEqual([]);
  });

  it("lets only an admin remove", () => {
    for (const from of TESTIMONY_STATUSES) {
      expect(canTransition(from, "removed", "author")).toBe(false);
      expect(canTransition(from, "removed", "system")).toBe(false);
    }
  });

  it("lets the author delete from every state except deleted", () => {
    for (const from of TESTIMONY_STATUSES) {
      expect(canTransition(from, "deleted", "author")).toBe(from !== "deleted");
      expect(canTransition(from, "deleted", "admin")).toBe(false);
    }
  });

  it("never leaves deleted", () => {
    for (const to of TESTIMONY_STATUSES) {
      for (const actor of ACTORS) expect(canTransition("deleted", to, actor)).toBe(false);
    }
  });
});

describe("canAuthorEdit", () => {
  it.each<[TestimonyStatus, boolean]>([
    ["submitted", true],
    ["published", true],
    ["needsAuthorFix", true],
    ["held", true],
    ["rejected", true],
    ["hidden", false],
    ["removed", false],
    ["deleted", false],
  ])("%s → %s", (status, editable) => {
    expect(canAuthorEdit(status)).toBe(editable);
  });
});
