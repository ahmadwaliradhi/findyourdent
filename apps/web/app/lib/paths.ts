/** Public page of a Listed Provider, keyed by Google place id (spec 02). */
export function providerPath(placeId: string): string {
  return `/tempat/${encodeURIComponent(placeId)}`;
}

/** Anchor of one Testimony on its Provider page. */
export function testimonyPath(placeId: string, testimonyId: string): string {
  return `${providerPath(placeId)}#testimoni-${encodeURIComponent(testimonyId)}`;
}

/** The page "BPJS Kesehatan dan perawatan gigi": what BPJS covers, FKTP, and how to read Payment Methods. */
export const BPJS_PAGE_PATH = "/bpjs";

/** Its section on the FKTP the member is registered with; the Provider page links here. */
export const BPJS_FKTP_PATH = `${BPJS_PAGE_PATH}#fktp`;

/** The transparency page "Cara kami memverifikasi testimoni" (spec 09). */
export const TRANSPARENCY_PAGE_PATH = "/verifikasi-testimoni";
