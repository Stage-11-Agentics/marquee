/**
 * Lists — the named groups of people an organizer addresses more than once.
 *
 * A list is a way of looking at People rather than a separate place people
 * live, so this is a tab inside the People screen and not a screen of its own:
 * the header, the org's counts and the sidebar row above it all stay put while
 * the body swaps. Opening a list takes the reader back to the People tab with
 * the list applied.
 *
 * It renders what the People screen already read. One fetch owns the list of
 * lists, because the count is on screen on both tabs.
 */
import type { JSX } from "preact";

import { Button, EmptyState } from "../shell/components";
import { formatMoment, type SavedPersonList } from "./people-api";

export function ListsPanel({ lists, error, onOpen, onDelete }: {
  lists: SavedPersonList[] | null;
  error: string;
  onOpen: (list: SavedPersonList) => void;
  onDelete: (list: SavedPersonList) => void;
}): JSX.Element {
  return <>
    <p class="people-tabnote">A named group of people you address more than once — “the 2026 track chairs,” “keynote shortlist.” A Live list is a saved search: anyone who newly matches joins it. A Fixed list holds exactly who you put in it.</p>

    {error ? <div class="people-table-wrap"><div class="people-state error" role="alert">{error}</div></div> : null}
    {!lists && !error ? <div class="people-table-wrap"><div class="people-state">Reading your lists…</div></div> : null}

    {lists && lists.length === 0 ? <EmptyState
      title="No lists yet"
      copy="Filter People to the group you keep coming back to, then save it. A list is reusable as an email audience and as a pipeline source."
    /> : null}

    {lists && lists.length > 0 ? <div class="people-table-wrap">
      {lists.map((list) => <div class="people-list-row" key={list.id}>
        <div>
          <button type="button" class="people-rowlink" onClick={() => onOpen(list)}>
            <span class="people-list-name">{list.name}</span>
          </button>
          <div class="people-list-created">
            Created {formatMoment(list.created_at)}{list.created_by_name ? ` · ${list.created_by_name}` : ""}
          </div>
        </div>
        <span class={`people-list-kind ${list.kind === "live" ? "live" : ""}`}>{list.kind}</span>
        <span class="people-list-count">{list.member_count} people</span>
        <span style={{ display: "flex", gap: "var(--s2)", justifyContent: "flex-end" }}>
          <Button small onClick={() => onOpen(list)}>Open</Button>
          <Button small onClick={() => onDelete(list)}>Delete</Button>
        </span>
      </div>)}
      <div class="people-tablefoot">
        <span>{lists.length} list{lists.length === 1 ? "" : "s"}</span>
        <span>A list is reusable as an email audience and as a pipeline source</span>
      </div>
    </div> : null}
  </>;
}
