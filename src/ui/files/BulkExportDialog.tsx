/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { formatBytes } from "../upload/upload-policy";
import { Button } from "../shell/components";
import "./export.css";

export interface ExportableFileRow {
  id: string;
  task: { title: string };
  person: { name: string };
  session: { title: string } | null;
  latest: { filename: string; size_bytes: number } | null;
}

type ExportState = "idle" | "preparing" | "ready" | "error";

interface Props {
  eventId: string;
  rows: readonly ExportableFileRow[];
  open: boolean;
  onClose: () => void;
}

async function responseMessage(response: Response): Promise<string> {
  let payload: unknown = null;
  try {
    payload = await response.clone().json();
  } catch {
    // The generic sentence below is more useful than exposing an HTML proxy error.
  }
  const apiMessage = typeof payload === "object" && payload !== null && "error" in payload
    && typeof payload.error === "object" && payload.error !== null && "message" in payload.error
    && typeof payload.error.message === "string" ? payload.error.message : null;
  if (response.status === 401) return "Your session has expired. Sign in again, then retry the export.";
  if (response.status === 404) return "One of the selected deliverables is no longer available. Refresh the Files library and try again.";
  if (response.status === 422) return apiMessage ?? "This selection is too large for one ZIP. Remove some files and try again.";
  return apiMessage ?? "The export could not be generated. Your selection is still here — try again.";
}

export function BulkExportDialog({ eventId, rows, open, onClose }: Props): JSX.Element | null {
  const [grouping, setGrouping] = useState<"session" | "speaker">("session");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [state, setState] = useState<ExportState>("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  const selected = useMemo(() => rows.filter((row) => !removed.has(row.id)), [rows, removed]);
  const totalBytes = selected.reduce((sum, row) => sum + (row.latest?.size_bytes ?? 0), 0);

  useEffect(() => () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  }, [downloadUrl]);

  useEffect(() => {
    if (!open) {
      setState("idle");
      setRemoved(new Set());
      setDownloadUrl(null);
      setErrorMessage(null);
    }
  }, [open]);

  const close = (): void => {
    if (state === "preparing") return;
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, state]);

  const invalidateDownload = (): void => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setErrorMessage(null);
    if (state !== "preparing") setState("idle");
  };

  const changeGrouping = (next: "session" | "speaker"): void => {
    if (next === grouping) return;
    invalidateDownload();
    setGrouping(next);
  };

  const removeRow = (id: string): void => {
    invalidateDownload();
    setRemoved((current) => new Set(current).add(id));
  };

  if (!open) return null;

  const generate = async (): Promise<void> => {
    if (selected.length === 0 || state === "preparing") return;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setErrorMessage(null);
    setState("preparing");
    try {
      const response = await fetch(`/api/v1/events/${encodeURIComponent(eventId)}/files/export`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/zip" },
        body: JSON.stringify({ task_ids: selected.map((row) => row.id), grouping }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const blob = await response.blob();
      setDownloadUrl(URL.createObjectURL(blob));
      setState("ready");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The export could not be generated. Your selection is still here — try again.");
      setState("error");
    }
  };

  return <div class="files-export-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialogRef} class="files-export-dialog" role="dialog" aria-modal="true" aria-labelledby="files-export-title" tabIndex={-1}>
      <header class="files-export-head">
        <div><span class="eyebrow">Bulk export</span><h2 id="files-export-title">Export deliverables</h2><p>Only the current version of each selected deliverable is included.</p></div>
        <button class="files-export-close" type="button" aria-label="Close export dialog" onClick={close} disabled={state === "preparing"}>×</button>
      </header>
      <div class="files-export-body">
        <fieldset class="files-export-grouping">
          <legend>Group files by</legend>
          <label><input type="radio" name="files-export-grouping" value="session" checked={grouping === "session"} onChange={() => changeGrouping("session")} disabled={state === "preparing"} /> <span>Session</span><small>One folder per session</small></label>
          <label><input type="radio" name="files-export-grouping" value="speaker" checked={grouping === "speaker"} onChange={() => changeGrouping("speaker")} disabled={state === "preparing"} /> <span>Speaker</span><small>One folder per speaker</small></label>
        </fieldset>
        <div class="files-export-selection-head"><strong>{selected.length} selected</strong><span class="tabular">{formatBytes(totalBytes)} total</span></div>
        <ul class="files-export-selection">
          {selected.map((row) => <li key={row.id}>
            <div><strong>{row.latest?.filename ?? row.task.title}</strong><small>{row.session?.title ?? "No session"} · {row.person.name}</small></div>
            <span class="tabular">{formatBytes(row.latest?.size_bytes ?? 0)}</span>
            <button type="button" class="files-export-remove" aria-label={`Remove ${row.latest?.filename ?? row.task.title}`} onClick={() => removeRow(row.id)} disabled={state === "preparing"}>Remove</button>
          </li>)}
        </ul>
        <div class="files-export-status" aria-live="polite" aria-atomic="true">
          {state === "preparing" && <><span class="files-export-status-mark" aria-hidden="true">◌</span><div><strong>Preparing your download…</strong><small>Reading the current files and assembling the archive. Keep this panel open.</small></div></>}
          {state === "ready" && downloadUrl && <><span class="files-export-status-mark is-ready" aria-hidden="true">✓</span><div><strong>Ready to download</strong><small>The ZIP contains the latest selected versions. Missing deliverables are listed in manifest.txt.</small><a class="button primary files-export-download" href={downloadUrl} download={`deliverables-${grouping}.zip`}>Download ZIP</a></div></>}
          {state === "error" && <><span class="files-export-status-mark is-error" aria-hidden="true">!</span><div><strong>Export unavailable</strong><small>{errorMessage ?? "The archive was not created. Nothing changed in the Files library."}</small></div></>}
          {state === "idle" && <><span class="files-export-status-mark" aria-hidden="true">→</span><div><strong>Ready when you are</strong><small>Generate a ZIP of the selected current deliverables. Empty slots stay visible in manifest.txt.</small></div></>}
        </div>
      </div>
      <footer class="files-export-foot"><span class="files-export-foot-note">{selected.length === 0 ? "Select at least one deliverable." : "The archive is generated securely from the conference file store."}</span><div><Button type="button" onClick={close} disabled={state === "preparing"}>Cancel</Button><Button type="button" variant="primary" onClick={() => void generate()} disabled={selected.length === 0 || state === "preparing"}>{state === "preparing" ? "Preparing…" : state === "error" ? "Try again" : "Generate download"}</Button></div></footer>
    </section>
  </div>;
}
