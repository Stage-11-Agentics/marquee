import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { type OnboardingFilter, type OnboardingRow, type OnboardingSnapshot, type OnboardingSpeakerDetail } from "../../routes/onboarding.queries";
import { AgentBriefLauncher } from "../shell/AgentBrief";
import { apiFetch, errorSummary } from "../shell/api-client";
import { idempotencyKeyForCompose } from "../shell/compose-idempotency";
import { Button, Chip, EmptyState, PageHeader } from "../shell/components";
import { lockBodyScroll } from "../shell/OverlayHosts";
import { orderNewestFirst } from "../shell/wide-grid";
import { formatDueDate } from "../../lib/task-due";
import { disambiguatedNames } from "../../lib/duplicate-names";
import { FileVersions } from "../files/FileVersions";
import "./onboarding.css";

const CUSTOM_TEMPLATE = "__custom__";
const FILTER_LABELS: Record<OnboardingFilter, string> = {
  all: "All",
  overdue: "Overdue",
  incomplete: "Incomplete",
  risk: "At risk",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; snapshot: OnboardingSnapshot };

interface EmailTemplate {
  key: string;
  name: string;
  subject: string;
  body_md: string;
  enabled: number;
}

interface SendResponse {
  selected: number;
  queued: number;
  duplicate: number;
  skipped: Array<{ person_id: string; name: string; reason: string }>;
  outbox_ids: string[];
  outbox_rows: Array<{ person_id: string; entity_id: string; outbox_id: string; inserted: boolean }>;
}

interface PortalInvite {
  person_id: string;
  name: string;
  email: string;
  invited_at: number;
  outbox_id: string;
  outbox_inserted: boolean;
  magic_link?: string;
}

interface PortalInviteResponse {
  ok: true;
  message: string;
  invites: PortalInvite[];
}

const FALLBACK_TEMPLATE: EmailTemplate = {
  key: "reminder_generic",
  name: "Generic reminder",
  subject: "A quick Marquee reminder",
  body_md: "Hi {{speaker.first_name}},\n\nThis is a reminder about your conference tasks.",
  enabled: 1,
};

async function requestJson<T>(path: string, route: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    route,
  });
}

async function readBoard(eventId: string, filters: { filter: OnboardingFilter; taskType: string; track: string; search: string }, page: number, perPage: number, signal: AbortSignal): Promise<OnboardingSnapshot> {
  const query = new URLSearchParams({ filter: filters.filter });
  query.set("page", String(page));
  query.set("per_page", String(perPage));
  if (filters.taskType) query.set("task_type", filters.taskType);
  if (filters.track) query.set("track", filters.track);
  if (filters.search.trim()) query.set("q", filters.search.trim());
  return requestJson<OnboardingSnapshot>(`/api/v1/events/${encodeURIComponent(eventId)}/onboarding?${query.toString()}`, "/api/v1/events/{eventId}/onboarding", { signal });
}

/**
 * Reconcile only the page that was refreshed. Selection intentionally survives
 * paging, but a row that was visible on this page and disappears from the
 * server must not remain actionable through its cached projection.
 */
export function reconcileOnboardingSelection(
  selected: ReadonlySet<string>,
  previousVisibleIds: ReadonlySet<string>,
  nextRows: readonly Pick<OnboardingRow, "id">[],
): Set<string> {
  const nextVisibleIds = new Set(nextRows.map((row) => row.id));
  return new Set([...selected].filter((id) => !previousVisibleIds.has(id) || nextVisibleIds.has(id)));
}

export function reconcileOnboardingSelectionForView(
  selected: ReadonlySet<string>,
  visibleRowsByView: ReadonlyMap<string, ReadonlySet<string>>,
  viewIdentity: string,
  nextRows: readonly Pick<OnboardingRow, "id">[],
): Set<string> {
  const previousVisibleIds = visibleRowsByView.get(viewIdentity);
  return previousVisibleIds === undefined ? new Set(selected) : reconcileOnboardingSelection(selected, previousVisibleIds, nextRows);
}

export function shouldApplyOnboardingSnapshot(disposed: boolean, activeRequest: AbortController | null, request: AbortController): boolean {
  return !disposed && activeRequest === request && !request.signal.aborted;
}

function formatDate(value: number | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: number | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "SP";
}

function headshotUrl(eventId: string, personId: string, attachmentId: string | null): string | null {
  if (!attachmentId) return null;
  return `/api/v1/events/${encodeURIComponent(eventId)}/people/${encodeURIComponent(personId)}/headshot?v=${encodeURIComponent(attachmentId)}`;
}

function SpeakerAvatar({ eventId, person, className }: { eventId: string; person: Pick<OnboardingRow["person"], "id" | "name" | "headshot_attachment_id">; className: "onboarding-row-avatar" | "onboarding-avatar" }): JSX.Element {
  const src = headshotUrl(eventId, person.id, person.headshot_attachment_id);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <span class={className} role="img" aria-label={`${person.name} headshot`}>
    {src && !failed ? <img src={src} alt={`${person.name} headshot`} width={44} height={44} onError={() => setFailed(true)} /> : initials(person.name)}
  </span>;
}

function reminderSubmission(row: OnboardingRow): string | null {
  return row.tasks.find((task) => task.owed && task.submission_id)?.submission_id ?? row.submission_ids[0] ?? null;
}

function SpeakerDrawer({ eventId, personId, onClose }: { eventId: string; personId: string; onClose: () => void }): JSX.Element {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; detail: OnboardingSpeakerDetail }>({ kind: "loading" });
  const [inviteState, setInviteState] = useState<{ kind: "idle" | "sending" } | { kind: "success"; result: PortalInviteResponse } | { kind: "error"; message: string }>({ kind: "idle" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    requestJson<OnboardingSpeakerDetail>(`/api/v1/events/${encodeURIComponent(eventId)}/onboarding/speakers/${encodeURIComponent(personId)}`, "/api/v1/events/{eventId}/onboarding/speakers/{personId}", { signal: controller.signal })
      .then((detail) => setState({ kind: "ready", detail }))
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ kind: "error", message: errorSummary(error) }); });
    return () => controller.abort();
  }, [eventId, personId]);

  const invite = async () => {
    setInviteState({ kind: "sending" });
    try {
      const result = await requestJson<PortalInviteResponse>(`/api/v1/events/${encodeURIComponent(eventId)}/speakers/invite`, "/api/v1/events/{eventId}/speakers/invite", {
        method: "POST",
        body: JSON.stringify({ person_ids: [personId] }),
      });
      setInviteState({ kind: "success", result });
    } catch (error: unknown) {
      setInviteState({ kind: "error", message: errorSummary(error) });
    }
  };

  return <aside class="onboarding-drawer" role="dialog" aria-modal="true" aria-labelledby="speaker-drawer-title">
    <header class="onboarding-drawer-head"><div><span class="onboarding-kicker">Speaker context</span><h2 id="speaker-drawer-title">{state.kind === "ready" ? state.detail.person.name : "Loading speaker"}</h2></div><Button small aria-label="Close speaker context" onClick={onClose}>Close</Button></header>
    {state.kind === "loading" ? <div class="onboarding-drawer-state">Reading the conference record…</div> : null}
    {state.kind === "error" ? <div class="onboarding-drawer-state error">{state.message}</div> : null}
    {state.kind === "ready" ? <div class="onboarding-drawer-body">
      <section class="onboarding-profile"><SpeakerAvatar eventId={eventId} person={state.detail.person} className="onboarding-avatar" /><div><strong>{state.detail.person.name}</strong><span>{state.detail.person.email}</span><span>{[state.detail.person.title, state.detail.person.company].filter(Boolean).join(" · ") || "—"}</span></div></section>
      <section class="onboarding-drawer-section"><h3>Bio</h3><p>{state.detail.person.bio || "—"}</p></section>
      <section class="onboarding-drawer-section"><h3>Tasks</h3><div class="onboarding-context-list">{state.detail.tasks.map((task) => <div class="onboarding-context-row" key={`${task.template_id}-${task.task_id ?? "unassigned"}`}><span class={`onboarding-glyph state-${task.state}`} aria-label={task.state}>{task.glyph}</span><div><strong>{task.title}</strong><span>{task.state} · due {task.due_at === null ? "—" : formatDueDate(task.due_at)}</span></div></div>)}</div></section>
      <section class="onboarding-drawer-section" aria-labelledby="speaker-files-heading"><h3 id="speaker-files-heading">Files</h3><div class="onboarding-file-groups"><div class="onboarding-file-group"><strong>Profile headshot</strong><FileVersions list={state.detail.files.profile} emptyCopy="No headshot uploaded yet." /></div>{state.detail.files.tasks.map((task) => <div class="onboarding-file-group" key={task.task_id}><strong>{task.title}</strong><FileVersions list={task.list} emptyCopy="No file uploaded yet." /></div>)}</div></section>
      <section class="onboarding-drawer-section"><h3>Sessions</h3><div class="onboarding-context-list">{state.detail.sessions.length === 0 ? <p>—</p> : state.detail.sessions.map((session) => <div class="onboarding-context-row" key={session.id}><span class="onboarding-context-mark">◌</span><div><strong>{session.title}</strong><span>{session.tracks.map((track) => track.name).join(" · ") || "No track"}{session.agenda ? ` · ${formatDateTime(session.agenda.starts_at)} · ${session.agenda.room ?? "No room"}` : " · not scheduled"}</span></div></div>)}</div></section>
      <section class="onboarding-drawer-section"><h3>Message history</h3><div class="onboarding-context-list">{state.detail.messages.length === 0 ? <p>Nothing sent yet.</p> : state.detail.messages.map((message) => <div class="onboarding-message-row" key={message.id}><div><strong>{message.subject}</strong><span>{formatDateTime(message.created_at)} · {message.to_email}</span></div><Chip tone={message.status === "sent" ? "success" : message.status === "suppressed" ? "warning" : ""}>{message.status === "suppressed" ? "demo-safe" : message.status}</Chip><p>{message.text}</p></div>)}</div></section>
      <section class="onboarding-drawer-section onboarding-invite-section"><div class="onboarding-invite-heading"><div><h3>Portal access</h3><p>Send a speaker portal invitation valid for 15 days; it can be opened again during that window.</p></div><Button small variant="primary" onClick={() => void invite()} disabled={inviteState.kind === "sending"}>{inviteState.kind === "sending" ? "Queueing…" : "Invite to portal"}</Button></div>{inviteState.kind === "success" ? <div class="onboarding-invite-result" aria-live="polite"><strong>{inviteState.result.message}</strong>{inviteState.result.invites.map((item) => item.magic_link ? <a href={item.magic_link} key={item.outbox_id}>Open {item.name}'s portal link</a> : <span key={item.outbox_id}>Outbox row {item.outbox_id} recorded; delivery remains provider-controlled.</span>)}</div> : null}{inviteState.kind === "error" ? <div class="onboarding-inline-error" role="alert">Invitation failed: {inviteState.message}</div> : null}</section>
    </div> : null}
  </aside>;
}

function ComposeDrawer({ eventId, rows, displayNames, onClose }: { eventId: string; rows: OnboardingRow[]; displayNames: ReadonlyMap<string, string>; onClose: () => void }): JSX.Element {
  const [templates, setTemplates] = useState<EmailTemplate[]>([FALLBACK_TEMPLATE]);
  const [templateKey, setTemplateKey] = useState(FALLBACK_TEMPLATE.key);
  const [subject, setSubject] = useState(FALLBACK_TEMPLATE.subject);
  const [body, setBody] = useState(FALLBACK_TEMPLATE.body_md);
  const [preview, setPreview] = useState<{ subject: string; text: string; to_email: string } | null>(null);
  const [result, setResult] = useState<SendResponse | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const composeIdempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const custom = templateKey === CUSTOM_TEMPLATE;
  const activeTemplate = templates.find((template) => template.key === templateKey) ?? FALLBACK_TEMPLATE;
  const recipientRows = rows.map((row) => ({ row, submissionId: reminderSubmission(row) }));
  const personIds = [...new Set(recipientRows.map(({ row }) => row.person.id))];
  const recipientPairs = recipientRows.map(({ row, submissionId }) => ({ person_id: row.person.id, submission_id: submissionId }));

  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ data: EmailTemplate[] }>(`/api/v1/events/${encodeURIComponent(eventId)}/templates`, "/api/v1/events/{eventId}/templates", { signal: controller.signal })
      .then((response) => setTemplates([FALLBACK_TEMPLATE, ...response.data.filter((template) => template.enabled === 1 && template.key !== FALLBACK_TEMPLATE.key)]))
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId]);

  useEffect(() => {
    if (custom) return;
    setSubject(activeTemplate.subject);
    setBody(activeTemplate.body_md);
  }, [activeTemplate.key, custom]);

  const message = custom ? { subject, body } : { template_key: templateKey };
  const firstRecipient = recipientRows[0];
  const previewMessage = async () => {
    if (!firstRecipient) return;
    setBusy("preview"); setError(null);
    try {
      const next = await requestJson<{ subject: string; text: string; to_email: string }>(`/api/v1/events/${encodeURIComponent(eventId)}/comms/preview`, "/api/v1/events/{eventId}/comms/preview", {
        method: "POST",
        body: JSON.stringify({ person_id: firstRecipient.row.person.id, submission_id: firstRecipient.submissionId ?? undefined, ...message }),
      });
      setPreview(next);
    } catch (caught) { setError(errorSummary(caught)); }
    finally { setBusy(null); }
  };
  const queue = async () => {
    if (personIds.length === 0) return;
    setBusy("send"); setError(null); setResult(null);
    try {
      const headers = custom
        ? {
          "Idempotency-Key": idempotencyKeyForCompose(
            composeIdempotencyRef,
            JSON.stringify({ eventId, templateKey, recipientPairs, subject, body }),
          ),
        }
        : undefined;
      const next = await requestJson<SendResponse>(`/api/v1/events/${encodeURIComponent(eventId)}/comms/send`, "/api/v1/events/{eventId}/comms/send", {
        method: "POST",
        ...(headers ? { headers } : {}),
        body: JSON.stringify({ selector: { recipient_pairs: recipientPairs, task_state: "open" }, ...message }),
      });
      setResult(next);
      // The successful response closes this compose. A failed request leaves
      // the ref untouched so the operator's retry reuses its key.
      composeIdempotencyRef.current = null;
    } catch (caught) { setError(errorSummary(caught)); }
    finally { setBusy(null); }
  };

  return <aside class="onboarding-drawer onboarding-compose-drawer" role="dialog" aria-modal="true" aria-labelledby="compose-drawer-title">
    <header class="onboarding-drawer-head"><div><span class="onboarding-kicker">Compose</span><h2 id="compose-drawer-title">Reminder for {rows.length} speaker{rows.length === 1 ? "" : "s"}</h2><span class="onboarding-demo-safe">Demo-safe outbox · no email will be delivered</span></div><Button small aria-label="Close compose drawer" onClick={onClose}>Close</Button></header>
    <div class="onboarding-drawer-body">
      <div class="onboarding-compose-recipient"><span>Recipients</span><strong class="tabular">{personIds.length}</strong><small>{rows.map((row) => displayNames.get(row.person.id) ?? row.person.name).join(" · ") || "—"}</small></div>
      <label class="onboarding-field">Template<select value={templateKey} onChange={(event) => setTemplateKey((event.currentTarget as HTMLSelectElement).value)}>{templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}<option value={CUSTOM_TEMPLATE}>Write custom copy</option></select></label>
      <label class="onboarding-field">Subject<input value={subject} readOnly={!custom} onInput={(event) => setSubject((event.currentTarget as HTMLInputElement).value)} /></label>
      <label class="onboarding-field">Body<textarea rows={8} value={body} readOnly={!custom} onInput={(event) => setBody((event.currentTarget as HTMLTextAreaElement).value)} /></label>
      <div class="onboarding-merge-note">Merge fields render once through the shared mail seam. Preview uses the first selected speaker and their outstanding task context.</div>
      {preview ? <section class="onboarding-preview"><span>Preview · {preview.to_email}</span><strong>{preview.subject}</strong><p>{preview.text}</p></section> : null}
      <div class="onboarding-outbox-result-slot" aria-live="polite">{result ? <section class="onboarding-outbox-result"><strong>{result.selected} selected · {result.queued} queued · {result.duplicate} already in outbox · {result.skipped.length} skipped</strong>{result.outbox_rows.map((row) => <div key={`${row.person_id}-${row.outbox_id}`}><span>{displayNames.get(row.person_id) ?? rows.find((candidate) => candidate.person.id === row.person_id)?.person.name ?? row.person_id}</span><Chip tone={row.inserted ? "success" : "warning"}>{row.inserted ? "queued" : "duplicate"}</Chip></div>)}{result.skipped.map((row) => <div key={`skipped-${row.person_id}`}><span><strong>{displayNames.get(row.person_id) ?? row.name}</strong><small>{row.reason}</small></span><Chip tone="warning">skipped</Chip></div>)}</section> : null}</div>
      {error ? <div class="onboarding-inline-error" role="alert">{error}</div> : null}
    </div>
    <footer class="onboarding-drawer-foot"><Button small onClick={() => void previewMessage()} disabled={busy !== null || firstRecipient === undefined}>{busy === "preview" ? "Rendering…" : "Preview merge"}</Button><button class="onboarding-fixed-action" type="button" onClick={() => void queue()} disabled={busy !== null || personIds.length === 0}>{busy === "send" ? "Queueing…" : `Queue reminder (${personIds.length})`}</button></footer>
  </aside>;
}

export function OnboardingPage({ eventId, search = "", navigate }: { eventId: string; search?: string; navigate?: (target: string) => void }): JSX.Element {
  const [filters, setFilters] = useState({ filter: "all" as OnboardingFilter, taskType: "", track: "", search: "" });
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Selection is an operator decision, not a property of the currently loaded
  // page. Keep the latest row projection for every selected id so a reminder or
  // invite remains actionable after the operator moves to another page.
  const [knownRows, setKnownRows] = useState<Map<string, OnboardingRow>>(new Map());
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [drawer, setDrawer] = useState<{ kind: "speaker"; personId: string } | { kind: "compose" } | null>(null);
  // Quick-search has always returned speaker hits carrying `?person=`; until now
  // nothing on the receiving end read it, so the link went nowhere.
  const deepLinkedPerson = new URLSearchParams(search).get("person");
  const [origin, setOrigin] = useState<HTMLElement | null>(null);
  const [inviteState, setInviteState] = useState<{ kind: "idle" | "sending" } | { kind: "success"; result: PortalInviteResponse } | { kind: "error"; message: string }>({ kind: "idle" });
  const matrixRef = useRef<HTMLDivElement>(null);
  const [matrixOverflows, setMatrixOverflows] = useState(false);
  const filterIdentity = JSON.stringify(filters);
  const visibleRowsByView = useRef<Map<string, Set<string>>>(new Map());
  const updateFilters = (update: typeof filters | ((current: typeof filters) => typeof filters)) => {
    setPage(1);
    setSelected(new Set());
    setKnownRows(new Map());
    visibleRowsByView.current = new Map();
    setFilters(update);
  };
  const ready = state.kind === "ready"
    ? { ...state.snapshot, task_templates: orderNewestFirst(state.snapshot.task_templates, (task) => task.position) }
    : null;
  const rows = ready?.data ?? [];
  // Two speakers may share a name; the grid must not print them as one
  // indistinguishable pair. Derived once here so the drawers agree with the grid.
  const displayNames = disambiguatedNames([...knownRows.values()].map((row) => row.person));
  const selectedRows = [...selected]
    .map((id) => knownRows.get(id))
    .filter((row): row is OnboardingRow => row !== undefined);
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  useEffect(() => {
    setSelected(new Set());
    setKnownRows(new Map());
    visibleRowsByView.current = new Map();
  }, [eventId]);

  useEffect(() => {
    let disposed = false;
    let active: AbortController | null = null;
    const load = (showLoading: boolean) => {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      if (showLoading) setState({ kind: "loading" });
      readBoard(eventId, filters, page, pageSize, controller.signal)
        .then((snapshot) => {
          if (!shouldApplyOnboardingSnapshot(disposed, active, controller)) return;
          const viewIdentity = `${eventId}|${filterIdentity}|${page}`;
          const previousVisibleIds = visibleRowsByView.current.get(viewIdentity);
          const nextVisibleIds = new Set(snapshot.data.map((row) => row.id));
          setState({ kind: "ready", snapshot });
          if (previousVisibleIds !== undefined) {
            setSelected((current) => reconcileOnboardingSelection(current, previousVisibleIds, snapshot.data));
          }
          setKnownRows((current) => {
            const next = new Map(current);
            if (previousVisibleIds !== undefined) {
              for (const id of previousVisibleIds) {
                if (!nextVisibleIds.has(id)) next.delete(id);
              }
            }
            for (const row of snapshot.data) next.set(row.id, row);
            return next;
          });
          visibleRowsByView.current.set(viewIdentity, nextVisibleIds);
          // A mutation can shrink the result set while an operator is reading a
          // later page. Ask for the last real page instead of leaving an empty
          // grid behind with no way back to the data.
          const lastPage = Math.max(1, snapshot.total_pages);
          setPage((current) => current > lastPage ? lastPage : current);
        })
        .catch((error: unknown) => { if (shouldApplyOnboardingSnapshot(disposed, active, controller)) setState({ kind: "error", message: errorSummary(error) }); });
    };
    load(true);
    const timer = window.setInterval(() => load(false), 5_000);
    return () => { disposed = true; active?.abort(); window.clearInterval(timer); };
  }, [eventId, filterIdentity, page]);

  // Whether the grid hides columns depends on the viewport as much as on the
  // template count, so it is measured rather than guessed.
  useEffect(() => {
    const element = matrixRef.current;
    if (!element) { setMatrixOverflows(false); return; }
    const measure = () => setMatrixOverflows(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [state.kind, ready?.task_templates.length, rows.length]);

  useEffect(() => {
    if (deepLinkedPerson) setDrawer({ kind: "speaker", personId: deepLinkedPerson });
  }, [deepLinkedPerson]);

  useEffect(() => {
    if (!drawer) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawer(null); };
    document.addEventListener("keydown", onKeyDown);
    const releaseScrollLock = lockBodyScroll();
    return () => { document.removeEventListener("keydown", onKeyDown); releaseScrollLock(); };
  }, [drawer]);

  useEffect(() => {
    if (drawer === null) origin?.focus();
  }, [drawer]);

  const openDrawer = (next: NonNullable<typeof drawer>, element: HTMLElement) => { setOrigin(element); setDrawer(next); };
  const toggleRow = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => setSelected((current) => {
    const next = new Set(current);
    if (allVisibleSelected) rows.forEach((row) => next.delete(row.id));
    else rows.forEach((row) => next.add(row.id));
    return next;
  });
  const clearSelection = () => setSelected(new Set());
  const selectForNudge = (row: OnboardingRow, event: Event) => {
    setSelected(new Set([row.id]));
    openDrawer({ kind: "compose" }, event.currentTarget as HTMLElement);
  };
  const inviteSelected = async () => {
    const personIds = [...new Set(selectedRows.map((row) => row.person.id))];
    if (personIds.length === 0) return;
    setInviteState({ kind: "sending" });
    try {
      const result = await requestJson<PortalInviteResponse>(`/api/v1/events/${encodeURIComponent(eventId)}/speakers/invite`, "/api/v1/events/{eventId}/speakers/invite", {
        method: "POST",
        body: JSON.stringify({ person_ids: personIds }),
      });
      setInviteState({ kind: "success", result });
    } catch (error: unknown) {
      setInviteState({ kind: "error", message: errorSummary(error) });
    }
  };
  const lastTaskColumn = ready?.task_templates.at(-1) ?? null;
  const taskTypes = ready?.facets.task_types ?? [];
  const tracks = ready?.facets.tracks ?? [];
  const counts = ready?.counts ?? { all: 0, overdue: 0, incomplete: 0, risk: 0 };
  const hasActiveFilters = filters.filter !== "all" || Boolean(filters.taskType || filters.track || filters.search.trim());
  const acceptedSpeakerCount = ready?.metrics.accepted_speakers ?? 0;
  const noAcceptedSpeakers = !hasActiveFilters && acceptedSpeakerCount === 0;
  const allAcceptedSpeakersClear = !hasActiveFilters && acceptedSpeakerCount > 0 && counts.incomplete === 0;
  const hideBoardForTruthfulEmpty = noAcceptedSpeakers || allAcceptedSpeakersClear;
  const clearFilters = () => updateFilters({ filter: "all", taskType: "", track: "", search: "" });
  const matchingTotal = ready?.total ?? rows.length;
  const totalPages = Math.max(1, ready?.total_pages ?? Math.ceil(matchingTotal / pageSize));

  return <div class="onboarding-page">
    <PageHeader title="Onboarding" copy={ready ? acceptedSpeakerCount === 0 ? "No accepted speakers yet. Tasks appear after the first acceptance." : `${counts.incomplete} accepted speakers still owe something. The most behind are first; every task and reminder is visible here.` : "Reading the conference chase board…"} actions={<><AgentBriefLauncher surface="portal" eventId={eventId} small /><Button small onClick={() => navigate?.("/import")}>Import speakers</Button><Button small class="onboarding-selection-clear" type="button" disabled={selected.size === 0} onClick={clearSelection}>Clear selection</Button><button class="onboarding-fixed-action onboarding-header-action" type="button" disabled={selectedRows.length === 0 || inviteState.kind === "sending"} onClick={() => void inviteSelected()}>{inviteState.kind === "sending" ? "Inviting…" : `Invite to portal (${selectedRows.length})`}</button><button class="onboarding-fixed-action onboarding-header-action" type="button" disabled={selectedRows.length === 0} onClick={(event) => openDrawer({ kind: "compose" }, event.currentTarget)}>{`Send reminder (${selectedRows.length})`}</button></>} />
    <div class="onboarding-invite-result-slot" aria-live="polite">{inviteState.kind === "success" ? <div class="onboarding-invite-result"><strong>{inviteState.result.message}</strong>{inviteState.result.invites.map((item) => item.magic_link ? <a href={item.magic_link} key={item.outbox_id}>Open {displayNames.get(item.person_id) ?? item.name}'s portal link</a> : <span key={item.outbox_id}>{displayNames.get(item.person_id) ?? item.name}: outbox row {item.outbox_id} recorded; delivery remains provider-controlled.</span>)}</div> : null}{inviteState.kind === "error" ? <div class="onboarding-inline-error" role="alert">Invitation failed: {inviteState.message}</div> : null}</div>
    {ready ? <>
      <div class="onboarding-metrics" aria-label="Onboarding metrics">
        <button class={`onboarding-metric ${filters.filter === "incomplete" ? "active" : ""}`} type="button" aria-pressed={filters.filter === "incomplete"} onClick={() => updateFilters((current) => ({ ...current, filter: "incomplete" }))}><span>Accepted speakers</span><strong class="tabular">{ready.metrics.accepted_speakers}</strong><small>{counts.incomplete} still owe something</small></button>
        <button class={`onboarding-metric ${filters.filter === "overdue" ? "active" : ""}`} type="button" aria-pressed={filters.filter === "overdue"} onClick={() => updateFilters((current) => ({ ...current, filter: "overdue" }))}><span>Overdue tasks</span><strong class="tabular alarm-text">{ready.metrics.overdue_tasks}</strong><small>Across {counts.overdue} speakers</small></button>
        <button class={`onboarding-metric ${filters.filter === "risk" ? "active" : ""}`} type="button" aria-pressed={filters.filter === "risk"} onClick={() => updateFilters((current) => ({ ...current, filter: "risk" }))}><span>At risk</span><strong class="tabular warning-text">{ready.metrics.at_risk}</strong><small>Speakers with near-due work</small></button>
        <button class="onboarding-metric" type="button" onClick={() => navigate?.("/agenda-builder")}><span>Ready to schedule</span><strong class="tabular">{ready.metrics.ready_to_schedule}</strong><small>Accepted Sessions in the pool</small></button>
      </div>
      <section class="onboarding-board card" aria-label="Speaker onboarding chase board">
        <div class="onboarding-board-tools"><div class="onboarding-filter-chips" aria-label="Task state filters">{(Object.keys(FILTER_LABELS) as OnboardingFilter[]).map((filter) => <button class={`onboarding-filter-chip ${filters.filter === filter ? "active" : ""}`} type="button" key={filter} onClick={() => updateFilters((current) => ({ ...current, filter }))}><span>{FILTER_LABELS[filter]}</span><strong class="tabular">{counts[filter]}</strong></button>)}</div><label class="onboarding-search"><span class="sr-only">Search speakers and sessions</span><input value={filters.search} onInput={(event) => updateFilters((current) => ({ ...current, search: (event.currentTarget as HTMLInputElement).value }))} placeholder="Search speaker, company, session" /></label></div>
        <div class="onboarding-board-filters"><label>Task type<select value={filters.taskType} onChange={(event) => updateFilters((current) => ({ ...current, taskType: (event.currentTarget as HTMLSelectElement).value }))}><option value="">All task types</option>{taskTypes.map((task) => <option value={task.id} key={task.id}>{task.name} · {task.count}</option>)}</select></label><label>Track<select value={filters.track} onChange={(event) => updateFilters((current) => ({ ...current, track: (event.currentTarget as HTMLSelectElement).value }))}><option value="">All tracks</option>{tracks.map((track) => <option value={track.id} key={track.id}>{track.name} · {track.count}</option>)}</select></label><span class="onboarding-filter-count tabular">{rows.length} shown of {matchingTotal} · {selectedRows.length} selected</span></div>
        {state.kind === "loading" ? <div class="onboarding-board-state">Reading live task state…</div> : null}
        {state.kind === "error" ? <div class="onboarding-board-state error"><strong>Chase board unavailable</strong><span>{state.message}</span></div> : null}
        {state.kind === "ready" && (hasActiveFilters ? rows.length === 0 : noAcceptedSpeakers || allAcceptedSpeakersClear || rows.length === 0) ? <EmptyState
          title={hasActiveFilters ? "No speakers match these filters" : noAcceptedSpeakers ? "No accepted speakers yet" : allAcceptedSpeakersClear ? "Nothing outstanding" : "No onboarding work is visible"}
          copy={hasActiveFilters ? "Adjust the filters to see speakers with outstanding conference tasks." : noAcceptedSpeakers ? "Tasks appear when the first acceptance lands. Open submissions to accept a speaker." : allAcceptedSpeakersClear ? "Every accepted speaker is clear. Completed and cancelled work remains in the record, while this board keeps only tasks the conference still owes." : "The live chase board has no rows to show yet. Open submissions to check the current pipeline."}
          action={hasActiveFilters ? <Button variant="primary" onClick={clearFilters}>Clear filters</Button> : noAcceptedSpeakers ? <Button variant="primary" onClick={() => navigate?.("/submissions")}>Open submissions</Button> : <Button variant="primary" onClick={() => navigate?.("/submissions?status=accepted_any")}>Open accepted speakers</Button>}
        /> : null}
        {state.kind === "ready" && rows.length > 0 && !hideBoardForTruthfulEmpty ? <><div class="onboarding-matrix-scroll-note" aria-live="polite"><strong class="tabular">{ready.task_templates.length}</strong><span>task column{ready.task_templates.length === 1 ? "" : "s"}{matrixOverflows && lastTaskColumn ? ` · scroll the grid sideways to reach “${lastTaskColumn.name}”` : ""}</span></div><div class="onboarding-matrix-wrap wide-grid-scroll" ref={matrixRef}><table class="onboarding-matrix wide-grid-content"><thead><tr><th class="onboarding-select-column wide-grid-pinned wide-grid-pinned-leading wide-grid-pinned-header"><input type="checkbox" aria-label="Select all visible speakers" checked={allVisibleSelected} onChange={toggleAll} /></th><th scope="col" class="onboarding-speaker-column wide-grid-pinned wide-grid-pinned-after-leading wide-grid-pinned-header">Speaker</th><th scope="col" class="onboarding-track-column">Track</th>{ready.task_templates.map((task) => <th scope="col" class="onboarding-task-column" key={task.id}><span title={task.description}>{task.name}</span></th>)}<th scope="col" class="onboarding-last-contact-column">Last contact</th><th class="onboarding-action-column" scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td class="onboarding-select-column wide-grid-pinned wide-grid-pinned-leading"><input type="checkbox" aria-label={`Select ${displayNames.get(row.person.id) ?? row.person.name}`} checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} /></td><th scope="row" class="onboarding-speaker-column wide-grid-pinned wide-grid-pinned-after-leading"><button class="onboarding-speaker-link" type="button" onClick={(event) => openDrawer({ kind: "speaker", personId: row.person.id }, event.currentTarget)}><SpeakerAvatar eventId={eventId} person={row.person} className="onboarding-row-avatar" /><span><strong>{displayNames.get(row.person.id) ?? row.person.name}</strong><small>{row.person.company || row.person.email} · {row.wave?.name ?? "No wave"} · {row.sessions.length} Session{row.sessions.length === 1 ? "" : "s"}</small><small>{row.tasks.every((task) => task.state === "unassigned") ? "No tasks assigned" : `${row.tasks.filter((task) => task.state !== "unassigned").length} of ${row.tasks.length} tasks assigned`}</small></span></button></th><td class="onboarding-track-column">{row.tracks.length > 0 ? row.tracks.map((track) => <span class="onboarding-track" key={track.id}><i style={{ backgroundColor: track.color }} aria-hidden="true" />{track.name}</span>) : <span class="onboarding-muted">No track</span>}</td>{ready.task_templates.map((task) => { const cell = row.cells[task.id] ?? { glyph: "—", state: "unassigned", title: task.name, due_at: null, owed: false }; return <td key={task.id} class={`onboarding-cell state-${cell.state}`}><span class="onboarding-glyph" aria-label={`${cell.title}: ${cell.state}`}>{cell.glyph}</span><small>{cell.state === "unassigned" || cell.state === "cancelled" ? "—" : cell.due_at === null ? "—" : formatDueDate(cell.due_at)}</small></td>; })}<td class="onboarding-last-contact">{formatDate(row.last_contact)}</td><td class="onboarding-action-column"><Button small aria-label={`Nudge ${displayNames.get(row.person.id) ?? row.person.name}`} onClick={(event) => selectForNudge(row, event)}>Nudge</Button></td></tr>)}</tbody></table></div></> : null}
        {state.kind === "ready" && (rows.length > 0 || page > 1) && !hideBoardForTruthfulEmpty ? <div class="onboarding-tablefoot"><span class="tabular">Showing {rows.length} of {matchingTotal} speakers</span><span class="onboarding-pager"><Button small disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><span class="onboarding-pager-label tabular">Page {ready.page ?? page} of {totalPages}</span><Button small disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button></span></div> : null}
      </section>
    </> : <div class="onboarding-loading-card card">{state.kind === "error" ? <><strong>Chase board unavailable</strong><span>{state.message}</span></> : "Reading the conference chase board…"}</div>}
    {drawer ? <div class="onboarding-drawer-layer"><button class="onboarding-drawer-backdrop" type="button" aria-label="Close drawer" onClick={() => setDrawer(null)} />{drawer.kind === "speaker" ? <SpeakerDrawer eventId={eventId} personId={drawer.personId} onClose={() => setDrawer(null)} /> : <ComposeDrawer eventId={eventId} rows={selectedRows} displayNames={displayNames} onClose={() => setDrawer(null)} />}</div> : null}
  </div>;
}
