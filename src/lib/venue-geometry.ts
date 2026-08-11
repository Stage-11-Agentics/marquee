export interface GeometryBuilding {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  access_minutes: number;
}

/** The complete building record needed by speaker-facing arrival surfaces. */
export interface ArrivalBuilding extends GeometryBuilding {
  address: string;
  access_note: string | null;
}

export interface ArrivalSession {
  id: string;
  starts_at: number | null;
  duration_min: number | null;
  room_name: string | null;
  building: ArrivalBuilding | null;
}

export type ArrivalStatus = "ready" | "unscheduled" | "unassigned" | "unavailable";

export interface ArrivalProjection {
  status: ArrivalStatus;
  building: ArrivalBuilding | null;
  previous_session: ArrivalSession | null;
  origin: ArrivalBuilding | null;
  walk_minutes: number | null;
  access_minutes: number;
  leave_by: number | null;
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

function hasPin(
  building: Pick<GeometryBuilding, "lat" | "lng"> | null,
): building is Pick<GeometryBuilding, "lat" | "lng"> & { lat: number; lng: number } {
  return building !== null
    && building.lat !== null
    && building.lng !== null
    && Number.isFinite(building.lat)
    && Number.isFinite(building.lng);
}

function dayKey(value: number, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(value)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function buildingGeo(
  building: Pick<GeometryBuilding, "lat" | "lng"> | null,
): { lat: number; lng: number } | null {
  return hasPin(building) ? { lat: building.lat, lng: building.lng } : null;
}

/** One canonical, navigable location string for mail and calendar clients. */
export function sessionLocation(room: string | null, building: Pick<ArrivalBuilding, "name" | "address"> | null): string {
  return [room, building?.name, building?.address].filter((part): part is string => Boolean(part?.trim())).join(", ") || "—";
}

function previousSessionFor(
  current: ArrivalSession,
  previousSessions: readonly ArrivalSession[],
  timezone: string,
): ArrivalSession | null {
  if (current.starts_at === null) return null;
  const currentDay = dayKey(current.starts_at, timezone);
  return [...previousSessions]
    .filter((session) => {
      if (
        session.id === current.id
        || session.starts_at === null
        || session.duration_min === null
        || session.duration_min < 0
      ) return false;
      return dayKey(session.starts_at, timezone) === currentDay
        && session.starts_at + session.duration_min * 60_000 <= current.starts_at!;
    })
    .sort((left, right) => (
      right.starts_at! - left.starts_at!
      || right.id.localeCompare(left.id)
    ))[0] ?? null;
}

/**
 * Project one speaker's arrival plan. The route math deliberately stays here:
 * every surface consumes the same haversine-derived walkingMinutes result and
 * the same primary-building fallback.
 */
export function arrivalForSession(input: {
  current: ArrivalSession;
  previousSessions: readonly ArrivalSession[];
  primaryBuilding: ArrivalBuilding | null;
  timezone: string;
}): ArrivalProjection {
  const { current } = input;
  const building = current.building;
  const accessMinutes = building ? Math.max(0, building.access_minutes) : 0;
  const previousSession = previousSessionFor(current, input.previousSessions, input.timezone);
  const origin = previousSession?.building ?? input.primaryBuilding;
  if (current.starts_at === null) {
    return { status: "unscheduled", building, previous_session: previousSession, origin, walk_minutes: null, access_minutes: accessMinutes, leave_by: null };
  }
  if (!building) {
    return { status: "unassigned", building: null, previous_session: previousSession, origin, walk_minutes: null, access_minutes: 0, leave_by: null };
  }
  if (!hasPin(building) || !hasPin(origin)) {
    return { status: "unavailable", building, previous_session: previousSession, origin, walk_minutes: null, access_minutes: accessMinutes, leave_by: null };
  }
  const walkMinutes = origin.id === building.id ? 0 : walkingMinutes(origin, building);
  if (walkMinutes === null) {
    return { status: "unavailable", building, previous_session: previousSession, origin, walk_minutes: null, access_minutes: accessMinutes, leave_by: null };
  }
  return {
    status: "ready",
    building,
    previous_session: previousSession,
    origin,
    walk_minutes: walkMinutes,
    access_minutes: accessMinutes,
    leave_by: current.starts_at - (walkMinutes + accessMinutes) * 60_000,
  };
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
