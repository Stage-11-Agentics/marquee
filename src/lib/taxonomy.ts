/** Canonical event-taxonomy spelling used for names and collision keys. */
export function normalizeTaxonomyName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function taxonomyNameKey(value: string): string {
  return normalizeTaxonomyName(value).toLocaleLowerCase();
}
