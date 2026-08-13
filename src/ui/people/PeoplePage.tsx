/**
 * People — everyone this organization has worked with, across every conference.
 *
 * The screen reproduces `prototypes/crm/index.html`: KPI strip, search, a filter
 * panel of real attribute values, one reserved status row that carries either
 * the active criteria or the selection bar, and a server-paginated table.
 *
 * Search, filters, sort, and paging are all server-side. That is not an
 * optimization — at a conference organization's real scale a client-side filter
 * over one page is a filter that lies, and it lies quietly.
 */
import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { Button, EmptyState, PageHeader } from "../shell/components";
import { errorSummary } from "../shell/api-client";
import { PersonDrawer } from "./PersonDrawer";
import { AddPersonModal, ComposeModal, ImportPeopleModal, SaveListModal } from "./PeopleModals";
import {
  activeCriteria,
  EMPTY_FILTERS,
  fetchPeople,
  fetchSummary,
  formatDay,
  hasFilters,
  saveControl,
  type OrgSummary,
  type PeopleFilters,
  type PeoplePage as PeoplePayload,
} from "./people-api";
import "./people.css";

const PER_PAGE = 25;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; payload: PeoplePayload };

function KpiStrip({ summary }: { summary: OrgSummary | null }): JSX.Element {
  const top = summary?.top_companies ?? [];
  const highest = top[0]?.count ?? 1;
  const value = (input: number | undefined): string => (input === undefined ? "—" : input.toLocaleString());
  return <div class="people-instrument">
    <div class="people-instrument-inner">
      <div class="people-kpi">
        <div class="people-kpi-name">People</div>
        <div class="people-kpi-count">{value(summary?.people)}</div>
        <div class="people-kpi-meaning">across all conferences</div>
      </div>
      <div class="people-kpi">
        <div class="people-kpi-name">Conferences</div>
        <div class="people-kpi-count">{value(summary?.conferences)}</div>
        <div class="people-kpi-meaning">this organization runs</div>
      </div>
      <div class="people-kpi">
        <div class="people-kpi-name">Returning speakers</div>
        <div class="people-kpi-count">{value(summary?.returning_speakers)}</div>
        <div class="people-kpi-meaning">spoke at 2+ conferences</div>
      </div>
      <div class="people-kpi">
        <div class="people-kpi-name">In pipeline</div>
        <div class="people-kpi-count">{value(summary?.in_pipeline)}</div>
        <div class="people-kpi-meaning">being sourced now</div>
      </div>
      <div class="people-widget">
        <div class="people-widget-name">Top companies</div>
        {top.length === 0
          ? <span class="people-hint">No company is recorded on anyone yet.</span>
          : top.map((company) => <div class="people-bar-row" key={company.value}>
            <span class="people-bar-name">{company.value}</span>
            <span class="people-bar-track"><i style={{ width: `${Math.round((company.count / highest) * 100)}%` }} /></span>
            <span class="people-bar-count">{company.count}</span>
          </div>)}
      </div>
    </div>
  </div>;
}

export function PeoplePage({ search = "", navigate }: { search?: string; navigate?: (target: string) => void }): JSX.Element {
  const openPersonId = useMemo(() => new URLSearchParams(search).get("person"), [search]);
  const listFromUrl = useMemo(() => new URLSearchParams(search).get("list") ?? "", [search]);
  const [filters, setFilters] = useState<PeopleFilters>({ ...EMPTY_FILTERS, listId: listFromUrl });
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [summary, setSummary] = useState<OrgSummary | null>(null);
  const [modal, setModal] = useState<"" | "import" | "compose" | "savelist" | "addperson">("");
  const [toast, setToast] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const filterIdentity = JSON.stringify(filters);

  useEffect(() => { setFilters((current) => ({ ...current, listId: listFromUrl })); }, [listFromUrl]);

  useEffect(() => {
    const controller = new AbortController();
    // A typeahead that fires a server scan per keystroke is the slow list R7
    // forbids; chips and page changes answer immediately.
    const debounceMs = filters.q.trim() ? 180 : 0;
    const timer = window.setTimeout(() => {
      fetchPeople(filters, page, PER_PAGE, controller.signal)
        .then((payload) => setState({ kind: "ready", payload }))
        .catch((caught: unknown) => {
          if (!controller.signal.aborted) setState({ kind: "error", message: errorSummary(caught) });
        });
    }, debounceMs);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [filterIdentity, page, reloadToken]);

  useEffect(() => {
    const controller = new AbortController();
    fetchSummary(controller.signal).then(setSummary).catch(() => setSummary(null));
    return () => controller.abort();
  }, [reloadToken]);

  const payload = state.kind === "ready" ? state.payload : null;
  const rows = payload?.data ?? [];
  const facets = payload?.facets ?? { company: [], title: [], tag: [] };
  const criteria = activeCriteria(filters);
  const filtered = hasFilters(filters);
  const control = saveControl(selected.size);

  const setFilter = (key: keyof PeopleFilters, value: string) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: current[key] === value ? "" : value }));
  };
  const clearAll = () => { setPage(1); setFilters({ ...EMPTY_FILTERS }); navigate?.("/people"); };
  const toggleRow = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const openPerson = (personId: string) => navigate?.(`/people?person=${encodeURIComponent(personId)}`);
  const closePerson = () => navigate?.("/people");
  // An import receipt — "14 created · 2 updated · 1 skipped" — is a number the
  // organizer has to actually read, so the line stays up long enough to read it.
  const announce = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 8000);
  };

  return <div class="people-page">
    <PageHeader
      title="People"
      copy={payload
        ? `Everyone this organization has worked with, across every conference — ${payload.total.toLocaleString()} speakers, submitters, chairs and contacts, carrying their history, notes and tags. A returning speaker is already here; nobody re-keys anything.`
        : "Reading everyone this organization has worked with…"}
      actions={<>
        <Button onClick={() => setModal("import")}>Import people</Button>
        <Button variant="primary" onClick={() => setModal("addperson")}>Add person</Button>
      </>}
    />

    <KpiStrip summary={summary} />

    <div class="people-toolbar">
      <label class="people-search">
        <span class="people-search-glyph" aria-hidden="true">⌕</span>
        <span class="sr-only">Search people</span>
        <input
          value={filters.q}
          placeholder="Search by name, email, company…"
          onInput={(event) => { setPage(1); setFilters((current) => ({ ...current, q: (event.currentTarget as HTMLInputElement).value })); }}
        />
      </label>
      <Button
        small
        class="people-filter-toggle"
        variant={filterOpen ? "primary" : ""}
        aria-expanded={filterOpen}
        onClick={() => setFilterOpen((open) => !open)}
      >Filter</Button>
      <span class="people-toolbar-spacer" />
      <Button small class="people-save-control" onClick={() => setModal("savelist")}>{control.label}</Button>
      <Button small onClick={() => navigate?.("/lists")}>Lists</Button>
      <Button small onClick={() => navigate?.("/pipeline")}>Sourcing pipeline</Button>
    </div>

    {filterOpen ? <div class="people-filter-panel">
      <div class="people-filter-group">
        <h3>Company</h3>
        {facets.company.length === 0 ? <span class="people-hint">No companies recorded yet.</span> : facets.company.map((facet) => <button
          type="button"
          class="people-filter-option"
          key={facet.value}
          aria-pressed={filters.company === facet.value}
          onClick={() => setFilter("company", facet.value)}
        ><span>{facet.value}</span><span class="people-filter-count">{facet.count}</span></button>)}
      </div>
      <div class="people-filter-group">
        <h3>Job title</h3>
        {facets.title.length === 0 ? <span class="people-hint">No job titles recorded yet.</span> : facets.title.map((facet) => <button
          type="button"
          class="people-filter-option"
          key={facet.value}
          aria-pressed={filters.title === facet.value}
          onClick={() => setFilter("title", facet.value)}
        ><span>{facet.value}</span><span class="people-filter-count">{facet.count}</span></button>)}
      </div>
      <div class="people-filter-group">
        <h3>Tag</h3>
        {facets.tag.length === 0
          ? <span class="people-hint">No tags yet. Open anyone and tag them — tags are org-level and follow the person.</span>
          : facets.tag.map((facet) => <button
            type="button"
            class="people-filter-option"
            key={facet.value}
            aria-pressed={filters.tag === facet.value}
            onClick={() => setFilter("tag", facet.value)}
          ><span>{facet.value}</span><span class="people-filter-count">{facet.count}</span></button>)}
      </div>
    </div> : null}

    {/* One reserved row carries the active criteria AND the selection bar, so
        ticking a checkbox never pushes the table down the screen. */}
    <div class="people-statusbar">
      {selected.size > 0 ? <>
        <span class="people-selcount">{selected.size} selected</span>
        <Button small onClick={() => setModal("compose")}>Communicate</Button>
        <Button small onClick={() => setModal("savelist")}>{control.label}</Button>
        <button type="button" class="people-chip" onClick={() => setSelected(new Set())}>
          <span class="people-chip-x" aria-hidden="true">×</span> Clear selection
        </button>
      </> : <>
        {criteria.map((criterion) => <button
          type="button"
          class="people-chip on"
          key={criterion.key}
          onClick={() => setFilter(criterion.key, filters[criterion.key])}
        >{criterion.label}: {criterion.value} <span class="people-chip-x" aria-hidden="true">×</span></button>)}
        {filters.q.trim() ? <button type="button" class="people-chip on" onClick={() => setFilters((current) => ({ ...current, q: "" }))}>
          search: “{filters.q.trim()}” <span class="people-chip-x" aria-hidden="true">×</span>
        </button> : null}
        {filtered
          ? <button type="button" class="people-chip" onClick={clearAll}>Clear all</button>
          : <span class="people-chip quiet">No filters — showing everyone</span>}
      </>}
    </div>

    {state.kind === "error" ? <div class="people-table-wrap"><div class="people-state error">{state.message}</div></div> : null}
    {state.kind === "loading" ? <div class="people-table-wrap"><div class="people-state">Reading People…</div></div> : null}

    {state.kind === "ready" && rows.length === 0 ? <EmptyState
      title={filtered ? "Nobody matches these filters" : "Nobody here yet"}
      copy={filtered
        ? "Clear a filter to bring everyone back into view."
        : "Import a speaker list, or add someone by hand. Everyone who submits to a conference lands here too."}
      action={filtered
        ? <Button variant="primary" onClick={clearAll}>Clear filters</Button>
        : <Button variant="primary" onClick={() => setModal("import")}>Import people</Button>}
    /> : null}

    {state.kind === "ready" && rows.length > 0 ? <div class="people-table-wrap">
      <table class="people-table">
        <thead>
          <tr>
            <th scope="col" class="people-check">
              <input
                type="checkbox"
                aria-label="Select every person on this page"
                checked={rows.every((row) => selected.has(row.id))}
                onChange={(event) => {
                  const on = (event.currentTarget as HTMLInputElement).checked;
                  setSelected((current) => {
                    const next = new Set(current);
                    for (const row of rows) { if (on) next.add(row.id); else next.delete(row.id); }
                    return next;
                  });
                }}
              />
            </th>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Company</th>
            <th scope="col">Job title</th>
            <th scope="col">Tags</th>
            <th scope="col">Confs</th>
            <th scope="col">Last contact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <tr key={row.id} class={selected.has(row.id) ? "selected" : ""}>
            <td class="people-check">
              <input
                type="checkbox"
                aria-label={`Select ${row.name}`}
                checked={selected.has(row.id)}
                onChange={() => toggleRow(row.id)}
              />
            </td>
            <td>
              <button type="button" class="people-rowlink" onClick={() => openPerson(row.id)}>
                <span class="people-cell-name">{row.name}</span>
              </button>
            </td>
            <td><span class="people-cell-mail people-cell-trunc">{row.email}</span></td>
            <td><span class="people-cell-trunc">{row.company ?? "—"}</span></td>
            <td><span class="people-cell-trunc">{row.title ?? "—"}</span></td>
            <td>
              <span class="people-tagset">
                {row.tags.length === 0
                  ? <span class="people-tag">—</span>
                  : row.tags.map((tag) => <span class="people-tag accent" key={tag}>{tag}</span>)}
              </span>
            </td>
            <td class="tabular">{row.conference_count}</td>
            <td class="tabular">{formatDay(row.last_contact_at)}</td>
          </tr>)}
        </tbody>
      </table>
      <div class="people-tablefoot">
        <span>Showing {rows.length} of {payload!.total.toLocaleString()}{filtered ? " matching" : ""} people</span>
        <span class="people-pager">
          <Button small disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
          <span>Page {payload!.page} of {Math.max(1, payload!.total_pages)}</span>
          <Button small disabled={page >= payload!.total_pages} onClick={() => setPage((current) => current + 1)}>Next</Button>
        </span>
      </div>
    </div> : null}

    {toast ? <div class="people-hint" role="status" style={{ marginTop: "var(--s3)" }}>{toast}</div> : null}

    {openPersonId ? <PersonDrawer
      personId={openPersonId}
      onClose={closePerson}
      onChanged={() => setReloadToken((token) => token + 1)}
    /> : null}

    {modal === "import" ? <ImportPeopleModal
      onClose={() => setModal("")}
      onImported={(result) => {
        setReloadToken((token) => token + 1);
        announce(`${result.created} created · ${result.updated} updated · ${result.skipped} skipped · receipt ready to undo`);
      }}
      onUndone={(undone) => {
        setReloadToken((token) => token + 1);
        announce(`${undone} ${undone === 1 ? "person" : "people"} restored from the import receipt`);
      }}
    /> : null}

    {modal === "compose" ? <ComposeModal
      personIds={[...selected]}
      onClose={() => setModal("")}
      onSent={(result) => {
        setModal("");
        setSelected(new Set());
        announce(`${result.queued} message${result.queued === 1 ? "" : "s"} queued — every one is logged in the outbox`);
      }}
    /> : null}

    {modal === "addperson" ? <AddPersonModal
      onClose={() => setModal("")}
      onAdded={(person) => {
        setModal("");
        setReloadToken((token) => token + 1);
        openPerson(person.id);
      }}
    /> : null}

    {modal === "savelist" ? <SaveListModal
      selectedIds={[...selected]}
      matching={payload?.total ?? 0}
      filters={filters}
      onClose={() => setModal("")}
      onSaved={(list) => {
        setModal("");
        announce(`List “${list.name}” saved`);
        navigate?.("/lists");
      }}
    /> : null}
  </div>;
}
