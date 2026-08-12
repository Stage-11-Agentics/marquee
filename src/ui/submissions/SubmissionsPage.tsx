import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import type { SubmissionListItem, SubmissionTrackListItem } from "../../api/submissions";
import {
  DEFAULT_SUBMISSION_COLUMNS,
  SUBMISSION_COLUMN_REGISTRY,
  submissionColumn,
  submissionKindLabel,
  type SubmissionColumnId,
} from "../../lib/submission-columns";
import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, PageHeader } from "../shell/components";
import { selectionCount } from "./selection";
import "./submissions.css";

export interface ListEnvelope {
  data: SubmissionListItem[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

interface Props {
  eventId?: string;
  search: string;
  navigate: (target: string) => void;
  /** Deterministic SSR/test seam; production always loads through the API. */
  initialEnvelope?: ListEnvelope;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; envelope: ListEnvelope };

interface SavedView {
  id: string;
  name: string;
  built_in: boolean;
  config: {
    q: string;
    filters: Record<string, string>;
    sort: "newest" | "updated" | "title" | "score";
    columns: SubmissionColumnId[];
  };
  /** This view's own matching total — never the list currently on screen. */
  count: number | null;
  created_at: number | null;
  updated_at: number | null;
}

const STATUS_OPTIONS = [
  {
    label: "Stored decision facts",
    options: [
      ["draft", "Draft"],
      ["submitted", "Submitted"],
      ["in_review", "In review"],
      ["accepted_any", "Accepted (any stage)"],
      ["waitlisted", "Maybe"],
      ["rejected", "Rejected"],
      ["withdrawn", "Withdrawn"],
    ],
  },
  {
    label: "Pipeline stages",
    options: [
      ["unreviewed", "Unreviewed"],
      ["waved", "Waved"],
      ["onboarding", "Onboarding"],
      ["accepted", "Ready to place"],
      ["scheduled", "Scheduled"],
      ["published", "Published"],
    ],
  },
  {
    label: "Attention queue",
    options: [["not_notified", "Decided · not notified"]],
  },
] as const;

/**
 * The decision set the single-record Record Action card offers, in its words.
 * `notifies` is not cosmetic: a waitlist deliberately queues no mail, so the
 * confirm button must not promise a message this action will never send.
 */
const BULK_ACTIONS = [
  { action: "accept", label: "Accept", variant: "primary", question: "Accept", confirm: "Accept and notify", notifies: true },
  { action: "waitlist", label: "Maybe", variant: "", question: "Waitlist", confirm: "Waitlist", notifies: false },
  { action: "reject", label: "Reject", variant: "danger", question: "Reject", confirm: "Reject and notify", notifies: true },
] as const;

type BulkAction = (typeof BULK_ACTIONS)[number]["action"];

const SORT_OPTIONS = [
  ["newest", "Newest"],
  ["updated", "Recently updated"],
  ["score", "Score high → low"],
  ["title", "Title A → Z"],
] as const;

function statusLabel(status: SubmissionListItem["status"]): string {
  if (status === "waitlisted") return "Maybe";
  if (status === "in_review") return "In review";
  if (status === "unreviewed") return "Unreviewed";
  if (status === "accepted") return "Ready to place";
  return status[0]!.toUpperCase() + status.slice(1);
}

function formatMoment(value: number | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function slotLabel(item: SubmissionListItem): string | null {
  if (!item.slot) return null;
  const start = new Date(item.slot.starts_at);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: item.slot.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: item.slot.timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
  return `${day} · ${time} · ${item.slot.room}${item.slot.show_building ? ` · ${item.slot.building}` : ""}`;
}

function queryValue(params: URLSearchParams, key: string, fallback = ""): string {
  return params.get(key) ?? fallback;
}

function columnsWithTitle(columns: readonly SubmissionColumnId[]): SubmissionColumnId[] {
  const result = [...new Set(columns)];
  if (!result.includes("title")) result.splice(0, 0, "title");
  return result;
}

function storedColumns(eventId: string): SubmissionColumnId[] {
  if (typeof window === "undefined") return [...DEFAULT_SUBMISSION_COLUMNS];
  try {
    const value = JSON.parse(window.localStorage.getItem(`marquee.columns.${eventId}`) ?? "null") as unknown;
    if (!Array.isArray(value)) return [...DEFAULT_SUBMISSION_COLUMNS];
    const known = new Set(SUBMISSION_COLUMN_REGISTRY.map((column) => column.id));
    return columnsWithTitle(value.filter((column): column is SubmissionColumnId => typeof column === "string" && known.has(column as SubmissionColumnId)));
  } catch {
    return [...DEFAULT_SUBMISSION_COLUMNS];
  }
}

function viewConfigFromParams(params: URLSearchParams, columns: SubmissionColumnId[]): SavedView["config"] {
  const filters: Record<string, string> = {};
  for (const key of ["kind", "status", "track", "format", "wave", "task", "placement"]) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  return {
    q: params.get("q") ?? "",
    filters,
    sort: (params.get("sort") as SavedView["config"]["sort"] | null) ?? "newest",
    columns: columnsWithTitle(columns),
  };
}

function Cell({ item, column, navigate }: { item: SubmissionListItem; column: SubmissionColumnId; navigate: (target: string) => void }): JSX.Element {
  if (column === "type") return <span class={`chip entity-chip ${item.kind}`}>{submissionKindLabel(item.kind)}</span>;
  if (column === "id") return <strong class="tabular">{item.id}</strong>;
  if (column === "title") {
    const slot = slotLabel(item);
    return <>
      <a class="table-title" href={`/submissions/${item.id}`} title={item.title} onClick={(event) => { event.preventDefault(); navigate(`/submissions/${item.id}`); }}>{item.title}</a>
      <span class="row-meta">{item.id} · {item.origin}</span>
      {item.submitter && <span class="row-meta">{item.submitter.name} · {item.submitter.email}</span>}
      {slot && <span class="slot-row"><span class="chip slot-chip">{slot}</span>{!item.slot?.is_published && <span class="chip not-public">Not yet public</span>}</span>}
    </>;
  }
  if (column === "speakers") {
    const [first, ...rest] = item.speakers;
    return <span title={item.speakers.map((speaker) => speaker.name).join(", ")}>{first ? `${first.name}${rest.length ? ` +${rest.length}` : ""}` : "—"}</span>;
  }
  if (column === "status") return <span class={`chip status-chip ${item.status}`}>{statusLabel(item.status)}</span>;
  if (column === "notified") return item.notified
    ? <span class={`notification-state ${item.notified.state}`} title={item.notified.detail}><strong>{item.notified.label}</strong><small>{item.notified.detail}</small></span>
    : <span class="subtle">—</span>;
  if (column === "tracks") return <span class="track-chips">{item.tracks.length ? item.tracks.map((track) => <span key={track.id} class="chip track-chip" style={{ borderLeftColor: track.color }} title={track.is_primary ? "Primary track" : "Additional track"}>{track.name}{track.is_primary ? " · Primary" : ""}</span>) : "—"}</span>;
  if (column === "score") return <span class="tabular">{item.score === null ? "—" : item.score.toFixed(2)}</span>;
  if (column === "submitted") return <span class="tabular">{item.status === "draft" ? "Not submitted" : formatMoment(item.submitted_at)}</span>;
  if (column === "updated") return <span class="tabular">{formatMoment(item.last_saved_at ?? item.updated_at)}</span>;
  if (column === "origin") return <span>{item.origin[0]!.toUpperCase() + item.origin.slice(1)}</span>;
  if (column === "missing") return item.missing_fields.length ? <span class="draft-warning">{item.missing_fields.join(" · ")}</span> : <span class="subtle">—</span>;
  return <span>—</span>;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function SubmissionsPage({
  eventId = "evt_aie-ny-2026",
  search,
  navigate,
  initialEnvelope,
}: Props): JSX.Element {
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const [state, setState] = useState<LoadState>(initialEnvelope ? { kind: "ready", envelope: initialEnvelope } : { kind: "loading" });
  const [searchDraft, setSearchDraft] = useState(queryValue(params, "q"));
  const [knownTracks, setKnownTracks] = useState<Map<string, SubmissionTrackListItem>>(new Map());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [columns, setColumns] = useState<SubmissionColumnId[]>(() => storedColumns(eventId));
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState("all-submissions");
  const [viewsLoading, setViewsLoading] = useState(true);
  const [viewsError, setViewsError] = useState("");
  const [viewBusy, setViewBusy] = useState(false);
  const [columnPanelOpen, setColumnPanelOpen] = useState(false);
  const [notifiedSummary, setNotifiedSummary] = useState<{ total: number; sendable: number; no_valid_address: number } | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [notifyMessage, setNotifyMessage] = useState("");
  const [notifyError, setNotifyError] = useState("");
  const [bulkRequest, setBulkRequest] = useState<BulkAction | null>(null);
  const [bulkFeedback, setBulkFeedback] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkError, setBulkError] = useState("");

  const page = Number(queryValue(params, "page", "1"));
  const status = queryValue(params, "status");
  const kind = queryValue(params, "kind");
  const track = queryValue(params, "track");
  const format = queryValue(params, "format");
  const wave = queryValue(params, "wave");
  const task = queryValue(params, "task");
  const placement = queryValue(params, "placement");
  const sort = queryValue(params, "sort", "newest");
  const q = queryValue(params, "q");
  const queryIdentity = `${q}\u0000${status}\u0000${kind}\u0000${track}\u0000${format}\u0000${wave}\u0000${task}\u0000${placement}\u0000${sort}`;
  const draftQueue = status === "draft";
  const notifiedQueue = status === "not_notified";

  useEffect(() => {
    setColumns(storedColumns(eventId));
  }, [eventId]);

  useEffect(() => {
    const controller = new AbortController();
    setViewsLoading(true);
    setViewsError("");
    apiFetch<{ data: SavedView[] }>(`/api/v1/events/${encodeURIComponent(eventId)}/views`, {
      signal: controller.signal,
      route: "/api/v1/events/{eventId}/views",
    })
      .then((body) => {
        setViews(body.data);
        setActiveViewId((current) => notifiedQueue
          ? "decided-not-notified"
          : draftQueue
            ? "drafts-needing-attention"
            : current === "drafts-needing-attention" || current === "decided-not-notified" ? "all-submissions" : current);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setViewsError(errorSummary(error));
      })
      .finally(() => { if (!controller.signal.aborted) setViewsLoading(false); });
    return () => controller.abort();
    // reloadKey: a bulk decision moves records between views, so their badge
    // counts are re-read with the list rather than left stale on screen.
  }, [eventId, draftQueue, notifiedQueue, reloadKey]);

  useEffect(() => {
    if (notifiedQueue) setActiveViewId("decided-not-notified");
    else if (draftQueue) setActiveViewId("drafts-needing-attention");
    else if (activeViewId === "drafts-needing-attention" || activeViewId === "decided-not-notified") setActiveViewId("all-submissions");
  }, [draftQueue, notifiedQueue, activeViewId]);

  useEffect(() => {
    if (!notifiedQueue) {
      setNotifiedSummary(null);
      setNotifyMessage("");
      setNotifyError("");
      return;
    }
    const controller = new AbortController();
    apiFetch<{ total: number; sendable: number; no_valid_address: number }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/submissions/not-notified/summary`,
      { signal: controller.signal, route: "/api/v1/events/{eventId}/submissions/not-notified/summary" },
    )
      .then(setNotifiedSummary)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setNotifyError(errorSummary(error));
      });
    return () => controller.abort();
  }, [eventId, notifiedQueue, reloadKey]);

  const updateQuery = (updates: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === "" || value === 1 && key === "page") next.delete(key);
      else next.set(key, String(value));
    }
    navigate(`/submissions${next.size ? `?${next.toString()}` : ""}`);
  };

  const persistColumns = (next: SubmissionColumnId[]) => {
    const normalized = columnsWithTitle(next);
    setColumns(normalized);
    try { window.localStorage.setItem(`marquee.columns.${eventId}`, JSON.stringify(normalized)); } catch { /* storage is an enhancement, not the source of truth */ }
  };

  const applyView = (view: SavedView) => {
    const next = new URLSearchParams();
    if (view.config.q) next.set("q", view.config.q);
    for (const [key, value] of Object.entries(view.config.filters)) if (value) next.set(key, value);
    if (view.config.sort !== "newest") next.set("sort", view.config.sort);
    persistColumns(view.config.columns);
    setActiveViewId(view.id);
    navigate(`/submissions${next.size ? `?${next.toString()}` : ""}`);
  };

  const saveCurrentView = async () => {
    const existing = views.find((view) => view.id === activeViewId && !view.built_in);
    const name = existing?.name ?? window.prompt("Name this conference view");
    if (!name?.trim()) return;
    setViewBusy(true);
    setViewsError("");
    try {
      const viewUrl = existing
        ? `/api/v1/events/${encodeURIComponent(eventId)}/views/${encodeURIComponent(existing.id)}`
        : `/api/v1/events/${encodeURIComponent(eventId)}/views`;
      const view = await apiFetch<SavedView>(viewUrl, {
        method: existing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), config: viewConfigFromParams(params, columns) }),
        route: existing ? "/api/v1/events/{eventId}/views/{viewId}" : "/api/v1/events/{eventId}/views",
      });
      setViews((current) => [...current.filter((item) => item.id !== view.id), view]);
      setActiveViewId(view.id);
    } catch (error: unknown) {
      setViewsError(errorSummary(error));
    } finally { setViewBusy(false); }
  };

  const renameView = async (view: SavedView) => {
    const name = window.prompt("Rename this conference view", view.name);
    if (!name?.trim() || name.trim() === view.name) return;
    setViewBusy(true);
    try {
      const updated = await apiFetch<SavedView>(`/api/v1/events/${encodeURIComponent(eventId)}/views/${encodeURIComponent(view.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
        route: "/api/v1/events/{eventId}/views/{viewId}",
      });
      setViews((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error: unknown) {
      setViewsError(errorSummary(error));
    } finally { setViewBusy(false); }
  };

  const deleteView = async (view: SavedView) => {
    if (!window.confirm(`Delete “${view.name}”?`)) return;
    setViewBusy(true);
    try {
      await apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/views/${encodeURIComponent(view.id)}`, {
        method: "DELETE",
        route: "/api/v1/events/{eventId}/views/{viewId}",
      });
      setViews((current) => current.filter((item) => item.id !== view.id));
      if (activeViewId === view.id) setActiveViewId("all-submissions");
    } catch (error: unknown) {
      setViewsError(errorSummary(error));
    } finally { setViewBusy(false); }
  };

  const toggleColumn = (column: SubmissionColumnId, checked: boolean) => {
    if (column === "title") return;
    persistColumns(checked ? [...columns, column] : columns.filter((item) => item !== column));
  };

  const moveColumn = (column: SubmissionColumnId, direction: -1 | 1) => {
    const index = columns.indexOf(column);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= columns.length) return;
    const next = [...columns];
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    persistColumns(next);
  };

  useEffect(() => setSearchDraft(q), [q]);
  useEffect(() => {
    setSelectedIds(new Set());
    setAllMatching(false);
    setBulkRequest(null);
    setBulkMessage("");
    setBulkError("");
  }, [queryIdentity]);

  useEffect(() => {
    if (initialEnvelope) return;
    const controller = new AbortController();
    const apiQuery = new URLSearchParams(params);
    apiQuery.set("per_page", "50");
    setState({ kind: "loading" });
    apiFetch<ListEnvelope>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions?${apiQuery.toString()}`, {
      signal: controller.signal,
      route: "/api/v1/events/{eventId}/submissions",
    })
      .then((envelope) => {
        setKnownTracks((current) => {
          const next = new Map(current);
          for (const item of envelope.data) for (const itemTrack of item.tracks) next.set(itemTrack.id, itemTrack);
          return next;
        });
        setState({ kind: "ready", envelope });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: errorSummary(error) });
      });
    return () => controller.abort();
  }, [eventId, search, reloadKey, initialEnvelope]);

  const envelope = state.kind === "ready" ? state.envelope : null;
  const rows = envelope?.data ?? [];
  const selectedCount = selectionCount(selectedIds, allMatching, envelope?.total ?? 0);
  const first = envelope && envelope.total > 0 ? (envelope.page - 1) * envelope.per_page + 1 : 0;
  const last = envelope ? Math.min(envelope.page * envelope.per_page, envelope.total) : 0;

  const togglePage = (checked: boolean) => {
    setAllMatching(false);
    setSelectedIds(checked ? new Set(rows.map((item) => item.id)) : new Set());
  };
  const toggleRow = (id: string, checked: boolean) => {
    setAllMatching(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const exportMatching = async () => {
    setExporting(true);
    setExportError("");
    try {
      const exportParams = new URLSearchParams(params);
      exportParams.set("per_page", "100");
      exportParams.set("page", "1");
      const exported: SubmissionListItem[] = [];
      let totalPages = 1;
      for (let exportPage = 1; exportPage <= totalPages; exportPage += 1) {
        exportParams.set("page", String(exportPage));
        const result = await apiFetch<ListEnvelope>(
          `/api/v1/events/${encodeURIComponent(eventId)}/submissions?${exportParams.toString()}`,
          { route: "/api/v1/events/{eventId}/submissions" },
        );
        exported.push(...result.data);
        totalPages = result.total_pages;
      }
      const header = ["Type", "ID", "Title", "Speakers", "Status", "Tracks", "Score", "Submitted", "Last updated", "Origin"];
      const lines = [header.map(csvCell).join(","), ...exported.map((item) => [
        submissionKindLabel(item.kind), item.id, item.title,
        item.speakers.map((speaker) => speaker.name).join("; "), statusLabel(item.status),
        item.tracks.map((itemTrack) => itemTrack.name).join("; "), item.score,
        item.submitted_at, item.updated_at, item.origin,
      ].map(csvCell).join(","))];
      const url = URL.createObjectURL(new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "marquee-submissions.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      setExportError(errorSummary(error));
    } finally {
      setExporting(false);
    }
  };

  /**
   * "Select all N matching" is a promise about records this page has never
   * loaded, so it travels as the filter itself and the server resolves it —
   * the 50 rows in the DOM are never mistaken for the selection.
   */
  const bulkSelector = (): { ids: string[] } | { filter: Record<string, string> } => {
    if (!allMatching) return { ids: [...selectedIds] };
    const filter: Record<string, string> = {};
    for (const key of ["kind", "status", "track", "format", "wave", "task", "placement", "q"]) {
      const value = params.get(key);
      if (value) filter[key] = value;
    }
    return { filter };
  };

  const runBulk = async (action: BulkAction) => {
    setBulkBusy(true);
    setBulkError("");
    setBulkMessage("");
    try {
      const result = await apiFetch<{ succeeded: number; failed: number; outbox_enqueued: number }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/submissions/bulk`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            selector: bulkSelector(),
            action,
            ...(bulkFeedback.trim() ? { feedback_md: bulkFeedback.trim() } : {}),
          }),
          route: "/api/v1/events/{eventId}/submissions/bulk",
        },
      );
      const verb = action === "waitlist" ? "waitlisted" : action === "accept" ? "accepted" : "rejected";
      setBulkMessage(`${result.succeeded.toLocaleString()} ${verb}${result.failed ? ` · ${result.failed.toLocaleString()} could not move` : ""}${result.outbox_enqueued ? ` · ${result.outbox_enqueued.toLocaleString()} notification${result.outbox_enqueued === 1 ? "" : "s"} queued` : ""}.`);
      setBulkRequest(null);
      setBulkFeedback("");
      setSelectedIds(new Set());
      setAllMatching(false);
      setReloadKey((value) => value + 1);
    } catch (error: unknown) {
      setBulkError(errorSummary(error));
    } finally {
      setBulkBusy(false);
    }
  };

  const notifySpeakers = async () => {
    setNotifying(true);
    setNotifyMessage("");
    setNotifyError("");
    try {
      const result = await apiFetch<{ queued: number; skipped_no_address: number }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/submissions/not-notified/notify`,
        { method: "POST", route: "/api/v1/events/{eventId}/submissions/not-notified/notify" },
      );
      setNotifyMessage(`${result.queued.toLocaleString()} notification${result.queued === 1 ? "" : "s"} queued${result.skipped_no_address ? ` · ${result.skipped_no_address.toLocaleString()} need an address first` : ""}.`);
      setReloadKey((value) => value + 1);
    } catch (error: unknown) {
      setNotifyError(errorSummary(error));
    } finally {
      setNotifying(false);
    }
  };

  const activeView = views.find((view) => view.id === activeViewId);
  const orderedColumns = [...columns, ...SUBMISSION_COLUMN_REGISTRY.map((column) => column.id).filter((column) => !columns.includes(column))];
  const singleVenueName = rows.find((item) => item.slot && !item.slot.show_building)?.slot?.building ?? null;
  return <div class="submissions-page">
    <PageHeader
      title={notifiedQueue ? "Decided · not notified" : draftQueue ? "Drafts needing attention" : "Abstracts & sessions"}
      copy={envelope ? notifiedQueue
        ? `${envelope.total.toLocaleString()} decisions need attention · ${notifiedSummary?.sendable.toLocaleString() ?? "—"} can be notified now · ${notifiedSummary?.no_valid_address.toLocaleString() ?? "—"} need an address first.`
        : `${singleVenueName ? `${singleVenueName}. ` : ""}${envelope.total.toLocaleString()} ${draftQueue ? "drafts needing attention" : "matching records"} · rendered 50 at a time for an instant response at full scale.`
        : "Loading the conference submission register…"}
      actions={<><button class="button export-button" disabled={exporting} onClick={exportMatching}>{exporting ? "Exporting…" : "Export"}</button>{notifiedQueue ? <Button variant="primary" disabled={notifying || notifiedSummary?.sendable === 0} onClick={() => void notifySpeakers()}>{notifying ? "Queuing…" : `Notify ${notifiedSummary?.sendable.toLocaleString() ?? "—"} speakers`}</Button> : <Button variant="primary" onClick={() => navigate("/submissions/new")}>+ Add session</Button>}</>}
    />
    <div class={`export-message ${exportError ? "visible" : ""}`} role="status">{exportError || "Export status space reserved"}</div>
    {notifiedQueue && <div class={`notify-message ${notifyError || notifyMessage ? "visible" : ""}`} role="status">{notifyError || notifyMessage || "Notification status space reserved"}</div>}
    <section class="card table-card" aria-busy={state.kind === "loading"}>
      <div class="saved-view-strip" aria-label="Saved conference views">
        <span class="eyebrow">Views</span>
        <div class="saved-view-chips">
          {views.map((view) => <span class={`saved-view-chip ${activeViewId === view.id ? "active" : ""}`} key={view.id}>
            <button type="button" onClick={() => applyView(view)} disabled={viewBusy}>{view.name}{view.count !== null && <span class="tabular view-count">{view.count.toLocaleString()}</span>}</button>
            {!view.built_in && <><button type="button" class="view-icon-button" aria-label={`Rename ${view.name}`} onClick={() => void renameView(view)} disabled={viewBusy}>✎</button><button type="button" class="view-icon-button" aria-label={`Delete ${view.name}`} onClick={() => void deleteView(view)} disabled={viewBusy}>×</button></>}
          </span>)}
          {!viewsLoading && views.length === 0 && <span class="subtle">No saved views yet.</span>}
        </div>
        <span class="toolbar-spacer" />
        <Button small onClick={() => void saveCurrentView()} disabled={viewBusy}>Save current view</Button>
        <Button small onClick={() => setColumnPanelOpen((open) => !open)} aria-expanded={columnPanelOpen}>{columnPanelOpen ? "Hide columns" : "Columns"}</Button>
      </div>
      <div class={`saved-view-message ${viewsError ? "visible" : ""}`} role="status">{viewsError || "Saved view status space reserved"}</div>
      {columnPanelOpen && <div class="column-panel" aria-label="Configure submission columns">
        <div class="column-panel-heading"><div><strong>Columns</strong><span>Title is always visible. Changes stay reserved in this frame and persist for this conference.</span></div><span class="tabular">{columns.length} / {SUBMISSION_COLUMN_REGISTRY.length}</span></div>
        <div class="column-list">{orderedColumns.map((column) => {
          const position = columns.indexOf(column);
          const visible = position >= 0;
          return <div class={`column-option ${visible ? "visible" : "hidden"}`} key={column}>
            <label><input type="checkbox" checked={visible} disabled={column === "title"} onChange={(event) => toggleColumn(column, event.currentTarget.checked)} /><span>{submissionColumn(column).label}</span></label>
            <span class="column-arrows"><button type="button" class="button tiny" aria-label={`Move ${submissionColumn(column).label} left`} disabled={!visible || position === 0} onClick={() => moveColumn(column, -1)}>←</button><button type="button" class="button tiny" aria-label={`Move ${submissionColumn(column).label} right`} disabled={!visible || position === columns.length - 1} onClick={() => moveColumn(column, 1)}>→</button></span>
          </div>;
        })}</div>
        {activeView && !activeView.built_in && <span class="column-panel-note">Save current view again to capture this column order in “{activeView.name}”.</span>}
      </div>}
      <form class="submissions-toolbar" onSubmit={(event) => { event.preventDefault(); updateQuery({ q: searchDraft.trim(), page: 1 }); }}>
        <label class="search-field"><span class="sr-only">Search submissions</span><input value={searchDraft} onInput={(event) => setSearchDraft(event.currentTarget.value)} placeholder="Search 1,000 submissions…" /><button class="button small" type="submit">Search</button></label>
        <label><span class="sr-only">Status</span><select class={`status-filter ${status ? "has-selection" : "is-default"}`} value={status} onChange={(event) => updateQuery({ status: event.currentTarget.value, page: 1 })}><option value="">All statuses</option>{STATUS_OPTIONS.map((group) => <optgroup label={group.label}>{group.options.map(([value, label]) => <option value={value}>{label}</option>)}</optgroup>)}</select></label>
        <label><span class="sr-only">Type</span><select value={kind} onChange={(event) => updateQuery({ kind: event.currentTarget.value, page: 1 })}><option value="">All types</option><option value="abstract">Abstract</option><option value="session">Session</option></select></label>
        <label><span class="sr-only">Track</span><select value={track} onChange={(event) => updateQuery({ track: event.currentTarget.value, page: 1 })}><option value="">All tracks</option>{[...knownTracks.values()].sort((left, right) => left.name.localeCompare(right.name)).map((itemTrack) => <option value={itemTrack.id}>{itemTrack.name}</option>)}</select></label>
        <span class="toolbar-spacer" />
        <label><span class="sr-only">Sort</span><select value={sort} onChange={(event) => updateQuery({ sort: event.currentTarget.value, page: 1 })}>{SORT_OPTIONS.map(([value, label]) => <option value={value}>{label}</option>)}</select></label>
      </form>

      <div class={`selection-bar ${selectedCount ? "visible" : ""}`} aria-live="polite">
        {selectedCount ? <><strong class="tabular">{selectedCount.toLocaleString()} selected</strong>{!allMatching && envelope && selectedCount < envelope.total ? <Button small onClick={() => setAllMatching(true)}>Select all {envelope.total.toLocaleString()} matching</Button> : <span>All matching records selected</span>}<span class="toolbar-spacer" /><span class="selection-actions">{BULK_ACTIONS.map((option) => <Button key={option.action} small variant={option.variant} disabled={bulkBusy} onClick={() => { setBulkRequest(option.action); setBulkFeedback(""); setBulkError(""); }}>{option.label}</Button>)}</span></> : <span aria-hidden="true">Selection space reserved</span>}
      </div>
      <div class={`bulk-message ${bulkError || bulkMessage ? "visible" : ""}`} role="status">{bulkError || bulkMessage || "Bulk action status space reserved"}</div>
      {bulkRequest && (() => {
        const option = BULK_ACTIONS.find((entry) => entry.action === bulkRequest)!;
        const scope = allMatching ? "matching records" : selectedCount === 1 ? "record" : "records";
        return <div class="bulk-decision-dialog" role="group" aria-labelledby="bulk-decision-heading">
          <div class="bulk-decision-dialog-head">
            <div><span class="eyebrow">Confirm bulk action</span><h2 id="bulk-decision-heading">{option.question} {selectedCount.toLocaleString()} {scope}?</h2></div>
            <button type="button" aria-label="Close bulk decision dialog" onClick={() => setBulkRequest(null)}>×</button>
          </div>
          <p>The decision is written on every selected record. {option.notifies ? "The same normalized feedback is saved on each decision row and rendered through the standard conference email." : "A waitlist is not announced: the feedback is saved on each decision row, and no message is queued."}</p>
          <label class="field"><span>Feedback for the speakers (optional)</span><textarea rows={5} value={bulkFeedback} onInput={(event) => setBulkFeedback(event.currentTarget.value)} placeholder="Share context every one of these speakers can act on." /></label>
          <div class="bulk-decision-actions">
            <Button type="button" onClick={() => setBulkRequest(null)} disabled={bulkBusy}>Cancel</Button>
            <Button type="button" variant={option.variant} disabled={bulkBusy} onClick={() => void runBulk(option.action)}>{bulkBusy ? "Saving…" : `${option.confirm} ${selectedCount.toLocaleString()}`}</Button>
          </div>
        </div>;
      })()}

      <div class="submissions-table-wrap">
        <table class="submissions-table">
          <thead><tr><th class="check-col"><input type="checkbox" aria-label="Select visible rows" checked={rows.length > 0 && rows.every((item) => allMatching || selectedIds.has(item.id))} onChange={(event) => togglePage(event.currentTarget.checked)} /></th>{columns.map((column) => <th class={`${column}-col`}>{submissionColumn(column).label}</th>)}</tr></thead>
          <tbody>
            {state.kind === "loading" && <tr class="state-row"><td colSpan={columns.length + 1}><strong>{notifiedQueue ? "Loading notification gaps…" : draftQueue ? "Loading drafts…" : "Loading submissions…"}</strong><span>Reading the exact filtered slice from D1.</span></td></tr>}
            {state.kind === "error" && <tr class="state-row error"><td colSpan={columns.length + 1}><strong>{notifiedQueue ? "Notification gaps did not load" : draftQueue ? "Drafts did not load" : "Submissions did not load"}</strong><span>{state.message}</span><Button small onClick={() => setReloadKey((value) => value + 1)}>Retry</Button></td></tr>}
            {envelope && rows.length === 0 && <tr class="state-row"><td colSpan={columns.length + 1}><strong>{notifiedQueue ? "Every decision has reached its speaker" : draftQueue ? "No drafts need attention" : envelope.total === 0 && !q && !status && !kind && !track && !format && !wave && !task && !placement ? "No submissions yet" : "No matching records"}</strong><span>{notifiedQueue ? "The notification gap is clear." : draftQueue ? "Every draft is complete for the fields its submitter can see." : envelope.total === 0 && !q && !status && !kind && !track && !format && !wave && !task && !placement ? "This conference is ready for its first Abstract or Session." : "Clear a filter to bring records back into view."}</span>{notifiedQueue || draftQueue ? <Button small onClick={() => navigate("/submissions")}>View all submissions</Button> : q || status || kind || track || format || wave || task || placement ? <Button small onClick={() => navigate("/submissions")}>Clear filters</Button> : <Button small onClick={() => navigate("/submissions/new")}>+ Add session</Button>}</td></tr>}
            {rows.map((item) => <tr class="submission-row" key={item.id} onClick={(event) => { const target = event.target as HTMLElement; if (!target.closest("a,input,button,select")) navigate(`/submissions/${item.id}`); }}>
              <td class="check-col"><input type="checkbox" aria-label={`Select ${item.id}`} checked={allMatching || selectedIds.has(item.id)} onChange={(event) => toggleRow(item.id, event.currentTarget.checked)} /></td>
              {columns.map((column) => <td class={`${column}-col`}><Cell item={item} column={column} navigate={navigate} /></td>)}
            </tr>)}
          </tbody>
        </table>
      </div>
      <footer class="submissions-pagination">
        <span class="tabular">{envelope ? `Showing ${first}–${last} of ${envelope.total.toLocaleString()}` : "Showing —"}</span>
        <span class="page-buttons"><button class="button small" disabled={!envelope || envelope.page <= 1} onClick={() => updateQuery({ page: page - 1 })}>Previous</button><span class="button small static-page tabular">{envelope ? `${envelope.page} / ${Math.max(1, envelope.total_pages)}` : "— / —"}</span><button class="button small" disabled={!envelope || envelope.page >= envelope.total_pages} onClick={() => updateQuery({ page: page + 1 })}>Next</button></span>
      </footer>
    </section>
  </div>;
}
