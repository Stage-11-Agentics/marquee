import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, PageHeader } from "../shell/components";
import "./setup.css";

/**
 * One record, created once. Forms, portals, agenda times, and calendar invites
 * all inherit it.
 *
 * The screen and the switcher's `＋` both land on `POST /api/v1/events` — the
 * same endpoint the CLI's `event create` drives — so there is exactly one way a
 * conference comes into existence, whoever asks for it (AC-279, AC-280).
 */

export const CREATE_EVENT_ROUTE = "/api/v1/events";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
];

interface CreatedEvent {
  data: { event: { id: string; name: string } };
}

export function CreateConferencePage({ navigate }: { navigate: (target: string) => void }): JSX.Element {
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [timezone, setTimezone] = useState(TIMEZONES[0] ?? "America/New_York");
  const [venue, setVenue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await apiFetch<CreatedEvent>(CREATE_EVENT_ROUTE, {
        method: "POST",
        route: CREATE_EVENT_ROUTE,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          starts_on: startsOn,
          ends_on: endsOn,
          timezone,
          venue: venue.trim().length > 0 ? venue.trim() : null,
        }),
      });
      navigate(`/dashboard?event=${encodeURIComponent(created.data.event.id)}`);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  return <div class="setup-page">
    <PageHeader
      title="Create conference"
      copy="One record, created once. Forms, portals, agenda times, and calendar invites all inherit it."
    />
    <Card>
      <CardHeader title="The conference">
        <span class="subtle">Everything here can be changed later in Conference settings</span>
      </CardHeader>
      <CardBody>
        <div class="field">
          <label for="new-event-name">Conference name</label>
          <input id="new-event-name" value={name} placeholder="AI Engineer New York 2027"
            onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)} />
          <span class="field-note">Used in the sidebar, every email subject, the public site, and calendar invites.</span>
        </div>
        <div class="setup-field-row">
          <div class="field">
            <label for="new-event-start">First day</label>
            <input id="new-event-start" type="date" value={startsOn}
              onInput={(event) => setStartsOn((event.currentTarget as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label for="new-event-end">Last day</label>
            <input id="new-event-end" type="date" value={endsOn}
              onInput={(event) => setEndsOn((event.currentTarget as HTMLInputElement).value)} />
          </div>
        </div>
        <div class="field">
          <label for="new-event-timezone">Timezone</label>
          <select id="new-event-timezone" value={timezone}
            onChange={(event) => setTimezone((event.currentTarget as HTMLSelectElement).value)}>
            {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          <span class="field-note">Agenda times and calendar invites inherit this timezone.</span>
        </div>
        <div class="field">
          <label for="new-event-venue">Venue</label>
          <input id="new-event-venue" value={venue} placeholder="Buffalo Marriott HARBORCENTER"
            onInput={(event) => setVenue((event.currentTarget as HTMLInputElement).value)} />
          <span class="field-note">Optional now; rooms and buildings are configured after the conference exists.</span>
        </div>
        <div class="setup-actions">
          <span class="setup-error" role="status" aria-live="polite">{error}</span>
          <Button variant="primary" onClick={() => void create()} disabled={busy} aria-busy={busy}>
            {busy ? "Creating…" : "Create conference"}
          </Button>
        </div>
      </CardBody>
    </Card>
  </div>;
}
