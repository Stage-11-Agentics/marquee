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
import { errorSummary, MarqueeApiError } from "../shell/api-client";
import { useEventContext } from "../shell/event-context";
import { disambiguatedNames } from "../../lib/duplicate-names";
import { PersonDrawer } from "./PersonDrawer";
import { AddPersonModal, ComposeModal, ImportAttendeesModal, ImportPeopleModal, SaveListModal } from "./PeopleModals";
import { ListsPanel } from "./ListsPanel";
import {
  activeCriteria,
  deleteList,
  EMPTY_FILTERS,
  fetchList,
  fetchLists,
  fetchPeople,
  fetchSummary,
  exportPeople,
  formatDay,
  formatMoment,
  hasFilters,
  saveControl,
  type OrgSummary,
  type PeopleFilters,
  type PeoplePage as PeoplePayload,
  type Person,
  type PersonListDetail,
  type SavedPersonList,
} from "./people-api";
import "./people.css";

const PER_PAGE = 25;
type SelectedPerson = Pick<Person, "id" | "name" | "do_not_contact">;

/**
 * The People URL. Only two things live in it — which list you are inside and
 * which person is open — and every navigation within the screen has to carry
 * the first, so it is built in one place rather than spelled out per call site.
 */
function peopleUrl(listId: string, personId?: string): string {
  const params = new URLSearchParams();
  if (listId) params.set("list", listId);
  if (personId) params.set("person", personId);
  const query = params.toString();
  return query ? `/people?${query}` : "/people";
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "list_missing" }
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

/** The two tabs of the People area. `/lists` is the second one, not a screen. */
export type PeopleTab = "people" | "lists";

export function PeoplePage({ search = "", navigate, tab = "people" }: { search?: string; navigate?: (target: string) => void; tab?: PeopleTab }): JSX.Element {
  const openPersonId = useMemo(() => new URLSearchParams(search).get("person"), [search]);
  const listFromUrl = useMemo(() => new URLSearchParams(search).get("list") ?? "", [search]);
  const [filters, setFilters] = useState<PeopleFilters>({ ...EMPTY_FILTERS, listId: listFromUrl });
  // People is org-level, but "bring in attendees" is not: an attendance row
  // belongs to one conference, so the brief names the one the shell is on.
  const { event } = useEventContext();
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  // Keep the selected records, not only their ids. Selection survives a
  // server-side search/page change, and the composer must still be able to
  // name a do-not-contact person who is no longer in the visible page.
  const [selected, setSelected] = useState<Map<string, SelectedPerson>>(new Map());
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [summary, setSummary] = useState<OrgSummary | null>(null);
  const [lists, setLists] = useState<SavedPersonList[] | null>(null);
  const [listsError, setListsError] = useState("");
  const [modal, setModal] = useState<"" | "import" | "attendees" | "compose" | "savelist" | "addperson">("");
  const [toast, setToast] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [exporting, setExporting] = useState(false);
  // Four states, and telling them apart is the point. "Deleted" and "the
  // request failed" look identical to a `.catch`, and reporting a network blip
  // as "this list no longer exists" tells an organizer their work is gone.
  const [listState, setListState] = useState<
    { kind: "resolving" } | { kind: "named"; list: PersonListDetail } | { kind: "missing" } | { kind: "error"; message: string }
  >({ kind: "resolving" });
  const filterIdentity = JSON.stringify(filters);

  useEffect(() => { setFilters((current) => ({ ...current, listId: listFromUrl })); }, [listFromUrl]);

  // Resolve the named lens directly. The detail projection carries no member
  // rows, and a real 404 is the only missing state; an index cannot turn an
  // uncapped-list assumption into a deletion claim.
  useEffect(() => {
    setListState({ kind: "resolving" });
    if (!listFromUrl) return;
    const controller = new AbortController();
    fetchList(listFromUrl, controller.signal)
      .then((payload) => setListState({ kind: "named", list: payload.list }))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        // A conference switch calls `abortInFlightRequests()`, which aborts the
        // shell's generation controller and not this one — so the signal above
        // reads false and only the error's own name gives it away.
        if (caught instanceof Error && caught.name === "AbortError") return;
        if (caught instanceof MarqueeApiError && caught.code === "not_found") {
          setListState({ kind: "missing" });
          return;
        }
        setListState({ kind: "error", message: errorSummary(caught) });
      });
    return () => controller.abort();
  }, [listFromUrl]);

  useEffect(() => {
    const controller = new AbortController();
    // A typeahead that fires a server scan per keystroke is the slow list R7
    // forbids; chips and page changes answer immediately.
    const debounceMs = filters.q.trim() ? 180 : 0;
    const timer = window.setTimeout(() => {
      fetchPeople(filters, page, PER_PAGE, controller.signal)
        .then((payload) => setState({ kind: "ready", payload }))
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          if (filters.listId && caught instanceof MarqueeApiError && caught.code === "not_found") {
            // The list band owns the missing-list explanation. Do not add a
            // second generic People error underneath it for the same 404.
            setState({ kind: "list_missing" });
            return;
          }
          setState({ kind: "error", message: errorSummary(caught) });
        });
    }, debounceMs);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [filterIdentity, page, reloadToken]);

  useEffect(() => {
    const controller = new AbortController();
    fetchSummary(controller.signal).then(setSummary).catch(() => setSummary(null));
    return () => controller.abort();
  }, [reloadToken]);

  // The lists themselves, read once for both tabs: the count is on the tab
  // whichever one you are standing on, so a fetch deferred until the Lists tab
  // opens would be a tab that cannot say what is behind it.
  useEffect(() => {
    const controller = new AbortController();
    fetchLists(controller.signal)
      .then((payload) => setLists(payload.data))
      .catch((caught: unknown) => { if (!controller.signal.aborted) setListsError(errorSummary(caught)); });
    return () => controller.abort();
  }, [reloadToken]);

  const payload = state.kind === "ready" ? state.payload : null;
  const rows = payload?.data ?? [];
  // Two people may legitimately share a name; the roster must not print them as
  // one indistinguishable pair.
  const displayNames = disambiguatedNames(rows);
  const facets = payload?.facets ?? { company: [], title: [], tag: [] };
  const criteria = activeCriteria(filters);
  const filtered = hasFilters(filters);
  const control = saveControl(selected.size);

  const setFilter = (key: keyof PeopleFilters, value: string) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: current[key] === value ? "" : value }));
  };
  const clearAll = () => { setPage(1); setFilters({ ...EMPTY_FILTERS }); navigate?.(peopleUrl("")); };
  // Leaves the list and NOTHING else — it is not "show everyone", because a
  // company or tag chip set alongside the list stays set, and a button whose
  // label overpromises is worse than one that says what it does. It clears the
  // state as well as the URL so it still works if `navigate` is ever absent;
  // clearing only the filter would leave `?list=` in the address bar for the
  // next reload to put back.
  const leaveList = () => {
    setPage(1);
    setFilters((current) => ({ ...current, listId: "" }));
    navigate?.(peopleUrl(""));
  };
  const toggleRow = (row: SelectedPerson) => setSelected((current) => {
    const next = new Map(current);
    if (next.has(row.id)) next.delete(row.id); else next.set(row.id, row);
    return next;
  });
  // The drawer is a layer over the list you are in, so both of these carry the
  // list through. Dropping it would close the drawer onto the whole
  // organization — the band gone, the rows silently different, and no way back
  // but the browser's own button.
  const openPerson = (personId: string) => navigate?.(peopleUrl(filters.listId, personId));
  const closePerson = () => navigate?.(peopleUrl(filters.listId));
  // An import receipt — "14 created · 2 updated · 1 skipped" — is a number the
  // organizer has to actually read, so the line stays up long enough to read it.
  const announce = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 8000);
  };

  const removeList = async (list: SavedPersonList) => {
    setListsError("");
    try {
      await deleteList(list.id);
      setReloadToken((token) => token + 1);
    } catch (caught) {
      setListsError(errorSummary(caught));
    }
  };
  // The count is rendered in a fixed-width slot so the tab does not change
  // width when the number arrives, or when a list is created or deleted.
  const listsLabel = lists === null ? "—" : lists.length.toLocaleString();

  const downloadCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const csv = await exportPeople(filters);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "marquee-people.csv";
      anchor.click();
      URL.revokeObjectURL(url);
      announce("People exported as CSV");
    } catch (caught) {
      announce(`Export failed: ${errorSummary(caught)}`);
    } finally {
      setExporting(false);
    }
  };

  return <div class="people-page">
    <PageHeader
      title="People CRM"
      copy={tab === "lists"
        ? "Lists are how this organization addresses the same group twice. They live here, inside People, because a list is a way of looking at people rather than a separate place people live."
        : filters.listId
          ? "A list is a way of looking at People, not a separate place people live — everything below is this organization's people, narrowed to the list named beneath the search."
          : payload
            ? `Everyone this organization has worked with, across every conference — ${payload.total.toLocaleString()} speakers, submitters, chairs and contacts, carrying their history, notes and tags. A returning speaker is already here; nobody re-keys anything.`
            : "Reading everyone this organization has worked with…"}
      actions={<>
        <Button onClick={() => void downloadCsv()} disabled={exporting}>{exporting ? "Exporting…" : "Export CSV"}</Button>
        <Button onClick={() => setModal("import")}>Import people</Button>
        <Button onClick={() => setModal("attendees")}>Bring in attendees</Button>
        <Button variant="primary" onClick={() => setModal("addperson")}>Add person</Button>
      </>}
    />

    <KpiStrip summary={summary} />

    {/* The two tabs of one area. Header and counts above them do not move when
        the body swaps — the sidebar row does not change either. */}
    <div class="people-tabs" role="tablist" aria-label="People">
      <button
        type="button"
        role="tab"
        class={`people-tab${tab === "people" ? " active" : ""}`}
        aria-selected={tab === "people"}
        onClick={() => navigate?.(peopleUrl(filters.listId))}
      >People</button>
      <button
        type="button"
        role="tab"
        class={`people-tab${tab === "lists" ? " active" : ""}`}
        aria-selected={tab === "lists"}
        onClick={() => navigate?.("/lists")}
      >Lists · <span class="people-tab-count tabular">{listsLabel}</span></button>
    </div>

    {tab === "lists" ? <ListsPanel
      lists={lists}
      error={listsError}
      onOpen={(list) => navigate?.(peopleUrl(list.id))}
      onDelete={(list) => void removeList(list)}
    /> : <>
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
      <Button small onClick={() => navigate?.("/lists")}>Lists · {listsLabel}</Button>
      <Button small class="people-save-control" onClick={() => setModal("savelist")}>{control.label}</Button>
      <Button small onClick={() => navigate?.("/pipeline")}>Outreach</Button>
    </div>

    {/* The list you are inside, said in the name you gave it. Rendered from the
        URL rather than from the resolved record, so the band is on screen from
        the first paint and the name fills into it — the table never shifts. */}
    {filters.listId ? <div class="people-listband">
      <span class="people-listband-mark" aria-hidden="true">◈</span>
      {/* The live region is the name and its line, not the whole band: the two
          buttons never change, and dragging them into every announcement is
          noise a screen reader cannot skip past. */}
      <span class="people-listband-said" aria-live="polite">
        <span class="people-listband-name">{
        listState.kind === "named" ? listState.list.name
          : listState.kind === "missing" ? "This list no longer exists"
            : listState.kind === "error" ? "This list could not be read"
              : "Reading this list…"
        }</span>
        <span class="people-listband-meta">{
        listState.kind === "named"
          ? `${listState.list.kind === "live" ? "Live" : "Fixed"} list · ${listState.list.member_count.toLocaleString()} ${listState.list.member_count === 1 ? "person" : "people"} · saved ${formatMoment(listState.list.created_at)}${listState.list.created_by_name ? ` by ${listState.list.created_by_name}` : ""}`
          : listState.kind === "missing" ? "It was deleted, or the link is from another organization."
            : listState.kind === "error" ? listState.message
              : " "
        }</span>
      </span>
      <span class="people-listband-actions">
        <Button small onClick={() => navigate?.("/lists")}>All lists</Button>
        <Button small onClick={leaveList}>Leave this list</Button>
      </span>
    </div> : null}

    {filterOpen ? <div class="people-filter-panel">
      <p class="people-filter-note">Counts show available values after the current list, search, and other filters; they are not narrowed by the selected chip.</p>
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
        <button type="button" class="people-chip" onClick={() => setSelected(new Map())}>
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
                    const next = new Map(current);
                    for (const row of rows) {
                      if (on) next.set(row.id, { id: row.id, name: row.name, do_not_contact: row.do_not_contact });
                      else next.delete(row.id);
                    }
                    return next;
                  });
                }}
              />
            </th>
            <th scope="col" class="people-name-column">Name</th>
            <th scope="col" class="people-email-column">Email</th>
            <th scope="col" class="people-company-column">Company</th>
            <th scope="col" class="people-title-column">Job title</th>
            <th scope="col" class="people-outreach-column">Outreach</th>
            <th scope="col" class="people-tags-column">Tags</th>
            <th scope="col" class="people-confs-column">Confs</th>
            <th scope="col" class="people-last-contact-column">Last contact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <tr key={row.id} class={selected.has(row.id) ? "selected" : ""}>
            <td class="people-check">
              <input
                type="checkbox"
                aria-label={`Select ${displayNames.get(row.id) ?? row.name}`}
                checked={selected.has(row.id)}
                onChange={() => toggleRow({ id: row.id, name: row.name, do_not_contact: row.do_not_contact })}
              />
            </td>
            <td class="people-name-column">
              <button type="button" class="people-rowlink" onClick={() => openPerson(row.id)}>
                <span class="people-cell-name">{displayNames.get(row.id) ?? row.name}</span>
              </button>
            </td>
            <td class="people-email-column"><span class="people-cell-mail people-cell-trunc">{row.email}</span></td>
            <td class="people-company-column"><span class="people-cell-trunc">{row.company ?? "—"}</span></td>
            <td class="people-title-column"><span class="people-cell-trunc">{row.title ?? "—"}</span></td>
            <td class="people-cell-outreach people-outreach-column">
              <strong title={row.outreach_target_event_name ? `→ ${row.outreach_target_event_name}` : "No conference target"}>
                {row.stage ? row.stage.replaceAll("_", " ") : "Not enrolled"}
              </strong>
              <span class={row.outreach_next_touch_on && row.outreach_next_touch_on < new Date().toISOString().slice(0, 10) ? "overdue" : ""}>
                {row.outreach_target_event_name ? `→ ${row.outreach_target_event_name}` : "→ No target"}
              </span>
            </td>
            <td class="people-tags-column">
              <span class="people-tagset">
                {row.tags.length === 0
                  ? <span class="people-tag">—</span>
                  : row.tags.map((tag) => <span class="people-tag accent" key={tag}>{tag}</span>)}
              </span>
            </td>
            <td class="people-confs-column tabular">{row.conference_count}</td>
            <td class="people-last-contact-column tabular">{formatDay(row.last_contact_at)}</td>
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
    </>}

    {toast ? <div class="people-hint" role="status" style={{ marginTop: "var(--s3)" }}>{toast}</div> : null}

    {openPersonId ? <PersonDrawer
      personId={openPersonId}
      onClose={closePerson}
      navigate={navigate}
      onChanged={() => setReloadToken((token) => token + 1)}
    /> : null}

    {modal === "attendees" ? <ImportAttendeesModal
      event={event ? { name: event.name, slug: event.slug } : null}
      onClose={() => setModal("")}
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
      people={[...selected.values()]}
      onClose={() => setModal("")}
      onSent={(result) => {
        setModal("");
        setSelected(new Map());
        announce(`${result.queued} message${result.queued === 1 ? "" : "s"} queued — every one is logged in the outbox${result.excluded_people.length ? ` · excluded: ${result.excluded_people.join(", ")}` : ""}`);
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
      selectedIds={[...selected.keys()]}
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
