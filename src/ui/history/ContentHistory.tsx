import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { Button } from "../shell/components";
import "./history.css";

/**
 * The change history for one record, with restore.
 *
 * Deliberately knows nothing about submissions: the submission record and the
 * speaker record show the same timeline over the same `audit_log` rows, and the
 * only thing that differs is which entity the caller loaded. Anything
 * submission-shaped in here would have to be duplicated the moment the second
 * surface adopted it.
 */
export interface HistoryEntryView {
  id: string;
  action: string;
  actor_name: string | null;
  created_at: number;
  before: unknown;
  restorable?: boolean;
}

interface Props {
  entries: HistoryEntryView[];
  /** Omit to render the timeline read-only — no restore controls appear. */
  onRestore?: (entryId: string) => void | Promise<void>;
  busy?: boolean;
  /** When true the record is on the public site, so a restore changes it. */
  livePublicly?: boolean;
  label: (action: string) => string;
  moment: (value: number | null) => string;
  emptyCopy?: string;
}

function titleBefore(before: unknown): string | null {
  if (!before || typeof before !== "object") return null;
  const value = (before as { title?: unknown }).title;
  return typeof value === "string" ? value : null;
}

/** Enough of the old title to recognise it, without letting a long one wrap the row. */
function preview(value: string): string {
  return value.length > 52 ? `${value.slice(0, 51)}…` : value;
}

export function ContentHistory({ entries, onRestore, busy = false, livePublicly = false, label, moment, emptyCopy }: Props): JSX.Element {
  const [confirming, setConfirming] = useState<string | null>(null);

  if (entries.length === 0) return <span class="subtle">{emptyCopy ?? "No history recorded."}</span>;

  return <div class="history-list">
    {entries.map((entry) => {
      const restorable = Boolean(onRestore && entry.restorable);
      const previousTitle = titleBefore(entry.before);
      return <div class="history-row" key={entry.id}>
        <div class="history-fact">
          <strong>{label(entry.action)}</strong>
          {/* An audit row with no person behind it is a system write, and saying
              so is more honest than borrowing a name that did not do it. */}
          <span>{entry.actor_name || "Conference team"}</span>
          <time class="tabular">{moment(entry.created_at)}</time>
        </div>
        {/* The action column is present on every row, restorable or not, so a
            row never changes width when the timeline reloads. */}
        <div class="history-action">
          {restorable && (confirming === entry.id
            ? <span class="history-confirm">
                <Button small variant="primary" disabled={busy} onClick={() => { setConfirming(null); void onRestore?.(entry.id); }}>Confirm</Button>
                <Button small variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
              </span>
            : <Button small variant="ghost" disabled={busy} onClick={() => setConfirming(entry.id)}>Restore this version</Button>)}
        </div>
        {/* On a live Session a restore rewrites the public agenda. Saying so
            before the second click is the whole point of having a second
            click; a bare "Confirm" would make this the quiet path around the
            warning the editor gives. */}
        {restorable && confirming === entry.id && livePublicly
          && <small class="history-warning">This replaces what attendees see on the public agenda.</small>}
        {/* Naming the version the button restores TO is what makes "Restore"
            unambiguous. An audit row records a change, so the version it
            offers is the one that preceded it — a reader should not have to
            infer that, or click to find out. */}
        {restorable && previousTitle && <small class="history-preview">Restores: “{preview(previousTitle)}”</small>}
      </div>;
    })}
  </div>;
}
