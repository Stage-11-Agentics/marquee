export interface GeometryBuilding {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  access_minutes: number;
}

export interface TransitAgendaItem {
  id: string;
  starts_at: number;
  duration_min: number;
  building_id: string | null;
  person_ids: readonly string[];
}

export interface TransitConflict {
  kind: "transit";
  label: "Transit";
  speaker_id: string;
  from_building_id: string;
  to_building_id: string;
  from_building: string;
  to_building: string;
  walk_minutes: number;
  access_minutes: number;
  needed_minutes: number;
  available_minutes: number;
  message: string;
}

const EARTH_RADIUS_METRES = 6_371_000;
const WALKING_FACTOR = 1.3;
const WALKING_METRES_PER_MINUTE = 80;

export function haversineMetres(
  from: Pick<GeometryBuilding, "lat" | "lng">,
  to: Pick<GeometryBuilding, "lat" | "lng">,
): number | null {
  if (from.lat === null || from.lng === null || to.lat === null || to.lng === null) return null;
  const radians = Math.PI / 180;
  const latitude = (to.lat - from.lat) * radians;
  const longitude = (to.lng - from.lng) * radians;
  const fromLatitude = from.lat * radians;
  const toLatitude = to.lat * radians;
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(a));
}

export function walkingMinutes(
  from: Pick<GeometryBuilding, "lat" | "lng">,
  to: Pick<GeometryBuilding, "lat" | "lng">,
): number | null {
  const metres = haversineMetres(from, to);
  return metres === null ? null : Math.max(1, Math.floor((metres * WALKING_FACTOR) / WALKING_METRES_PER_MINUTE));
}

function pairKey(left: string, right: string): string {
  return `${left}\u0000${right}`;
}

/**
 * Detects only cross-building movement. This pure seam is used by the seeded
 * check now and is the source M-58 can consume for agenda conflicts later.
 */
export function getTransitConflicts(
  items: readonly TransitAgendaItem[],
  buildings: readonly GeometryBuilding[],
): TransitConflict[] {
  const byId = new Map(buildings.map((building) => [building.id, building]));
  const conflicts: TransitConflict[] = [];
  const seen = new Set<string>();
  const orderedItems = [...items].sort((left, right) =>
    left.starts_at === right.starts_at ? left.id.localeCompare(right.id) : left.starts_at - right.starts_at,
  );

  for (let firstIndex = 0; firstIndex < orderedItems.length; firstIndex += 1) {
    const first = orderedItems[firstIndex]!;
    for (let secondIndex = firstIndex + 1; secondIndex < orderedItems.length; secondIndex += 1) {
      const second = orderedItems[secondIndex]!;
      if (!first.building_id || !second.building_id || first.building_id === second.building_id) continue;
      const from = byId.get(first.building_id);
      const to = byId.get(second.building_id);
      if (!from || !to) continue;
      const walk = walkingMinutes(from, to);
      if (walk === null) continue;
      const sharedPeople = first.person_ids.filter((personId) => second.person_ids.includes(personId));
      const available = Math.max(
        0,
        Math.floor((second.starts_at - (first.starts_at + first.duration_min * 60_000)) / 60_000),
      );
      const access = Math.max(0, to.access_minutes);
      const needed = walk + access;
      for (const speakerId of sharedPeople) {
        const key = pairKey(speakerId, pairKey(first.id, second.id));
        if (seen.has(key) || available >= needed) continue;
        seen.add(key);
        conflicts.push({
          kind: "transit",
          label: "Transit",
          speaker_id: speakerId,
          from_building_id: from.id,
          to_building_id: to.id,
          from_building: from.name,
          to_building: to.name,
          walk_minutes: walk,
          access_minutes: access,
          needed_minutes: needed,
          available_minutes: available,
          message: `Transit — ${walk} min walk to ${to.name}${access ? `, plus ${access} min building access` : ""}. Needs ${needed} min; has ${available}.`,
        });
      }
    }
  }
  return conflicts;
}
