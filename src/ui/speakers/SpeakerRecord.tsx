import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { SpeakerRow, SpeakerStatus } from "../../routes/speakers.queries";
import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Chip } from "../shell/components";
import { SpeakerAvatar } from "./SpeakerAvatar";
import { SpeakerFilesPanel } from "./SpeakerFilesPanel";

const STATUS_ORDER: SpeakerStatus[] = ["pending", "invited", "confirmed", "declined"];
const STATUS_LABELS: Record<SpeakerStatus, string> = {
  pending: "Pending",
  invited: "Invited",
  confirmed: "Confirmed",
  declined: "Declined",
};

/**
 * Named logistics rows, plus free notes. SPK-15 is a rider: an organizer needs
 * somewhere to put "arrives the 11th, vegetarian, aisle seat" and needs it to
 * still be there tomorrow. A field-definition engine is a different product.
 */
const LOGISTICS_FIELDS: Array<{ key: string; label: string; placeholder: string }> = [
  { key: "Arrival", label: "Arrival", placeholder: "May 11, evening" },
  { key: "Departure", label: "Departure", placeholder: "May 15, midday" },
  { key: "Travel", label: "Travel preferences", placeholder: "Aisle seat; no red-eyes" },
  { key: "Dietary", label: "Dietary", placeholder: "Vegetarian" },
  { key: "Accessibility", label: "Accessibility", placeholder: "Step-free stage access" },
  { key: "Notes", label: "Notes", placeholder: "Anything the conference should hold on to" },
];

function chipTone(status: SpeakerStatus | "pending" | "confirmed" | "declined"): "" | "success" | "warning" | "alarm" {
  if (status === "confirmed") return "success";
  if (status === "declined") return "alarm";
  if (status === "invited") return "warning";
  return "";
}

export function SpeakerStatusBadge({ status }: { status: SpeakerStatus }): JSX.Element {
  // Fixed width and a constant label length band: switching a speaker from
  // Pending to Confirmed must not move the column beside it.
  return <span class={`speaker-status status-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function SpeakerRecord({
  eventId,
  personId,
  onClose,
  onSaved,
}: {
  eventId: string;
  personId: string;
  onClose: () => void;
  onSaved: (speaker: SpeakerRow) => void;
}): JSX.Element {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; speaker: SpeakerRow }
  >({ kind: "loading" });
  const [form, setForm] = useState<{
    name: string;
    email: string;
    title: string;
    company: string;
    bio: string;
    status: SpeakerStatus;
    custom: Record<string, string>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    apiFetch<{ speaker: SpeakerRow }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(personId)}`,
      { route: "/api/v1/events/{eventId}/speakers/{personId}", signal: controller.signal },
    )
      .then((body) => {
        setState({ kind: "ready", speaker: body.speaker });
        setForm({
          name: body.speaker.name,
          email: body.speaker.email,
          title: body.speaker.title ?? "",
          company: body.speaker.company ?? "",
          bio: body.speaker.bio ?? "",
          status: body.speaker.status,
          custom: { ...body.speaker.custom_fields },
        });
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: errorSummary(caught) });
      });
    return () => controller.abort();
  }, [eventId, personId]);

  const save = async () => {
    if (!form || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body = await apiFetch<{ speaker: SpeakerRow }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(personId)}`,
        {
          route: "/api/v1/events/{eventId}/speakers/{personId}",
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            title: form.title,
            company: form.company,
            bio: form.bio,
            confirmation_status: form.status,
            custom_fields: form.custom,
          }),
        },
      );
      setState({ kind: "ready", speaker: body.speaker });
      setSaved(true);
      onSaved(body.speaker);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  const speaker = state.kind === "ready" ? state.speaker : null;

  return <aside class="speaker-record" role="dialog" aria-modal="true" aria-labelledby="speaker-record-title">
    <header class="speaker-record-head">
      <div>
        <span class="speaker-kicker">Speaker record</span>
        <h2 id="speaker-record-title">{speaker?.name ?? "Loading speaker"}</h2>
      </div>
      <Button small aria-label="Close speaker record" onClick={onClose}>Close</Button>
    </header>

    {state.kind === "loading" ? <div class="speaker-record-state">Reading the conference record…</div> : null}
    {state.kind === "error" ? <div class="speaker-record-state error" role="alert">{state.message}</div> : null}

    {speaker && form ? <div class="speaker-record-body">
      <section class="speaker-identity">
        <SpeakerAvatar name={speaker.name} attachmentId={speaker.headshot_attachment_id} size={48} />
        <div>
          <strong>{speaker.name}</strong>
          <span>{speaker.email}</span>
          <span>{[speaker.title, speaker.company].filter(Boolean).join(" · ") || "No title or company yet"}</span>
        </div>
        <SpeakerStatusBadge status={speaker.status} />
      </section>

      <section class="speaker-section">
        <h3>Profile</h3>
        <div class="speaker-form-grid">
          <label class="speaker-field">Name<input value={form.name} onInput={(event) => setForm({ ...form, name: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="speaker-field">Email<input type="email" value={form.email} onInput={(event) => setForm({ ...form, email: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="speaker-field">Job title<input value={form.title} onInput={(event) => setForm({ ...form, title: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="speaker-field">Company<input value={form.company} onInput={(event) => setForm({ ...form, company: (event.currentTarget as HTMLInputElement).value })} /></label>
        </div>
        <label class="speaker-field speaker-field-wide">Bio<textarea rows={7} value={form.bio} onInput={(event) => setForm({ ...form, bio: (event.currentTarget as HTMLTextAreaElement).value })} /></label>
      </section>

      <section class="speaker-section">
        <h3>Status</h3>
        <div class="speaker-form-grid">
          <label class="speaker-field">Conference status<select value={form.status} onChange={(event) => setForm({ ...form, status: (event.currentTarget as HTMLSelectElement).value as SpeakerStatus })}>
            {STATUS_ORDER.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
          </select></label>
        </div>
        <p class="speaker-note">
          Setting this applies to every session this speaker holds, so the roster badge and the
          per-session chips below always tell the same story — useful when a speaker confirms on a call.
        </p>
      </section>

      <section class="speaker-section">
        <h3>Sessions</h3>
        {speaker.sessions.length === 0
          ? <p class="speaker-empty-line">No sessions yet. This speaker is on the roster; their status above is the conference-level answer.</p>
          : <div class="speaker-list">{speaker.sessions.map((session) => <div class="speaker-list-row" key={session.participation_id}>
            <div>
              <strong>{session.title}</strong>
              <span>{session.role === "co_speaker" ? "Co-speaker" : "Speaker"} · {session.status}</span>
            </div>
            <Chip tone={chipTone(session.confirmation_status)}>{STATUS_LABELS[session.confirmation_status]}</Chip>
          </div>)}</div>}
      </section>

      <section class="speaker-section">
        <h3>Logistics &amp; notes</h3>
        <div class="speaker-form-grid">
          {LOGISTICS_FIELDS.map((field) => <label class="speaker-field" key={field.key}>{field.label}
            <input
              value={form.custom[field.key] ?? ""}
              placeholder={field.placeholder}
              onInput={(event) => setForm({ ...form, custom: { ...form.custom, [field.key]: (event.currentTarget as HTMLInputElement).value } })}
            />
          </label>)}
        </div>
      </section>

      <SpeakerFilesPanel eventId={eventId} personId={personId} />

      <section class="speaker-section">
        <h3>Onboarding</h3>
        <p class="speaker-note tabular">{speaker.task_done} of {speaker.task_total} onboarding task{speaker.task_total === 1 ? "" : "s"} complete.</p>
      </section>
    </div> : null}

    <footer class="speaker-record-foot">
      <span class="speaker-save-state" aria-live="polite">{error ? <em class="alarm-text">{error}</em> : saved ? "Saved" : ""}</span>
      <button class="speaker-fixed-action" type="button" disabled={busy || !form} onClick={() => void save()}>{busy ? "Saving…" : "Save speaker"}</button>
    </footer>
  </aside>;
}
