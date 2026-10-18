// The kecamatan of one kota/kabupaten, from our own GET /api/regions/:regencyCode/districts
// (the full list stays on the server). Shared by every Region fields on a page and by
// the Testimony form's Region pre-fill.
import type { DistrictOption } from "~/lib/regions";

// The kecamatan lists fetched in this page view.
const districtRequests = new Map<string, Promise<DistrictOption[]>>();

export function fetchDistricts(regencyCode: string): Promise<DistrictOption[]> {
  let request = districtRequests.get(regencyCode);
  if (!request) {
    request = fetch(`/api/regions/${encodeURIComponent(regencyCode)}/districts`)
      .then((response) => (response.ok ? (response.json() as Promise<{ districts: DistrictOption[] }>) : null))
      .then((body) => body?.districts ?? []);
    // A failed request is not kept, so choosing the kota again retries it.
    request.catch(() => districtRequests.delete(regencyCode));
    districtRequests.set(regencyCode, request);
  }
  return request;
}
