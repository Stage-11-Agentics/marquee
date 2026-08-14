/** @jsxImportSource preact */

/**
 * What this speaker has sent the conference, on the speaker's own record.
 *
 * The /files library answers "whose deck is missing" across the whole
 * conference; this answers "what has *she* sent us" for one human, and it has
 * to include the profile photo the library deliberately leaves out — a photo
 * is not a chased deliverable, but an organizer opening a speaker record is
 * still asking about it.
 *
 * Rendering is `FileVersions`, unchanged, so a file reads the same here, in
 * the library, and in the speaker's own portal.
 */

import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { SpeakerFilesSnapshot } from "../../routes/speaker-files.queries";
import { FileVersions } from "../files/FileVersions";
import { apiFetch, errorSummary } from "../shell/api-client";

function formatDue(value: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

type SpeakerFileGroup = SpeakerFilesSnapshot["groups"][number];

function groupMeta(group: SpeakerFileGroup): string {
  if (group.cancelled_at !== null) return "Cancelled request";
  if (group.kind === "headshot") return group.versions.latest === null ? "Not uploaded yet" : "Speaker-provided";
  if (group.versions.latest !== null) return "Received";
  return group.due_at !== null ? `Due ${formatDue(group.due_at)}` : "Not received yet";
}

export function SpeakerFilesPanel({ eventId, personId }: { eventId: string; personId: string }): JSX.Element {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; files: SpeakerFilesSnapshot }
  >({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    apiFetch<{ data: SpeakerFilesSnapshot }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(personId)}/files`,
      { route: "/api/v1/events/{eventId}/speakers/{personId}/files", signal: controller.signal },
    )
      .then((body) => setState({ kind: "ready", files: body.data }))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: errorSummary(caught) });
      });
    return () => controller.abort();
  }, [eventId, personId]);

  const files = state.kind === "ready" ? state.files : null;
  const headshot = files?.groups.find((group) => group.kind === "headshot");

  return <section class="speaker-section speaker-files" aria-label="Speaker files">
    <h3>Files</h3>
    {state.kind === "loading" ? <p class="speaker-empty-line">Reading this speaker's files…</p> : null}
    {state.kind === "error"
      ? <p class="speaker-empty-line alarm-text" role="alert">{state.message}</p>
      : null}

    {files ? <div class="speaker-files-summary" aria-label="File summary">
      <p class="speaker-note tabular">
        <strong>Requested deliverables</strong>
        <span>{files.expected === 0 ? "None requested yet." : `${files.received} of ${files.expected} received.`}</span>
      </p>
      <p class="speaker-note tabular">
        <strong>Profile photo</strong>
        <span>{headshot?.versions.latest ? "Received." : "Not received yet."}</span>
      </p>
    </div> : null}

    {/* No "nothing here" branch: the profile-photo row is always present, and
        its own empty copy is the honest answer for a speaker who has sent
        nothing. A second empty state would be unreachable. */}
    {files ? <div class="speaker-files-groups">
      {files.groups.map((group) => <div class="speaker-files-group" key={`${group.kind}:${group.id}`}>
        <div class="speaker-files-group-head">
          <strong>{group.label}</strong>
          <span class="speaker-files-group-meta">
            {groupMeta(group)}
            {group.session ? ` · ${group.session.title}` : ""}
          </span>
        </div>
        <FileVersions
          list={group.versions}
          compact={group.versions.version_count <= 1}
          emptyCopy={group.kind === "headshot"
            ? "No profile photo uploaded yet."
            : "Nothing uploaded against this request yet."}
        />
      </div>)}
    </div> : null}
  </section>;
}
