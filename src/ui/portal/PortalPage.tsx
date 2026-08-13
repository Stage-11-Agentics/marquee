/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { PUBLIC_DRAFT_RESUME_EMAIL_SUBJECT } from "../../lib/auth/draft-resume-copy";
import { apiFetch } from "../shell/api-client";
import { isUploadAborted, putFileToR2, speakerUploadFailureMessage, type UploadProgressHandlers } from "../upload/upload-client";
import { formatBytes, validateClientUpload } from "../upload/upload-policy";
import type { SignedUpload } from "../../lib/r2/protocol";
import { isFieldApplicable } from "../../lib/form-conditions";
import { seedId } from "../../lib/ids";
import { formatDueDate } from "../../lib/task-due";
import type { VenueBuildingInput } from "../../lib/venues";
import { MAP_HEIGHT, VenueMap } from "../venues/VenueMap";
import { FileVersions } from "../files/FileVersions";
import type { FileVersion, FileVersionList } from "../../lib/files/versions";
import { FileComments } from "./FileComments";
import "./portal.css";

type PortalField = {
  key: string;
  label: string;
  help_text: string | null;
  type: string;
  required: boolean;
  position: number;
  config: Record<string, unknown>;
  condition?: unknown;
  value: unknown;
};

type PortalTask = {
  id: string;
  submission_id: string | null;
  submission_title: string | null;
  template_id: string;
  title: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  due_at: number;
  status: "open" | "done";
  completed_at: number | null;
  cancelled_at: number | null;
  cancelled_reason: string | null;
  overdue: boolean;
  payload: {
    kind: string;
    acknowledged?: boolean;
    attachment_id?: string | null;
    versions?: FileVersion[];
    latest?: FileVersion | null;
    version_count?: number;
    latest_source?: "pointer" | "recency";
    accept?: string[];
    max_bytes?: number | null;
    form_id?: string | null;
    fields?: PortalField[];
    answers?: Record<string, unknown>;
  };
};

// These are deterministic seed IDs, not new task kinds. The template identity
// lets the two subject-bearing acknowledgement tasks opt into their subject
// surface while every other acknowledgement keeps the generic checkbox.
const FINALIZE_TALK_TEMPLATE_ID = seedId("tpl", "finalize-talk-description");
const FINALIZE_BIO_TEMPLATE_ID = seedId("tpl", "finalize-bio-and-photos");
type SubjectTaskKind = "talk" | "profile";

function subjectTaskKind(task: PortalTask): SubjectTaskKind | null {
  if (task.kind !== "acknowledge") return null;
  if (task.template_id === FINALIZE_TALK_TEMPLATE_ID && task.submission_id !== null) return "talk";
  if (task.template_id === FINALIZE_BIO_TEMPLATE_ID) return "profile";
  return null;
}

type PortalSubmission = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  status_label: string;
  format: string;
  wave: string | null;
  wave_decision_on: string | null;
  slot: {
    day: string;
    date: string;
    time: string;
    starts_at: number;
    duration_min: number | null;
    room: string;
    location: {
      room: string | null;
      building: string | null;
      address: string | null;
      access_note: string | null;
      access_minutes: number;
      lat: number | null;
      lng: number | null;
    };
    show_building_comparison: boolean;
    arrival: {
      status: "ready" | "unscheduled" | "unassigned" | "unavailable";
      origin: { id: string; name: string; address: string } | null;
      previous_session: { id: string; room: string | null; building: string | null; starts_at: number | null; duration_min: number | null } | null;
      walk_minutes: number | null;
      access_minutes: number;
      leave_by: number | null;
    } | null;
    is_published: boolean;
  } | null;
  decision_feedback: { id: string | null; markdown: string; decided_at: number | null } | null;
  participations: Array<{
    id: string;
    role: string;
    confirmation_status: "pending" | "confirmed" | "declined";
    confirmed_at: number | null;
  }>;
  talk_editable: boolean;
  history?: Array<{
    id: string;
    actor_name: string | null;
    created_at: number;
    before: { title?: string; description?: string | null } | null;
    after: { title?: string; description?: string | null } | null;
  }>;
};

type PortalPerson = {
  id: string;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  social_links: string[];
  headshot_attachment_id: string | null;
  updated_at: number;
};

type PortalSnapshot = {
  seat: "speaker";
  event: { id: string; name: string; slug: string; timezone: string; status: string };
  venue: { pinned_building_count: number };
  person: PortalPerson;
  submissions: PortalSubmission[];
  tasks: PortalTask[];
  handbook: { markdown: string };
};

type SubmitterSubmission = {
  id: string;
  title: string;
  status: string;
  format: string | null;
  submitted_at: number | null;
  updated_at: number;
  wave_name: string | null;
  wave_decision_on: string | null;
  role: string;
  form_slug: string | null;
};

/**
 * The seat of someone who submitted an abstract and holds no speaker role — the
 * person the public CFP creates. SPEC §10 keeps the submitter and the speaker
 * distinct on purpose, so this surface carries their submissions and nothing a
 * speaker seat owns: no tasks, no handbook, no schedule.
 */
type SubmitterSnapshot = {
  seat: "submitter";
  event: { id: string; name: string; slug: string; timezone: string; status: string };
  person: { id: string; name: string; email: string };
  submissions: SubmitterSubmission[];
};

type AnyPortalSnapshot = PortalSnapshot | SubmitterSnapshot;

type ApiFailure = Error & { status?: number };

/**
 * The speaker portal's one API call, through the shared client. A speaker who
 * hits a failure is the person least equipped to debug it and least likely to
 * be sitting next to an engineer, so the reference code and the plain sentence
 * matter more here than anywhere else in the product.
 */
async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "SP";
}

function headshotUrl(eventId: string, personId: string, attachmentId: string | null): string | null {
  if (!attachmentId) return null;
  const event = encodeURIComponent(eventId);
  const person = encodeURIComponent(personId);
  // The query only busts the browser cache after a replacement. The server
  // authorizes against the people pointer, never against this client value.
  return `/api/v1/events/${event}/people/${person}/headshot?v=${encodeURIComponent(attachmentId)}`;
}

function HeadshotAvatar({ eventId, person, size = "regular" }: { eventId: string; person: Pick<PortalPerson, "id" | "name" | "headshot_attachment_id">; size?: "regular" | "compact" }): JSX.Element {
  const src = headshotUrl(eventId, person.id, person.headshot_attachment_id);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <div class={`portal-avatar portal-avatar-${size}${src && !failed ? " has-photo" : ""}`} aria-label={`${person.name} headshot`} role="img">
    {src && !failed ? <img src={src} alt={`${person.name} headshot`} width={size === "compact" ? 40 : 52} height={size === "compact" ? 40 : 52} onError={() => setFailed(true)} /> : initials(person.name)}
  </div>;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDay(value: string): string {
  return value || "—";
}

function formatPortalTime(value: number | null, timezone: string): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

type UploadHandlers = UploadProgressHandlers & { onAbortReady?: (abort: (() => void) | null) => void };

function roleLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function uploadFile(file: File, ownerType: "task_upload" | "person_headshot", ownerId: string, handlers: UploadHandlers = {}): Promise<string> {
  const signed = await requestJson<SignedUpload>("/api/v1/me/uploads/sign", {
    method: "POST",
    body: JSON.stringify({ ownerType, ownerId, filename: file.name, contentType: file.type, sizeBytes: file.size }),
  });
  const put = putFileToR2(signed, file, handlers);
  handlers.onAbortReady?.(put.abort);
  try {
    await put.promise;
  } finally {
    handlers.onAbortReady?.(null);
  }
  const completed = await requestJson<{ attachmentId: string }>(`/api/v1/me/uploads/${signed.attachmentId}/complete`, {
    method: "POST",
    body: JSON.stringify({ completionToken: signed.completionToken }),
  });
  return completed.attachmentId;
}

function markdownInline(text: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push(<span key={`text-${cursor}`}>{text.slice(cursor, match.index)}</span>);
    parts.push(<a key={`link-${match.index}`} href={match[2]} target="_blank" rel="noreferrer">{match[1]}</a>);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>);
  return parts;
}

function Markdown({ markdown }: { markdown: string }): JSX.Element {
  const blocks: JSX.Element[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(<ul key={`list-${blocks.length}`}>{list.map((item, index) => <li key={`${index}-${item}`}>{markdownInline(item)}</li>)}</ul>);
    list = [];
  };
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (line.startsWith("- ")) {
      list.push(line.slice(2));
      return;
    }
    flushList();
    if (line.startsWith("## ")) blocks.push(<h2 key={index}>{markdownInline(line.slice(3))}</h2>);
    else if (line.startsWith("### ")) blocks.push(<h3 key={index}>{markdownInline(line.slice(4))}</h3>);
    else if (line.trim()) blocks.push(<p key={index}>{markdownInline(line)}</p>);
  });
  flushList();
  return <div class="portal-markdown">{blocks}</div>;
}

type TaskSurfaceProps = {
  eventId: string;
  task: PortalTask;
  submission: PortalSubmission | null;
  person: PortalPerson;
  onComplete: () => Promise<void>;
};

export function TaskSurface({ eventId, task, submission, person, onComplete }: TaskSurfaceProps): JSX.Element {
  const subject = subjectTaskKind(task);
  if (subject === "talk" && submission) return <TalkTaskSurface task={task} submission={submission} onComplete={onComplete} />;
  if (subject === "profile" && person) return <ProfileTaskSurface eventId={eventId} task={task} person={person} onComplete={onComplete} />;
  return <GenericTaskSurface task={task} onComplete={onComplete} />;
}

function GenericTaskSurface({ task, onComplete }: { task: PortalTask; onComplete: () => Promise<void> }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(task.payload.acknowledged === true);
  const [answers, setAnswers] = useState<Record<string, unknown>>(task.payload.answers ?? {});
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [canAbort, setCanAbort] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const abortUpload = useRef<(() => void) | null>(null);
  const uploadLinkExpired = useRef(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let attachmentId = task.payload.attachment_id ?? undefined;
      if (task.kind === "file") {
        if (!file) throw new Error("Choose a file before completing this task.");
        const validationError = validateClientUpload(file, { accept: task.payload.accept, maxBytes: task.payload.max_bytes });
        if (validationError) throw new Error(validationError);
        setProgress({ loaded: 0, total: file.size });
        setCanRetry(false);
        uploadLinkExpired.current = false;
        attachmentId = await uploadFile(file, "task_upload", task.id, {
          onProgress: (loaded, total) => setProgress({ loaded, total }),
          onExpiredOrForbidden: () => {
            uploadLinkExpired.current = true;
            setError("The upload link expired. Retry to request a fresh link.");
          },
          onAbortReady: (abort) => {
            abortUpload.current = abort;
            setCanAbort(abort !== null);
          },
        });
      }
      await requestJson(`/api/v1/me/tasks/${task.id}/complete`, {
        method: "POST",
        body: JSON.stringify({
          ...(task.kind === "acknowledge" ? { acknowledged } : {}),
          ...(task.kind === "form" ? { answers } : {}),
          ...(attachmentId ? { attachment_id: attachmentId } : {}),
        }),
      });
      await onComplete();
    } catch (caught) {
      const aborted = isUploadAborted(caught);
      const speakerFailure = speakerUploadFailureMessage(caught);
      if (task.kind === "file" && speakerFailure) console.error("Speaker upload failed", caught);
      setError(uploadLinkExpired.current ? "The upload link expired. Retry to request a fresh link." : aborted ? null : speakerFailure ?? (caught as Error).message);
      setCanRetry(task.kind === "file" && file !== null);
    } finally {
      setBusy(false);
      setProgress(null);
      setCanAbort(false);
      abortUpload.current = null;
    }
  };

  if (task.kind === "acknowledge") {
    return <form onSubmit={submit}>
      <label class="portal-check"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged((event.currentTarget as HTMLInputElement).checked)} /> <span>I have read and acknowledge this task.</span></label>
      <div class="portal-payload-actions"><span class="portal-payload-error">{error ?? ""}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Acknowledge"}</button></div>
    </form>;
  }

  if (task.kind === "file") {
    const accept = task.payload.accept?.map((item) => item.startsWith(".") ? item : `.${item}`).join(",") || undefined;
    const hasVersions = (task.payload.version_count ?? 0) > 0;
    return <form onSubmit={submit}>
      <div class="portal-task-field"><label for={`file-${task.id}`}>{hasVersions ? "Upload a new version" : "Upload file"}</label><input id={`file-${task.id}`} type="file" accept={accept} onChange={(event) => { setFile((event.currentTarget as HTMLInputElement).files?.[0] ?? null); setError(null); setCanRetry(false); }} /><small>{accept ? `Accepted: ${accept}` : "Choose the file requested by the conference."}{task.payload.max_bytes ? ` · Limit: ${formatBytes(task.payload.max_bytes)}` : ""}{hasVersions ? " · Your earlier upload is kept as a previous version." : ""}</small></div>
      {progress ? <div class="portal-upload-progress" role="status" aria-live="polite"><div><span>Uploading · {progress.total > 0 ? Math.round(progress.loaded / progress.total * 100) : 0}%</span><span>{formatBytes(progress.loaded)} / {formatBytes(progress.total)}</span></div><progress max={progress.total} value={progress.loaded} /></div> : null}
      <div class="portal-payload-actions"><span class="portal-payload-error">{error ?? (canRetry ? "The file is still selected. Retry when ready." : "")}</span><span class="portal-upload-actions">{canAbort ? <button class="portal-button secondary" type="button" onClick={() => abortUpload.current?.()}>Cancel upload</button> : null}<button class="portal-button" type="submit" disabled={busy}>{busy ? "Uploading…" : canRetry ? "Retry upload" : hasVersions ? "Upload new version" : "Upload and complete"}</button></span></div>
    </form>;
  }

  const fields = [...(task.payload.fields ?? [])].sort((left, right) => left.position - right.position);
  const visibleFields = fields.filter((field) => isFieldApplicable(field, answers));
  return <form onSubmit={submit}>
    {visibleFields.map((field) => <FormField key={field.key} field={field} value={answers[field.key]} onChange={(value) => setAnswers((current) => ({ ...current, [field.key]: value }))} />)}
    <div class="portal-payload-actions"><span class="portal-payload-error">{error ?? ""}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save and complete"}</button></div>
  </form>;
}

function TalkEditor({ submission, onSaved, compact = false }: { submission: PortalSubmission; onSaved: () => Promise<void>; compact?: boolean }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(submission.title);
  const [description, setDescription] = useState(submission.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(submission.title);
    setDescription(submission.description ?? "");
    if (!submission.talk_editable) setEditing(false);
  }, [submission.id, submission.title, submission.description, submission.talk_editable]);

  const save = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/v1/me/submissions/${submission.id}/talk`, {
        method: "PATCH",
        body: JSON.stringify({ title, description }),
      });
      setEditing(false);
      await onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <div class={`portal-talk-editor${compact ? " portal-talk-editor-compact" : ""}`}>
    <div class="portal-payload-actions"><h3 title={submission.title}>{submission.title}</h3><button class="portal-task-action" type="button" disabled={!submission.talk_editable} onClick={() => setEditing((current) => !current)}>{!submission.talk_editable ? "Closed" : editing ? "Close" : "Edit talk"}</button></div>
    {editing ? <form onSubmit={save}>
      <div class="portal-field"><label for={`${compact ? "task-" : ""}talk-title-${submission.id}`}>Talk title</label><input id={`${compact ? "task-" : ""}talk-title-${submission.id}`} value={title} onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)} /></div>
      <div class="portal-field"><label for={`${compact ? "task-" : ""}talk-description-${submission.id}`}>Description</label><textarea id={`${compact ? "task-" : ""}talk-description-${submission.id}`} value={description} onInput={(event) => setDescription((event.currentTarget as HTMLTextAreaElement).value)} /></div>
      <div class="portal-payload-actions"><span class="portal-payload-error">{error ?? "Editing closes when the conference call for proposals closes."}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save talk"}</button></div>
    </form> : <><p class="portal-talk-description">{submission.description || "—"}</p>{!submission.talk_editable ? <p class="portal-subject-note">Talk editing is closed because the conference call for proposals is closed.</p> : null}</>}
  </div>;
}

function TalkTaskSurface({ task, submission, onComplete }: { task: PortalTask; submission: PortalSubmission; onComplete: () => Promise<void> }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(task.payload.acknowledged === true);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/v1/me/tasks/${task.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ acknowledged }),
      });
      await onComplete();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <div class="portal-subject-task portal-talk-task">
    <TalkEditor submission={submission} onSaved={onComplete} compact />
    <form class="portal-subject-confirm" onSubmit={submit}>
      <label class="portal-check"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged((event.currentTarget as HTMLInputElement).checked)} /> <span>I have reviewed this talk title and abstract.</span></label>
      <div class="portal-payload-actions"><span class="portal-payload-error">{error ?? ""}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Confirm abstract"}</button></div>
    </form>
  </div>;
}

function ProfileForm({ eventId, person, onSaved, compact = false }: { eventId: string; person: PortalPerson; onSaved: () => Promise<void>; compact?: boolean }): JSX.Element {
  const [draft, setDraft] = useState({ title: person.title ?? "", company: person.company ?? "", bio: person.bio ?? "", social_links: person.social_links.join("\n") });
  const [headshot, setHeadshot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    setDraft({ title: person.title ?? "", company: person.company ?? "", bio: person.bio ?? "", social_links: person.social_links.join("\n") });
    setHeadshot(null);
    setPreview(null);
  }, [person.id, person.title, person.company, person.bio, person.social_links.join("\n"), person.headshot_attachment_id]);

  const chooseHeadshot = (event: JSX.TargetedEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    if (!file) return;
    if (!/[.](?:jpe?g|png|webp)$/i.test(file.name)) { setError("Choose a JPEG, PNG, or WebP headshot."); return; }
    const url = URL.createObjectURL(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(url);
    setHeadshot(file);
    setError(null);
  };

  const save = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let headshotAttachmentId = person.headshot_attachment_id;
      if (headshot) {
        const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => reject(new Error("The headshot preview could not be read."));
          image.src = preview ?? "";
        });
        if (dimensions.width < 256 || dimensions.height < 256) throw new Error("Headshots must be at least 256 × 256 pixels.");
        headshotAttachmentId = await uploadFile(headshot, "person_headshot", person.id);
      }
      const body = compact
        ? { bio: draft.bio || null, headshot_attachment_id: headshotAttachmentId }
        : { title: draft.title || null, company: draft.company || null, bio: draft.bio || null, social_links: draft.social_links.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean), headshot_attachment_id: headshotAttachmentId };
      await requestJson("/api/v1/me/profile", { method: "PATCH", body: JSON.stringify(body) });
      setHeadshot(null);
      setPreview(null);
      await onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bioId = compact ? `task-profile-bio-${person.id}` : "profile-bio";
  const headshotId = compact ? `task-profile-headshot-${person.id}` : "profile-headshot";
  return <form class={`portal-profile${compact ? " portal-profile-compact" : ""}`} onSubmit={save}>
    {!compact ? <div class="portal-avatar-line"><HeadshotAvatar eventId={eventId} person={person} /><div class="portal-avatar-copy"><strong title={person.name}>{person.name}</strong><span>{person.email}</span></div></div> : null}
    <div class="portal-profile-grid">
      {!compact ? <><div class="portal-field"><label for="profile-title">Title</label><input id="profile-title" value={draft.title} onInput={(event) => setDraft({ ...draft, title: (event.currentTarget as HTMLInputElement).value })} /></div><div class="portal-field"><label for="profile-company">Company</label><input id="profile-company" value={draft.company} onInput={(event) => setDraft({ ...draft, company: (event.currentTarget as HTMLInputElement).value })} /></div></> : null}
      <div class="portal-field full"><label for={bioId}>Bio</label><textarea id={bioId} value={draft.bio} onInput={(event) => setDraft({ ...draft, bio: (event.currentTarget as HTMLTextAreaElement).value })} /></div>
      {!compact ? <div class="portal-field full"><label for="profile-links">Social links</label><textarea id="profile-links" value={draft.social_links} onInput={(event) => setDraft({ ...draft, social_links: (event.currentTarget as HTMLTextAreaElement).value })} /></div> : null}
      <div class="portal-field full"><label for={headshotId}>Headshot</label><input id={headshotId} type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseHeadshot} /><small class="portal-crop-note">{person.headshot_attachment_id ? "A headshot is on file. Choose a new image to replace it." : "No headshot is on file yet."} Minimum 256 × 256 pixels.</small>{preview ? <div class="portal-crop"><img src={preview} alt="Headshot crop preview" /></div> : null}</div>
    </div>
    <div class="portal-payload-actions"><span class="portal-payload-error" aria-live="polite">{error ?? ""}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></div>
  </form>;
}

function ProfileTaskSurface({ eventId, task, person, onComplete }: { eventId: string; task: PortalTask; person: PortalPerson; onComplete: () => Promise<void> }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(task.payload.acknowledged === true);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/v1/me/tasks/${task.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ acknowledged }),
      });
      await onComplete();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <div class="portal-subject-task portal-profile-task">
    <div class="portal-subject-card">
      <div class="portal-subject-head"><div class="portal-subject-title"><HeadshotAvatar eventId={eventId} person={person} size="compact" /><div><span class="portal-subject-kicker">Speaker profile</span><h3>Bio and headshot</h3></div></div><button class="portal-task-action" type="button" onClick={() => setEditing((current) => !current)}>{editing ? "Close" : "Edit bio & photos"}</button></div>
      <p class="portal-talk-description">{person.bio || "No bio added yet."}</p>
      <p class="portal-subject-note">{person.headshot_attachment_id ? "A headshot is on file for the speaker gallery." : "No headshot is on file yet."}</p>
    </div>
    {editing ? <div class="portal-subject-editor"><ProfileForm eventId={eventId} compact person={person} onSaved={async () => { setEditing(false); await onComplete(); }} /></div> : null}
    <form class="portal-subject-confirm" onSubmit={submit}>
      <label class="portal-check"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged((event.currentTarget as HTMLInputElement).checked)} /> <span>I have reviewed my speaker bio and headshot.</span></label>
      <div class="portal-payload-actions"><span class="portal-payload-error">{error ?? ""}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Confirm profile"}</button></div>
    </form>
  </div>;
}

function FormField({ field, value, onChange }: { field: PortalField; value: unknown; onChange: (value: unknown) => void }): JSX.Element {
  const options = Array.isArray(field.config.options) ? field.config.options.filter((item): item is string => typeof item === "string") : [];
  const label = `${field.label}${field.required ? " · required" : ""}`;
  if (field.type === "long_text") return <div class="portal-task-field"><label for={`field-${field.key}`}>{label}</label><textarea id={`field-${field.key}`} value={typeof value === "string" ? value : ""} onInput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)} /><small>{field.help_text ?? ""}</small></div>;
  if (field.type === "single_select") return <div class="portal-task-field"><label for={`field-${field.key}`}>{label}</label><select id={`field-${field.key}`} value={typeof value === "string" ? value : ""} onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}><option value="">Choose one</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select><small>{field.help_text ?? ""}</small></div>;
  if (field.type === "multi_select") return <div class="portal-task-field"><label>{label}</label>{options.map((option) => { const selected = Array.isArray(value) && value.includes(option); return <label class="portal-check" key={option}><input type="checkbox" checked={selected} onChange={(event) => { const next = new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []); if ((event.currentTarget as HTMLInputElement).checked) next.add(option); else next.delete(option); onChange([...next]); }} /> <span>{option}</span></label>; })}<small>{field.help_text ?? ""}</small></div>;
  const inputType = field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
  return <div class="portal-task-field"><label for={`field-${field.key}`}>{label}</label><input id={`field-${field.key}`} type={inputType} value={value === null || value === undefined ? "" : String(value)} onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)} /><small>{field.help_text ?? ""}</small></div>;
}

/**
 * The portal renders the same version list the organizer sees, from the same
 * derivation. `latest_source` is carried rather than assumed so the two
 * surfaces cannot drift into disagreeing about which upload is current.
 */
function versionListFor(task: PortalTask): FileVersionList | null {
  if (task.kind !== "file") return null;
  const versions = task.payload.versions ?? [];
  if (versions.length === 0) return null;
  return {
    owner_type: "task_upload",
    owner_id: task.id,
    versions,
    latest: task.payload.latest ?? versions.find((version) => version.is_latest) ?? null,
    version_count: task.payload.version_count ?? versions.length,
    latest_source: task.payload.latest_source ?? "pointer",
  };
}

function TaskRow({ eventId, task, submissions, person, onComplete }: { eventId: string; task: PortalTask; submissions: PortalSubmission[]; person: PortalPerson; onComplete: () => Promise<void> }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const submission = task.submission_id ? submissions.find((item) => item.id === task.submission_id) ?? null : null;
  const versions = versionListFor(task);
  return <article class={`portal-task-row ${expanded ? "is-expanded" : ""}`}>
    <span class={`portal-task-mark ${task.status === "done" ? "done" : ""}`} aria-label={task.status === "done" ? "Complete" : "Open"}>{task.status === "done" ? "✓" : "·"}</span>
    <div>
      <h3 class="portal-task-title" title={task.title}>{task.title}</h3>
      <p class="portal-task-description">{task.description || "—"}</p>
      <div class="portal-task-meta"><span>{task.kind}</span><span>due {formatDueDate(task.due_at)}</span>{task.overdue && task.status === "open" ? <span class="overdue">overdue</span> : null}</div>
      {/* Named in the collapsed row on purpose: a checkmark alone is not
          evidence, and the speaker should never have to open anything to
          confirm which file the conference is holding. */}
      {versions ? <div class="portal-task-file"><FileVersions list={versions} compact /></div> : null}
    </div>
    <button class="portal-task-action" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{task.status === "done" ? (expanded ? "Close" : "View") : (expanded ? "Close" : "Complete")}</button>
    {expanded ? <div class="portal-task-payload">
      {versions ? <div class="portal-task-versions"><FileVersions list={versions} /></div> : null}
      <TaskSurface eventId={eventId} task={task} submission={submission} person={person} onComplete={onComplete} />
      {task.kind === "file" ? <FileComments taskId={task.id} attachmentId={task.payload.attachment_id ?? null} /> : null}
    </div> : null}
  </article>;
}

function CancelledTaskRow({ task }: { task: PortalTask }): JSX.Element {
  return <article class="portal-task-row portal-task-row-cancelled" data-task-cancelled="true">
    <span class="portal-task-mark cancelled" aria-label="Cancelled">–</span>
    <div>
      <h3 class="portal-task-title" title={task.title}>{task.title}</h3>
      <p class="portal-task-description">{task.description || "—"}</p>
      <div class="portal-task-meta"><span>{task.kind}</span><span>Cancelled</span></div>
    </div>
  </article>;
}

function TasksPanel({ eventId, tasks, submissions, person, onRefresh }: { eventId: string; tasks: PortalTask[]; submissions: PortalSubmission[]; person: PortalPerson; onRefresh: () => Promise<void> }): JSX.Element {
  const activeTasks = tasks.filter((task) => task.cancelled_at === null);
  const cancelledTasks = tasks.filter((task) => task.cancelled_at !== null);
  const complete = activeTasks.length > 0 && activeTasks.every((task) => task.status === "done");
  const cancelledSets = [...cancelledTasks.reduce((groups, task) => {
    const key = task.submission_id ?? "unassigned";
    const current = groups.get(key) ?? { key, title: task.submission_title ?? "Cancelled talk", reason: task.cancelled_reason ?? "This work is no longer needed by the conference.", tasks: [] as PortalTask[] };
    current.tasks.push(task);
    groups.set(key, current);
    return groups;
  }, new Map<string, { key: string; title: string; reason: string; tasks: PortalTask[] }>()).values()];
  return <section class="portal-panel" aria-labelledby="tasks-heading"><header class="portal-panel-head"><h2 id="tasks-heading">Your tasks</h2><span>{activeTasks.filter((task) => task.status === "done").length}/{activeTasks.length} complete</span></header><div class="portal-panel-body"><div class="portal-task-list">{activeTasks.length === 0 ? <div class="portal-empty">No tasks are assigned to you right now.</div> : activeTasks.map((task) => <TaskRow key={task.id} eventId={eventId} task={task} submissions={submissions} person={person} onComplete={onRefresh} />)}</div>{complete ? <p class="portal-empty">All speaker tasks are complete. Nothing is waiting on you.</p> : null}{cancelledTasks.length > 0 ? <div class="portal-cancelled-task-list" data-cancelled-task-count={cancelledTasks.length}><div class="portal-cancelled-divider"><span>Cancelled · {cancelledTasks.length}</span></div>{cancelledSets.map((group) => <section class="portal-cancelled-set" key={group.key}><div class="portal-cancelled-set-head"><strong>{group.title}</strong><p>{group.reason}</p></div><div class="portal-task-list">{group.tasks.map((task) => <CancelledTaskRow key={task.id} task={task} />)}</div></section>)}</div> : null}</div></section>;
}

function ProfileEditor({ eventId, person, onSaved }: { eventId: string; person: PortalPerson; onSaved: () => Promise<void> }): JSX.Element {
  return <section class="portal-panel" aria-labelledby="profile-heading"><header class="portal-panel-head"><h2 id="profile-heading">Your profile</h2><span>public speaker record</span></header><div class="portal-panel-body"><ProfileForm eventId={eventId} person={person} onSaved={onSaved} /></div></section>;
}

function TalkCard({ submission, onSaved }: { submission: PortalSubmission; onSaved: () => Promise<void> }): JSX.Element {
  return <article class="portal-talk"><TalkEditor submission={submission} onSaved={onSaved} />{submission.history && submission.history.length > 0 ? <div class="portal-history" aria-label="Talk edit history">{submission.history.map((item) => <div class="portal-history-item" key={item.id}><strong>{item.actor_name ?? "Conference team"}</strong> · {formatDate(item.created_at)} · updated title or description</div>)}</div> : null}</article>;
}

function ParticipationActions({ submission, onRefresh }: { submission: PortalSubmission; onRefresh: () => Promise<void> }): JSX.Element {
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const respond = async (participationId: string, response: "confirm" | "decline") => {
    setBusyId(participationId);
    setError(null);
    try {
      await requestJson(`/api/v1/me/participations/${encodeURIComponent(participationId)}/${response}`, {
        method: "POST",
        ...(response === "decline" ? { body: JSON.stringify({ note: note.trim() || null }) } : {}),
      });
      setDecliningId(null);
      setNote("");
      await onRefresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  const isAccepted = submission.status === "accepted";
  return <div class="portal-role-responses" aria-label="Role responses">
    <div class="portal-role-responses-head"><span>Role response</span><small>{isAccepted ? "Each role is confirmed separately" : "Available after acceptance"}</small></div>
    {submission.participations.map((participation) => {
      const isDeclining = decliningId === participation.id;
      const isBusy = busyId === participation.id;
      const statusText = participation.confirmation_status === "confirmed" ? "Role confirmed ✓" : participation.confirmation_status === "declined" ? "Role declined" : "Response needed";
      return <div class="portal-role-response" key={participation.id}>
        <div class="portal-role-copy"><strong>{roleLabel(participation.role)}</strong><span>{statusText}</span></div>
        <div class="portal-role-actions">
          {participation.confirmation_status !== "pending" ? <span class={`portal-role-status ${participation.confirmation_status}`}>{statusText}</span> : isAccepted && !isDeclining ? <><button class="portal-button" type="button" disabled={Boolean(busyId)} onClick={() => void respond(participation.id, "confirm")}>{isBusy ? "Saving…" : "Confirm role"}</button><button class="portal-role-decline" type="button" disabled={Boolean(busyId)} onClick={() => { setDecliningId(participation.id); setNote(""); setError(null); }}>Decline</button></> : isAccepted ? <div class="portal-decline-panel"><label for={`decline-note-${participation.id}`}>Optional note to the program team</label><textarea id={`decline-note-${participation.id}`} value={note} onInput={(event) => setNote((event.currentTarget as HTMLTextAreaElement).value)} placeholder="Add context for the conference team" /><div class="portal-role-action-buttons"><button class="portal-button" type="button" disabled={isBusy} onClick={() => void respond(participation.id, "decline")}>{isBusy ? "Saving…" : "Confirm decline"}</button><button class="portal-role-cancel" type="button" disabled={isBusy} onClick={() => { setDecliningId(null); setNote(""); }}>Cancel</button></div></div> : <span class="portal-role-pending">Waiting for the conference decision</span>}
        </div>
      </div>;
    })}
    <div class="portal-role-error" aria-live="polite">{error ?? ""}</div>
  </div>;
}

function arrivalVenueBuilding(slot: NonNullable<PortalSubmission["slot"]>): VenueBuildingInput {
  const { location } = slot;
  const name = location.building?.trim() || location.address?.trim() || "The conference team has not named this building.";
  return {
    id: `portal-arrival-${slot.starts_at}`,
    name,
    address: location.address?.trim() ?? "",
    position: 0,
    lat: location.lat,
    lng: location.lng,
    access_minutes: location.access_minutes,
    access_note: location.access_note,
  };
}

function ArrivalMap({ slot }: { slot: NonNullable<PortalSubmission["slot"]> }): JSX.Element {
  const { location } = slot;
  const lat = location.lat;
  const lng = location.lng;
  const hasPin = lat !== null && lng !== null;
  const mapHeight = `${MAP_HEIGHT}px`;
  const mapStyle = { height: mapHeight, minHeight: mapHeight };
  if (!hasPin) return <div class="portal-arrival-map empty" role="group" aria-label="Venue map unavailable" style={mapStyle}><span>The conference team has not pinned this building.</span></div>;
  const directions = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const building = arrivalVenueBuilding(slot);
  const venueLabel = building.name;
  return <div class="portal-arrival-map" role="group" aria-label={`Venue map for ${venueLabel}`} style={mapStyle}>
    <VenueMap ariaLabel={`Map of ${venueLabel}`} buildings={[building]} />
    <a class="portal-button portal-arrival-map-directions" href={directions} target="_blank" rel="noreferrer">Directions ↗</a>
  </div>;
}

function ArrivalCard({ slot, timezone }: { slot: NonNullable<PortalSubmission["slot"]>; timezone: string }): JSX.Element {
  const { location, arrival } = slot;
  const showBuildingComparison = slot.show_building_comparison;
  let arrivalCopy = "Arrival timing will appear when this session is placed.";
  if (arrival?.status === "ready" && arrival.leave_by !== null) {
    const movement = [
      showBuildingComparison && arrival.walk_minutes !== null ? `${arrival.walk_minutes} min walk` : null,
      arrival.access_minutes > 0 ? `${arrival.access_minutes} min to get in` : null,
    ].filter(Boolean).join(" · ");
    const from = showBuildingComparison ? arrival.previous_session?.building ?? arrival.origin?.name : null;
    arrivalCopy = showBuildingComparison
      ? `${from ? `From ${from}${movement ? ` · ${movement}` : ""}. ` : ""}Leave by ${formatPortalTime(arrival.leave_by, timezone)}.`
      : `${arrival.access_minutes > 0 ? `Allow ${arrival.access_minutes} min to get in. ` : ""}Leave by ${formatPortalTime(arrival.leave_by, timezone)}.`;
  } else if (arrival?.status === "unavailable") {
    arrivalCopy = "Arrival timing is not available until this building and your starting building have map pins.";
  } else if (arrival?.status === "unassigned") {
    arrivalCopy = "Your room is scheduled, but its building has not been assigned yet.";
  } else if (arrival?.status === "unscheduled") {
    arrivalCopy = "Your arrival instructions will appear when the session time is set.";
  }
  return <section class="portal-arrival-card" aria-labelledby={`arrival-heading-${slot.starts_at}`}>
    <header class="portal-arrival-head"><div><h2 id={`arrival-heading-${slot.starts_at}`}>Where you are speaking</h2><span>{slot.day} · {slot.date} · {slot.time}</span></div></header>
    <div class="portal-arrival-body"><dl class="portal-arrival-details">
      <div><dt>Room</dt><dd>{location.room ?? "—"}</dd></div>
      <div><dt>Building</dt><dd>{location.building ?? "No building assigned yet"}</dd></div>
      <div><dt>Address</dt><dd>{location.address ?? "—"}</dd></div>
      <div><dt>Getting in</dt><dd>{location.access_note ?? "—"}</dd></div>
      <div><dt>Entry time</dt><dd>{location.access_minutes > 0 ? `${location.access_minutes} min` : "No additional time recorded"}</dd></div>
      <div class="portal-arrival-leave"><dt>Arrival plan</dt><dd>{arrivalCopy}</dd></div>
    </dl><ArrivalMap slot={slot} /></div>
  </section>;
}

function StatusHero({ submission, index, timezone, onRefresh }: { submission: PortalSubmission; index: number; timezone: string; onRefresh: () => Promise<void> }): JSX.Element {
  const statusText = `${submission.status_label}${submission.wave ? ` · ${submission.wave}` : ""}`;
  const titleId = `portal-status-heading-${submission.id}`;
  return <section class={`portal-status-hero ${index > 0 ? "secondary" : ""}`} aria-labelledby={titleId}><span class="eyebrow">{index === 0 ? "Current status" : "Submission status"}</span>{index === 0 ? <h1 id={titleId}>{statusText}</h1> : <h2 id={titleId}>{statusText}</h2>}<div class="portal-status-meta"><div class="portal-status-copy"><strong title={submission.title}>{submission.title}</strong><br />{submission.format} · {submission.wave_decision_on ? `next decision ${submission.wave_decision_on}` : "status is current"}</div>{submission.slot ? <div class="portal-slot"><small>Schedule</small><span>{formatDay(submission.slot.day)} · {submission.slot.date} · {submission.slot.time}</span><span>{submission.slot.room}</span>{!submission.slot.is_published ? <span class="portal-slot-note">Not yet public</span> : null}</div> : <div class="portal-slot"><small>Schedule</small><span>—</span></div>}</div>{submission.slot ? <ArrivalCard slot={submission.slot} timezone={timezone} /> : null}<ParticipationActions submission={submission} onRefresh={onRefresh} /></section>;
}

/** A `YYYY-MM-DD` decision date, read as a calendar day rather than an instant. */
function formatCalendarDay(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return value;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))));
}

/** What is true of this abstract right now, said the way its author would say it. */
function submitterHeadline(status: string): string {
  if (status === "draft") return "Your draft is saved, not yet submitted";
  if (status === "accepted") return "Your abstract was accepted";
  if (status === "waitlisted") return "Your abstract is a Maybe";
  if (status === "rejected") return "Your abstract was not selected";
  if (status === "withdrawn") return "You withdrew this abstract";
  if (status === "in_review") return "Your abstract is under review";
  return "Your abstract is in";
}

function submitterStatusLabel(status: string): string {
  if (status === "waitlisted") return "Maybe";
  if (status === "submitted") return "Submitted · awaiting review";
  return status.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function isSubmitterAwaitingReview(status: string): boolean {
  return status === "submitted" || status === "in_review";
}

function submitterOutcomeCopy(status: string): string {
  if (status === "accepted") return "The program team accepted this abstract for the conference.";
  if (status === "waitlisted") return "The program team marked this abstract as Maybe.";
  if (status === "rejected") return "The program team did not select this abstract for the conference.";
  if (status === "withdrawn") return "This abstract is no longer in consideration.";
  return "The program team has not shared a more specific update for this abstract yet.";
}

function submitterOutcomeDetail(status: string): string {
  if (status === "accepted") return "This page becomes your speaker portal. Tasks and session details will arrive here.";
  if (status === "rejected") return "The program team has finished reviewing this abstract.";
  if (status === "withdrawn") return "This abstract will not be considered for the conference.";
  return submitterOutcomeCopy(status);
}

function submitterProgressCopy(status: string, draftCallOpen: boolean): string {
  if (status === "draft") return draftCallOpen ? "Finish and submit your abstract" : "Draft saved · call closed";
  if (status === "waitlisted") return "Maybe · still in consideration";
  if (isSubmitterAwaitingReview(status)) return "Nothing is waiting on you";
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Not selected";
  if (status === "withdrawn") return "Withdrawn";
  return "Status current";
}

function SubmissionRow({ submission }: { submission: SubmitterSubmission }): JSX.Element {
  const decisionDetails = isSubmitterAwaitingReview(submission.status)
    ? [
      submission.wave_name,
      submission.wave_decision_on ? `decision by ${formatCalendarDay(submission.wave_decision_on)}` : null,
    ].filter((value): value is string => Boolean(value)).join(" · ")
    : null;
  const decisionLabel = decisionDetails ? `Next decision · ${decisionDetails}` : null;
  return <article class="portal-submitted-row" data-submission-id={submission.id} data-submission-status={submission.status}>
    <div class="portal-submitted-copy">
      <strong title={submission.title}>{submission.title}</strong>
      <span>{submission.format ?? "Format not set"} · {submission.submitted_at === null ? "Not yet submitted" : `Submitted ${formatDate(submission.submitted_at)}`}</span>
      {decisionLabel ? <span class="portal-submitted-wave">{decisionLabel}</span> : null}
    </div>
    <span class="portal-submitted-status">{submitterStatusLabel(submission.status)}</span>
  </article>;
}

/**
 * The portal a submitter sees. It exists because the public CFP's confirmation
 * page invites them here, and a person who has just handed over their work
 * deserves an answer rather than an error. Every claim on it is one the record
 * can support: what they sent, where it stands, and what to do next when a
 * draft still needs work.
 */
function SubmitterPortal({ snapshot, onSignOut, viewingAsSpeaker = false }: { snapshot: SubmitterSnapshot; onSignOut: () => void; viewingAsSpeaker?: boolean }): JSX.Element {
  // The resolver only returns this seat through a participation on a
  // submission. Keep that invariant explicit: the hero and its date always
  // describe the same lead abstract.
  const lead = snapshot.submissions[0]!;
  const decisionOn = lead.wave_decision_on;
  const waveName = lead.wave_name;
  const isDraft = lead.status === "draft";
  const draftCallOpen = isDraft && Boolean(lead.form_slug);
  const isWaitlisted = lead.status === "waitlisted";
  const isAwaitingReview = isSubmitterAwaitingReview(lead.status);
  const decisionCopy = decisionOn
    ? `Decisions for ${waveName ?? "this round"} go out by ${formatCalendarDay(decisionOn)}.`
    : "The program team has not set a decision date for this round yet.";
  // Only offered while the call is genuinely still open; the server sends null otherwise.
  const openForm = snapshot.submissions
    .filter((submission) => submission.status !== "draft")
    .map((submission) => submission.form_slug)
    .find((value): value is string => Boolean(value)) ?? null;
  const heroCopy = isDraft
    ? "This abstract is saved as a draft, not yet submitted."
    : isWaitlisted
      ? "The program team marked this abstract as Maybe. It is still in consideration."
      : isAwaitingReview
      ? decisionCopy
      : submitterOutcomeCopy(lead.status);
  const progressCopy = submitterProgressCopy(lead.status, draftCallOpen);
  return <div class="portal-shell">
    <header class="portal-top">
      <span class="portal-brand">Marquee · Your submission</span>
      <button type="button" onClick={onSignOut}>Sign out</button>
    </header>
    <main class="portal-main">
      {viewingAsSpeaker ? <div class="portal-viewing-as" role="status">Viewing as speaker · organizer preview</div> : null}
      <section class="portal-status-hero" aria-labelledby="portal-status-heading" data-portal-seat="submitter">
        <span class="eyebrow">Current status</span>
        <h1 id="portal-status-heading">{submitterHeadline(lead.status)}</h1>
        <div class="portal-status-meta">
          <div class="portal-status-copy">
            <strong title={lead.title}>{lead.title}</strong><br />
            {snapshot.event.name} · {heroCopy}
          </div>
        </div>
      </section>
      <div class="portal-welcome">
        <div>
          <h2>Thank you, {snapshot.person.name}</h2>
          <p>{snapshot.event.name} · {snapshot.submissions.length} abstract{snapshot.submissions.length === 1 ? "" : "s"} on file</p>
        </div>
        <div class="portal-progress">{progressCopy}</div>
      </div>
      <div class="portal-grid">
        {isDraft ? <section class="portal-panel portal-submitter-flow" aria-labelledby="next-heading">
          <header class="portal-panel-head"><h2 id="next-heading">Your next step</h2><span>{draftCallOpen ? "action needed" : "call closed"}</span></header>
          <div class="portal-panel-body">
            <div class="portal-submitter-action"><strong>{draftCallOpen ? "Finish and submit your abstract." : "Keep your draft link."}</strong><p>{draftCallOpen
              ? <>If you saved this draft through the public call, the email titled “{PUBLIC_DRAFT_RESUME_EMAIL_SUBJECT}” includes a link that reopens it. You can finish and submit while the call is open.</>
              : <>The call for speakers is closed. If you saved this draft through the public call, keep the email titled “{PUBLIC_DRAFT_RESUME_EMAIL_SUBJECT}” — its link will reopen the draft if the call opens again.</>}</p></div>
          </div>
        </section> : isWaitlisted ? <section class="portal-panel portal-submitter-flow" aria-labelledby="maybe-heading">
          <header class="portal-panel-head"><h2 id="maybe-heading">What happens next</h2><span>Maybe status</span></header>
          <div class="portal-panel-body"><p class="portal-submitter-status-note">This abstract remains in consideration. Any further update will appear here.</p></div>
        </section> : isAwaitingReview ? <section class="portal-panel portal-submitter-flow" aria-labelledby="next-heading">
          <header class="portal-panel-head"><h2 id="next-heading">What happens next</h2><span>three steps</span></header>
          <div class="portal-panel-body">
            <ol class="portal-next-steps">
              <li><strong>Review.</strong><span>The program team reads every abstract. Yours is in the queue — there is no further step for you here.</span></li>
              <li><strong>Decision.</strong><span>{decisionCopy} We write to <strong>{snapshot.person.email}</strong> either way.</span></li>
              <li><strong>If it is accepted.</strong><span>This page becomes your speaker portal — your tasks, profile, headshot, and session time all arrive here.</span></li>
            </ol>
          </div>
        </section> : <section class="portal-panel portal-submitter-flow" aria-labelledby="status-update-heading">
          <header class="portal-panel-head"><h2 id="status-update-heading">Submission update</h2><span>current outcome</span></header>
          <div class="portal-panel-body"><p class="portal-submitter-status-note">{submitterOutcomeDetail(lead.status)}</p></div>
        </section>}
        <section class="portal-panel" aria-labelledby="reach-heading">
          <header class="portal-panel-head"><h2 id="reach-heading">Getting back here</h2><span>{snapshot.person.email}</span></header>
          <div class="portal-panel-body">
            <p class="portal-empty">Bookmark this page. If the link expires, sign in with <strong>{snapshot.person.email}</strong> and you will land right back here.</p>
            <div class="portal-seat-actions">
              <a class="portal-button secondary" href="/signin?next=/portal">Sign in with your email</a>
              {openForm ? <a class="portal-button secondary" href={`/f/${encodeURIComponent(openForm)}`}>Open the call for speakers</a> : null}
            </div>
          </div>
        </section>
      </div>
      <section class="portal-panel portal-talks" aria-labelledby="submitted-heading">
        <header class="portal-panel-head">
          <h2 id="submitted-heading">What you sent</h2>
          <span>{snapshot.submissions.length} abstract{snapshot.submissions.length === 1 ? "" : "s"}</span>
        </header>
        <div class="portal-panel-body">
          {snapshot.submissions.map((submission) => <SubmissionRow key={submission.id} submission={submission} />)}
        </div>
      </section>
      <section class="portal-panel" aria-labelledby="conference-heading">
        <header class="portal-panel-head"><h2 id="conference-heading">{snapshot.event.name}</h2><span>public pages</span></header>
        <div class="portal-panel-body">
          <div class="portal-seat-actions">
            <a class="portal-button secondary" href="/">Return to conference</a>
            <a class="portal-button secondary" href="/agenda">View the agenda</a>
          </div>
        </div>
      </section>
    </main>
  </div>;
}

function PortalPage(): JSX.Element {
  const viewingAsSpeaker = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("viewing_as") === "speaker";
  const [snapshot, setSnapshot] = useState<AnyPortalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiFailure | null>(null);
  const refresh = async () => {
    try { setLoading(true); setError(null); const next = await requestJson<AnyPortalSnapshot>("/api/v1/me/portal"); setSnapshot(next); }
    catch (caught) { setError(caught as ApiFailure); } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const signOut = async () => {
    await requestJson("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/");
  };
  // Everything below this line belongs to the speaker seat. A submitter reaches
  // its own surface before any of it is read.
  const speaker = snapshot?.seat === "submitter" ? null : snapshot ?? null;
  const activeTasks = speaker?.tasks.filter((task) => task.cancelled_at === null) ?? [];
  const completedTasks = activeTasks.filter((task) => task.status === "done").length;
  const handbook = useMemo(() => speaker?.handbook.markdown ?? "", [speaker?.handbook.markdown]);
  if (loading && !snapshot) return <div class="portal-shell"><div class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span></div><main class="portal-main"><div class="portal-loading">Loading your conference portal…</div></main></div>;
  if (error && !snapshot && error.status === 401) return <div class="portal-shell"><div class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span><a href="/">Return to conference</a></div><main class="portal-main"><div class="portal-error"><div><strong>Sign in to open your speaker portal.</strong><p>Your session is missing or has expired.</p><a class="portal-signin" href="/signin?next=/portal">Sign in</a></div></div></main></div>;
  if (error && !snapshot) return <div class="portal-shell"><div class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span></div><main class="portal-main"><div class="portal-error"><div><strong>We could not load your portal.</strong><p>{error.message}</p><button class="portal-button" type="button" onClick={() => void refresh()}>Try again</button></div></div></main></div>;
  if (snapshot && snapshot.seat === "submitter") return <SubmitterPortal snapshot={snapshot} onSignOut={() => void signOut()} viewingAsSpeaker={viewingAsSpeaker} />;
  if (!speaker) return <div class="portal-shell"><header class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span><a href="/">Return to conference</a></header><main class="portal-main"><div class="portal-error"><div><strong>No portal data is available.</strong><p>Try loading the speaker workspace again.</p><button class="portal-button" type="button" onClick={() => void refresh()}>Try again</button></div></div></main></div>;
  return <div class="portal-shell"><header class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span><button type="button" onClick={() => void signOut()}>Sign out</button></header><main class="portal-main">{viewingAsSpeaker ? <div class="portal-viewing-as" role="status">Viewing as speaker · organizer preview</div> : null}{speaker.submissions.length === 0 ? <section class="portal-status-hero" aria-labelledby="portal-status-heading"><span class="eyebrow">Current status</span><h1 id="portal-status-heading">Speaker portal</h1><div class="portal-status-copy">Your conference submissions and speaker tasks will appear here.</div><a class="portal-button secondary" href="/">Return to conference</a></section> : speaker.submissions.map((submission, index) => <StatusHero key={submission.id} submission={submission} index={index} timezone={speaker.event.timezone} onRefresh={refresh} />)}<div class="portal-welcome"><div><h2>Welcome back, {speaker.person.name}</h2><p>{speaker.event.name} · your speaker workspace</p></div><div class="portal-progress">{completedTasks} / {activeTasks.length} tasks complete</div></div><div class="portal-grid"><TasksPanel eventId={speaker.event.id} tasks={speaker.tasks} submissions={speaker.submissions} person={speaker.person} onRefresh={refresh} /><ProfileEditor eventId={speaker.event.id} person={speaker.person} onSaved={refresh} /></div><section class="portal-panel portal-talks" aria-labelledby="talks-heading"><header class="portal-panel-head"><h2 id="talks-heading">Your talks</h2><span>{speaker.submissions.length} record{speaker.submissions.length === 1 ? "" : "s"}</span></header><div class="portal-panel-body">{speaker.submissions.length === 0 ? <div class="portal-empty">No submissions are attached to this speaker record. The conference team will attach one when it is ready.</div> : speaker.submissions.map((submission) => <TalkCard key={submission.id} submission={submission} onSaved={refresh} />)}</div></section>{speaker.submissions.some((submission) => submission.decision_feedback) ? <section class="portal-panel portal-talks" aria-labelledby="feedback-heading"><header class="portal-panel-head"><h2 id="feedback-heading">Conference update</h2><span>latest note</span></header><div class="portal-panel-body">{speaker.submissions.filter((submission) => submission.decision_feedback).map((submission) => <div class="portal-feedback" key={submission.id}><h3>{submission.title}</h3><p>{submission.decision_feedback?.markdown}</p></div>)}</div></section> : null}<section class="portal-panel portal-handbook" aria-labelledby="handbook-heading"><header class="portal-panel-head"><h2 id="handbook-heading">Speaker handbook</h2><span>{speaker.event.name}</span></header><div class="portal-panel-body"><Markdown markdown={handbook} /></div></section></main></div>;
}

export { PortalPage, SubmitterPortal };
export type { PortalPerson, PortalSubmission, PortalTask, SubmitterSnapshot, SubmitterSubmission };
