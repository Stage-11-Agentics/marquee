import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { PageHeader } from "../shell/components";
import { DEFAULT_EVENT_ID, loadVenueModel } from "./venue-writer";

export function SettingsPage({ navigate, eventId = DEFAULT_EVENT_ID }: { navigate: (target: string) => void; eventId?: string }): JSX.Element {
  const [counts, setCounts] = useState<{ buildings: number; rooms: number } | null>(null);
  useEffect(() => { loadVenueModel(eventId).then((model) => setCounts({ buildings: model.buildings.length, rooms: model.rooms.length })).catch(() => setCounts(null)); }, [eventId]);
  return <div class="settings-page"><PageHeader title="Event settings" copy="Conference details, formats, and tracks live here. Venue geography has its own surface so the map and authoring stay together." /><section class="card settings-venue-link"><div><span class="eyebrow">Venues and rooms</span><h2>One place for every door</h2><p class="subtle">{counts ? `${counts.buildings} buildings · ${counts.rooms} rooms` : "Venue counts unavailable"}</p></div><button class="button primary" onClick={() => navigate("/settings/venues")}>Open Venues →</button></section></div>;
}
