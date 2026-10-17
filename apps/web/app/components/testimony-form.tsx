// STUB (T11 seam): owned by the "form, photos and Proof upload" sub-agent.
import type { TestimonySubmission } from "~/lib/testimony";

export interface TestimonyFormProps {
  /** create: POST /api/testimonies, with a browser draft. edit: POST /api/testimonies/:testimonyId. */
  mode: "create" | "edit";
  /** Edit: the Testimony id. */
  testimonyId?: string;
  /** Create: a place picked on the Provider page. Edit: the stored content, with photo URLs for keepPhotoPaths. */
  initial?: Partial<TestimonySubmission> & { photos?: Array<{ path: string; url: string }> };
  /** Edit: the Listed Provider being written about (it cannot change). */
  provider?: { placeId: string; name: string };
}

export function TestimonyForm(_props: TestimonyFormProps) {
  return null;
}
