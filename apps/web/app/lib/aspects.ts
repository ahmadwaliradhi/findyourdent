import type { AspectRatings } from "@findyourdent/contracts/firestore";

/** The three aspects every Testimony rates, in display order. */
export const ASPECTS = ["service", "hygiene", "materialsEquipment"] as const satisfies readonly (keyof AspectRatings)[];
