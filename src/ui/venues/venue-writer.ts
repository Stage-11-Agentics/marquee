import type { VenueModel } from "../../lib/venues";
import { apiFetch } from "../shell/api-client";

const VENUE_ROUTE = "/api/v1/events/{eventId}/venues";

export async function loadVenueModel(eventId: string): Promise<VenueModel> {
  return apiFetch<VenueModel>(`/api/v1/events/${encodeURIComponent(eventId)}/venues`, { route: VENUE_ROUTE });
}

/** One client writer shared by every venue-capable save surface. */
export async function saveVenueModel(model: VenueModel, eventId: string): Promise<VenueModel> {
  return apiFetch<VenueModel>(`/api/v1/events/${encodeURIComponent(eventId)}/venues`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(model),
    route: VENUE_ROUTE,
  });
}
