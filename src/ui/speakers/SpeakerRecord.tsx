import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { SocialBadges } from "../social/SocialBadges";
import type { SpeakerRow, SpeakerStatus } from "../../routes/speakers.queries";
import type { SignedUpload } from "../../lib/r2/protocol";
import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Chip } from "../shell/components";
import { putFileToR2 } from "../upload/upload-client";
import { validateClientUpload } from "../upload/upload-policy";
import { SpeakerAvatar } from "./SpeakerAvatar";
import { SpeakerFilesPanel } from "./SpeakerFilesPanel";
import { openPortalPreview as runPortalPreview } from "./portal-preview";

const STATUS_ORDER: SpeakerStatus[] = ["pending", "invited", "confirmed", "declined"];
const STATUS_LABELS: Record<SpeakerStatus, string> = {
  pending: "Pending",
  invited: "Invited",
  confirmed: "Confirmed",
  declined: "Declined",
};

interface SpeakerHelper {
  id: string;
  helper_person_id: string;
  helper_name: string;
  helper_email: string;
  removed_at: number | null;
}

/**
 * Named logistics rows, plus free notes. SPK-15 is a rider: an organizer needs
 * somewhere to put "arrives the 11th, vegetarian, aisle seat" and needs it to
 * still be there tomorrow. A field-definition engine is a different product.
 */
/**
 * The placeholders are prompts, not specimens. Written as sample values —
 * "May 11, evening", "Step-free stage access" — an untouched panel reads at a
 * glance as though travel and access needs are already on file, and the one
 * thing an organizer must never wrongly believe is that a speaker's access
 * requirement has been captured. Each line now asks for the answer in the same
 * voice the Notes field already used, so an empty field looks empty.
 */
export const LOGISTICS_FIELDS: Array<{ key: string; label: string; placeholder: string }> = [
  { key: "Arrival", label: "Arrival", placeholder: "When they arrive, once you know" },
  { key: "Departure", label: "Departure", placeholder: "When they leave" },
  { key: "Travel", label: "Travel preferences", placeholder: "Seat, timing, anything they have asked for" },
  { key: "Dietary", label: "Dietary", placeholder: "Anything they cannot eat" },
  { key: "Accessibility", label: "Accessibility", placeholder: "What they need to take part" },
  { key: "Notes", label: "Notes", placeholder: "Anything the conference should hold on to" },
];

function chipTone(status: SpeakerStatus | "pending" | "confirmed" | "declined"): "" | "success" | "warning" | "alarm" {
  if (status === "confirmed") return "success";
  if (status === "declined") return "alarm";
  if (status === "invited") return "warning";
  return "";
}

async function uploadOrganizerHeadshot(eventId: string, personId: string, file: File): Promise<string> {
  const signed = await apiFetch<SignedUpload>(
    `/api/v1/events/${encodeURIComponent(eventId)}/people/${encodeURIComponent(personId)}/headshot/sign`,
    {
      route: "/api/v1/events/{eventId}/people/{personId}/headshot/sign",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size }),
    },
  );
  const put = putFileToR2(signed, file);
  await put.promise;
  const completed = await apiFetch<{ attachmentId: string }>(`/api/v1/me/uploads/${encodeURIComponent(signed.attachmentId)}/complete`, {
    route: "/api/v1/me/uploads/{id}/complete",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ completionToken: signed.completionToken }),
  });
  return completed.attachmentId;
}

async function headshotDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("The headshot preview could not be read."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
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
  const [headshot, setHeadshot] = useState<File | null>(null);
  const [headshotPreview, setHeadshotPreview] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [helpers, setHelpers] = useState<SpeakerHelper[]>([]);
  const [helperState, setHelperState] = useState<"loading" | "ready" | "error">("loading");
  const [helperName, setHelperName] = useState("");
  const [helperEmail, setHelperEmail] = useState("");
  const [helperBusy, setHelperBusy] = useState(false);
  const [helperError, setHelperError] = useState<string | null>(null);

  useEffect(() => () => {
    if (headshotPreview) URL.revokeObjectURL(headshotPreview);
  }, [headshotPreview]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    apiFetch<{ speaker: SpeakerRow }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(personId)}`,
      { route: "/api/v1/events/{eventId}/speakers/{personId}", signal: controller.signal },
    )
      .then((body) => {
        setState({ kind: "ready", speaker: body.speaker });
        setHeadshot(null);
        setHeadshotPreview(null);
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

  const readHelpers = async (signal?: AbortSignal) => {
    try {
      setHelperState("loading");
      const result = await apiFetch<{ helpers: SpeakerHelper[] }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(personId)}/helpers`,
        { route: "/api/v1/events/{eventId}/speakers/{personId}/helpers", signal },
      );
      if (!signal?.aborted) {
        setHelpers(result.helpers.filter((helper) => helper.removed_at === null));
        setHelperState("ready");
      }
    } catch (caught: unknown) {
      if (!signal?.aborted) {
        setHelperState("error");
        setHelperError(errorSummary(caught));
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setHelperError(null);
    void readHelpers(controller.signal);
    return () => controller.abort();
  }, [eventId, personId]);

  const addHelper = async (event: JSX.TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (helperBusy) return;
    setHelperBusy(true);
    setHelperError(null);
    try {
      await apiFetch(
        `/api/v1/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(personId)}/helpers`,
        {
          route: "/api/v1/events/{eventId}/speakers/{personId}/helpers",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: helperName, email: helperEmail }),
        },
      );
      setHelperName("");
      setHelperEmail("");
      await readHelpers();
    } catch (caught: unknown) {
      setHelperError(errorSummary(caught));
    } finally {
      setHelperBusy(false);
    }
  };

  const removeHelper = async (helper: SpeakerHelper) => {
    if (helperBusy) return;
    setHelperBusy(true);
    setHelperError(null);
    try {
      await apiFetch(
        `/api/v1/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(personId)}/helpers/${encodeURIComponent(helper.helper_person_id)}`,
        {
          route: "/api/v1/events/{eventId}/speakers/{personId}/helpers/{helperId}",
          method: "DELETE",
        },
      );
      await readHelpers();
    } catch (caught: unknown) {
      setHelperError(errorSummary(caught));
    } finally {
      setHelperBusy(false);
    }
  };

  const chooseHeadshot = (event: JSX.TargetedEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    if (!file) return;
    const validation = validateClientUpload(file, { accept: ["jpg", "jpeg", "png", "webp"], maxBytes: 10 * 1024 * 1024 });
    if (validation) {
      setError(validation);
      return;
    }
    if (headshotPreview) URL.revokeObjectURL(headshotPreview);
    setHeadshotPreview(URL.createObjectURL(file));
    setHeadshot(file);
    setError(null);
    setSaved(false);
  };

  const openPortalPreview = async () => {
    if (!speaker || previewBusy) return;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const outcome = await runPortalPreview({
        // Called synchronously inside `runPortalPreview`, still under the
        // organizer's click — see the note there.
        open: (url, target, features) => window.open(url, target, features),
        previewUrl: async () => {
          const body = await apiFetch<{ url: string }>(
            `/api/v1/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(personId)}/portal-preview`,
            {
              route: "/api/v1/events/{eventId}/speakers/{personId}/portal-preview",
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            },
          );
          return body.url;
        },
        describeError: errorSummary,
      });
      if (!outcome.ok) setPreviewError(outcome.message);
    } finally {
      setPreviewBusy(false);
    }
  };

  const save = async () => {
    if (!form || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      let headshotAttachmentId: string | undefined;
      if (headshot) {
        const dimensions = await headshotDimensions(headshot);
        if (dimensions.width < 256 || dimensions.height < 256) throw new Error("Headshots must be at least 256 × 256 pixels.");
        headshotAttachmentId = await uploadOrganizerHeadshot(eventId, personId, headshot);
      }
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
            ...(headshotAttachmentId ? { headshot_attachment_id: headshotAttachmentId } : {}),
          }),
        },
      );
      setState({ kind: "ready", speaker: body.speaker });
      setHeadshot(null);
      setHeadshotPreview(null);
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
      <div class="speaker-record-head-actions">
        {speaker ? <Button small disabled={previewBusy} onClick={() => void openPortalPreview()}>{previewBusy ? "Opening…" : "Open portal as this speaker →"}</Button> : null}
        <Button small aria-label="Close speaker record" onClick={onClose}>Close</Button>
      </div>
    </header>

    {state.kind === "loading" ? <div class="speaker-record-state">Reading the conference record…</div> : null}
    {state.kind === "error" ? <div class="speaker-record-state error" role="alert">{state.message}</div> : null}

    {speaker && form ? <div class="speaker-record-body">
      <section class="speaker-identity">
        <SpeakerAvatar eventId={eventId} personId={personId} name={speaker.name} attachmentId={speaker.headshot_attachment_id} size={48} />
        <div>
          <strong>{speaker.name}</strong>
          <span>{speaker.email}</span>
          <span>{[speaker.title, speaker.company].filter(Boolean).join(" · ") || "No title or company yet"}</span>
          {/* Read-only: the handles are the speaker's own, kept where they
              wrote them. The organizer sees what will publish beside the name. */}
          <SocialBadges links={speaker.social_links} ownerName={speaker.name} size="compact" />
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
        <label class="speaker-field speaker-field-wide">Upload headshot<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseHeadshot} /><small class="speaker-upload-note">{speaker.headshot_attachment_id ? "A headshot is on file. Choose a new image to replace it." : "No headshot is on file yet."} Minimum 256 × 256 pixels.</small>{headshotPreview ? <span class="speaker-headshot-preview"><img src={headshotPreview} alt="Headshot preview" /></span> : null}</label>
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

      <section class="speaker-section speaker-helper-section">
        <div class="speaker-section-heading">
          <div>
            <h3>Helpers</h3>
            <p class="speaker-note">Helpers can see this speaker’s tasks and logistics only. The name shown is the name you entered, not the private speaker record.</p>
          </div>
          <span class="speaker-helper-count">{helperState === "loading" ? "Reading…" : `${helpers.length} active`}</span>
        </div>
        {helpers.length > 0
          ? <div class="speaker-list">{helpers.map((helper) => <div class="speaker-list-row" key={helper.id}>
            <div>
              <strong>{helper.helper_name}</strong>
              <span>{helper.helper_email}</span>
            </div>
            <Button small onClick={() => void removeHelper(helper)} disabled={helperBusy}>Remove</Button>
          </div>)}</div>
          : <p class="speaker-empty-line">{helperState === "error" ? "Helpers could not be read." : "No active helpers."}</p>}
        <form class="speaker-helper-form" onSubmit={addHelper}>
          <label class="speaker-field">Name<input required value={helperName} onInput={(event) => setHelperName((event.currentTarget as HTMLInputElement).value)} placeholder="Name they use" /></label>
          <label class="speaker-field">Email<input required type="email" value={helperEmail} onInput={(event) => setHelperEmail((event.currentTarget as HTMLInputElement).value)} placeholder="helper@example.com" /></label>
          <Button small variant="primary" type="submit" disabled={helperBusy}>{helperBusy ? "Saving…" : "Add helper"}</Button>
        </form>
        {helperError ? <div class="speaker-inline-error" role="alert">{helperError}</div> : null}
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
      <span class="speaker-save-state" aria-live="polite">{error ? <em class="alarm-text">{error}</em> : previewError ? <em class="alarm-text">{previewError}</em> : saved ? "Saved" : ""}</span>
      <button class="speaker-fixed-action" type="button" disabled={busy || !form} onClick={() => void save()}>{busy ? "Saving…" : "Save speaker"}</button>
    </footer>
  </aside>;
}
