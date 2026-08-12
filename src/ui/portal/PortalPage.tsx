import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { apiFetch } from "../shell/api-client";
import { putFileToR2, type UploadProgressHandlers } from "../upload/upload-client";
import { formatBytes, validateClientUpload } from "../upload/upload-policy";
import type { SignedUpload } from "../../lib/r2/protocol";
import { isFieldApplicable } from "../../lib/form-conditions";
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
    accept?: string[];
    max_bytes?: number | null;
    form_id?: string | null;
    fields?: PortalField[];
    answers?: Record<string, unknown>;
  };
};

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
  event: { id: string; name: string; slug: string; timezone: string; status: string };
  venue: { pinned_building_count: number };
  person: PortalPerson;
  submissions: PortalSubmission[];
  tasks: PortalTask[];
  handbook: { markdown: string };
};

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

function TaskSurface({ task, onComplete }: { task: PortalTask; onComplete: () => Promise<void> }): JSX.Element {
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
      setError(uploadLinkExpired.current ? "The upload link expired. Retry to request a fresh link." : (caught as Error).message);
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
    return <form onSubmit={submit}>
      <div class="portal-task-field"><label for={`file-${task.id}`}>Upload file</label><input id={`file-${task.id}`} type="file" accept={accept} onChange={(event) => { setFile((event.currentTarget as HTMLInputElement).files?.[0] ?? null); setError(null); setCanRetry(false); }} /><small>{accept ? `Accepted: ${accept}` : "Choose the file requested by the conference."}{task.payload.max_bytes ? ` · Limit: ${formatBytes(task.payload.max_bytes)}` : ""}</small></div>
      {progress ? <div class="portal-upload-progress" role="status" aria-live="polite"><div><span>Uploading · {progress.total > 0 ? Math.round(progress.loaded / progress.total * 100) : 0}%</span><span>{formatBytes(progress.loaded)} / {formatBytes(progress.total)}</span></div><progress max={progress.total} value={progress.loaded} /></div> : null}
      <div class="portal-payload-actions"><span class="portal-payload-error">{error ?? (canRetry ? "The file is still selected. Retry when ready." : "")}</span><span class="portal-upload-actions">{canAbort ? <button class="portal-button secondary" type="button" onClick={() => abortUpload.current?.()}>Cancel upload</button> : null}<button class="portal-button" type="submit" disabled={busy}>{busy ? "Uploading…" : canRetry ? "Retry upload" : "Upload and complete"}</button></span></div>
    </form>;
  }

  const fields = [...(task.payload.fields ?? [])].sort((left, right) => left.position - right.position);
  const visibleFields = fields.filter((field) => isFieldApplicable(field, answers));
  return <form onSubmit={submit}>
    {visibleFields.map((field) => <FormField key={field.key} field={field} value={answers[field.key]} onChange={(value) => setAnswers((current) => ({ ...current, [field.key]: value }))} />)}
    <div class="portal-payload-actions"><span class="portal-payload-error">{error ?? ""}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save and complete"}</button></div>
  </form>;
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

function TaskRow({ task, onComplete }: { task: PortalTask; onComplete: () => Promise<void> }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return <article class={`portal-task-row ${expanded ? "is-expanded" : ""}`}>
    <span class={`portal-task-mark ${task.status === "done" ? "done" : ""}`} aria-label={task.status === "done" ? "Complete" : "Open"}>{task.status === "done" ? "✓" : "·"}</span>
    <div>
      <h3 class="portal-task-title" title={task.title}>{task.title}</h3>
      <p class="portal-task-description">{task.description || "—"}</p>
      <div class="portal-task-meta"><span>{task.kind}</span><span>due {formatDate(task.due_at)}</span>{task.overdue && task.status === "open" ? <span class="overdue">overdue</span> : null}</div>
    </div>
    <button class="portal-task-action" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{task.status === "done" ? (expanded ? "Close" : "View") : (expanded ? "Close" : "Complete")}</button>
    {expanded ? <div class="portal-task-payload"><TaskSurface task={task} onComplete={onComplete} /></div> : null}
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

function TasksPanel({ tasks, onRefresh }: { tasks: PortalTask[]; onRefresh: () => Promise<void> }): JSX.Element {
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
  return <section class="portal-panel" aria-labelledby="tasks-heading"><header class="portal-panel-head"><h2 id="tasks-heading">Your tasks</h2><span>{activeTasks.filter((task) => task.status === "done").length}/{activeTasks.length} complete</span></header><div class="portal-panel-body"><div class="portal-task-list">{activeTasks.length === 0 ? <div class="portal-empty">No tasks are assigned to you right now.</div> : activeTasks.map((task) => <TaskRow key={task.id} task={task} onComplete={onRefresh} />)}</div>{complete ? <p class="portal-empty">All speaker tasks are complete. Nothing is waiting on you.</p> : null}{cancelledTasks.length > 0 ? <div class="portal-cancelled-task-list" data-cancelled-task-count={cancelledTasks.length}><div class="portal-cancelled-divider"><span>Cancelled · {cancelledTasks.length}</span></div>{cancelledSets.map((group) => <section class="portal-cancelled-set" key={group.key}><div class="portal-cancelled-set-head"><strong>{group.title}</strong><p>{group.reason}</p></div><div class="portal-task-list">{group.tasks.map((task) => <CancelledTaskRow key={task.id} task={task} />)}</div></section>)}</div> : null}</div></section>;
}

function ProfileEditor({ person, onSaved }: { person: PortalPerson; onSaved: () => Promise<void> }): JSX.Element {
  const [draft, setDraft] = useState({ title: person.title ?? "", company: person.company ?? "", bio: person.bio ?? "", social_links: person.social_links.join("\n") });
  const [headshot, setHeadshot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
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
    setBusy(true); setError(null);
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
      await requestJson("/api/v1/me/profile", { method: "PATCH", body: JSON.stringify({ title: draft.title || null, company: draft.company || null, bio: draft.bio || null, social_links: draft.social_links.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean), headshot_attachment_id: headshotAttachmentId }) });
      setHeadshot(null); setPreview(null);
      await onSaved();
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  return <section class="portal-panel" aria-labelledby="profile-heading"><header class="portal-panel-head"><h2 id="profile-heading">Your profile</h2><span>public speaker record</span></header><div class="portal-panel-body"><form class="portal-profile" onSubmit={save}><div class="portal-avatar-line"><div class="portal-avatar" aria-hidden="true">{initials(person.name)}</div><div class="portal-avatar-copy"><strong title={person.name}>{person.name}</strong><span>{person.email}</span></div></div><div class="portal-profile-grid"><div class="portal-field"><label for="profile-title">Title</label><input id="profile-title" value={draft.title} onInput={(event) => setDraft({ ...draft, title: (event.currentTarget as HTMLInputElement).value })} /></div><div class="portal-field"><label for="profile-company">Company</label><input id="profile-company" value={draft.company} onInput={(event) => setDraft({ ...draft, company: (event.currentTarget as HTMLInputElement).value })} /></div><div class="portal-field full"><label for="profile-bio">Bio</label><textarea id="profile-bio" value={draft.bio} onInput={(event) => setDraft({ ...draft, bio: (event.currentTarget as HTMLTextAreaElement).value })} /></div><div class="portal-field full"><label for="profile-links">Social links</label><textarea id="profile-links" value={draft.social_links} onInput={(event) => setDraft({ ...draft, social_links: (event.currentTarget as HTMLTextAreaElement).value })} /></div><div class="portal-field full"><label for="profile-headshot">Headshot</label><input id="profile-headshot" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseHeadshot} /><small class="portal-crop-note">Choose a new image to see the crop preview before saving. Minimum 256 × 256 pixels.</small>{preview ? <div class="portal-crop"><img src={preview} alt="Headshot crop preview" /></div> : null}</div></div><div class="portal-payload-actions"><span class="portal-payload-error">{error ?? ""}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></div></form></div></section>;
}

function TalkCard({ submission, onSaved }: { submission: PortalSubmission; onSaved: () => Promise<void> }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(submission.title);
  const [description, setDescription] = useState(submission.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: Event) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await requestJson(`/api/v1/me/submissions/${submission.id}/talk`, { method: "PATCH", body: JSON.stringify({ title, description }) }); setEditing(false); await onSaved(); }
    catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  return <article class="portal-talk"><div class="portal-payload-actions"><h3 title={submission.title}>{submission.title}</h3><button class="portal-task-action" type="button" disabled={!submission.talk_editable} onClick={() => setEditing((current) => !current)}>{!submission.talk_editable ? "Closed" : editing ? "Close" : "Edit talk"}</button></div>{editing ? <form onSubmit={save}><div class="portal-field"><label for={`talk-title-${submission.id}`}>Talk title</label><input id={`talk-title-${submission.id}`} value={title} onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)} /></div><div class="portal-field"><label for={`talk-description-${submission.id}`}>Description</label><textarea id={`talk-description-${submission.id}`} value={description} onInput={(event) => setDescription((event.currentTarget as HTMLTextAreaElement).value)} /></div><div class="portal-payload-actions"><span class="portal-payload-error">{error ?? "Editing closes when the conference call for proposals closes."}</span><button class="portal-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save talk"}</button></div></form> : <p class="portal-talk-description">{submission.description || "—"}</p>}{submission.history && submission.history.length > 0 ? <div class="portal-history" aria-label="Talk edit history">{submission.history.map((item) => <div class="portal-history-item" key={item.id}><strong>{item.actor_name ?? "Conference team"}</strong> · {formatDate(item.created_at)} · updated title or description</div>)}</div> : null}</article>;
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

function ArrivalCard({ slot, timezone }: { slot: NonNullable<PortalSubmission["slot"]>; timezone: string }): JSX.Element {
  const { location, arrival } = slot;
  const showBuildingComparison = slot.show_building_comparison;
  const hasPin = location.lat !== null && location.lng !== null;
  const directions = hasPin ? `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}` : null;
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
    <header class="portal-arrival-head"><div><h2 id={`arrival-heading-${slot.starts_at}`}>Where you are speaking</h2><span>{slot.day} · {slot.date} · {slot.time}</span></div>{directions ? <a class="portal-button secondary" href={directions} target="_blank" rel="noreferrer">Directions ↗</a> : null}</header>
    <div class="portal-arrival-body"><dl class="portal-arrival-details">
      <div><dt>Room</dt><dd>{location.room ?? "—"}</dd></div>
      <div><dt>Building</dt><dd>{location.building ?? "No building assigned yet"}</dd></div>
      <div><dt>Address</dt><dd>{location.address ?? "—"}</dd></div>
      <div><dt>Getting in</dt><dd>{location.access_note ?? "—"}</dd></div>
      <div><dt>Entry time</dt><dd>{location.access_minutes > 0 ? `${location.access_minutes} min` : "No additional time recorded"}</dd></div>
      <div class="portal-arrival-leave"><dt>Arrival plan</dt><dd>{arrivalCopy}</dd></div>
    </dl><details class="portal-arrival-map-fold" open={showBuildingComparison}><summary>{showBuildingComparison ? "Venue map" : "Show venue map"}</summary><div class={`portal-arrival-map${hasPin ? " pinned" : ""}`} aria-label={hasPin ? "Pinned venue location" : "No physical location pin available"}><span>{hasPin ? "Pinned venue" : "No map pin"}</span><small>{hasPin ? `${location.lat}, ${location.lng}` : "The conference team has not pinned this building."}</small></div></details></div>
  </section>;
}

function StatusHero({ submission, index, timezone, onRefresh }: { submission: PortalSubmission; index: number; timezone: string; onRefresh: () => Promise<void> }): JSX.Element {
  const statusText = `${submission.status_label}${submission.wave ? ` · ${submission.wave}` : ""}`;
  const titleId = `portal-status-heading-${submission.id}`;
  return <section class={`portal-status-hero ${index > 0 ? "secondary" : ""}`} aria-labelledby={titleId}><span class="eyebrow">{index === 0 ? "Current status" : "Submission status"}</span>{index === 0 ? <h1 id={titleId}>{statusText}</h1> : <h2 id={titleId}>{statusText}</h2>}<div class="portal-status-meta"><div class="portal-status-copy"><strong title={submission.title}>{submission.title}</strong><br />{submission.format} · {submission.wave_decision_on ? `next decision ${submission.wave_decision_on}` : "status is current"}</div>{submission.slot ? <div class="portal-slot"><small>Schedule</small><span>{formatDay(submission.slot.day)} · {submission.slot.date} · {submission.slot.time}</span><span>{submission.slot.room}</span>{!submission.slot.is_published ? <span class="portal-slot-note">Not yet public</span> : null}</div> : <div class="portal-slot"><small>Schedule</small><span>—</span></div>}</div>{submission.slot ? <ArrivalCard slot={submission.slot} timezone={timezone} /> : null}<ParticipationActions submission={submission} onRefresh={onRefresh} /></section>;
}

function PortalPage(): JSX.Element {
  const [snapshot, setSnapshot] = useState<PortalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiFailure | null>(null);
  const refresh = async () => {
    try { setLoading(true); setError(null); const next = await requestJson<PortalSnapshot>("/api/v1/me/portal"); setSnapshot(next); }
    catch (caught) { setError(caught as ApiFailure); } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const activeTasks = snapshot?.tasks.filter((task) => task.cancelled_at === null) ?? [];
  const completedTasks = activeTasks.filter((task) => task.status === "done").length;
  const handbook = useMemo(() => snapshot?.handbook.markdown ?? "", [snapshot?.handbook.markdown]);
  if (loading && !snapshot) return <div class="portal-shell"><div class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span></div><main class="portal-main"><div class="portal-loading">Loading your conference portal…</div></main></div>;
  if (error && !snapshot && error.status === 401) return <div class="portal-shell"><div class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span><a href="/">Return to conference</a></div><main class="portal-main"><div class="portal-error"><div><strong>Sign in to open your speaker portal.</strong><p>Your session is missing or has expired.</p><a class="portal-signin" href="/">Return to sign in</a></div></div></main></div>;
  if (error && !snapshot) return <div class="portal-shell"><div class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span></div><main class="portal-main"><div class="portal-error"><div><strong>We could not load your portal.</strong><p>{error.message}</p><button class="portal-button" type="button" onClick={() => void refresh()}>Try again</button></div></div></main></div>;
  if (!snapshot) return <div class="portal-shell"><header class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span><a href="/">Return to conference</a></header><main class="portal-main"><div class="portal-error"><div><strong>No portal data is available.</strong><p>Try loading the speaker workspace again.</p><button class="portal-button" type="button" onClick={() => void refresh()}>Try again</button></div></div></main></div>;
  return <div class="portal-shell"><header class="portal-top"><span class="portal-brand">Marquee · Speaker portal</span><button type="button" onClick={async () => { await requestJson("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined); window.location.assign("/"); }}>Sign out</button></header><main class="portal-main">{snapshot.submissions.length === 0 ? <section class="portal-status-hero" aria-labelledby="portal-status-heading"><span class="eyebrow">Current status</span><h1 id="portal-status-heading">Speaker portal</h1><div class="portal-status-copy">Your conference submissions and speaker tasks will appear here.</div><a class="portal-button secondary" href="/">Return to conference</a></section> : snapshot.submissions.map((submission, index) => <StatusHero key={submission.id} submission={submission} index={index} timezone={snapshot.event.timezone} onRefresh={refresh} />)}<div class="portal-welcome"><div><h2>Welcome back, {snapshot.person.name}</h2><p>{snapshot.event.name} · your speaker workspace</p></div><div class="portal-progress">{completedTasks} / {activeTasks.length} tasks complete</div></div><div class="portal-grid"><TasksPanel tasks={snapshot.tasks} onRefresh={refresh} /><ProfileEditor person={snapshot.person} onSaved={refresh} /></div><section class="portal-panel portal-talks" aria-labelledby="talks-heading"><header class="portal-panel-head"><h2 id="talks-heading">Your talks</h2><span>{snapshot.submissions.length} record{snapshot.submissions.length === 1 ? "" : "s"}</span></header><div class="portal-panel-body">{snapshot.submissions.length === 0 ? <div class="portal-empty">No submissions are attached to this speaker record. The conference team will attach one when it is ready.</div> : snapshot.submissions.map((submission) => <TalkCard key={submission.id} submission={submission} onSaved={refresh} />)}</div></section>{snapshot.submissions.some((submission) => submission.decision_feedback) ? <section class="portal-panel portal-talks" aria-labelledby="feedback-heading"><header class="portal-panel-head"><h2 id="feedback-heading">Conference update</h2><span>latest note</span></header><div class="portal-panel-body">{snapshot.submissions.filter((submission) => submission.decision_feedback).map((submission) => <div class="portal-feedback" key={submission.id}><h3>{submission.title}</h3><p>{submission.decision_feedback?.markdown}</p></div>)}</div></section> : null}<section class="portal-panel portal-handbook" aria-labelledby="handbook-heading"><header class="portal-panel-head"><h2 id="handbook-heading">Speaker handbook</h2><span>{snapshot.event.name}</span></header><div class="portal-panel-body"><Markdown markdown={handbook} /></div></section></main></div>;
}

export { PortalPage };
