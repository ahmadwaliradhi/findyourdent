import { describe, expect, it } from "vitest";
import { impactDeltaForStatusChange } from "../../app/server/impact.server.ts";

const published = { status: "published", verifiedVisit: false } as const;
const publishedVerified = { status: "published", verifiedVisit: true } as const;

describe("impactDeltaForStatusChange", () => {
  it("counts a Testimony entering published", () => {
    expect(impactDeltaForStatusChange({ status: "submitted", verifiedVisit: false }, published)).toEqual({
      testimoniesPublished: 1,
    });
  });

  it("counts a verified Testimony entering published as a Kunjungan terbukti too", () => {
    expect(impactDeltaForStatusChange({ status: "held", verifiedVisit: true }, publishedVerified)).toEqual({
      testimoniesPublished: 1,
      verifiedVisits: 1,
    });
  });

  it("counts a Testimony created straight into published", () => {
    expect(impactDeltaForStatusChange(null, publishedVerified)).toEqual({
      testimoniesPublished: 1,
      verifiedVisits: 1,
    });
  });

  it.each(["removed", "hidden", "deleted", "held"] as const)(
    "uncounts a published Testimony that becomes %s",
    (status) => {
      expect(impactDeltaForStatusChange(publishedVerified, { status, verifiedVisit: true })).toEqual({
        testimoniesPublished: -1,
        verifiedVisits: -1,
      });
    },
  );

  it("uncounts a published Testimony whose document is gone", () => {
    expect(impactDeltaForStatusChange(published, null)).toEqual({ testimoniesPublished: -1 });
  });

  it("counts Kunjungan terbukti granted on an already published Testimony", () => {
    expect(impactDeltaForStatusChange(published, publishedVerified)).toEqual({ verifiedVisits: 1 });
  });

  it("does not count a verification on a Testimony that is not public", () => {
    expect(
      impactDeltaForStatusChange({ status: "held", verifiedVisit: false }, { status: "held", verifiedVisit: true }),
    ).toEqual({});
  });

  it("does not count transitions that stay outside published", () => {
    expect(
      impactDeltaForStatusChange(
        { status: "submitted", verifiedVisit: false },
        { status: "held", verifiedVisit: false },
      ),
    ).toEqual({});
    expect(
      impactDeltaForStatusChange({ status: "hidden", verifiedVisit: true }, { status: "removed", verifiedVisit: true }),
    ).toEqual({});
  });

  it("does not count a published Testimony that stays published (an edit)", () => {
    expect(impactDeltaForStatusChange(publishedVerified, publishedVerified)).toEqual({});
  });
});
