import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { BuildingRow, RoomRow } from "../db/schema";

export interface VenueBuildingInput {
  id: string;
  name: string;
  address: string;
  position: number;
  lat: number | null;
  lng: number | null;
  access_minutes: number;
  access_note: string | null;
}

export interface VenueRoomInput {
  id: string;
  building_id: string;
  name: string;
  capacity: number;
  position: number;
  av_capabilities: string[];
  notes: string | null;
}

export interface VenueModel {
  buildings: VenueBuildingInput[];
  rooms: VenueRoomInput[];
}

export interface VenueModelResponse {
  buildings: VenueBuildingInput[];
  rooms: VenueRoomInput[];
}

export function roomDisplayLabel(
  room: Pick<VenueRoomInput, "name">,
  building: Pick<VenueBuildingInput, "name"> | null,
  includeBuilding = true,
): string {
  return includeBuilding && building ? `${room.name} · ${building.name}` : room.name;
}

function venueError(message: string): Error {
  return new Error(message);
}

function checkCoordinatePair(building: VenueBuildingInput): void {
  const hasLat = building.lat !== null;
  const hasLng = building.lng !== null;
  if (hasLat !== hasLng) throw venueError(`${building.name}: latitude and longitude must be set together`);
  if (building.lat !== null && (building.lat < -90 || building.lat > 90)) {
    throw venueError(`${building.name}: latitude is outside -90..90`);
  }
  if (building.lng !== null && (building.lng < -180 || building.lng > 180)) {
    throw venueError(`${building.name}: longitude is outside -180..180`);
  }
}

export function validateVenueModel(model: VenueModel): void {
  if (model.buildings.length === 0) throw venueError("at least one building is required");
  const buildingIds = new Set<string>();
  for (const building of model.buildings) {
    if (!building.id || buildingIds.has(building.id)) throw venueError("building ids must be unique and non-empty");
    buildingIds.add(building.id);
    if (!building.name.trim()) throw venueError("building name is required");
    if (!building.address.trim()) throw venueError(`${building.name}: address is required`);
    if (!Number.isInteger(building.position) || building.position < 0) throw venueError(`${building.name}: invalid position`);
    if (!Number.isInteger(building.access_minutes) || building.access_minutes < 0) {
      throw venueError(`${building.name}: access minutes must be a non-negative integer`);
    }
    checkCoordinatePair(building);
  }

  const roomIds = new Set<string>();
  for (const room of model.rooms) {
    if (!room.id || roomIds.has(room.id)) throw venueError("room ids must be unique and non-empty");
    roomIds.add(room.id);
    if (!buildingIds.has(room.building_id)) throw venueError(`${room.name || "room"}: building is required`);
    if (!room.name.trim()) throw venueError("room name is required");
    if (!Number.isInteger(room.capacity) || room.capacity < 0) throw venueError(`${room.name}: capacity must be non-negative`);
    if (!Number.isInteger(room.position) || room.position < 0) throw venueError(`${room.name}: invalid position`);
    if (!Array.isArray(room.av_capabilities) || room.av_capabilities.some((tag) => typeof tag !== "string" || !tag.trim())) {
      throw venueError(`${room.name}: AV capabilities must be non-empty strings`);
    }
  }
}

function parseCapabilities(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((tag) => typeof tag === "string") ? parsed : [];
  } catch {
    return [];
  }
}

export async function readVenueModel(db: D1Database, eventId: string): Promise<VenueModelResponse> {
  const [buildings, rooms] = await Promise.all([
    db.prepare(
      "SELECT id, name, address, position, lat, lng, access_minutes, access_note FROM buildings WHERE event_id = ? ORDER BY position, id",
    ).bind(eventId).all<BuildingRow>(),
    db.prepare(
      "SELECT id, building_id, name, capacity, position, av_capabilities, notes FROM rooms WHERE event_id = ? ORDER BY position, id",
    ).bind(eventId).all<RoomRow>(),
  ]);
  return {
    buildings: buildings.results.map((building) => ({
      id: building.id,
      name: building.name,
      address: building.address,
      position: building.position,
      lat: building.lat,
      lng: building.lng,
      access_minutes: building.access_minutes,
      access_note: building.access_note,
    })),
    rooms: rooms.results.map((room) => ({
      id: room.id,
      building_id: room.building_id,
      name: room.name,
      capacity: room.capacity,
      position: room.position,
      av_capabilities: parseCapabilities(room.av_capabilities),
      notes: room.notes,
    })),
  };
}

async function assertIdsBelongToEvent(
  db: D1Database,
  table: "buildings" | "rooms",
  ids: readonly string[],
  eventId: string,
): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.prepare(`SELECT id, event_id FROM ${table} WHERE id IN (${placeholders})`).bind(...ids).all<{ id: string; event_id: string }>();
  if (rows.results.some((row) => row.event_id !== eventId)) throw venueError(`${table} id belongs to another event`);
}

export async function writeVenueModel(
  db: D1Database,
  eventId: string,
  model: VenueModel,
  now = Date.now(),
): Promise<VenueModelResponse> {
  validateVenueModel(model);
  await assertIdsBelongToEvent(db, "buildings", model.buildings.map((building) => building.id), eventId);
  await assertIdsBelongToEvent(db, "rooms", model.rooms.map((room) => room.id), eventId);

  const current = await readVenueModel(db, eventId);
  const nextBuildingIds = new Set(model.buildings.map((building) => building.id));
  const nextRoomIds = new Set(model.rooms.map((room) => room.id));
  const statements: D1PreparedStatement[] = [];

  // Children are removed before their parent building so the composite room
  // foreign key remains valid throughout the atomic batch.
  for (const room of current.rooms) {
    if (!nextRoomIds.has(room.id)) statements.push(db.prepare("DELETE FROM rooms WHERE id = ? AND event_id = ?").bind(room.id, eventId));
  }
  for (const building of current.buildings) {
    if (!nextBuildingIds.has(building.id)) statements.push(db.prepare("DELETE FROM buildings WHERE id = ? AND event_id = ?").bind(building.id, eventId));
  }
  for (const building of model.buildings) {
    statements.push(db.prepare(
      `INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, address = excluded.address, position = excluded.position,
         lat = excluded.lat, lng = excluded.lng, access_minutes = excluded.access_minutes,
         access_note = excluded.access_note, updated_at = excluded.updated_at`,
    ).bind(building.id, eventId, building.name.trim(), building.address.trim(), building.position, building.lat, building.lng, building.access_minutes, building.access_note?.trim() || null, now, now));
  }
  for (const room of model.rooms) {
    statements.push(db.prepare(
      `INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET building_id = excluded.building_id, name = excluded.name,
         capacity = excluded.capacity, position = excluded.position, av_capabilities = excluded.av_capabilities,
         notes = excluded.notes, updated_at = excluded.updated_at`,
    ).bind(room.id, eventId, room.building_id, room.name.trim(), room.capacity, room.position, JSON.stringify(room.av_capabilities), room.notes?.trim() || null, now, now));
  }
  await db.batch(statements);
  return readVenueModel(db, eventId);
}
