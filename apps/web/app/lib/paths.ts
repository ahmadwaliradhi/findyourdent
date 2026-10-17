/** Public page of a Listed Provider, keyed by Google place id (spec 02). */
export function providerPath(placeId: string): string {
  return `/tempat/${encodeURIComponent(placeId)}`;
}

/** Anchor of one Testimony on its Provider page. */
export function testimonyPath(placeId: string, testimonyId: string): string {
  return `${providerPath(placeId)}#testimoni-${encodeURIComponent(testimonyId)}`;
}
