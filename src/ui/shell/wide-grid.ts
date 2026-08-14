/**
 * Keep live, position-ordered grids useful at their leading edge. The API
 * keeps authored order intact; callers opt into this display order explicitly.
 * The index tie-breaker makes the helper stable even when two records share a
 * position, which is important while an authoring update is still settling.
 */
export function orderNewestFirst<T>(items: readonly T[], positionOf: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => positionOf(right.item) - positionOf(left.item) || left.index - right.index)
    .map(({ item }) => item);
}
