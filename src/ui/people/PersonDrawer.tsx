/**
 * One person, in one scrolling drawer — identity, tags, internal notes,
 * connections across every conference, and the activity feed.
 *
 * Not a tab chain: a tab chain makes an organizer hunt for the note they wrote
 * last week, and the whole record is short enough to scroll.
 *
 * Every write here goes to the server and the drawer re-reads the record from
 * the response. Nothing is marked saved that is not saved.
 */
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { errorSummary } from "../shell/api-client";
import { Button } from "../shell/components";
import {
  addNote,
  addTag,
  fetchPerson,
  fetchPersonActivity,
  formatDay,
  formatMoment,
  removeTag,
  setStage,
  updatePerson,
  type PersonActivity,
  type PersonRecord,
} from "./people-api";
import { PIPELINE_STAGES } from "./pipeline-stages";

export function PersonDrawer({
  personId,
  onClose,
  onChanged,
  navigate,
}: {
  personId: string;
  onClose: () => void;
  onChanged?: () => void;
  navigate?: (target: string) => void;
}): JSX.Element {
  const [record, setRecord] = useState<PersonRecord | null>(null);
  const [error, setError] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Lens two is paged on the server, so the drawer holds the pages it has asked
  // for rather than the whole relationship. A write re-reads the record, which
  // resets this to page one — the newest rows, which is what a write produced.
  const [olderActivity, setOlderActivity] = useState<PersonActivity[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityNextCursor, setActivityNextCursor] = useState<string | null>(null);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setRecord(null);
    setError("");
    setOlderActivity([]);
    setActivityPage(1);
    setActivityNextCursor(null);
    setActivityHasMore(false);
    fetchPerson(personId, controller.signal)
      .then((next) => {
        setRecord(next);
        setActivityNextCursor(next.activity_next_cursor);
        setActivityHasMore(next.activity_has_more);
      })
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(errorSummary(caught)); });
    return () => controller.abort();
  }, [personId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Re-read rather than patch: the note that comes back is the one on the
  // server, which is the only one worth showing.
  const reread = async () => {
    setOlderActivity([]);
    setActivityPage(1);
    setActivityNextCursor(null);
    setActivityHasMore(false);
    const next = await fetchPerson(personId);
    setRecord(next);
    setActivityNextCursor(next.activity_next_cursor);
    setActivityHasMore(next.activity_has_more);
    onChanged?.();
  };

  const loadMoreActivity = async () => {
    if (loadingMore || !activityHasMore || !activityNextCursor) return;
    setLoadingMore(true);
    try {
      const next = await fetchPersonActivity(personId, activityPage + 1, activityNextCursor);
      // The cursor is the server's stable boundary. A row written now belongs
      // to a newer window; concatenation cannot repeat or skip it.
      setOlderActivity((rows) => [...rows, ...next.data]);
      setActivityPage(next.page);
      setActivityNextCursor(next.next_cursor);
      setActivityHasMore(next.has_more);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setLoadingMore(false);
    }
  };

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await reread();
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveTag = async () => {
    const tag = tagDraft.trim();
    if (!tag) return;
    await run(async () => { await addTag(personId, tag); setTagDraft(""); });
  };

  const saveCard = (input: { target_event_id?: string | null; next_touch_on?: string | null }) => {
    if (!record?.card) return;
    void run(() => setStage(personId, {
      stage: record.card!.stage,
      target_event_id: input.target_event_id === undefined ? record.card!.target_event_id : input.target_event_id,
      next_touch_on: input.next_touch_on === undefined ? record.card!.next_touch_on : input.next_touch_on,
    }));
  };

  const boardHref = `/pipeline?person=${encodeURIComponent(personId)}`;

  const person = record?.person;
  // Page one comes with the record; later pages accumulate beside it. The two
  // are concatenated rather than merged, because the server already ordered
  // them and re-sorting here is how a client starts disagreeing with the log.
  const shownActivity = record ? [...record.activity, ...olderActivity] : [];

  return <>
    <button type="button" class="people-scrim" aria-label="Close this person" onClick={onClose} />
    <aside class="people-drawer" role="dialog" aria-label={person?.name ?? "Person"}>
      <div class="people-drawer-head">
        <div>
          <h2>{person?.name ?? "Reading…"}</h2>
          <div class="people-drawer-sub">
            {person ? [person.title, person.company].filter(Boolean).join(" · ") || "No job title or company recorded" : personId}
          </div>
        </div>
        <Button small onClick={onClose}>Close</Button>
      </div>

      <div class="people-drawer-body">
        {error ? <div class="people-state error" role="alert">{error}</div> : null}
        {!record && !error ? <div class="people-state">Reading this person’s record…</div> : null}

        {record ? <>
          <section class="people-section">
            <h3>Profile</h3>
            <dl class="people-kv">
              <dt>Email</dt><dd class="people-cell-mail">{record.person.email}</dd>
              <dt>Company</dt><dd>{record.person.company ?? "—"}</dd>
              <dt>Job title</dt><dd>{record.person.title ?? "—"}</dd>
              <dt>Conferences</dt><dd class="tabular">{record.person.conference_count}</dd>
              <dt>Last contact</dt><dd class="tabular">{formatDay(record.person.last_contact_at)}</dd>
              <dt>Stage</dt><dd>{record.card ? record.card.stage_name : "Not in the pipeline"}</dd>
            </dl>
            {record.person.bio ? <p class="people-bio">{record.person.bio}</p> : <p class="people-hint">No bio yet.</p>}
            <div class="people-drawer-action-row">
              <span class="people-hint">{record.person.do_not_contact ? "Excluded from compose" : "Available for compose"}</span>
              <Button
                small
                variant={record.person.do_not_contact ? "" : "danger"}
                aria-pressed={record.person.do_not_contact}
                disabled={busy}
                onClick={() => void run(() => updatePerson(personId, { do_not_contact: !record.person.do_not_contact }))}
              >{record.person.do_not_contact ? "Clear do-not-contact" : "Mark do-not-contact"}</Button>
            </div>
          </section>

          {record.card ? <section class="people-section people-outreach-status">
            <h3>Outreach</h3>
            <p>
              Outreach: {record.card.stage_name} → {record.card.target_event_name ?? record.person.outreach_target_event_name ?? "No conference target"} ·{" "}
              <a
                href={boardHref}
                onClick={(event) => {
                  if (!navigate) return;
                  event.preventDefault();
                  navigate(boardHref);
                }}
              >Open board</a>
            </p>
          </section> : null}

          <section class="people-section">
            <h3>Tags</h3>
            <div class="people-tagset" style={{ marginBottom: "var(--s2)" }}>
              {record.person.tags.length === 0
                ? <span class="people-hint">No tags yet.</span>
                : record.person.tags.map((tag) => <button
                  type="button"
                  class="people-chip on"
                  key={tag}
                  disabled={busy}
                  onClick={() => void run(() => removeTag(personId, tag))}
                >{tag} <span class="people-chip-x" aria-hidden="true">×</span></button>)}
            </div>
            <form
              style={{ display: "flex", gap: "6px" }}
              onSubmit={(event) => { event.preventDefault(); void saveTag(); }}
            >
              <input
                class="people-tag-input"
                placeholder="Add a tag…"
                aria-label="Add a tag"
                value={tagDraft}
                onInput={(event) => setTagDraft((event.currentTarget as HTMLInputElement).value)}
                // Enter in a one-field form is how anyone types a tag, and
                // implicit form submission is not reliable in every engine the
                // product is driven in. The key is handled rather than assumed.
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void saveTag();
                }}
              />
              <Button small type="submit" disabled={busy}>Add</Button>
            </form>
          </section>

          <section class="people-section">
            <h3>Internal notes</h3>
            <div class="people-notebox">
              <textarea
                placeholder="Write an internal note — never visible to this person."
                aria-label="Write an internal note"
                value={noteDraft}
                onInput={(event) => setNoteDraft((event.currentTarget as HTMLTextAreaElement).value)}
              />
              <div>
                <Button
                  small
                  disabled={busy || noteDraft.trim().length === 0}
                  onClick={() => void run(async () => { await addNote(personId, noteDraft.trim()); setNoteDraft(""); })}
                >{busy ? "Saving…" : "Save note"}</Button>
              </div>
            </div>
            <div class="people-notes">
              {record.notes.length === 0
                ? <p class="people-hint">No notes yet. Notes stay internal and follow the person across conferences.</p>
                : record.notes.map((note) => <div class="people-note" key={note.id}>
                  <p>{note.body}</p>
                  <div class="people-note-meta">{note.actor_name ?? "Someone"} · {formatMoment(note.created_at)}</div>
                </div>)}
            </div>
          </section>

          <section class="people-section">
            <h3>Connections — conferences &amp; sessions</h3>
            {record.connections.length === 0
              ? <p class="people-hint">No sessions yet — this person has not been on a program.</p>
              : record.connections.map((connection) => <div class="people-connection" key={connection.submission_id + connection.role}>
                <div>
                  <div class="people-connection-title">{connection.title}</div>
                  <div class="people-connection-where">{connection.event_name} · {connection.role} · {connection.status}</div>
                </div>
              </div>)}
          </section>

          <section class="people-section">
            <h3>Outreach</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
              <label class="people-hint" for="people-stage-select">Stage</label>
              <select
                id="people-stage-select"
                class="people-moveto"
                disabled={busy}
                value={record.card?.stage ?? ""}
                onChange={(event) => {
                  const stage = (event.currentTarget as HTMLSelectElement).value;
                  if (stage) void run(() => setStage(personId, {
                    stage,
                    target_event_id: record.card?.target_event_id ?? null,
                    next_touch_on: record.card?.next_touch_on ?? null,
                  }));
                }}
              >
                <option value="">Not in the pipeline</option>
                {PIPELINE_STAGES.map((stage) => <option value={stage.id} key={stage.id}>{stage.name}</option>)}
              </select>
            </div>
            <label class="people-field" style={{ marginTop: "var(--s2)" }}>
              <span>Target conference</span>
              <select
                disabled={busy || !record.card}
                value={record.card?.target_event_id ?? ""}
                onChange={(event) => saveCard({ target_event_id: (event.currentTarget as HTMLSelectElement).value || null })}
              >
                <option value="">No conference target</option>
                {record.target_events.map((target) => <option value={target.id} key={target.id}>{target.name}</option>)}
              </select>
            </label>
            <label class="people-field">
              <span>Next touch</span>
              <input
                type="date"
                disabled={busy || !record.card}
                value={record.card?.next_touch_on ?? ""}
                onChange={(event) => saveCard({ next_touch_on: (event.currentTarget as HTMLInputElement).value || null })}
              />
            </label>
            {record.stage_history.length === 0
              ? <p class="people-hint" style={{ marginTop: "var(--s2)" }}>Not enrolled yet. Pick a stage and the move is recorded with a timestamp.</p>
              : <div class="people-feed" style={{ marginTop: "var(--s2)" }}>
                {[...record.stage_history].reverse().map((entry) => <div class="people-feed-row" key={entry.id}>
                  <span class="people-feed-dot accent" />
                  <div>
                    <div class="people-feed-text"><strong>{entry.stage_name}</strong>{entry.score === null ? "" : ` · score ${entry.score}`}</div>
                    <div class="people-feed-when">{formatMoment(entry.created_at)} · {entry.actor_name ?? "Someone"}</div>
                  </div>
                </div>)}
              </div>}
          </section>

          <section class="people-section">
            <h3>Activity</h3>
            {shownActivity.length === 0
              ? <p class="people-hint">No recorded activity.</p>
              : <>
                <div class="people-feed">
                  {shownActivity.map((entry) => <div class="people-feed-row" key={entry.id}>
                    <span class={`people-feed-dot ${entry.kind === "audit" ? "" : "accent"}`} />
                    <div>
                      {/* Summary and detail are composed on the server, so this
                          row reads exactly as the same row does in the
                          organization log and on a submission's timeline. */}
                      <div class="people-feed-text">{entry.summary}{entry.detail ? ` — ${entry.detail}` : ""}</div>
                      <div class="people-feed-when">{formatMoment(entry.created_at)}{entry.actor_name ? ` · ${entry.actor_name}` : ""}</div>
                    </div>
                  </div>)}
                </div>
                {/* The count holds this row whether or not more can be loaded,
                    so the control's disappearance never moves the feed. */}
                <div class="people-feed-foot">
                  <span class="people-hint tabular">{shownActivity.length} of {record.activity_total}</span>
                  {activityHasMore
                    ? <Button small disabled={loadingMore} onClick={() => void loadMoreActivity()}>{loadingMore ? "Loading…" : "Load more"}</Button>
                    : <span class="people-hint">Complete</span>}
                </div>
              </>}
          </section>
        </> : null}
      </div>
    </aside>
  </>;
}
