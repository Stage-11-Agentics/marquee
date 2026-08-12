import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, PageHeader } from "../shell/components";
import { useEventContext } from "../shell/event-context";
import { announce } from "../shell/OverlayHosts";
import "./setup.css";

/**
 * One record, created once. Forms, portals, agenda times, and calendar invites
 * all inherit it.
 *
 * The screen and the switcher's `＋` both land on `POST /api/v1/events` — the
 * same endpoint the CLI's `event create` drives — so there is no path by which
 * a conference can exist that an agent could not have made (AC-279, AC-280).
 *
 * Nothing here is empty on first paint. The conference this screen is most
 * often used for is next year's, and every required field it can guess it
 * guesses: a validation bounce on a date is a wasted round trip for a person
 * and an expensive one for an agent working a turn budget.
 */

export const CREATE_EVENT_ROUTE = "/api/v1/events";
const COPY_PLAN_ROUTE = "/api/v1/events/{eventId}/copy-plan";

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

type StartMode = "scratch" | "existing" | "sessionize";

type CopySetKey = "formats" | "tracks" | "forms" | "task_templates" | "email_templates" | "evaluation_plan" | "venues";

interface CopySetDefinition {
  key: CopySetKey;
  label: string;
  why: string;
  /** Manifest tables this set writes, in the order the count reads best. */
  tables: { table: string; noun: string }[];
}

/** The copy contract, in the organizer's language rather than the schema's. */
const COPY_SETS: CopySetDefinition[] = [
  { key: "formats", label: "Formats", why: "Durations carry — a 25-minute talk stays 25 minutes.", tables: [{ table: "formats", noun: "formats" }] },
  { key: "tracks", label: "Tracks", why: "Names and colors; reorder any time.", tables: [{ table: "tracks", noun: "tracks" }] },
  { key: "forms", label: "CFP forms", why: "Structure and the form's administrators. Copied forms arrive closed with no dates — opening intake is its own decision.", tables: [{ table: "forms", noun: "forms" }, { table: "form_fields", noun: "fields" }] },
  { key: "task_templates", label: "Task templates", why: "The chase work: bio, headshot, slides, travel.", tables: [{ table: "task_templates", noun: "templates" }] },
  { key: "email_templates", label: "Email templates", why: "Subjects and bodies; the conference name re-binds.", tables: [{ table: "email_templates", noun: "templates" }] },
  { key: "evaluation_plan", label: "Evaluation plan", why: "Rounds and scorecard, arriving as a draft. No committees, no scores — reviewers are re-invited each year.", tables: [{ table: "evaluation_rounds", noun: "rounds" }, { table: "rubric_criteria", noun: "criteria" }] },
  { key: "venues", label: "Venues", why: "Buildings and rooms — carry them only if you're returning.", tables: [{ table: "buildings", noun: "buildings" }, { table: "rooms", noun: "rooms" }] },
];

const DEFAULT_SELECTION: Record<CopySetKey, boolean> = {
  formats: true,
  tracks: true,
  forms: true,
  task_templates: true,
  email_templates: true,
  evaluation_plan: true,
  venues: false,
};

interface CopyPlan {
  event: { id: string; name: string };
  counts: Record<string, number>;
  task_templates_skipped_fixed_due: number;
  requires: Partial<Record<CopySetKey, CopySetKey[]>>;
  reasons: Partial<Record<CopySetKey, string>>;
}

interface CreatedEvent {
  data: {
    event: { id: string; name: string };
    copied?: Record<string, number>;
    task_templates_skipped_fixed_due?: number;
  };
}

/**
 * The receipt. Counts, not adjectives: an organizer who has just carried
 * structure between conferences wants to know exactly what arrived, and the
 * one sentence they read is the only place they will see it.
 */
export function receiptFor(
  created: CreatedEvent["data"],
  fallbackName: string,
  sourceName: string | null,
): string {
  const name = created.event.name || fallbackName || "The conference";
  if (!created.copied) return `${name} created — an empty conference with honest empty states.`;
  const total = Object.values(created.copied).reduce((sum, count) => sum + count, 0);
  const skipped = created.task_templates_skipped_fixed_due ?? 0;
  const skippedNote = skipped > 0
    ? ` ${skipped} task ${skipped === 1 ? "template" : "templates"} with a fixed deadline stayed behind.`
    : "";
  return `${name} created from ${sourceName ?? "the source conference"} — ${total} structure ${total === 1 ? "record" : "records"} copied, nothing personal travelled.${skippedNote}`;
}

/** Next year, same week: the dates an organizer would have typed anyway. */
function defaultDates(source: { starts_on: string; ends_on: string } | null): { startsOn: string; endsOn: string } {
  if (source) {
    return {
      startsOn: shiftYear(source.starts_on, 1),
      endsOn: shiftYear(source.ends_on, 1),
    };
  }
  const start = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
  return { startsOn: start.toISOString().slice(0, 10), endsOn: end.toISOString().slice(0, 10) };
}

function shiftYear(date: string, years: number): string {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${Number(year) + years}-${month}-${day}`;
}

export function CreateConferencePage({ navigate }: { navigate: (target: string) => void }): JSX.Element {
  const { events, eventId, switchEvent, refresh } = useEventContext();
  const [mode, setMode] = useState<StartMode>("scratch");
  const [sourceId, setSourceId] = useState("");
  const [plan, setPlan] = useState<CopyPlan | null>(null);
  const [planError, setPlanError] = useState("");
  const [selection, setSelection] = useState<Record<CopySetKey, boolean>>({ ...DEFAULT_SELECTION });
  const [name, setName] = useState("");
  const [dates, setDates] = useState(() => defaultDates(null));
  const [timezone, setTimezone] = useState(TIMEZONES[0] ?? "America/New_York");
  const [venue, setVenue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const source = events.find((event) => event.id === sourceId) ?? null;

  // The conference in view is the one you are most likely copying, and the
  // first paint is where that guess is worth the most.
  useEffect(() => {
    if (sourceId.length > 0) return;
    const preferred = events.find((event) => event.id === eventId) ?? events[0];
    if (preferred) setSourceId(preferred.id);
  }, [events, eventId, sourceId]);

  useEffect(() => {
    if (mode !== "existing" || sourceId.length === 0) return;
    let cancelled = false;
    setPlanError("");
    void apiFetch<{ data: CopyPlan }>(`/api/v1/events/${encodeURIComponent(sourceId)}/copy-plan`, { route: COPY_PLAN_ROUTE })
      .then((body) => { if (!cancelled) setPlan(body.data); })
      .catch((caught: unknown) => { if (!cancelled) { setPlan(null); setPlanError(errorSummary(caught)); } });
    return () => { cancelled = true; };
  }, [mode, sourceId]);

  useEffect(() => {
    if (mode !== "existing" || !source) return;
    setDates(defaultDates(source));
    setTimezone(source.timezone);
  }, [mode, source]);

  /**
   * A set that another set cannot travel without is checked and locked, with
   * the reason on the row. The API refuses the illegal combination too — this
   * is so the organizer never has to be refused.
   */
  const locked = useMemo(() => {
    const result = new Set<CopySetKey>();
    for (const [key, requires] of Object.entries(plan?.requires ?? {})) {
      if (!selection[key as CopySetKey]) continue;
      for (const required of requires ?? []) result.add(required);
    }
    return result;
  }, [plan, selection]);

  const effective = useMemo(() => {
    const result = { ...selection };
    for (const key of locked) result[key] = true;
    return result;
  }, [selection, locked]);

  const countFor = (set: CopySetDefinition): string => {
    if (!plan) return "—";
    return set.tables
      .map((entry) => `${plan.counts[entry.table] ?? 0} ${entry.noun}`)
      .join(" · ");
  };

  const lockedReason = (key: CopySetKey): string => {
    for (const [dependent, requires] of Object.entries(plan?.requires ?? {})) {
      if (!selection[dependent as CopySetKey]) continue;
      if ((requires ?? []).includes(key)) return plan?.reasons[dependent as CopySetKey] ?? "";
    }
    return "";
  };

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
          starts_on: dates.startsOn,
          ends_on: dates.endsOn,
          timezone,
          venue: venue.trim().length > 0 ? venue.trim() : null,
          ...(mode === "existing" && sourceId.length > 0 ? { copy_from: sourceId, copy: effective } : {}),
        }),
      });
      // The list is re-read before the switch so the new conference is a real
      // row in it; a selection the list does not contain is not honoured.
      await refresh();
      switchEvent(created.data.event.id);
      announce(receiptFor(created.data, name.trim(), source?.name ?? null));
      navigate(mode === "sessionize" ? "/import" : "/dashboard");
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  const submittable = name.trim().length > 0
    && dates.startsOn.length > 0
    && dates.endsOn.length > 0
    && dates.startsOn <= dates.endsOn
    && timezone.length > 0;

  const outcome = mode === "sessionize"
    ? "You'll land in the Sessionize importer next."
    : mode === "scratch"
      ? "You'll add tracks, formats, and rooms next."
      : "You'll land on the new conference's empty program home.";

  return <div class="setup-page">
    <PageHeader
      title="Create conference"
      copy="One record, created once. Forms, portals, agenda times, and calendar invites all inherit it."
    />

    <div class="choice-row" role="group" aria-label="How to start">
      {([
        { key: "scratch", title: "Start from scratch", copy: "Name the conference and configure tracks, formats, and rooms here." },
        { key: "existing", title: "Start from an existing conference", copy: "Carry the structure — formats, tracks, forms, chase tasks — never the people or their data." },
        { key: "sessionize", title: "Import from Sessionize", copy: "Create the conference, then bring an open CFP across with its review history." },
      ] as const).map((choice) => <button
        key={choice.key}
        type="button"
        class="choice-card"
        data-start-mode={choice.key}
        aria-pressed={mode === choice.key}
        disabled={choice.key === "existing" && events.length === 0}
        onClick={() => setMode(choice.key)}
      >
        <strong>{choice.title}</strong>
        <span>{choice.copy}</span>
      </button>)}
    </div>

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
            <input id="new-event-start" type="date" value={dates.startsOn}
              onInput={(event) => setDates((current) => ({ ...current, startsOn: (event.currentTarget as HTMLInputElement).value }))} />
          </div>
          <div class="field">
            <label for="new-event-end">Last day</label>
            <input id="new-event-end" type="date" value={dates.endsOn}
              onInput={(event) => setDates((current) => ({ ...current, endsOn: (event.currentTarget as HTMLInputElement).value }))} />
          </div>
        </div>
        <div class="field">
          <label for="new-event-timezone">Timezone</label>
          <select id="new-event-timezone" value={timezone}
            onChange={(event) => setTimezone((event.currentTarget as HTMLSelectElement).value)}>
            {[...new Set([timezone, ...TIMEZONES])].map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          <span class="field-note">Agenda times and calendar invites inherit this timezone.</span>
        </div>
        <div class="field">
          <label for="new-event-venue">Venue</label>
          <input id="new-event-venue" value={venue} placeholder="Buffalo Marriott HARBORCENTER"
            onInput={(event) => setVenue((event.currentTarget as HTMLInputElement).value)} />
          <span class="field-note">Optional now; rooms and buildings are configured after the conference exists.</span>
        </div>
      </CardBody>
    </Card>

    {mode === "existing" && <Card>
      <CardHeader title="Clone from existing conference">
        <span class="copy-source subtle">
          <label for="copy-from">from</label>
          <select id="copy-from" value={sourceId} onChange={(event) => setSourceId((event.currentTarget as HTMLSelectElement).value)}>
            {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </span>
      </CardHeader>
      <CardBody>
        {planError.length > 0 && <p class="setup-error" role="status">{planError}</p>}
        <div class="copy-list">
          {COPY_SETS.map((set) => {
            const isLocked = locked.has(set.key);
            const checked = effective[set.key];
            const reason = isLocked ? lockedReason(set.key) : "";
            return <label class={`copy-row${checked ? "" : " off"}`} key={set.key}>
              <input
                type="checkbox"
                checked={checked}
                disabled={isLocked}
                data-copy-set={set.key}
                onChange={(event) => setSelection((current) => ({ ...current, [set.key]: (event.currentTarget as HTMLInputElement).checked }))}
              />
              <span class="what">{set.label}
                <span class="why">{reason || set.why}</span>
              </span>
              <span class="count mono">{countFor(set)}</span>
            </label>;
          })}
        </div>
        {(plan?.task_templates_skipped_fixed_due ?? 0) > 0 && <p class="copy-skipped">
          {plan?.task_templates_skipped_fixed_due} task {plan?.task_templates_skipped_fixed_due === 1 ? "template carries" : "templates carry"} a fixed calendar deadline and will not be copied — that date belongs to {plan?.event.name}. Templates counted from acceptance carry over as they are.
        </p>}
        <div class="never">
          <strong>Never copies</strong>
          Submissions, speakers' conference data, reviews and scores, the agenda, decision waves, uploads, messages, committees, and the audit log stay with {plan?.event.name ?? "the source conference"}. People aren't copied because they don't need to be — a returning speaker is already the same person in your organization.
        </div>
      </CardBody>
    </Card>}

    <div class="setup-actions">
      <span class="subtle setup-outcome">{outcome}</span>
      <span class="setup-error" role="status" aria-live="polite">{error}</span>
      {/*
        Every required field arrives filled, so the only way one empties is that
        somebody cleared it — and a cleared date otherwise buys a 400 whose
        sentence ("the system sent a request this conference could not accept")
        tells the organizer nothing about which field to look at.
      */}
      <Button variant="primary" onClick={() => void create()} disabled={busy || !submittable} aria-busy={busy}>
        {busy ? "Creating…" : `Create ${name.trim() || "conference"}`}
      </Button>
    </div>
  </div>;
}
