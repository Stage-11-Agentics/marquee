/**
 * Comparison-mode evidence is stored as ordered rank groups. A group with
 * more than one submission is a tie; the flat form `[a, b, c]` is accepted as
 * shorthand for `[[a], [b], [c]]` at the API boundary.
 */
export type ComparisonRanking = string[][];

export interface ComparisonEvidence {
  ranking: unknown;
  submissionIds: readonly string[];
}

export function normalizeComparisonRanking(value: unknown): ComparisonRanking | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const groups: ComparisonRanking = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const group = Array.isArray(entry) ? entry : [entry];
    if (group.length === 0 || group.some((id) => typeof id !== "string" || id.length === 0)) return null;
    const normalized = group as string[];
    for (const id of normalized) {
      if (seen.has(id)) return null;
      seen.add(id);
    }
    groups.push(normalized);
  }
  return groups;
}

/** Return a canonical ranking only when it covers exactly the three cards. */
export function validateComparisonRanking(
  submissionIds: readonly string[],
  value: unknown,
): ComparisonRanking | null {
  if (submissionIds.length !== 3 || new Set(submissionIds).size !== 3) return null;
  const ranking = normalizeComparisonRanking(value);
  if (!ranking) return null;
  const expected = new Set(submissionIds);
  const ranked = ranking.flat();
  return ranked.length === expected.size && ranked.every((id) => expected.has(id))
    ? ranking
    : null;
}

/**
 * Aggregate pairwise wins. Every submission beats each card in a lower rank
 * group; tied cards do not beat one another. This makes a three-card ranking
 * contribute 2/1/0 wins, while a tied first place contributes one win to each
 * tied card against the remaining card.
 */
export function comparisonWinCounts(
  comparisons: readonly ComparisonEvidence[],
): Map<string, number> {
  const wins = new Map<string, number>();
  for (const comparison of comparisons) {
    const ranking = validateComparisonRanking(comparison.submissionIds, comparison.ranking);
    if (!ranking) continue;
    for (const [groupIndex, group] of ranking.entries()) {
      for (const submissionId of group) {
        const lowerCards = ranking
          .slice(groupIndex + 1)
          .reduce((count, lowerGroup) => count + lowerGroup.length, 0);
        wins.set(submissionId, (wins.get(submissionId) ?? 0) + lowerCards);
      }
    }
  }
  return wins;
}
