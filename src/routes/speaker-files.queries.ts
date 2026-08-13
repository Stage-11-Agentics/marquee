/**
 * One speaker's files, as the organizer's record shows them.
 *
 * A conference holds two kinds of file for a speaker and they are stored as
 * two different owners: the profile photo the speaker uploads for themselves
 * (`person_headshot`, owned by the person) and the deliverables the conference
 * asked for (`task_upload`, owned by a file-request task). The library at
 * /files is the deliverable half only — by design, because it is a chase
 * board. The speaker record is where both halves have to appear, or an
 * organizer looking at one human still cannot answer "what has she sent us?".
 *
 * This module unions the two owners into one list and reads version history
 * through `lib/files/versions`, so "current" is the same derivation the portal
 * and the library already use. It never re-derives a latest of its own.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { listVersionsForOwners, type FileVersionList } from "../lib/files/versions";
import { MEDIA_LINK_POLICY } from "../lib/r2/media-links";

export interface SpeakerFileGroup {
  /** The owner the files hang from — the person for a photo, the task for a deliverable. */
  id: string;
  kind: "headshot" | "deliverable";
  label: string;
  /** Deliverables only; a profile photo is never owed by a date. */
  due_at: number | null;
  cancelled_at: number | null;
  session: { id: string; title: string } | null;
  versions: FileVersionList;
}

export interface SpeakerFilesSnapshot {
  groups: SpeakerFileGroup[];
  /** Live deliverable slots — cancelled work is still listed but is not owed. */
  expected: number;
  received: number;
  /** Named so a caller can see the expiry and revocation boundary of these URLs. */
  link_policy: typeof MEDIA_LINK_POLICY;
}

interface TaskRow {
  id: string;
  title: string;
  template_name: string;
  due_at: number;
  cancelled_at: number | null;
  submission_id: string | null;
  submission_title: string | null;
}

/**
 * Order reads as a record, not a queue: the profile photo first because it is
 * the one file every speaker has, then deliverables by due date, then work the
 * conference cancelled. A cancelled request whose file already arrived stays
 * visible — dropping it would read as data loss.
 */
function compareGroups(left: SpeakerFileGroup, right: SpeakerFileGroup): number {
  const rank = (group: SpeakerFileGroup): number =>
    group.kind === "headshot" ? 0 : group.cancelled_at !== null ? 2 : 1;
  const byRank = rank(left) - rank(right);
  if (byRank !== 0) return byRank;
  const byDue = (left.due_at ?? 0) - (right.due_at ?? 0);
  if (byDue !== 0) return byDue;
  return left.label.localeCompare(right.label);
}

export async function listSpeakerFiles(
  db: D1Database,
  eventId: string,
  personId: string,
  mediaPublicOrigin: string,
  mediaSigningSecret: string,
): Promise<SpeakerFilesSnapshot> {
  const tasks = await db
    .prepare(
      `SELECT task.id, task.title, template.name AS template_name, task.due_at, task.cancelled_at,
              submission.id AS submission_id, submission.title AS submission_title
       FROM speaker_tasks task
       JOIN task_templates template ON template.id = task.template_id AND template.event_id = task.event_id
       LEFT JOIN submissions submission ON submission.id = task.submission_id AND submission.event_id = task.event_id
       WHERE task.event_id = ? AND task.person_id = ? AND task.kind = 'file'`,
    )
    .bind(eventId, personId)
    .all<TaskRow>();

  const [headshots, deliverables] = await Promise.all([
    listVersionsForOwners(db, "person_headshot", [personId], mediaPublicOrigin, mediaSigningSecret),
    listVersionsForOwners(db, "task_upload", tasks.results.map((task) => task.id), mediaPublicOrigin, mediaSigningSecret),
  ]);

  const headshotList = headshots.get(personId);
  const groups: SpeakerFileGroup[] = [];
  // The photo row is listed even when empty: "no headshot yet" is the single
  // most-chased fact about a speaker, and a missing row cannot be chased.
  if (headshotList) {
    groups.push({
      id: personId,
      kind: "headshot",
      label: "Profile photo",
      due_at: null,
      cancelled_at: null,
      session: null,
      versions: headshotList,
    });
  }
  for (const task of tasks.results) {
    const list = deliverables.get(task.id);
    if (!list) continue;
    groups.push({
      id: task.id,
      kind: "deliverable",
      label: task.title || task.template_name,
      due_at: task.due_at,
      cancelled_at: task.cancelled_at,
      session: task.submission_id
        ? { id: task.submission_id, title: task.submission_title ?? "Untitled session" }
        : null,
      versions: list,
    });
  }
  groups.sort(compareGroups);

  const live = groups.filter((group) => group.kind === "deliverable" && group.cancelled_at === null);
  return {
    groups,
    expected: live.length,
    received: live.filter((group) => group.versions.latest !== null).length,
    link_policy: MEDIA_LINK_POLICY,
  };
}
