import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import type { SubmissionListItem, SubmissionTrackListItem } from "../../api/submissions";
import {
  DEFAULT_SUBMISSION_COLUMNS,
  submissionColumn,
  submissionKindLabel,
  type SubmissionColumnId,
} from "../../lib/submission-columns";
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

const STATUS_OPTIONS = [
  ["", "All statuses"],
  ["draft", "Draft"],
  ["submitted", "Submitted"],
  ["in_review", "In review"],
  ["unreviewed", "Unreviewed"],
  ["waved", "Waved"],
  ["onboarding", "Onboarding"],
  ["accepted", "Accepted"],
  ["waitlisted", "Maybe"],
  ["rejected", "Rejected"],
  ["withdrawn", "Withdrawn"],
  ["scheduled", "Scheduled"],
  ["published", "Published"],
] as const;

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
  return `${day} · ${time} · ${item.slot.room}`;
}

function queryValue(params: URLSearchParams, key: string, fallback = ""): string {
  return params.get(key) ?? fallback;
}

function Cell({ item, column, navigate }: { item: SubmissionListItem; column: SubmissionColumnId; navigate: (target: string) => void }): JSX.Element {
  if (column === "type") return <span class={`chip entity-chip ${item.kind}`}>{submissionKindLabel(item.kind)}</span>;
  if (column === "id") return <strong class="tabular">{item.id}</strong>;
  if (column === "title") {
    const slot = slotLabel(item);
    return <>
      <a class="table-title" href={`/submissions/${item.id}`} title={item.title} onClick={(event) => { event.preventDefault(); navigate(`/submissions/${item.id}`); }}>{item.title}</a>
      <span class="row-meta">{item.id} · {item.origin}</span>
      {slot && <span class="slot-row"><span class="chip slot-chip">{slot}</span>{!item.slot?.is_published && <span class="chip not-public">Not yet public</span>}</span>}
    </>;
  }
  if (column === "speakers") {
    const [first, ...rest] = item.speakers;
    return <span title={item.speakers.map((speaker) => speaker.name).join(", ")}>{first ? `${first.name}${rest.length ? ` +${rest.length}` : ""}` : "—"}</span>;
  }
  if (column === "status") return <span class={`chip status-chip ${item.status}`}>{statusLabel(item.status)}</span>;
  if (column === "tracks") return <span class="track-chips">{item.tracks.length ? item.tracks.map((track) => <span key={track.id} class="chip track-chip" style={{ borderLeftColor: track.color }} title={track.is_primary ? "Primary track" : "Additional track"}>{track.name}{track.is_primary ? " · Primary" : ""}</span>) : "—"}</span>;
  if (column === "score") return <span class="tabular">{item.score === null ? "—" : item.score.toFixed(2)}</span>;
  if (column === "submitted") return <span class="tabular">{item.status === "draft" ? "Not submitted" : formatMoment(item.submitted_at)}</span>;
  if (column === "updated") return <span class="tabular">{formatMoment(item.updated_at)}</span>;
  if (column === "origin") return <span>{item.origin[0]!.toUpperCase() + item.origin.slice(1)}</span>;
  if (column === "missing") return item.missing_fields.length ? <span class="draft-warning">{item.missing_fields.join(" · ")}</span> : <span class="subtle">Complete</span>;
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

  const updateQuery = (updates: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === "" || value === 1 && key === "page") next.delete(key);
      else next.set(key, String(value));
    }
    navigate(`/submissions${next.size ? `?${next.toString()}` : ""}`);
  };

  useEffect(() => setSearchDraft(q), [q]);
  useEffect(() => {
    setSelectedIds(new Set());
    setAllMatching(false);
  }, [queryIdentity]);

  useEffect(() => {
    if (initialEnvelope) return;
    const controller = new AbortController();
    const apiQuery = new URLSearchParams(params);
    apiQuery.set("per_page", "50");
    setState({ kind: "loading" });
    fetch(`/api/v1/events/${encodeURIComponent(eventId)}/submissions?${apiQuery.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`The list request failed (${response.status}).`);
        return response.json() as Promise<ListEnvelope>;
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
        setState({ kind: "error", message: error instanceof Error ? error.message : "The list could not be loaded." });
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
        const response = await fetch(`/api/v1/events/${encodeURIComponent(eventId)}/submissions?${exportParams.toString()}`);
        if (!response.ok) throw new Error(`Export failed (${response.status}).`);
        const result = await response.json() as ListEnvelope;
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
      setExportError(error instanceof Error ? error.message : "The export could not be created.");
    } finally {
      setExporting(false);
    }
  };

  return <div class="submissions-page">
    <PageHeader
      title="Abstracts & sessions"
      copy={envelope ? `${envelope.total.toLocaleString()} matching records · rendered 50 at a time for an instant response at full scale.` : "Loading the conference submission register…"}
      actions={<><button class="button export-button" disabled={exporting} onClick={exportMatching}>{exporting ? "Exporting…" : "Export"}</button><Button variant="primary" onClick={() => navigate("/submissions/new")}>+ Add session</Button></>}
    />
    <div class={`export-message ${exportError ? "visible" : ""}`} role="status">{exportError || "Export status space reserved"}</div>
    <section class="card table-card" aria-busy={state.kind === "loading"}>
      <form class="submissions-toolbar" onSubmit={(event) => { event.preventDefault(); updateQuery({ q: searchDraft.trim(), page: 1 }); }}>
        <label class="search-field"><span class="sr-only">Search submissions</span><input value={searchDraft} onInput={(event) => setSearchDraft(event.currentTarget.value)} placeholder="Search 1,000 submissions…" /><button class="button small" type="submit">Search</button></label>
        <label><span class="sr-only">Status</span><select value={status} onChange={(event) => updateQuery({ status: event.currentTarget.value, page: 1 })}>{STATUS_OPTIONS.map(([value, label]) => <option value={value}>{label}</option>)}</select></label>
        <label><span class="sr-only">Type</span><select value={kind} onChange={(event) => updateQuery({ kind: event.currentTarget.value, page: 1 })}><option value="">All types</option><option value="abstract">Abstract</option><option value="session">Session</option></select></label>
        <label><span class="sr-only">Track</span><select value={track} onChange={(event) => updateQuery({ track: event.currentTarget.value, page: 1 })}><option value="">All tracks</option>{[...knownTracks.values()].sort((left, right) => left.name.localeCompare(right.name)).map((itemTrack) => <option value={itemTrack.id}>{itemTrack.name}</option>)}</select></label>
        <span class="toolbar-spacer" />
        <label><span class="sr-only">Sort</span><select value={sort} onChange={(event) => updateQuery({ sort: event.currentTarget.value, page: 1 })}>{SORT_OPTIONS.map(([value, label]) => <option value={value}>{label}</option>)}</select></label>
      </form>

      <div class={`selection-bar ${selectedCount ? "visible" : ""}`} aria-live="polite">
        {selectedCount ? <><strong class="tabular">{selectedCount.toLocaleString()} selected</strong>{!allMatching && envelope && selectedCount < envelope.total ? <Button small onClick={() => setAllMatching(true)}>Select all {envelope.total.toLocaleString()} matching</Button> : <span>All matching records selected</span>}<span class="toolbar-spacer" /><span>Bulk actions land on the exact matching selector.</span></> : <span aria-hidden="true">Selection space reserved</span>}
      </div>

      <div class="submissions-table-wrap">
        <table class="submissions-table">
          <thead><tr><th class="check-col"><input type="checkbox" aria-label="Select visible rows" checked={rows.length > 0 && rows.every((item) => allMatching || selectedIds.has(item.id))} onChange={(event) => togglePage(event.currentTarget.checked)} /></th>{DEFAULT_SUBMISSION_COLUMNS.map((column) => <th class={`${column}-col`}>{submissionColumn(column).label}</th>)}</tr></thead>
          <tbody>
            {state.kind === "loading" && <tr class="state-row"><td colSpan={DEFAULT_SUBMISSION_COLUMNS.length + 1}><strong>Loading submissions…</strong><span>Reading the exact filtered slice from D1.</span></td></tr>}
            {state.kind === "error" && <tr class="state-row error"><td colSpan={DEFAULT_SUBMISSION_COLUMNS.length + 1}><strong>Submissions did not load</strong><span>{state.message}</span><Button small onClick={() => setReloadKey((value) => value + 1)}>Retry</Button></td></tr>}
            {envelope && rows.length === 0 && <tr class="state-row"><td colSpan={DEFAULT_SUBMISSION_COLUMNS.length + 1}><strong>{envelope.total === 0 && !q && !status && !kind && !track && !format && !wave && !task && !placement ? "No submissions yet" : "No matching records"}</strong><span>{envelope.total === 0 && !q && !status && !kind && !track && !format && !wave && !task && !placement ? "This conference is ready for its first Abstract or Session." : "Clear a filter to bring records back into view."}</span>{(q || status || kind || track || format || wave || task || placement) && <Button small onClick={() => navigate("/submissions")}>Clear filters</Button>}</td></tr>}
            {rows.map((item) => <tr class="submission-row" key={item.id} onClick={(event) => { const target = event.target as HTMLElement; if (!target.closest("a,input,button,select")) navigate(`/submissions/${item.id}`); }}>
              <td class="check-col"><input type="checkbox" aria-label={`Select ${item.id}`} checked={allMatching || selectedIds.has(item.id)} onChange={(event) => toggleRow(item.id, event.currentTarget.checked)} /></td>
              {DEFAULT_SUBMISSION_COLUMNS.map((column) => <td class={`${column}-col`}><Cell item={item} column={column} navigate={navigate} /></td>)}
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
