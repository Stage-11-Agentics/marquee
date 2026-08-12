import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, Chip, PageHeader } from "../shell/components";
import "./sessionize-import.css";

type ImportStep = "upload" | "mapping" | "results";
type Preview = {
  headers: string[];
  mapped: Record<string, string | null>;
  rows: Array<Record<string, string>>;
  missing: string[];
};
type ImportSummary = {
  id: string;
  status: string;
  preview?: { sessions: Preview; speakers: Preview };
  mapping: { sessions: Record<string, string | null>; speakers: Record<string, string | null> };
};
type ImportRow = { row_index: number; entity: string; outcome: "created" | "updated" | "skipped" | "failed"; reason: string | null; target_id: string | null };
type Counts = { created: number; updated: number; skipped: number; failed: number; sessions: number; speakers: number; evaluations: number };

const SESSION_LABELS: Record<string, string> = {
  external_ref: "External reference", title: "Title", abstract: "Abstract", status: "Status", kind: "Kind",
  track: "Track", format: "Format", speaker_emails: "Speaker emails", reviewer_email: "Reviewer email",
  score: "Score", reviewer_comment: "Reviewer comment", custom_fields: "Custom fields",
};
const SPEAKER_LABELS: Record<string, string> = {
  external_ref: "External reference", name: "Name", first_name: "First name", last_name: "Last name",
  email: "Email", title: "Title", company: "Company", bio: "Bio", headshot_url: "Headshot URL", custom_fields: "Custom fields",
};

async function jsonRequest<T>(path: string, route: string, init: RequestInit): Promise<T> {
  return apiFetch<T>(path, { ...init, route });
}

function MappingPanel({ title, preview, mapping, labels, onChange, note }: {
  title: string;
  preview: Preview;
  mapping: Record<string, string | null>;
  labels: Record<string, string>;
  onChange: (field: string, value: string | null) => void;
  note?: string;
}): JSX.Element {
  return <Card class="sessionize-mapping-card">
    <CardHeader title={title}><Chip tone={preview.missing.length ? "warning" : "success"}>{preview.missing.length ? `${preview.missing.length} fields to review` : "Mapped"}</Chip></CardHeader>
    <CardBody>
      {note ? <p class="field-note">{note}</p> : null}
      <div class="sessionize-mapping-fields">
        {Object.keys(mapping).map((field) => <label class="field" key={field}>
          <span>{labels[field] ?? field}</span>
          <select value={mapping[field] ?? ""} onChange={(event) => onChange(field, (event.currentTarget as HTMLSelectElement).value || null)}>
            <option value="">— Unmapped —</option>
            {preview.headers.map((header) => <option value={header} key={header}>{header}</option>)}
          </select>
        </label>)}
      </div>
      <div class="sessionize-preview-table" aria-label={`${title} sample rows`}>
        <table><thead><tr>{Object.keys(mapping).slice(0, 6).map((field) => <th key={field}>{labels[field] ?? field}</th>)}</tr></thead><tbody>
          {preview.rows.map((row, index) => <tr key={index}>{Object.keys(mapping).slice(0, 6).map((field) => <td key={field} title={row[field]}>{row[field] || "—"}</td>)}</tr>)}
        </tbody></table>
        {preview.rows.length === 0 && <div class="sessionize-table-empty">No sample rows are available in this export. Map the headers, then run the import when the file contains data.</div>}
      </div>
    </CardBody>
  </Card>;
}

export function SessionizeImportPage({ eventId, navigate }: { eventId: string; navigate?: (target: string) => void }): JSX.Element {
  const [step, setStep] = useState<ImportStep>("upload");
  const [sessionsFile, setSessionsFile] = useState<File | null>(null);
  const [speakersFile, setSpeakersFile] = useState<File | null>(null);
  const [current, setCurrent] = useState<ImportSummary | null>(null);
  const [mapping, setMapping] = useState<ImportSummary["mapping"] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sessionPreview = current?.preview?.sessions;
  const speakerPreview = current?.preview?.speakers;
  const hasMissing = useMemo(() => {
    const requiredSessions = ["external_ref", "title", "speaker_emails"];
    const requiredSpeakers = ["name", "email"];
    const hasSessions = Boolean(sessionPreview?.headers.length);
    return Boolean(
      (hasSessions && sessionPreview?.missing.some((field) => requiredSessions.includes(field)))
      || speakerPreview?.missing.some((field) => requiredSpeakers.includes(field)),
    );
  }, [sessionPreview, speakerPreview]);

  const upload = async () => {
    if (!speakersFile) return;
    setBusy(true); setError(null);
    try {
      const result = await jsonRequest<ImportSummary>(`/api/v1/events/${encodeURIComponent(eventId)}/imports`, "/api/v1/events/{eventId}/imports", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "sessionize", ...(sessionsFile ? { sessions_csv: await sessionsFile.text() } : {}), speakers_csv: await speakersFile.text() }),
      });
      setCurrent(result); setMapping(result.mapping); setStep("mapping");
    } catch (reason) { setError(errorSummary(reason)); }
    finally { setBusy(false); }
  };

  const saveMapping = async (): Promise<boolean> => {
    if (!current || !mapping) return false;
    setBusy(true); setError(null);
    try {
      const result = await jsonRequest<ImportSummary>(`/api/v1/events/${encodeURIComponent(eventId)}/imports/${current.id}/mapping`, "/api/v1/events/{eventId}/imports/{importId}/mapping", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mapping),
      });
      setCurrent(result); setMapping(result.mapping); return true;
    } catch (reason) { setError(errorSummary(reason)); return false; }
    finally { setBusy(false); }
  };

  const run = async () => {
    if (!current) return;
    setBusy(true); setError(null);
    try {
      const result = await jsonRequest<{ import: ImportSummary; counts: Counts; rows: ImportRow[] }>(`/api/v1/events/${encodeURIComponent(eventId)}/imports/${current.id}/run`, "/api/v1/events/{eventId}/imports/{importId}/run", { method: "POST" });
      setCurrent(result.import); setCounts(result.counts); setRows(result.rows); setStep("results");
    } catch (reason) { setError(errorSummary(reason)); }
    finally { setBusy(false); }
  };

  const undo = async () => {
    if (!current || !window.confirm("Undo this import? Only this import's rows will be reversed; the manifest stays available for audit.")) return;
    setBusy(true); setError(null);
    try {
      await jsonRequest<{ undone: number; retained_manifest: true }>(`/api/v1/events/${encodeURIComponent(eventId)}/imports/${current.id}/undo`, "/api/v1/events/{eventId}/imports/{importId}/undo", { method: "POST" });
      setCounts(null); setRows([]); setCurrent({ ...current, status: "undone" });
    } catch (reason) { setError(errorSummary(reason)); }
    finally { setBusy(false); }
  };

  return <div class="sessionize-import-page">
    <PageHeader title="Sessionize import" copy="Bring a conference export into the program with a stable mapping preview, reversible outcomes, and no duplicate sessions." actions={<Button small onClick={() => navigate?.("/import")}>Import speakers</Button>} />
    <div class="sessionize-import-steps" aria-label="Import steps">
      {(["upload", "mapping", "results"] as ImportStep[]).map((name, index) => <div class={`sessionize-import-step ${step === name ? "active" : ""}`} key={name}><span>0{index + 1}</span><strong>{name === "upload" ? "Choose export" : name === "mapping" ? "Map columns" : "Review outcomes"}</strong><small>{name === "upload" ? "Sessions optional · speakers required" : name === "mapping" ? "Preview before writing" : "Run or batch undo"}</small></div>)}
    </div>
    {error && <div class="sessionize-import-error" role="alert"><strong>Import needs attention</strong><span>{error}</span></div>}
    {step === "upload" && <Card class="sessionize-import-stage"><CardHeader title="Choose a Sessionize export"><Chip>Fixture-backed until operator export arrives</Chip></CardHeader><CardBody><div class="sessionize-upload-grid">
      <label class="field"><span>Sessions CSV <small>(optional)</small></span><input type="file" accept=".csv,text/csv" onChange={(event) => setSessionsFile((event.currentTarget as HTMLInputElement).files?.[0] ?? null)} /><small class="field-note">Talks, statuses, tracks, speakers, and evaluation columns. Leave blank for a speakers-only import.</small></label>
      <label class="field"><span>Speakers CSV <small>(required)</small></span><input type="file" accept=".csv,text/csv" onChange={(event) => setSpeakersFile((event.currentTarget as HTMLInputElement).files?.[0] ?? null)} /><small class="field-note">Names, normalized email, profile, and optional headshot URL.</small></label>
    </div><div class="sessionize-stage-actions"><Button variant="primary" disabled={!speakersFile || busy} onClick={() => void upload()}>Upload and preview →</Button></div></CardBody></Card>}
    {step === "mapping" && sessionPreview && speakerPreview && mapping && <div class="sessionize-import-stage"><div class="sessionize-mapping-grid">
      <MappingPanel title="Sessions" preview={sessionPreview} mapping={mapping.sessions} labels={SESSION_LABELS} onChange={(field, value) => setMapping({ ...mapping, sessions: { ...mapping.sessions, [field]: value } })} note={sessionPreview.headers.length ? undefined : "No Sessions CSV supplied. This import will create or update speakers only."} />
      <MappingPanel title="Speakers" preview={speakerPreview} mapping={mapping.speakers} labels={SPEAKER_LABELS} onChange={(field, value) => setMapping({ ...mapping, speakers: { ...mapping.speakers, [field]: value } })} note="External reference is optional. When it is absent, Marquee matches repeat imports by normalized email." />
    </div><div class="sessionize-stage-actions"><Button onClick={() => setStep("upload")}>Back</Button><Button variant="primary" disabled={busy || hasMissing} onClick={() => void saveMapping().then((saved) => { if (saved) void run(); })}>Map, import, and review →</Button></div></div>}
    {step === "results" && <div class="sessionize-import-stage"><Card><CardHeader title="Import outcomes"><div class="head-actions"><Chip tone={current?.status === "undone" ? "warning" : "success"}>{current?.status === "undone" ? "Undone" : "Completed"}</Chip>{current?.status !== "undone" && <Button variant="danger" small disabled={busy} onClick={() => void undo()}>Batch undo</Button>}</div></CardHeader><CardBody><div class="sessionize-count-grid">{counts && Object.entries({ Created: counts.created, Updated: counts.updated, Skipped: counts.skipped, Failed: counts.failed, Evaluations: counts.evaluations }).map(([label, value]) => <div class="sessionize-count" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><p class="subtle">The R2 manifest is retained for audit. A repeated export matches by external reference when present, otherwise normalized email.</p></CardBody></Card><Card class="sessionize-results-card"><CardHeader title="Row detail"><Chip>{rows.length} durable outcomes</Chip></CardHeader><CardBody>{rows.length ? <div class="sessionize-results-table"><table><thead><tr><th>Row</th><th>Entity</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.entity}-${row.row_index}`}><td>{row.row_index}</td><td>{row.entity}</td><td><Chip tone={row.outcome === "failed" ? "alarm" : row.outcome === "created" ? "success" : row.outcome === "updated" ? "warning" : ""}>{row.outcome}</Chip></td><td>{row.reason ?? "—"}</td></tr>)}</tbody></table></div> : <div class="sessionize-results-empty"><strong>No durable outcomes remain</strong><span>This import is empty or has been undone. Choose another export to continue.</span><Button small variant="primary" onClick={() => setStep("upload")}>Choose another export</Button></div>}</CardBody></Card></div>}
  </div>;
}
