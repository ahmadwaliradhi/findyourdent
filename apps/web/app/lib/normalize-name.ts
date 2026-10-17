/**
 * The form of a Provider name stored in `ProviderDoc.nameNormalized` and used
 * for the directory's prefix search (spec 04): lower-cased, accents and
 * punctuation stripped, single spaces, trimmed. Writers and the search box must
 * both go through this function so a prefix typed as "KLINIK gígi" matches.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
