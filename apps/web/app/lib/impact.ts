// Shared by the server read (server/impact.server.ts), /dampak and the landing counter.

/** The public impact counter (spec 04). */
export interface ImpactCounts {
  testimoniesPublished: number;
  /** Distinct kota/kabupaten across Listed Providers. */
  kotaCovered: number;
  verifiedVisits: number;
  listedProviders: number;
  guidanceSessionsCompleted: number;
}
