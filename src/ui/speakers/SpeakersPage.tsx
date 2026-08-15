import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import type { SpeakerRosterSnapshot, SpeakerRow, SpeakerStatus } from "../../routes/speakers.queries";
import { apiFetch, errorSummary } from "../shell/api-client";
import { lockBodyScroll } from "../shell/OverlayHosts";
import { disambiguatedNames } from "../../lib/duplicate-names";
import { Button, EmptyState, PageHeader } from "../shell/components";
import { SpeakerAvatar } from "./SpeakerAvatar";
import { SpeakerRecord, SpeakerStatusBadge } from "./SpeakerRecord";
import "./speakers.css";

const STATUS_FILTERS: Array<{ key: SpeakerStatus | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "invited", label: "Invited" },
  { key: "confirmed", label: "Confirmed" },
  { key: "declined", label: "Declined" },
];

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; snapshot: SpeakerRosterSnapshot };

const EMPTY_DRAFT = { name: "", email: "", title: "", company: "", bio: "" };

function AddSpeakerPanel({
  eventId,
  onCreated,
  onCancel,
}: {
  eventId: string;
  onCreated: (speaker: SpeakerRow) => void;
  onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = await apiFetch<{ speaker: SpeakerRow }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/speakers`,
        {
          route: "/api/v1/events/{eventId}/speakers",
          method: "POST",
          headers: { "content-type": "application/json" },
          // Omit what was left blank rather than sending an explicit null: on
          // an email that already belongs to someone, null means "clear this".
          body: JSON.stringify({
            name: draft.name,
            email: draft.email,
            ...(draft.title.trim() ? { title: draft.title } : {}),
            ...(draft.company.trim() ? { company: draft.company } : {}),
            ...(draft.bio.trim() ? { bio: draft.bio } : {}),
          }),
        },
      );
      setDraft({ ...EMPTY_DRAFT });
      onCreated(body.speaker);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  return <form class="speaker-add card" onSubmit={(event) => void submit(event)}>
    <div class="speaker-add-head"><h2>Add a speaker</h2><span>Name and email are all that is required; everything else can follow.</span></div>
    <div class="speaker-form-grid">
      <label class="speaker-field">Name<input required value={draft.name} onInput={(event) => setDraft({ ...draft, name: (event.currentTarget as HTMLInputElement).value })} /></label>
      <label class="speaker-field">Email<input required type="email" value={draft.email} onInput={(event) => setDraft({ ...draft, email: (event.currentTarget as HTMLInputElement).value })} /></label>
      <label class="speaker-field">Job title<input value={draft.title} onInput={(event) => setDraft({ ...draft, title: (event.currentTarget as HTMLInputElement).value })} /></label>
      <label class="speaker-field">Company<input value={draft.company} onInput={(event) => setDraft({ ...draft, company: (event.currentTarget as HTMLInputElement).value })} /></label>
    </div>
    <label class="speaker-field speaker-field-wide">Bio<textarea rows={5} value={draft.bio} onInput={(event) => setDraft({ ...draft, bio: (event.currentTarget as HTMLTextAreaElement).value })} /></label>
    {error ? <div class="speaker-inline-error" role="alert">{error}</div> : null}
    <div class="speaker-add-foot">
      <Button small onClick={onCancel} type="button">Cancel</Button>
      <button class="speaker-fixed-action" type="submit" disabled={busy}>{busy ? "Saving…" : "Save speaker"}</button>
    </div>
  </form>;
}

export function SpeakersPage({
  eventId,
  search = "",
  navigate,
}: {
  eventId: string;
  search?: string;
  navigate?: (target: string) => void;
}): JSX.Element {
  const deepLinkedPerson = useMemo(() => new URLSearchParams(search).get("person"), [search]);
  const [filters, setFilters] = useState<{ status: SpeakerStatus | "all"; track: string; query: string }>({
    status: "all",
    track: "",
    query: "",
  });
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [adding, setAdding] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const filterIdentity = JSON.stringify(filters);
  const updateFilters = (update: typeof filters | ((current: typeof filters) => typeof filters)) => {
    setPage(1);
    setFilters(update);
  };

  useEffect(() => {
    const controller = new AbortController();
    // Aborting the fetch does not abort the D1 work already in flight, so the
    // typeahead waits for a pause instead of firing a full roster scan per
    // keystroke. Filter chips and the track select answer immediately.
    const debounceMs = filters.query.trim() ? 180 : 0;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ status: filters.status });
      params.set("page", String(page));
      params.set("per_page", String(pageSize));
      if (filters.track) params.set("track", filters.track);
      if (filters.query.trim()) params.set("q", filters.query.trim());
      apiFetch<SpeakerRosterSnapshot>(
        `/api/v1/events/${encodeURIComponent(eventId)}/speakers?${params.toString()}`,
        { route: "/api/v1/events/{eventId}/speakers", signal: controller.signal },
      )
        .then((snapshot) => {
          setState({ kind: "ready", snapshot });
          const lastPage = Math.max(1, snapshot.total_pages);
          setPage((current) => current > lastPage ? lastPage : current);
        })
        .catch((caught: unknown) => {
          if (!controller.signal.aborted) setState({ kind: "error", message: errorSummary(caught) });
        });
    }, debounceMs);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [eventId, filterIdentity, reloadToken, page]);

  // The record lives in the URL, so an organizer can send someone a speaker,
  // quick-search can deep-link one, and a reload lands back on the same record
  // rather than dumping the reader at the top of the roster.
  const openRecord = (personId: string) => navigate?.(`/roster?person=${encodeURIComponent(personId)}`);
  const closeRecord = () => navigate?.("/roster");

  useEffect(() => {
    if (!deepLinkedPerson) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeRecord(); };
    document.addEventListener("keydown", onKeyDown);
    const releaseScrollLock = lockBodyScroll();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      releaseScrollLock();
    };
  }, [deepLinkedPerson]);

  const ready = state.kind === "ready" ? state.snapshot : null;
  const rows = ready?.data ?? [];
  // Two speakers may legitimately share a name; the roster must not print them
  // as one indistinguishable pair.
  const displayNames = disambiguatedNames(rows);
  const counts = ready?.counts ?? { all: 0, pending: 0, invited: 0, confirmed: 0, declined: 0 };
  const hasFilters = filters.status !== "all" || Boolean(filters.track) || filters.query.trim().length > 0;
  const clearFilters = () => updateFilters({ status: "all", track: "", query: "" });
  const matchingTotal = ready?.total ?? 0;
  const totalPages = Math.max(1, ready?.total_pages ?? Math.ceil(matchingTotal / pageSize));

  return <div class="speakers-page">
    <PageHeader
      title="Speakers"
      copy={ready
        ? `${ready.counts.all} speaker${ready.counts.all === 1 ? "" : "s"} on the roster for this conference — everyone who submitted, was accepted, was imported, or was added by hand.`
        : "Reading the conference roster…"}
      actions={<button class="speaker-fixed-action" type="button" onClick={() => setAdding((open) => !open)}>{adding ? "Close form" : "Add speaker"}</button>}
    />

    {adding ? <AddSpeakerPanel
      eventId={eventId}
      onCancel={() => setAdding(false)}
      onCreated={(speaker) => { setAdding(false); setReloadToken((token) => token + 1); openRecord(speaker.id); }}
    /> : null}

    <section class="speaker-board card" aria-label="Speaker roster">
      <div class="speaker-board-tools">
        <div class="speaker-filter-chips" aria-label="Status filters">
          {STATUS_FILTERS.map((filter) => <button
            class={`speaker-filter-chip ${filters.status === filter.key ? "active" : ""}`}
            type="button"
            key={filter.key}
            aria-pressed={filters.status === filter.key}
            onClick={() => updateFilters((current) => ({ ...current, status: filter.key }))}
          ><span>{filter.label}</span><strong class="tabular">{counts[filter.key] ?? 0}</strong></button>)}
        </div>
        <label class="speaker-search">
          <span class="sr-only">Search speakers</span>
          <input
            value={filters.query}
            placeholder="Search name, company, email, session"
            onInput={(event) => updateFilters((current) => ({ ...current, query: (event.currentTarget as HTMLInputElement).value }))}
          />
        </label>
      </div>
      <div class="speaker-board-filters">
        <label>Track<select value={filters.track} onChange={(event) => updateFilters((current) => ({ ...current, track: (event.currentTarget as HTMLSelectElement).value }))}>
          <option value="">All tracks</option>
          {(ready?.tracks ?? []).map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
        </select></label>
        <span class="speaker-filter-count tabular">{rows.length} shown of {matchingTotal}</span>
      </div>

      {state.kind === "loading" ? <div class="speaker-board-state">Reading the conference roster…</div> : null}
      {state.kind === "error" ? <div class="speaker-board-state error"><strong>Roster unavailable</strong><span>{state.message}</span></div> : null}
      {state.kind === "ready" && rows.length === 0 ? <EmptyState
        title={hasFilters ? "No speakers match these filters" : "No speakers yet"}
        copy={hasFilters
          ? "Clear the search and filters to see the whole roster."
          : "Add a speaker by hand, or accept a submission — accepted speakers join the roster automatically."}
        action={hasFilters
          ? <Button variant="primary" onClick={clearFilters}>Clear filters</Button>
          : <Button variant="primary" onClick={() => setAdding(true)}>Add speaker</Button>}
      /> : null}

      {state.kind === "ready" && rows.length > 0 ? <div class="speaker-table-wrap">
        <table class="speaker-table">
          <thead>
            <tr>
              <th scope="col">Speaker</th>
              <th scope="col" class="speaker-profile-column">Title &amp; company</th>
              <th scope="col" class="speaker-sessions-column">Sessions</th>
              <th scope="col" class="speaker-status-column">Status</th>
              <th scope="col" class="speaker-tasks-column">Tasks</th>
              <th scope="col" class="speaker-action-column"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <tr key={row.id}>
              <th scope="row">
                <button class="speaker-link" type="button" onClick={() => openRecord(row.id)}>
                  <SpeakerAvatar eventId={eventId} personId={row.id} name={row.name} attachmentId={row.headshot_attachment_id} />
                  <span><strong>{displayNames.get(row.id) ?? row.name}</strong><small>{row.email}</small></span>
                </button>
              </th>
              <td class="speaker-profile-column">{[row.title, row.company].filter(Boolean).join(" · ") || <span class="speaker-muted">—</span>}</td>
              <td class="speaker-sessions-column">{row.sessions.length === 0
                ? <span class="speaker-muted">—</span>
                : <span class="speaker-session-titles">{row.sessions.map((session) => session.title).join(" · ")}</span>}</td>
              <td class="speaker-status-column"><SpeakerStatusBadge status={row.status} /></td>
              <td class="speaker-tasks-column tabular">{row.task_total === 0 ? "—" : `${row.task_done}/${row.task_total}`}</td>
              <td class="speaker-action-column"><Button small onClick={() => openRecord(row.id)}>Open</Button></td>
            </tr>)}
          </tbody>
        </table>
      </div> : null}
      {state.kind === "ready" && (rows.length > 0 || page > 1) ? <div class="speaker-tablefoot">
        <span class="tabular">Showing {rows.length} of {matchingTotal} speakers</span>
        <span class="speaker-pager"><Button small disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><span class="speaker-pager-label tabular">Page {ready?.page ?? page} of {totalPages}</span><Button small disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button></span>
      </div> : null}
    </section>

    {deepLinkedPerson ? <div class="speaker-record-layer">
      <button class="speaker-record-backdrop" type="button" aria-label="Close speaker record" onClick={closeRecord} />
      <SpeakerRecord
        eventId={eventId}
        personId={deepLinkedPerson}
        onClose={closeRecord}
        onSaved={() => setReloadToken((token) => token + 1)}
      />
    </div> : null}
  </div>;
}
