/** @jsxImportSource preact */

/**
 * The portal task row, and the surfaces that complete it.
 *
 * Shared by the speaker portal and the sponsor portal because it is the same
 * machinery: the same three kinds, the same upload with progress and retry, the
 * same expanded payload, the same cancelled treatment. Only two things differ,
 * and both arrive as props — who the row is assigned to (a sponsorship shows
 * every contact's work, a speaker only their own) and what renders inside the
 * expanded area.
 *
 * A second copy of a file-upload flow with abort, expiry and retry is exactly the
 * drift this project keeps paying for, so there is one.
 */

import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";

import { apiFetch } from "../shell/api-client";
import { isUploadAborted, putFileToR2, speakerUploadAbortedMessage, speakerUploadFailureMessage, type UploadProgressHandlers } from "../upload/upload-client";
import { formatBytes, validateClientUpload } from "../upload/upload-policy";
import type { SignedUpload } from "../../lib/r2/protocol";
import { isFieldApplicable } from "../../lib/form-conditions";
import { formatDueDate } from "../../lib/task-due";
import { FileVersions } from "../files/FileVersions";
import type { FileVersion, FileVersionList } from "../../lib/files/versions";

export type PortalField = {
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

export type PortalTask = {
  id: string;
  submission_id: string | null;
  submission_title: string | null;
  /** Set when this deliverable belongs to a sponsorship rather than a speaker. */
  sponsorship_id?: string | null;
  template_id: string;
  title: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  due_at: number;
  status: "open" | "done";
  completed_at: number | null;
  /** The contact the work is assigned to. Carried for every seat. */
  assignee?: { person_id: string; name: string };
  /** Who actually completed it — not necessarily the assignee. */
  completed_by?: { person_id: string; name: string } | null;
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

export type ApiFailure = Error & { status?: number };

/**
 * The portal's one API call shape, through the shared client. A speaker or a
 * sponsor contact who hits a failure is the person least equipped to debug it and
 * least likely to be sitting next to an engineer, so the plain sentence matters
 * more here than anywhere else in the product.
 */
export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
}

type UploadHandlers = UploadProgressHandlers & { onAbortReady?: (abort: (() => void) | null) => void };

export async function uploadFile(
  file: File,
  ownerType: "task_upload" | "person_headshot",
  ownerId: string,
  handlers: UploadHandlers = {},
): Promise<string> {
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

/** What the person actually has to do, rather than the kind's internal name. */
export function taskKindLabel(kind: PortalTask["kind"]): string {
  if (kind === "file") return "upload a file";
  if (kind === "form") return "answer a form";
  return "confirm";
}

type UploadProgress = { loaded: number | null; total: number; state: "uploading" | "failed" };

export function FormField({ field, value, onChange }: { field: PortalField; value: unknown; onChange: (value: unknown) => void }): JSX.Element {
  const options = Array.isArray(field.config.options) ? field.config.options.filter((item): item is string => typeof item === "string") : [];
  const label = `${field.label}${field.required ? " · required" : ""}`;
  if (field.type === "long_text") return <div class="portal-task-field"><label for={`field-${field.key}`}>{label}</label><textarea id={`field-${field.key}`} value={typeof value === "string" ? value : ""} onInput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)} /><small>{field.help_text ?? ""}</small></div>;
  if (field.type === "single_select") return <div class="portal-task-field"><label for={`field-${field.key}`}>{label}</label><select id={`field-${field.key}`} value={typeof value === "string" ? value : ""} onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}><option value="">Choose one</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select><small>{field.help_text ?? ""}</small></div>;
  if (field.type === "multi_select") return <div class="portal-task-field"><label>{label}</label>{options.map((option) => { const selected = Array.isArray(value) && value.includes(option); return <label class="portal-check" key={option}><input type="checkbox" checked={selected} onChange={(event) => { const next = new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []); if ((event.currentTarget as HTMLInputElement).checked) next.add(option); else next.delete(option); onChange([...next]); }} /> <span>{option}</span></label>; })}<small>{field.help_text ?? ""}</small></div>;
  const inputType = field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
  return <div class="portal-task-field"><label for={`field-${field.key}`}>{label}</label><input id={`field-${field.key}`} type={inputType} value={value === null || value === undefined ? "" : String(value)} onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)} /><small>{field.help_text ?? ""}</small></div>;
}

export function GenericTaskSurface({ task, onComplete }: { task: PortalTask; onComplete: () => Promise<void> }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(task.payload.acknowledged === true);
  const [answers, setAnswers] = useState<Record<string, unknown>>(task.payload.answers ?? {});
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [canAbort, setCanAbort] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const abortUpload = useRef<(() => void) | null>(null);
  const uploadLinkExpired = useRef(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    let uploadStarted = false;
    let uploadCompleted = false;
    try {
      let attachmentId = task.payload.attachment_id ?? undefined;
      if (task.kind === "file") {
        if (!file) throw new Error("Choose a file before completing this task.");
        const validationError = validateClientUpload(file, { accept: task.payload.accept, maxBytes: task.payload.max_bytes });
        if (validationError) throw new Error(validationError);
        // No progress event has arrived yet. Showing 0% here claims byte-level
        // knowledge the browser does not have and makes a stalled PUT look alive.
        setProgress({ loaded: null, total: file.size, state: "uploading" });
        setCanRetry(false);
        uploadLinkExpired.current = false;
        uploadStarted = true;
        attachmentId = await uploadFile(file, "task_upload", task.id, {
          onProgress: (loaded, total) => setProgress({ loaded, total, state: "uploading" }),
          onExpiredOrForbidden: () => {
            uploadLinkExpired.current = true;
            setError("The upload link expired. Retry to request a fresh link.");
          },
          onAbortReady: (abort) => {
            abortUpload.current = abort;
            setCanAbort(abort !== null);
          },
        });
        uploadCompleted = true;
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
      const hasPreviousVersion = (task.payload.version_count ?? 0) > 0;
      const speakerFailure = uploadStarted ? speakerUploadFailureMessage(caught, { hasPreviousVersion }) : null;
      if (task.kind === "file" && speakerFailure) console.error("Portal upload failed", caught);
      if (task.kind === "file" && uploadStarted && !uploadCompleted) {
        // Keep the terminal state row in place so the retry affordance does
        // not jump when a pending upload becomes a visible failure.
        setProgress({ loaded: null, total: file?.size ?? 0, state: "failed" });
      }
      setError(uploadLinkExpired.current
        ? `The upload link expired. ${hasPreviousVersion ? "Your previous version is still current. " : "No new file was saved. "}Retry to request a fresh link.`
        : aborted
          ? speakerUploadAbortedMessage(hasPreviousVersion)
          : speakerFailure ?? (caught as Error).message);
      setCanRetry(task.kind === "file" && file !== null);
    } finally {
      setBusy(false);
      if (uploadCompleted || !uploadStarted) setProgress(null);
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
    const progressFailed = progress?.state === "failed";
    return <form onSubmit={submit}>
      <div class="portal-task-field"><label for={`file-${task.id}`}>{hasVersions ? "Upload a new version" : "Upload file"}</label><input id={`file-${task.id}`} type="file" accept={accept} onChange={(event) => { setFile((event.currentTarget as HTMLInputElement).files?.[0] ?? null); setError(null); setCanRetry(false); }} /><small>{accept ? `Accepted: ${accept}` : "Choose the file requested by the conference."}{task.payload.max_bytes ? ` · Limit: ${formatBytes(task.payload.max_bytes)}` : ""}{hasVersions ? " · Your earlier upload is kept as a previous version." : ""}</small></div>
      {progress ? <div class="portal-upload-progress" role="status" aria-live="polite"><div><span>{progressFailed ? "Upload stopped" : progress.loaded === null ? "Uploading · waiting for transfer" : `Uploading · ${progress.total > 0 ? Math.round(progress.loaded / progress.total * 100) : 0}%`}</span><span>{progressFailed ? hasVersions ? "Previous version kept" : "No version saved" : progress.loaded === null ? "Waiting for transfer" : `${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`}</span></div>{progressFailed ? <progress max={progress.total} value={0} aria-label="Upload stopped" /> : progress.loaded === null ? <progress max={progress.total} /> : <progress max={progress.total} value={progress.loaded} />}</div> : null}
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

/**
 * The portal renders the same version list the organizer sees, from the same
 * derivation. `latest_source` is carried rather than assumed so the two
 * surfaces cannot drift into disagreeing about which upload is current.
 */
export function versionListFor(task: PortalTask): FileVersionList | null {
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

export interface TaskRowProps {
  task: PortalTask;
  /** What completes this task. The speaker seat swaps in subject-aware surfaces. */
  renderSurface: (task: PortalTask) => JSX.Element;
  /** Anything else inside the expanded payload — the speaker seat's comments. */
  renderPayloadExtras?: (task: PortalTask) => JSX.Element | null;
  /**
   * Who owes this row, when that is not simply "you". The sponsor seat passes
   * "yours" / "assigned to Priya Raghunathan"; the speaker seat passes nothing
   * and the line does not render.
   */
  ownerLabel?: string | null;
  /**
   * Expansion, when a second surface needs to open this row.
   *
   * Uncontrolled by default — the speaker portal opens rows by clicking them and
   * passes neither prop. The sponsor portal passes both, because a Session card's
   * "Name your speaker" has to open the deliverable that fills it: two controls
   * for one act, and only one place holding whether it is open.
   */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

export function TaskRow({ task, renderSurface, renderPayloadExtras, ownerLabel, expanded: controlledExpanded, onExpandedChange }: TaskRowProps): JSX.Element {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false);
  const expanded = controlledExpanded ?? uncontrolledExpanded;
  const setExpanded = (next: boolean) => {
    if (controlledExpanded === undefined) setUncontrolledExpanded(next);
    onExpandedChange?.(next);
  };
  const versions = versionListFor(task);
  // Whether this row is waiting on somebody is said three ways at once — the
  // mark, a named flag in the meta line, and the weight of the button — because
  // a person scanning this list is deciding what to do next, not reading it.
  const done = task.status === "done";
  const state = done ? "done" : task.overdue ? "overdue" : "open";
  const flagCopy = done ? "Complete" : task.overdue ? "Overdue · action needed" : "Action needed";
  // Attribution, once the work is done and we know who did it. It replaces the
  // owner label rather than sitting beside it: the useful fact about a finished
  // deliverable is who finished it, not who it was handed to.
  const attribution = done && task.completed_by ? `completed by ${task.completed_by.name}` : null;
  return <article class={`portal-task-row is-${state} ${expanded ? "is-expanded" : ""}`} id={`deliverable-${task.id}`}>
    <span class={`portal-task-mark ${state}`} aria-label={flagCopy}>{done ? "✓" : task.overdue ? "!" : "●"}</span>
    <div>
      <h3 class="portal-task-title" title={task.title}>{task.title}</h3>
      <p class="portal-task-description">{task.description || "—"}</p>
      <div class="portal-task-meta"><span class={`portal-task-flag ${state}`}>{flagCopy}</span><span>{taskKindLabel(task.kind)}</span><span>due {formatDueDate(task.due_at)}</span></div>
      {/* Reserved height: an attribution line appearing on completion must not
          move the rows below it. */}
      {ownerLabel !== undefined ? <div class="portal-task-owner">{attribution ?? ownerLabel ?? ""}</div> : null}
      {/* Named in the collapsed row on purpose: a checkmark alone is not
          evidence, and nobody should have to open anything to confirm which
          file the conference is holding. */}
      {versions ? <div class="portal-task-file"><FileVersions list={versions} compact /></div> : null}
    </div>
    <button class={`portal-task-action${done ? "" : " primary"}`} type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{done ? (expanded ? "Close" : "View") : (expanded ? "Close" : "Complete")}</button>
    {expanded ? <div class="portal-task-payload">
      {versions ? <div class="portal-task-versions"><FileVersions list={versions} /></div> : null}
      {renderSurface(task)}
      {renderPayloadExtras?.(task) ?? null}
    </div> : null}
  </article>;
}

export function CancelledTaskRow({ task, ownerLabel }: { task: PortalTask; ownerLabel?: string | null }): JSX.Element {
  return <article class="portal-task-row portal-task-row-cancelled" data-task-cancelled="true">
    <span class="portal-task-mark cancelled" aria-label="Cancelled">–</span>
    <div>
      <h3 class="portal-task-title" title={task.title}>{task.title}</h3>
      <p class="portal-task-description">{task.description || "—"}</p>
      <div class="portal-task-meta"><span>{task.kind}</span><span>Cancelled</span></div>
      {ownerLabel !== undefined ? <div class="portal-task-owner">{ownerLabel ?? ""}</div> : null}
    </div>
  </article>;
}
