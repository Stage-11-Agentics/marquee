export const SEARCH_RESULT_TYPES = ["Abstract", "Session", "Speaker", "Form"] as const;
export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

export const SEARCH_RESULT_LIMIT = 20;

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/** A row prepared by the API before the shared fuzzy scorer ranks it. */
export interface SearchCandidate extends SearchResult {
  searchText: readonly string[];
}
