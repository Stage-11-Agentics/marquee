import type { SearchCandidate, SearchResult } from "../api/search";

/** Match the prototype's punctuation-insensitive, diacritic-insensitive search contract. */
export function normalizeSearch(value: string): string {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function subsequenceScore(haystack: string, needle: string): number | null {
  let needleIndex = 0;
  let gaps = 0;
  for (const character of haystack) {
    if (character === needle[needleIndex]) needleIndex += 1;
    else if (needleIndex > 0) gaps += 1;
    if (needleIndex === needle.length) return 3 + gaps / Math.max(haystack.length, 1_000);
  }
  return null;
}

/** Lower scores are better; null means the value does not match. */
export function fuzzyScore(value: string, query: string): number | null {
  const haystack = normalizeSearch(value);
  const needle = normalizeSearch(query);
  if (!needle) return null;
  if (haystack === needle) return 0;
  if (haystack.startsWith(needle)) return 1;
  if (haystack.includes(needle)) return 2 + haystack.indexOf(needle) / Math.max(haystack.length, 1_000);
  return subsequenceScore(haystack, needle);
}

export function bestSearchScore(values: readonly string[], query: string): number | null {
  const needle = normalizeSearch(query);
  if (!needle) return null;
  let best: number | null = null;
  values.forEach((value, index) => {
    const score = fuzzyScore(value, needle);
    if (score === null) return;
    const fieldScore = score + index / 100;
    if (best === null || fieldScore < best) best = fieldScore;
  });
  return best;
}

const TYPE_ORDER: Record<SearchResult["type"], number> = {
  Abstract: 0,
  Session: 1,
  Speaker: 2,
  Form: 3,
};

/** Rank a bounded event candidate set deterministically for the shared overlay. */
export function rankSearchCandidates(
  candidates: readonly SearchCandidate[],
  query: string,
  limit = 20,
): SearchResult[] {
  if (!normalizeSearch(query)) return [];
  return candidates
    .map((candidate, index) => ({ candidate, index, score: bestSearchScore(candidate.searchText, query) }))
    .filter((entry): entry is { candidate: SearchCandidate; index: number; score: number } => entry.score !== null)
    .sort((left, right) =>
      left.score - right.score
      || TYPE_ORDER[left.candidate.type] - TYPE_ORDER[right.candidate.type]
      || left.candidate.title.localeCompare(right.candidate.title)
      || left.candidate.id.localeCompare(right.candidate.id)
      || left.index - right.index,
    )
    .slice(0, Math.max(0, limit))
    .map(({ candidate }) => ({
      type: candidate.type,
      id: candidate.id,
      title: candidate.title,
      subtitle: candidate.subtitle,
      href: candidate.href,
    }));
}
