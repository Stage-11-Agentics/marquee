/** @jsxImportSource preact */

/**
 * The files library — every deliverable the conference asked for, in one place.
 *
 * It lists the expected deliverable as well as the arrived one, because the
 * screen an AV lead runs the show from has to answer "whose deck is missing"
 * as readily as "where is Priya's deck". An empty row is a chase, not an
 * absence of data, and it says so.
 */

import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import type { FilesRow, FilesSnapshot, FileStateFilter } from "../../routes/files.queries";
import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, EmptyState, PageHeader } from "../shell/components";
import { formatBytes } from "../upload/upload-policy";
import { FileComments } from "./FileComments";
import { BulkExportDialog } from "./BulkExportDialog";
import { FileVersions } from "./FileVersions";
import "./files.css";

const ROUTE = "/api/v1/events/{eventId}/files";
const STATE_LABELS: Record<FileStateFilter, string> = {
  all: "All deliverables",
  uploaded: "Uploaded",
  missing: "Missing",
  overdue: "Overdue",
};
const ROW_STATE_LABELS: Record<FilesRow["state"], string> = {
  uploaded: "Uploaded",
  missing: "Awaiting",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; snapshot: FilesSnapshot };

function formatDate(value: number | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

async function readLibrary(
  eventId: string,
  filters: { state: FileStateFilter; taskType: string; search: string },
  signal: AbortSignal,
): Promise<FilesSnapshot> {
  const query = new URLSearchParams({ state: filters.state });
  if (filters.taskType) query.set("task_type", filters.taskType);
  if (filters.search.trim()) query.set("q", filters.search.trim());
  const body = await apiFetch<{ data: FilesSnapshot }>(
    `/api/v1/events/${encodeURIComponent(eventId)}/files?${query.toString()}`,
    { signal, route: ROUTE },
  );
  return body.data;
}

function FileRow({ eventId, row, selected, onToggle }: { eventId: string; row: FilesRow; selected: boolean; onToggle: () => void }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const hasFile = row.latest !== null;
  const hasAmbiguousSession = row.session === null && row.session_candidates.length > 0;
  const sessionChoices = row.session_candidates.map((session) => session.title).join(" · ");
  return <>
    <tr>
      <td class="files-select-column">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${row.latest?.filename ?? row.task.title} for ${row.person.name}`} />
      </td>
      <td class="files-file-cell">
        <strong title={row.latest?.filename ?? row.task.title}>{row.latest?.filename ?? <span class="files-empty-dash">—</span>}</strong>
        {/* A file task marked complete with nothing attached is the one state
            an AV lead must not discover on the day. Name it here rather than
            letting the chase board's "done" stand unqualified. */}
        <small>{row.task.title}{!hasFile && row.task.status === "done" ? " · marked complete, no file on record" : ""}</small>
      </td>
      <td class="files-speaker-cell">
        <strong>{row.person.name}</strong>
        <small>{row.person.email}</small>
      </td>
      <td class="files-session-cell">
        <strong title={row.session?.title ?? (sessionChoices || undefined)}>{row.session?.title ?? (hasAmbiguousSession ? "Multiple accepted sessions" : <span class="files-empty-dash">—</span>)}</strong>
        <small title={hasAmbiguousSession ? sessionChoices : undefined}>{row.session ? "session" : hasAmbiguousSession ? `choose one: ${sessionChoices}` : "no session attached"}</small>
      </td>
      <td><span class={`files-state state-${row.state}`}>{ROW_STATE_LABELS[row.state]}</span></td>
      <td class="files-when">{hasFile ? formatDate(row.latest?.uploaded_at ?? null) : `due ${formatDate(row.task.due_at)}`}</td>
      <td class="files-versions-count">{row.version_count > 0 ? `${row.version_count} version${row.version_count === 1 ? "" : "s"}` : "—"}</td>
      <td class="files-size">{row.latest ? formatBytes(row.latest.size_bytes) : "—"}</td>
      <td>
        <button class="files-expand" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Hide" : hasFile ? "Versions" : "Details"}
        </button>
      </td>
    </tr>
    {expanded ? <tr>
      <td class="files-detail-cell" colSpan={9}>
        <div class="files-detail">
          <div class="files-detail-head">Version history · {row.person.name} · {row.task.title}</div>
          <FileVersions
            list={hasFile ? { owner_type: "task_upload", owner_id: row.id, versions: row.versions, latest: row.latest, version_count: row.version_count, latest_source: row.latest_source } : null}
            emptyCopy="No upload yet — this deliverable slot is open for context."
          />
          <FileComments eventId={eventId} taskId={row.id} attachmentId={row.latest?.attachment_id ?? null} />
        </div>
      </td>
    </tr> : null}
  </>;
}

export function FilesPage({ eventId, navigate }: { eventId: string; navigate?: (target: string) => void }): JSX.Element {
  const [filters, setFilters] = useState({ state: "all" as FileStateFilter, taskType: "", search: "" });
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const filterIdentity = JSON.stringify(filters);
  const ready = state.kind === "ready" ? state.snapshot : null;
  const rows = useMemo(() => ready?.rows ?? [], [ready]);
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setState({ kind: "loading" });
    readLibrary(eventId, filters, controller.signal)
      .then((snapshot) => {
        if (disposed) return;
        setState({ kind: "ready", snapshot });
        setSelected((current) => new Set([...current].filter((id) => snapshot.rows.some((row) => row.id === id))));
      })
      .catch((error: unknown) => { if (!disposed && !controller.signal.aborted) setState({ kind: "error", message: errorSummary(error) }); });
    return () => { disposed = true; controller.abort(); };
  }, [eventId, filterIdentity]);

  const toggleRow = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((current) => {
    const next = new Set(current);
    if (allVisibleSelected) rows.forEach((row) => next.delete(row.id));
    else rows.forEach((row) => next.add(row.id));
    return next;
  });

  const counts = ready?.counts ?? { all: 0, uploaded: 0, missing: 0, overdue: 0 };
  const metrics = ready?.metrics ?? { expected: 0, received: 0, missing: 0, overdue: 0 };
  const taskTypes = ready?.facets.task_types ?? [];
  const filtered = filters.state !== "all" || Boolean(filters.taskType || filters.search.trim());
  const clearFilters = () => setFilters({ state: "all", taskType: "", search: "" });

  return <div class="files-page">
    <PageHeader
      title="Files"
      copy={ready
        ? `Received ${metrics.received} of ${metrics.expected} requested deliverables. Every upload keeps its history; the current version is the one the speaker uploaded last.`
        : "Reading every deliverable the conference has asked for…"}
      actions={<button class="button primary" type="button" disabled={selected.size === 0 || !ready} onClick={() => setExportOpen(true)}>Download files ({selected.size})</button>}
    />
    {ready ? <>
      <div class="files-metrics" aria-label="Deliverable metrics">
        <button class={`files-metric ${filters.state === "all" ? "active" : ""}`} type="button" aria-pressed={filters.state === "all"} onClick={() => setFilters((current) => ({ ...current, state: "all" }))}>
          <span>Requested</span><strong class="tabular">{metrics.expected}</strong><small>Speaker × file task</small>
        </button>
        <button class={`files-metric ${filters.state === "uploaded" ? "active" : ""}`} type="button" aria-pressed={filters.state === "uploaded"} onClick={() => setFilters((current) => ({ ...current, state: "uploaded" }))}>
          <span>Received</span><strong class="tabular">{metrics.received}</strong><small>At least one upload</small>
        </button>
        <button class={`files-metric ${filters.state === "missing" ? "active" : ""}`} type="button" aria-pressed={filters.state === "missing"} onClick={() => setFilters((current) => ({ ...current, state: "missing" }))}>
          <span>Missing</span><strong class="tabular">{metrics.missing}</strong><small>Nothing uploaded yet</small>
        </button>
        <button class={`files-metric ${filters.state === "overdue" ? "active" : ""}`} type="button" aria-pressed={filters.state === "overdue"} onClick={() => setFilters((current) => ({ ...current, state: "overdue" }))}>
          <span>Overdue</span><strong class="tabular files-alarm">{metrics.overdue}</strong><small>Past the due date</small>
        </button>
      </div>
      <section class="files-board card" aria-label="Conference files library">
        <div class="files-board-tools">
          <div class="files-chips" aria-label="Deliverable state filters">
            {(Object.keys(STATE_LABELS) as FileStateFilter[]).map((key) => <button class={`files-chip ${filters.state === key ? "active" : ""}`} type="button" key={key} onClick={() => setFilters((current) => ({ ...current, state: key }))}>
              <span>{STATE_LABELS[key]}</span><strong class="tabular">{counts[key]}</strong>
            </button>)}
          </div>
          <label class="files-search">
            <span class="sr-only">Search files, speakers, and sessions</span>
            <input value={filters.search} placeholder="Search filename, speaker, session" onInput={(event) => setFilters((current) => ({ ...current, search: (event.currentTarget as HTMLInputElement).value }))} />
          </label>
        </div>
        <div class="files-filters">
          <label>File task
            <select value={filters.taskType} onChange={(event) => setFilters((current) => ({ ...current, taskType: (event.currentTarget as HTMLSelectElement).value }))}>
              <option value="">All file tasks</option>
              {taskTypes.map((type) => <option value={type.id} key={type.id}>{type.name} · {type.count}</option>)}
            </select>
          </label>
          <span class="files-count">{rows.length} shown · {selected.size} selected</span>
        </div>
        {rows.length === 0
          ? <EmptyState
              title={filtered ? "No deliverables match these filters" : "No file has been requested yet"}
              copy={filtered
                ? "Adjust the filters to see the deliverables the conference is collecting."
                : "This library fills itself from file-request tasks. Create one and every assigned speaker appears here, uploaded or not."}
              action={filtered
                ? <Button variant="primary" onClick={clearFilters}>Clear filters</Button>
                : <Button variant="primary" onClick={() => navigate?.("/settings/tasks")}>Open task templates</Button>}
            />
          : <div class="files-table-wrap">
            <table class="files-table">
              <thead><tr>
                <th class="files-select-column"><input type="checkbox" aria-label="Select all shown deliverables" checked={allVisibleSelected} onChange={toggleAll} /></th>
                <th scope="col">File</th>
                <th scope="col">Speaker</th>
                <th scope="col">Session</th>
                <th scope="col">Status</th>
                <th scope="col">Uploaded</th>
                <th scope="col">Versions</th>
                <th scope="col">Size</th>
                <th scope="col"><span class="sr-only">Version history</span></th>
              </tr></thead>
              <tbody>{rows.map((row) => <FileRow key={row.id} eventId={eventId} row={row} selected={selected.has(row.id)} onToggle={() => toggleRow(row.id)} />)}</tbody>
            </table>
          </div>}
      </section>
    </> : <div class="files-board-state card">{state.kind === "error" ? <><strong>The files library is unavailable</strong><span>{state.message}</span></> : "Reading every deliverable the conference has asked for…"}</div>}
    <BulkExportDialog eventId={eventId} rows={selectedRows} open={exportOpen} onClose={() => setExportOpen(false)} />
  </div>;
}
