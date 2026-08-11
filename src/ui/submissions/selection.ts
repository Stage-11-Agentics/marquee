export function selectionCount(
  selectedIds: ReadonlySet<string>,
  allMatching: boolean,
  total: number,
): number {
  return allMatching ? total : selectedIds.size;
}
