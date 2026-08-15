import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { BoardCard, BoardColumn, BoardFacets, BoardListEnvelope, BoardStage } from "../../api/board";
import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, EmptyState, PageHeader } from "../shell/components";
import "./board.css";

const PAGE_SIZE = 100;
const CARD_HEIGHT = 132;
/* board.css sizes the columns to the window, so the height this component needs
   for its virtual window is a fact to read off the DOM rather than a number to
   impose on it — which is what keeps the measurement from chasing itself: how
   many cards are rendered cannot change how tall the list is. The fallback is
   what the first render assumes before the observer has spoken. */
const ASSUMED_COLUMN_HEIGHT = 560;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; cards: BoardCard[]; columns: BoardColumn[]; facets: BoardFacets };

interface Props {
  eventId: string;
  navigate: (target: string) => void;
}

interface FilterState {
  q: string;
  kind: "" | "abstract" | "session";
  track: string;
  format: string;
  wave: string;
}

const EMPTY_FILTERS: FilterState = { q: "", kind: "", track: "", format: "", wave: "" };

export function BoardKindNote({ kind }: { kind: FilterState["kind"] }): JSX.Element | null {
  return kind === "session"
    ? <div class="board-kind-note" role="note">Sessions are guaranteed — they skip evaluation and enter at Ready to place. The earlier columns are empty by design.</div>
    : null;
}

function BoardCardButton({ card, navigate }: { card: BoardCard; navigate: (target: string) => void }): JSX.Element {
  return <button
    class="program-board-card"
    type="button"
    aria-label={`Open ${card.id}: ${card.title}`}
    onClick={() => navigate(`/submissions/${card.id}`)}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        navigate(`/submissions/${card.id}`);
      }
    }}
  >
    <span class="program-board-card-top"><span class={`chip entity-chip ${card.kind}`}>{card.kind === "session" ? "Session" : "Abstract"}</span><span class="tabular">{card.id}</span></span>
    <strong class="program-board-card-title" title={card.title}>{card.title}</strong>
    <span class="program-board-card-speakers" title={card.speakers.map((speaker) => speaker.name).join(", ")}>{card.speakers.length ? card.speakers.map((speaker) => speaker.name).join(" · ") : "—"}</span>
    <span class="program-board-card-tracks">{card.tracks.length ? card.tracks.slice(0, 2).map((track) => <span key={track.id} class="chip track-chip" style={{ borderLeftColor: track.color }}>{track.name}</span>) : "—"}</span>
    {card.slot && <span class="program-board-slot"><span class="chip slot-chip">{card.slot.day} · {card.slot.time} · {card.slot.room}</span>{!card.slot.is_published && <span class="chip not-public">Not yet public</span>}</span>}
    <span class="program-board-card-foot"><span>{card.format ?? "—"}{card.wave ? ` · ${card.wave.name}` : ""}</span><strong class="tabular">{card.time_in_stage}</strong></span>
  </button>;
}

function VirtualColumn({ column, cards, navigate }: { column: BoardColumn; cards: BoardCard[]; navigate: (target: string) => void }): JSX.Element {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(ASSUMED_COLUMN_HEIGHT);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const read = () => setViewportHeight(node.clientHeight || ASSUMED_COLUMN_HEIGHT);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / CARD_HEIGHT) - 3);
  const visibleCount = Math.ceil(viewportHeight / CARD_HEIGHT) + 6;
  const visible = cards.slice(first, first + visibleCount);
  return <section class="program-board-column" aria-label={`${column.label}, ${column.count.toLocaleString()} records`}>
    <header class="program-board-column-head"><div><strong>{column.label}</strong><small>{column.entry_action}</small></div><span class="program-board-count tabular">{column.count.toLocaleString()}</span></header>
    <div class="program-board-derived-note">{column.id === "scheduled" ? "placed on the working agenda" : column.id === "published" ? "live on the public site" : column.id === "declined" ? "decision history" : "Record-owned actions"}</div>
    <div class="program-board-column-list" ref={listRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      {cards.length === 0 ? <div class="program-board-empty">No matching submissions</div> : <div style={{ height: `${cards.length * CARD_HEIGHT}px`, position: "relative" }}>
        <div class="program-board-window" style={{ transform: `translateY(${first * CARD_HEIGHT}px)` }}>
          {visible.map((card) => <BoardCardButton key={card.id} card={card} navigate={navigate} />)}
        </div>
      </div>}
    </div>
  </section>;
}

async function readBoard(eventId: string, filters: FilterState, signal: AbortSignal): Promise<LoadState> {
  const query = new URLSearchParams({ per_page: String(PAGE_SIZE), sort: "newest" });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  const cards: BoardCard[] = [];
  let page = 1;
  let first: BoardListEnvelope | null = null;
  while (true) {
    query.set("page", String(page));
    const result = await apiFetch<BoardListEnvelope>(`/api/v1/events/${encodeURIComponent(eventId)}/board?${query.toString()}`, { signal, route: "/api/v1/events/{eventId}/board" });
    first ??= result;
    cards.push(...result.data);
    if (page >= result.total_pages || result.data.length === 0) break;
    page += 1;
  }
  return { kind: "ready", cards, columns: first?.columns ?? [], facets: first?.facets ?? { tracks: [], formats: [], waves: [] } };
}

export function ProgramBoardPage({ eventId, navigate }: Props): JSX.Element {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const filterIdentity = JSON.stringify(filters);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    readBoard(eventId, filters, controller.signal)
      .then(setState)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: errorSummary(error) });
      });
    return () => controller.abort();
  }, [eventId, filterIdentity]);

  const cardsByStage = useMemo(() => {
    const grouped = new Map<BoardStage, BoardCard[]>();
    if (state.kind !== "ready") return grouped;
    for (const card of state.cards) grouped.set(card.stage, [...(grouped.get(card.stage) ?? []), card]);
    return grouped;
  }, [state]);

  const updateFilter = (key: keyof FilterState, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const hasFilters = Object.values(filters).some(Boolean);
  const ready = state.kind === "ready" ? state : null;
  return <div class="program-board-page">
    <PageHeader title="Program board" copy={ready ? `${ready.cards.length.toLocaleString()} records · seven lifecycle stages + terminal outcomes · read-only record projection.` : "Reading the conference record projection…"} actions={<Button small onClick={() => setFilters(EMPTY_FILTERS)}>Reset filters</Button>} />
    <Card class="program-board-card-shell">
      <form class="program-board-filters" onSubmit={(event) => event.preventDefault()}>
        <label class="program-board-search"><span class="sr-only">Search the program board</span><input value={filters.q} onInput={(event) => updateFilter("q", event.currentTarget.value)} placeholder="Search title, speaker, ID, or company" /></label>
        <label><span class="sr-only">Type</span><select value={filters.kind} onChange={(event) => updateFilter("kind", event.currentTarget.value)}><option value="">All types</option><option value="abstract">Abstracts</option><option value="session">Sessions</option></select></label>
        <label><span class="sr-only">Track</span><select value={filters.track} onChange={(event) => updateFilter("track", event.currentTarget.value)}><option value="">All tracks</option>{ready?.facets.tracks.map((track) => <option value={track.id}>{track.name}</option>)}</select></label>
        <label><span class="sr-only">Format</span><select value={filters.format} onChange={(event) => updateFilter("format", event.currentTarget.value)}><option value="">All formats</option>{ready?.facets.formats.map((format) => <option value={format.id}>{format.name}</option>)}</select></label>
        <label><span class="sr-only">Wave</span><select value={filters.wave} onChange={(event) => updateFilter("wave", event.currentTarget.value)}><option value="">All waves</option>{ready?.facets.waves.map((wave) => <option value={wave.id}>{wave.name}</option>)}</select></label>
        <span class="program-board-filter-summary tabular">{ready ? `${ready.cards.length.toLocaleString()} matching` : "—"}</span>
      </form>
      <BoardKindNote kind={filters.kind} />
      <div class="program-board-scroll-note" role="note"><strong>{ready ? `${ready.columns.length} stages` : "Program stages"}</strong><span>scroll sideways to see later columns</span></div>
      {state.kind === "loading" && <div class="program-board-state">Loading the program board…</div>}
      {state.kind === "error" && <div class="program-board-state error"><strong>Program board did not load</strong><span>{state.message}</span><Button small onClick={() => setFilters({ ...filters })}>Retry</Button></div>}
      {ready && ready.cards.length === 0
        ? <EmptyState class="program-board-empty-state" title={hasFilters ? "No submissions match these filters" : "No submissions on the program board yet"} copy={hasFilters ? "Clear a filter to bring the conference record back into view." : "Add the first Abstract or Session to start moving the conference through its stages."} action={hasFilters ? <Button variant="primary" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button> : <Button variant="primary" onClick={() => navigate("/submissions/new")}>+ Add session</Button>} />
        : ready && <div class="program-board-grid">{ready.columns.map((column) => <VirtualColumn key={column.id} column={column} cards={cardsByStage.get(column.id) ?? []} navigate={navigate} />)}</div>}
    </Card>
  </div>;
}
