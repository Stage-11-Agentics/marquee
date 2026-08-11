export interface PinnedBuildingProjection {
  id: string;
  lat: number | null;
  lng: number | null;
}

/** Comparison is meaningful only when two distinct buildings have verified pins. */
export function pinnedBuildingCount(buildings: readonly PinnedBuildingProjection[]): number {
  return new Set(
    buildings
      .filter((building) => building.lat !== null && building.lng !== null)
      .map((building) => building.id),
  ).size;
}

export function showsBuildingComparison(buildings: readonly PinnedBuildingProjection[]): boolean {
  return pinnedBuildingCount(buildings) >= 2;
}

export function showsBuildingComparisonCount(count: number | null | undefined): boolean {
  return Number(count ?? 0) >= 2;
}

export function displayRoomLabel(room: string, building: string | null | undefined, showComparison: boolean): string {
  return showComparison && building ? `${room} · ${building}` : room;
}

export function visibleVenueConflicts<T extends { kind: string }>(
  conflicts: readonly T[],
  showComparison: boolean,
): T[] {
  return showComparison ? [...conflicts] : conflicts.filter((conflict) => conflict.kind !== "transit");
}
