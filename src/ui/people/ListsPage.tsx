/**
 * Lists — the named groups of people an organizer addresses more than once.
 *
 * Opening one takes the reader back to People with the list applied, because a
 * list is a way of looking at People rather than a separate place people live.
 */
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { errorSummary } from "../shell/api-client";
import { Button, EmptyState, PageHeader } from "../shell/components";
import { deleteList, fetchLists, formatMoment, type SavedPersonList } from "./people-api";
import "./people.css";

export function ListsPage({ navigate }: { navigate?: (target: string) => void }): JSX.Element {
  const [lists, setLists] = useState<SavedPersonList[] | null>(null);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchLists(controller.signal)
      .then((payload) => setLists(payload.data))
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(errorSummary(caught)); });
    return () => controller.abort();
  }, [reloadToken]);

  const remove = async (list: SavedPersonList) => {
    setError("");
    try {
      await deleteList(list.id);
      setReloadToken((token) => token + 1);
    } catch (caught) {
      setError(errorSummary(caught));
    }
  };

  return <div class="people-page">
    <PageHeader
      title="Lists"
      copy="A named group of people you address more than once — “the 2026 track chairs,” “keynote shortlist.” A Live list is a saved search: anyone who newly matches joins it. A Fixed list holds exactly who you put in it."
      actions={<Button onClick={() => navigate?.("/people")}>Back to People</Button>}
    />

    {error ? <div class="people-table-wrap"><div class="people-state error" role="alert">{error}</div></div> : null}
    {!lists && !error ? <div class="people-table-wrap"><div class="people-state">Reading your lists…</div></div> : null}

    {lists && lists.length === 0 ? <EmptyState
      title="No lists yet"
      copy="Filter People to the group you keep coming back to, then save it. A list is reusable as an email audience and as a pipeline source."
      action={<Button variant="primary" onClick={() => navigate?.("/people")}>Open People</Button>}
    /> : null}

    {lists && lists.length > 0 ? <div class="people-table-wrap">
      {lists.map((list) => <div class="people-list-row" key={list.id}>
        <div>
          <button type="button" class="people-rowlink" onClick={() => navigate?.(`/people?list=${encodeURIComponent(list.id)}`)}>
            <span class="people-list-name">{list.name}</span>
          </button>
          <div class="people-list-created">
            Created {formatMoment(list.created_at)}{list.created_by_name ? ` · ${list.created_by_name}` : ""}
          </div>
        </div>
        <span class={`people-list-kind ${list.kind === "live" ? "live" : ""}`}>{list.kind}</span>
        <span class="people-list-count">{list.member_count} people</span>
        <span style={{ display: "flex", gap: "var(--s2)", justifyContent: "flex-end" }}>
          <Button small onClick={() => navigate?.(`/people?list=${encodeURIComponent(list.id)}`)}>Open</Button>
          <Button small onClick={() => void remove(list)}>Delete</Button>
        </span>
      </div>)}
      <div class="people-tablefoot">
        <span>{lists.length} list{lists.length === 1 ? "" : "s"}</span>
        <span>A list is reusable as an email audience and as a pipeline source</span>
      </div>
    </div> : null}
  </div>;
}
