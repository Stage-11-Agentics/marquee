import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { PageHeader } from "../shell/components";
import { dateInputFromDueAt, dueAtFromDateInput, formatDueDate } from "../../lib/task-due";
import { disambiguatedNames } from "../../lib/duplicate-names";
import "./settings.css";

const BYTES_PER_MB = 1024 * 1024;
const MAX_FILE_SIZE_MB = 100;
const DEFAULT_FILE_CONFIG: TaskFileConfig = { accept: ["pdf", "pptx", "key"], maxBytes: 25 * BYTES_PER_MB };

const FILE_PRESETS = [
  { id: "slides", label: "Slides (PDF, PPTX, Keynote)", extensions: ["pdf", "pptx", "key"] },
  { id: "documents", label: "Documents", extensions: ["pdf", "doc", "docx", "txt", "rtf"] },
  { id: "images", label: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif"] },
  { id: "video", label: "Video", extensions: ["mp4", "mov", "webm", "m4v"] },
] as const;
const PRESET_EXTENSIONS: string[] = FILE_PRESETS.flatMap((preset) => [...preset.extensions]);

/**
 * The three things a task can ask of a speaker, in the organizer's words rather
 * than the column's. `kind` is the stored value; the label is what an organizer
 * reads when deciding which one they mean.
 */
const TASK_KINDS = [
  { kind: "acknowledge", label: "Mark complete", hint: "The speaker confirms they have done it." },
  { kind: "file", label: "Upload a file", hint: "The speaker uploads a deliverable." },
  { kind: "form", label: "Fill in a form", hint: "The speaker answers a conference form." },
] as const;

type TaskKind = (typeof TASK_KINDS)[number]["kind"];

interface TaskFileConfig {
  accept: string[];
  maxBytes: number;
}

interface TaskTemplate {
  id: string;
  event_id: string;
  name: string;
  kind: TaskKind;
  description: string;
  position: number;
  file_config: TaskFileConfig | null;
  updated_at: number;
  due_at: number | null;
  due_offset_days: number | null;
  form_id: string | null;
  auto_assign: number;
  assigned_count: number;
  open_count: number;
}

interface SpeakerTask {
  id: string;
  template_id: string;
  title: string;
  kind: TaskKind;
  due_at: number;
  status: "open" | "done";
  cancelled: boolean;
  person: { id: string; name: string; email: string };
  submission_title: string | null;
}

interface SessionOption {
  id: string;
  title: string;
}

export interface Assignee {
  id: string;
  name: string;
  email: string;
  company: string | null;
  accepted_session_count: number;
  sessions: SessionOption[];
}

/**
 * The session this speaker's copy of the task belongs to: what the organizer
 * picked, or their only session when they have exactly one. An empty string is
 * "no session" — a real answer for a bio or a release form.
 */
function chosenSession(person: Assignee, choices: Readonly<Record<string, string>>): string {
  const choice = choices[person.id];
  if (choice !== undefined) return choice;
  return person.sessions.length === 1 ? (person.sessions[0] as SessionOption).id : "";
}

/**
 * What the request says about sessions.
 *
 * Only speakers the picker actually showed a session control for are named, so
 * a speaker who gained a session while the page sat open is still resolved by
 * the server rather than pinned to a stale nothing.
 */
function sessionAssignments(
  assignees: readonly Assignee[],
  selected: readonly string[],
  choices: Readonly<Record<string, string>>,
): Array<{ person_id: string; submission_id: string | null }> {
  const selectedSet = new Set(selected);
  return assignees
    .filter((person) => selectedSet.has(person.id) && person.sessions.length > 0)
    .map((person) => ({ person_id: person.id, submission_id: chosenSession(person, choices) || null }));
}

interface FormOption {
  id: string;
  name: string;
}

type LoadState =
  | { kind: "loading"; templates: TaskTemplate[] }
  | { kind: "ready"; templates: TaskTemplate[] }
  | { kind: "error"; templates: TaskTemplate[]; message: string };

interface Props {
  eventId: string;
}

interface Draft {
  name: string;
  kind: TaskKind;
  description: string;
  dueMode: "date" | "offset";
  dueDate: string;
  dueOffsetDays: string;
  formId: string;
  autoAssign: boolean;
  assignTo: string[];
  sessionChoices: Record<string, string>;
}

function emptyDraft(): Draft {
  return { name: "", kind: "acknowledge", description: "", dueMode: "date", dueDate: "", dueOffsetDays: "14", formId: "", autoAssign: false, assignTo: [], sessionChoices: {} };
}

async function requestJson<T>(path: string, route: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { credentials: "include", ...init, route });
}

function extensionDraft(value: string): string[] {
  return [...new Set(value
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^\.+/, ""))
    .filter((entry) => /^[a-z0-9](?:[a-z0-9_-]{0,31})$/.test(entry)))];
}

function fileSizeMb(config: TaskFileConfig): number {
  return Math.max(1, Math.round(config.maxBytes / BYTES_PER_MB));
}

function acceptedLabel(accept: readonly string[]): string {
  return accept.map((extension) => `.${extension}`).join(", ");
}

function kindLabel(kind: TaskKind): string {
  return TASK_KINDS.find((entry) => entry.kind === kind)?.label ?? kind;
}

/** What the row says about a deadline, whichever of the two the template carries. */
function deadlineLabel(template: Pick<TaskTemplate, "due_at" | "due_offset_days">): string {
  if (template.due_at !== null) return `Due ${formatDueDate(template.due_at)}`;
  const days = template.due_offset_days ?? 0;
  return `Due ${days} day${days === 1 ? "" : "s"} after acceptance`;
}

function TaskTemplatesSkeleton(): JSX.Element {
  return <div class="settings-grid settings-skeleton" aria-busy="true" aria-label="Loading tasks">
    <section class="card skeleton-block"><span class="skeleton-line wide" /><span class="skeleton-line" /><span class="skeleton-line" /></section>
    <section class="card skeleton-block"><span class="skeleton-line wide" /><span class="skeleton-line" /><span class="skeleton-line" /></section>
  </div>;
}

/**
 * The people picker.
 *
 * Multi-select is the whole point — every fixture task in the eval is assigned
 * to both speakers at once, and an organizer assigning a release form to sixty
 * speakers one at a time would be right to give up on the product.
 */
export function AssigneePicker({
  assignees,
  displayNames,
  selected,
  onChange,
  idPrefix,
}: {
  assignees: readonly Assignee[];
  /** Names to print: duplicates carry a disambiguator so the wrong record is not ticked. */
  displayNames: ReadonlyMap<string, string>;
  selected: readonly string[];
  /**
   * Emits a transform, not a snapshot. Ticking two speakers in the same frame
   * would otherwise apply both against the selection captured at render time,
   * and the second tick would silently drop the first — on the one control
   * whose entire job is picking several people at once.
   */
  onChange: (update: (previous: readonly string[]) => string[]) => void;
  idPrefix: string;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const selectedSet = new Set(selected);
  const toggle = (personId: string): void => {
    onChange((previous) => previous.includes(personId) ? previous.filter((id) => id !== personId) : [...previous, personId]);
  };
  // A real conference has a thousand people in this list. Scrolling to find two
  // of them by eye is not a control, it is a punishment — and "Select all"
  // means all of the people you are looking at, not all thousand.
  const needle = query.trim().toLowerCase();
  const visible = needle === ""
    ? assignees
    : assignees.filter((person) => `${person.name} ${person.email} ${person.company ?? ""}`.toLowerCase().includes(needle));

  return <div class="task-assignee-picker">
    <div class="task-assignee-head">
      <span class="eyebrow">Assign to speakers</span>
      <span class="task-assignee-count tabular">{selected.length} selected</span>
      <button class="button small" type="button" onClick={() => onChange((previous) => [...new Set([...previous, ...visible.map((person) => person.id)])])} disabled={visible.length === 0 || visible.every((person) => selectedSet.has(person.id))}>Select all</button>
      <button class="button small" type="button" onClick={() => onChange(() => [])} disabled={selected.length === 0}>Clear</button>
    </div>
    {assignees.length === 0
      ? <p class="task-assignee-empty">No speakers yet. Add speakers or accept a session, then assign this task to them.</p>
      : <>
        <input class="task-assignee-search" type="search" value={query} placeholder="Search speakers by name, company, or email" aria-label="Search speakers" onInput={(event) => { const value = event.currentTarget.value; setQuery(value); }} />
        <p class="task-assignee-empty tabular">{needle === "" ? `${assignees.length} speaker${assignees.length === 1 ? "" : "s"}` : `${visible.length} of ${assignees.length} match “${query.trim()}”`}</p>
        <div class="task-assignee-list" role="group" aria-label="Speakers">
          {visible.map((person) => <label class="task-assignee-option" key={person.id}>
            <input type="checkbox" id={`${idPrefix}-${person.id}`} checked={selectedSet.has(person.id)} onChange={() => toggle(person.id)} />
            <span><strong>{displayNames.get(person.id) ?? person.name}</strong><small>{person.company || person.email}</small></span>
          </label>)}
        </div>
      </>}
  </div>;
}

/**
 * Which session each selected speaker's task belongs to.
 *
 * Every deliverable the speaker uploads is filed under this session — the files
 * board groups by it and the bulk export makes a folder per session — so a task
 * assigned without one produces a deck nobody can place. A speaker with a single
 * session is answered before the organizer arrives; the rest get one control
 * each, right where they were selected.
 */
function SessionChoicePicker({
  assignees,
  displayNames,
  selected,
  choices,
  onChange,
  idPrefix,
}: {
  assignees: readonly Assignee[];
  displayNames: ReadonlyMap<string, string>;
  selected: readonly string[];
  choices: Readonly<Record<string, string>>;
  onChange: (personId: string, submissionId: string) => void;
  idPrefix: string;
}): JSX.Element | null {
  const selectedSet = new Set(selected);
  const people = assignees.filter((person) => selectedSet.has(person.id) && person.sessions.length > 0);
  if (people.length === 0) return null;

  return <div class="task-session-picker">
    <div class="task-assignee-head">
      <span class="eyebrow">Session</span>
      <span class="subtle">Deliverables are filed under the session chosen here.</span>
    </div>
    <div class="task-session-list">
      {people.map((person) => <div class="task-session-row" key={person.id}>
        <span class="task-session-person">
          <strong>{displayNames.get(person.id) ?? person.name}</strong>
          <small>{person.sessions.length === 1 ? "Their only session" : `${person.sessions.length} sessions`}</small>
        </span>
        <select
          class="task-session-select"
          id={`${idPrefix}-session-${person.id}`}
          aria-label={`Session for ${displayNames.get(person.id) ?? person.name}`}
          value={chosenSession(person, choices)}
          onChange={(event) => onChange(person.id, event.currentTarget.value)}
        >
          <option value="">No session</option>
          {person.sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
        </select>
      </div>)}
    </div>
  </div>;
}

/** The deadline control: a literal date by default, an offset when the organizer wants one. */
function DeadlineFields({
  dueMode,
  dueDate,
  dueOffsetDays,
  onChange,
  idPrefix,
}: {
  dueMode: "date" | "offset";
  dueDate: string;
  dueOffsetDays: string;
  onChange: (patch: { dueMode?: "date" | "offset"; dueDate?: string; dueOffsetDays?: string }) => void;
  idPrefix: string;
}): JSX.Element {
  return <div class="task-deadline">
    <div class="task-segment" role="group" aria-label="Deadline type">
      <button class={`task-segment-button ${dueMode === "date" ? "is-selected" : ""}`} type="button" aria-pressed={dueMode === "date"} onClick={() => onChange({ dueMode: "date" })}>Fixed date</button>
      <button class={`task-segment-button ${dueMode === "offset" ? "is-selected" : ""}`} type="button" aria-pressed={dueMode === "offset"} onClick={() => onChange({ dueMode: "offset" })}>After acceptance</button>
    </div>
    <div class="task-deadline-input">
      {dueMode === "date"
        ? <label class="field"><span>Due date</span><input type="date" id={`${idPrefix}-due-date`} value={dueDate} onInput={(event) => onChange({ dueDate: event.currentTarget.value })} /></label>
        : <label class="field"><span>Days after acceptance</span><input type="number" min="0" max="3650" id={`${idPrefix}-due-offset`} value={dueOffsetDays} onInput={(event) => onChange({ dueOffsetDays: event.currentTarget.value })} /></label>}
    </div>
  </div>;
}

function FileTemplateRow({
  template,
  onChange,
}: {
  template: TaskTemplate;
  onChange: (fileConfig: TaskFileConfig | null) => void;
}): JSX.Element {
  const config = template.file_config;
  const custom = useMemo(() => config
    ? config.accept.filter((extension) => !FILE_PRESETS.some((preset) => preset.extensions.includes(extension as never))).join(", ")
    : "", [config]);

  const togglePreset = (extensions: readonly string[]): void => {
    if (!config) return;
    const selected = extensions.every((extension) => config.accept.includes(extension));
    const accept = selected
      ? config.accept.filter((extension) => !extensions.includes(extension))
      : [...new Set([...config.accept, ...extensions])];
    onChange({ ...config, accept });
  };

  return <div class="task-template-file-policy">
    {config === null
      ? <div class="task-template-unconfigured"><span>No file limit is configured; the system's default upload policy remains in effect.</span><button class="button small" type="button" onClick={() => onChange({ ...DEFAULT_FILE_CONFIG, accept: [...DEFAULT_FILE_CONFIG.accept] })}>Configure file policy</button></div>
      : <div class="task-template-editor">
        <fieldset class="task-template-fieldset">
          <legend>Accepted file types</legend>
          <div class="task-template-preset-grid">
            {FILE_PRESETS.map((preset) => {
              const selected = preset.extensions.every((extension) => config.accept.includes(extension));
              return <button class={`task-template-preset ${selected ? "is-selected" : ""}`} type="button" aria-pressed={selected} key={preset.id} onClick={() => togglePreset(preset.extensions)}><span>{preset.label}</span><small>{selected ? "Included" : "Add set"}</small></button>;
            })}
          </div>
          <label class="field task-template-custom-field"><span>Custom extensions</span><input value={custom} placeholder="csv, zip, or another extension" onInput={(event) => { const next = extensionDraft(event.currentTarget.value); onChange({ ...config, accept: [...new Set([...config.accept.filter((extension) => PRESET_EXTENSIONS.includes(extension)), ...next])] }); }} /><small>Separate extensions with commas. A leading dot is optional.</small></label>
        </fieldset>
        <div class="task-template-limits">
          <label class="field"><span>Maximum file size</span><span class="unit-input"><input type="number" min="1" max={MAX_FILE_SIZE_MB} step="1" value={fileSizeMb(config)} onInput={(event) => { const megabytes = Math.min(MAX_FILE_SIZE_MB, Math.max(1, Number(event.currentTarget.value) || 1)); onChange({ ...config, maxBytes: megabytes * BYTES_PER_MB }); }} /><small>MB</small></span><small>Up to {MAX_FILE_SIZE_MB} MB per file.</small></label>
          <div class="task-template-effective"><span class="eyebrow">Speaker view</span><strong>Accepted: {acceptedLabel(config.accept) || "Choose at least one type"}</strong><small>Speakers see this list and the same size limit in their portal.</small></div>
        </div>
        {config.accept.length === 0 && <p class="task-template-inline-error" role="alert">Choose at least one accepted file type before saving.</p>}
      </div>}
  </div>;
}

export function TaskTemplatesPage({ eventId }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading", templates: [] });
  const [assignments, setAssignments] = useState<SpeakerTask[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [forms, setForms] = useState<FormOption[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [assignSelection, setAssignSelection] = useState<string[]>([]);
  const [assignSessions, setAssignSessions] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState({ kind: "loading", templates: [] });
    const templatesPath = `/api/v1/events/${encodeURIComponent(eventId)}/task-templates`;
    void Promise.all([
      requestJson<{ data: TaskTemplate[] }>(templatesPath, "/api/v1/events/{eventId}/task-templates"),
      requestJson<{ data: SpeakerTask[] }>(`/api/v1/events/${encodeURIComponent(eventId)}/speaker-tasks`, "/api/v1/events/{eventId}/speaker-tasks"),
      requestJson<{ data: Assignee[] }>(`/api/v1/events/${encodeURIComponent(eventId)}/task-assignees`, "/api/v1/events/{eventId}/task-assignees"),
    ])
      .then(([templates, tasks, people]) => {
        if (!active) return;
        setState({ kind: "ready", templates: templates.data });
        setAssignments(tasks.data);
        setAssignees(people.data);
        setDirty(false);
        setComposing(templates.data.length === 0);
      })
      .catch((error: unknown) => { if (active) setState({ kind: "error", templates: [], message: errorSummary(error) }); });
    // The form picker is a convenience, not a dependency: a failure here must
    // not take the page down, it just leaves the form task type without options.
    void requestJson<{ data?: FormOption[] }>(`/api/v1/events/${encodeURIComponent(eventId)}/forms`, "/api/v1/events/{eventId}/forms")
      .then((response) => { if (active && Array.isArray(response.data)) setForms(response.data.map((form) => ({ id: form.id, name: form.name }))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [eventId, reloadKey]);

  const reload = (): void => setReloadKey((value) => value + 1);

  // Two speakers may share a name. Assigning work to the wrong record is the
  // failure this guards, so the picker, the session control, and the list of
  // who is already assigned all read from one derivation.
  const assigneeNames = useMemo(() => disambiguatedNames(assignees), [assignees]);

  const assignmentsByTemplate = useMemo(() => {
    const map = new Map<string, SpeakerTask[]>();
    for (const task of assignments) {
      if (task.cancelled) continue;
      const list = map.get(task.template_id);
      if (list) list.push(task); else map.set(task.template_id, [task]);
    }
    return map;
  }, [assignments]);

  const updateTemplate = (templateId: string, fileConfig: TaskFileConfig | null): void => {
    setState((current) => ({ ...current, templates: current.templates.map((template) => template.id === templateId ? { ...template, file_config: fileConfig } : template) }));
    setDirty(true);
    setNotice(null);
    setSaveError(null);
  };

  /** Turn a draft into the request body, or explain in one sentence why it cannot be one. */
  const draftBody = (value: Draft): { body: Record<string, unknown> } | { error: string } => {
    if (!value.name.trim()) return { error: "Give the task a name speakers will recognise." };
    if (value.kind === "form" && !value.formId) return { error: "Choose the form speakers should fill in." };
    if (value.dueMode === "date") {
      const dueAt = dueAtFromDateInput(value.dueDate);
      if (dueAt === null) return { error: "Choose a due date." };
      return { body: { name: value.name.trim(), kind: value.kind, description: value.description, due_at: dueAt, due_offset_days: null, form_id: value.kind === "form" ? value.formId : null, auto_assign: value.autoAssign } };
    }
    const days = Number(value.dueOffsetDays);
    if (!Number.isInteger(days) || days < 0) return { error: "Days after acceptance must be a whole number." };
    return { body: { name: value.name.trim(), kind: value.kind, description: value.description, due_at: null, due_offset_days: days, form_id: value.kind === "form" ? value.formId : null, auto_assign: value.autoAssign } };
  };

  const createTask = async (event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const prepared = draftBody(draft);
    if ("error" in prepared) { setCreateError(prepared.error); return; }
    setCreating(true);
    setCreateError(null);
    try {
      const response = await requestJson<{ assigned: number }>(`/api/v1/events/${encodeURIComponent(eventId)}/task-templates`, "/api/v1/events/{eventId}/task-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...prepared.body,
          assign_to: draft.assignTo,
          session_assignments: sessionAssignments(assignees, draft.assignTo, draft.sessionChoices),
        }),
      });
      setNotice(response.assigned > 0
        ? `Created “${draft.name.trim()}” and assigned it to ${response.assigned} speaker${response.assigned === 1 ? "" : "s"}.`
        : `Created “${draft.name.trim()}”. Assign it to speakers when you are ready.`);
      setDraft(emptyDraft());
      setComposing(false);
      reload();
    } catch (error: unknown) {
      setCreateError(errorSummary(error));
    } finally {
      setCreating(false);
    }
  };

  const saveEdit = async (templateId: string): Promise<void> => {
    const prepared = draftBody(editDraft);
    if ("error" in prepared) { setSaveError(prepared.error); return; }
    setRowBusy(templateId);
    setSaveError(null);
    try {
      await requestJson(`/api/v1/events/${encodeURIComponent(eventId)}/task-templates/${encodeURIComponent(templateId)}`, "/api/v1/events/{eventId}/task-templates/{templateId}", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prepared.body),
      });
      setEditing(null);
      setNotice("Task updated. Open assignments now carry the new name and deadline.");
      reload();
    } catch (error: unknown) {
      setSaveError(errorSummary(error));
    } finally {
      setRowBusy(null);
    }
  };

  const assignTemplate = async (templateId: string): Promise<void> => {
    if (assignSelection.length === 0) return;
    setRowBusy(templateId);
    setSaveError(null);
    try {
      const response = await requestJson<{ assigned: number; skipped: number }>(`/api/v1/events/${encodeURIComponent(eventId)}/speaker-tasks`, "/api/v1/events/{eventId}/speaker-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          template_id: templateId,
          person_ids: assignSelection,
          session_assignments: sessionAssignments(assignees, assignSelection, assignSessions),
        }),
      });
      setAssignFor(null);
      setAssignSelection([]);
      setAssignSessions({});
      setNotice(response.skipped > 0
        ? `Assigned to ${response.assigned} speaker${response.assigned === 1 ? "" : "s"}; ${response.skipped} already owed this task.`
        : `Assigned to ${response.assigned} speaker${response.assigned === 1 ? "" : "s"}.`);
      setExpanded((current) => current.includes(templateId) ? current : [...current, templateId]);
      reload();
    } catch (error: unknown) {
      setSaveError(errorSummary(error));
    } finally {
      setRowBusy(null);
    }
  };

  const deleteTemplate = async (template: TaskTemplate): Promise<void> => {
    setRowBusy(template.id);
    setSaveError(null);
    try {
      await requestJson(`/api/v1/events/${encodeURIComponent(eventId)}/task-templates/${encodeURIComponent(template.id)}`, "/api/v1/events/{eventId}/task-templates/{templateId}", { method: "DELETE" });
      setNotice(`Deleted “${template.name}”.`);
      reload();
    } catch (error: unknown) {
      setSaveError(errorSummary(error));
    } finally {
      setRowBusy(null);
    }
  };

  const save = async (event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (state.templates.some((template) => template.kind === "file" && template.file_config !== null && template.file_config.accept.length === 0)) {
      setSaveError("Choose at least one accepted file type before saving.");
      return;
    }
    setSaving(true);
    setNotice(null);
    setSaveError(null);
    try {
      for (const template of state.templates.filter((candidate) => candidate.kind === "file")) {
        await requestJson(`/api/v1/events/${encodeURIComponent(eventId)}/task-templates/${encodeURIComponent(template.id)}`, "/api/v1/events/{eventId}/task-templates/{templateId}", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file_config: template.file_config }),
        });
      }
      setDirty(false);
      setNotice("File task settings saved");
      reload();
    } catch (error: unknown) {
      setSaveError(errorSummary(error));
    } finally {
      setSaving(false);
    }
  };

  if (state.kind === "loading") {
    return <div class="settings-page"><PageHeader title="Tasks" copy="Author what speakers must do, assign it to them, and watch who still owes it." /><TaskTemplatesSkeleton /></div>;
  }

  const startEdit = (template: TaskTemplate): void => {
    setEditing(template.id);
    setAssignFor(null);
    setEditDraft({
      name: template.name,
      kind: template.kind,
      description: template.description,
      dueMode: template.due_at !== null ? "date" : "offset",
      dueDate: template.due_at !== null ? dateInputFromDueAt(template.due_at) : "",
      dueOffsetDays: String(template.due_offset_days ?? 14),
      formId: template.form_id ?? "",
      autoAssign: template.auto_assign === 1,
      assignTo: [],
      sessionChoices: {},
    });
  };

  const createForm = <section class="card task-compose" aria-label="Create a task">
    <header class="card-head"><div><h2>New task</h2><span class="subtle">Speakers see the name, the instructions, and the deadline.</span></div></header>
    <div class="card-body">
      <div class="task-compose-fields">
        <label class="field span-2"><span>Task name</span><input value={draft.name} placeholder="Upload Session Presentation" onInput={(event) => { const value = event.currentTarget.value; setDraft((current) => ({ ...current, name: value })); }} /></label>
        <div class="field span-2">
          <span>What the speaker does</span>
          <div class="task-segment" role="group" aria-label="Task type">
            {TASK_KINDS.map((entry) => <button key={entry.kind} class={`task-segment-button ${draft.kind === entry.kind ? "is-selected" : ""}`} type="button" aria-pressed={draft.kind === entry.kind} onClick={() => setDraft((current) => ({ ...current, kind: entry.kind }))}>{entry.label}</button>)}
          </div>
          <small class="task-kind-hint">{TASK_KINDS.find((entry) => entry.kind === draft.kind)?.hint}</small>
        </div>
        <label class="field span-2"><span>Instructions</span><textarea rows={2} value={draft.description} placeholder="Final slide deck as a PDF, 16:9 aspect ratio." onInput={(event) => { const value = event.currentTarget.value; setDraft((current) => ({ ...current, description: value })); }} /></label>
        {draft.kind === "form" && <label class="field span-2"><span>Form</span><select value={draft.formId} onChange={(event) => { const value = event.currentTarget.value; setDraft((current) => ({ ...current, formId: value })); }}><option value="">Choose a form…</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>}
        <div class="field span-2"><span>Deadline</span><DeadlineFields dueMode={draft.dueMode} dueDate={draft.dueDate} dueOffsetDays={draft.dueOffsetDays} idPrefix="task-new" onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} /></div>
      </div>
      <AssigneePicker assignees={assignees} displayNames={assigneeNames} selected={draft.assignTo} idPrefix="task-new-assignee" onChange={(update) => setDraft((current) => ({ ...current, assignTo: update(current.assignTo) }))} />
      <SessionChoicePicker assignees={assignees} displayNames={assigneeNames} selected={draft.assignTo} choices={draft.sessionChoices} idPrefix="task-new-assignee" onChange={(personId, submissionId) => setDraft((current) => ({ ...current, sessionChoices: { ...current.sessionChoices, [personId]: submissionId } }))} />
      <label class="task-auto-assign"><input type="checkbox" checked={draft.autoAssign} onChange={(event) => { const checked = event.currentTarget.checked; setDraft((current) => ({ ...current, autoAssign: checked })); }} /><span>Also give this task to every speaker accepted from now on</span></label>
      <div class="task-compose-error" role="alert">{createError ?? ""}</div>
      <div class="task-compose-actions">
        <button class="button" type="button" onClick={() => { setComposing(false); setCreateError(null); }} disabled={state.templates.length === 0}>Cancel</button>
        <button class="button primary" type="submit" disabled={creating}>{creating ? "Creating…" : "Create task"}</button>
      </div>
    </div>
  </section>;

  return <div class="settings-page">
    <PageHeader
      title="Tasks"
      copy="Author what speakers must do, assign it to them, and watch who still owes it."
      actions={<>
        <span class={`settings-dirty ${dirty ? "is-dirty" : ""}`}>{dirty ? "Unsaved changes" : "All changes saved"}</span>
        <button class="button primary" type="button" onClick={() => { setComposing(true); setCreateError(null); }} disabled={composing}>＋ New task</button>
      </>}
    />
    {state.kind === "error" && <div class="settings-error" role="alert"><strong>Tasks unavailable</strong><span>{state.message}</span><button class="button small" type="button" onClick={reload}>Retry</button></div>}
    <div class="task-notice-slot">
      {notice && <div class="settings-banner" role="status">{notice}</div>}
      {saveError && <div class="settings-error" role="alert"><strong>That did not save</strong><span>{saveError}</span></div>}
    </div>
    <form onSubmit={composing ? createTask : save}>
      {composing && createForm}
      <div class="settings-list">
        {state.templates.length > 0
          ? state.templates.map((template) => {
            const rows = assignmentsByTemplate.get(template.id) ?? [];
            const done = rows.filter((row) => row.status === "done").length;
            const isOpen = expanded.includes(template.id);
            return <article class="settings-row task-template-row" key={template.id}>
              <div class="settings-row-heading task-template-heading">
                <strong>{template.name}</strong>
                <span class="task-heading-meta">
                  <span class="task-kind-badge">{kindLabel(template.kind)}</span>
                  <span class="subtle tabular">{deadlineLabel(template)}</span>
                </span>
              </div>
              <p class="task-template-description">{template.description || "No instructions yet."}</p>
              <div class="task-row-status">
                <button class="button small" type="button" aria-expanded={isOpen} onClick={() => setExpanded((current) => current.includes(template.id) ? current.filter((id) => id !== template.id) : [...current, template.id])}>
                  <span class="tabular">{done} of {rows.length} complete</span>
                </button>
                <div class="task-row-actions">
                  <button class="button small" type="button" onClick={() => { setAssignFor(assignFor === template.id ? null : template.id); setAssignSelection([]); setAssignSessions({}); setEditing(null); }} disabled={rowBusy === template.id}>Assign to speakers</button>
                  <button class="button small" type="button" onClick={() => editing === template.id ? setEditing(null) : startEdit(template)} disabled={rowBusy === template.id}>{editing === template.id ? "Cancel" : "Edit"}</button>
                  <button class="button small" type="button" onClick={() => void deleteTemplate(template)} disabled={rowBusy === template.id}>Delete</button>
                </div>
              </div>
              {editing === template.id && <div class="task-row-edit">
                <div class="task-compose-fields">
                  <label class="field span-2"><span>Task name</span><input value={editDraft.name} onInput={(event) => { const value = event.currentTarget.value; setEditDraft((current) => ({ ...current, name: value })); }} /></label>
                  <label class="field span-2"><span>Instructions</span><textarea rows={2} value={editDraft.description} onInput={(event) => { const value = event.currentTarget.value; setEditDraft((current) => ({ ...current, description: value })); }} /></label>
                  <div class="field span-2"><span>Deadline</span><DeadlineFields dueMode={editDraft.dueMode} dueDate={editDraft.dueDate} dueOffsetDays={editDraft.dueOffsetDays} idPrefix={`task-edit-${template.id}`} onChange={(patch) => setEditDraft((current) => ({ ...current, ...patch }))} /></div>
                </div>
                <div class="task-compose-actions"><button class="button primary" type="button" onClick={() => void saveEdit(template.id)} disabled={rowBusy === template.id}>{rowBusy === template.id ? "Saving…" : "Save task"}</button></div>
              </div>}
              {assignFor === template.id && <div class="task-row-assign">
                <AssigneePicker assignees={assignees} displayNames={assigneeNames} selected={assignSelection} idPrefix={`task-assign-${template.id}`} onChange={(update) => setAssignSelection((current) => update(current))} />
                <SessionChoicePicker assignees={assignees} displayNames={assigneeNames} selected={assignSelection} choices={assignSessions} idPrefix={`task-assign-${template.id}`} onChange={(personId, submissionId) => setAssignSessions((current) => ({ ...current, [personId]: submissionId }))} />
                <div class="task-compose-actions"><button class="button primary" type="button" onClick={() => void assignTemplate(template.id)} disabled={assignSelection.length === 0 || rowBusy === template.id}>{rowBusy === template.id ? "Assigning…" : `Assign to ${assignSelection.length} speaker${assignSelection.length === 1 ? "" : "s"}`}</button></div>
              </div>}
              {isOpen && <div class="task-assignment-list">
                {rows.length === 0
                  ? <p class="task-assignee-empty">Nobody is assigned to this task yet.</p>
                  : <table class="task-assignment-table"><thead><tr><th scope="col">Speaker</th><th scope="col">Session</th><th scope="col">Due</th><th scope="col">Status</th></tr></thead><tbody>
                    {rows.map((row) => <tr key={row.id}>
                      <th scope="row"><strong>{assigneeNames.get(row.person.id) ?? row.person.name}</strong><small>{row.person.email}</small></th>
                      <td>{row.submission_title ?? "—"}</td>
                      <td class="tabular">{formatDueDate(row.due_at)}</td>
                      <td><span class={`task-status task-status-${row.status}`}>{row.status === "done" ? "Complete" : "Pending"}</span></td>
                    </tr>)}
                  </tbody></table>}
              </div>}
              {template.kind === "file" && <FileTemplateRow template={template} onChange={(fileConfig) => updateTemplate(template.id, fileConfig)} />}
            </article>;
          })
          : <section class="card settings-list-empty"><strong>No tasks yet</strong><span>Create the first task speakers must complete — a slide upload, a bio, a signed release.</span><button class="button primary" type="button" onClick={() => setComposing(true)}>＋ New task</button></section>}
      </div>
      {!composing && <footer class="settings-savebar"><span class="subtle">File policy changes apply to speaker portals after saving.</span><button class="button primary" type="submit" disabled={!dirty || saving}>{saving ? "Saving…" : dirty ? "Save file task settings" : "File task settings saved"}</button></footer>}
    </form>
  </div>;
}
