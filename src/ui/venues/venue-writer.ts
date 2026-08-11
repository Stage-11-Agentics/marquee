import type { VenueModel } from "../../lib/venues";

export const DEFAULT_EVENT_ID = "evt_aie-ny-2026";

async function venueResponse(response: Response): Promise<VenueModel> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | VenueModel | null;
  if (!response.ok) {
    const message = body && "error" in body ? body.error?.message : undefined;
    throw new Error(message || `Venue save failed (${response.status})`);
  }
  return body as VenueModel;
}

export async function loadVenueModel(eventId = DEFAULT_EVENT_ID): Promise<VenueModel> {
  const response = await fetch(`/api/v1/events/${encodeURIComponent(eventId)}/venues`);
  return venueResponse(response);
}

/** One client writer shared by every venue-capable save surface. */
export async function saveVenueModel(model: VenueModel, eventId = DEFAULT_EVENT_ID): Promise<VenueModel> {
  const response = await fetch(`/api/v1/events/${encodeURIComponent(eventId)}/venues`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(model),
  });
  return venueResponse(response);
}
