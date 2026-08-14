/** @jsxImportSource preact */

/**
 * One deliverable's file history, rendered the same way on both sides of the
 * conference: the organizer's library and the speaker's portal read from the
 * same projection, so nobody has to reconcile two accounts of which deck is
 * current.
 *
 * The version number and the "current" mark are derived upstream from the
 * deliverable's latest-pointer (`lib/files/versions`). This component renders
 * that judgement; it never re-derives one of its own.
 */

import type { JSX } from "preact";
import { useState } from "preact/hooks";

import type { FileVersion, FileVersionList } from "../../lib/files/versions";
import { formatBytes } from "../upload/upload-policy";
import "./files.css";

/** The caveat is stated at the control, not hidden in a tooltip. */
export const CAPABILITY_LINK_NOTE =
  "Anyone with this link can open the file — it is not signed in to the conference. It expires 24 hours after this page loaded, and stops working sooner if the speaker leaves the conference.";

function formatUploaded(value: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(value));
}

function CopyLinkButton({ url, label = "Copy link" }: { url: string; label?: string }): JSX.Element {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2_000);
  };
  // Fixed width: the label swaps between three strings and the row must not
  // move underneath the operator's cursor.
  return <button class="file-versions-copy" type="button" title={CAPABILITY_LINK_NOTE} onClick={() => void copy()}>
    <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}</span>
  </button>;
}

function VersionRow({ version }: { version: FileVersion }): JSX.Element {
  return <li class="file-versions-row">
    <span class="file-versions-mark tabular">v{version.version}</span>
    <span class="file-versions-name" title={version.filename}>{version.filename}</span>
    <span class="file-versions-flag">Previous version</span>
    <span class="file-versions-when">{formatUploaded(version.uploaded_at)}</span>
    <span class="file-versions-size tabular">{formatBytes(version.size_bytes)}</span>
    <span class="file-versions-actions">
      <a class="file-versions-download" href={version.url} download={version.filename} target="_blank" rel="noreferrer">Download</a>
      <CopyLinkButton url={version.url} />
    </span>
  </li>;
}

export interface FileVersionsProps {
  list: FileVersionList | null | undefined;
  /** Summary line only — for a collapsed row that must still name the file. */
  compact?: boolean;
  /** What to say when nothing has been uploaded yet. Say something true. */
  emptyCopy?: string;
  class?: string;
}

export function FileVersions({ list, compact = false, emptyCopy, class: className = "" }: FileVersionsProps): JSX.Element {
  const versions = list?.versions ?? [];
  const latest = list?.latest ?? null;
  const count = list?.version_count ?? 0;

  if (!latest) {
    return <div class={`file-versions is-empty ${className}`}>
      <span class="file-versions-empty">{emptyCopy ?? "No file has been uploaded against this deliverable yet."}</span>
    </div>;
  }

  const summary = <div class="file-versions-summary">
    <span class="file-versions-filename" title={latest.filename}>{latest.filename}</span>
    <span class="file-versions-current tabular">v{latest.version} of {count}</span>
    <span class="file-versions-uploaded">uploaded {formatUploaded(latest.uploaded_at)}</span>
    <span class="file-versions-bytes tabular">{formatBytes(latest.size_bytes)}</span>
    <span class="file-versions-summary-actions">
      <a class="file-versions-download" href={latest.url} download={latest.filename} target="_blank" rel="noreferrer">Download</a>
      <CopyLinkButton url={latest.url} />
    </span>
  </div>;

  if (compact) return <div class={`file-versions is-compact ${className}`}>{summary}</div>;

  const previousVersions = versions.filter((version) => version.attachment_id !== latest.attachment_id);
  const priorCount = Math.max(0, count - 1);
  return <div class={`file-versions ${className}`}>
    {summary}
    {previousVersions.length > 0 ? <ul class="file-versions-list" aria-label={`Previous versions of ${latest.filename}`}>
      {previousVersions.map((version) => <VersionRow key={version.attachment_id} version={version} />)}
    </ul> : null}
    <p class="file-versions-note">
      {priorCount > 0
        ? `${priorCount} earlier version${priorCount === 1 ? "" : "s"} kept and still downloadable. `
        : "This is the only version uploaded so far. "}
      {CAPABILITY_LINK_NOTE}
    </p>
  </div>;
}
