import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, Chip, PageHeader } from "../shell/components";
import "./settings.css";
import "./airtable.css";

const STATUS_ROUTE = "/api/v1/mirror/status";
const CONNECT_ROUTE = "/api/v1/mirror/connect";
const MAPPING_ROUTE = "/api/v1/mirror/mapping";
const SYNC_ROUTE = "/api/v1/mirror/sync";
const DISCONNECT_ROUTE = "/api/v1/mirror/disconnect";

type MirroredTableName = "submissions" | "speaker_tasks" | "people";

interface AirtableTable {
  id: string;
  name: string;
  fields: { id: string; name: string; type?: string }[];
}

export interface MirrorStatus {
  base_id: string | null;
  base_url: string | null;
  configured: boolean;
  last_error: string | null;
  last_sync_at: number | null;
  last_verified_at: number | null;
  mapped: boolean;
  queued: number;
  set_at: number | null;
  stuck: number;
  tables: {
    airtable_table_id: string | null;
    local_row_count: number;
    last_sync_at: number | null;
    name: MirroredTableName;
    remote_row_count: number;
  }[];
  token_fingerprint: string | null;
  traffic_assisted: boolean;
  webhook_expires_at: number | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; status: MirrorStatus }
  | { kind: "error"; message: string };

const TABLE_LABELS: Record<MirroredTableName, string> = {
  submissions: "Submissions",
  speaker_tasks: "Speaker tasks",
  people: "People",
};

const TABLE_ORDER: readonly MirroredTableName[] = ["submissions", "speaker_tasks", "people"];

function dateTime(value: number | null): string {
  if (value === null) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function dateOnly(value: number | null): string {
  if (value === null) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value);
}

function initialMapping(tables: readonly AirtableTable[]): Record<MirroredTableName, string> {
  const find = (terms: readonly string[]): string => {
    const match = tables.find((table) => terms.some((term) => table.name.toLowerCase().includes(term)));
    return match?.id ?? "";
  };
  return {
    submissions: find(["submission", "abstract", "session"]),
    speaker_tasks: find(["task", "follow"]),
    people: find(["people", "speaker", "person"]),
  };
}

function expiryCopy(expiresAt: number | null): string | null {
  if (expiresAt === null) return null;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return "The Airtable webhook has expired. Verify the connection to renew it.";
  if (remaining < 2 * 86_400_000) return `The Airtable webhook expires ${dateTime(expiresAt)}. Marquee will renew it automatically.`;
  return null;
}

export function AirtableHealthCard({
  status,
  pending,
  expiry,
  onSync,
  onDisconnect,
}: {
  status: MirrorStatus;
  pending: string | null;
  expiry: string | null;
  onSync: () => void;
  onDisconnect: () => void;
}): JSX.Element {
  const rowsByName = new Map(status.tables.map((row) => [row.name, row]));
  return <>
    {expiry && <div class="settings-warning" role="status"><strong>Webhook renewal</strong><span>{expiry}</span></div>}
    <section class="card airtable-health-card">
      <CardHeader title="Mirror health"><div class="airtable-health-actions"><Button small onClick={onSync} disabled={pending !== null}>{pending === "sync" ? "Queueing…" : "Sync now"}</Button><Button small variant="danger" onClick={onDisconnect} disabled={pending !== null}>{pending === "disconnect" ? "Disconnecting…" : "Disconnect"}</Button></div></CardHeader>
      <CardBody>
        <div class="airtable-counts"><div><span>Queued</span><strong>{status.queued}</strong><small>Local changes waiting for Airtable</small></div><div><span>Stuck</span><strong class={status.stuck > 0 ? "airtable-count-alarm" : ""}>{status.stuck}</strong><small>At the retry cap and needing attention</small></div><div><span>Last sync</span><strong class="airtable-count-date">{dateOnly(status.last_sync_at)}</strong><small>Both counts are as of last sync</small></div></div>
        {status.last_error && <div class="settings-error airtable-last-error" role="alert"><strong>Last provider error</strong><span>{status.last_error}</span></div>}
        <div class="table-scroll"><table class="airtable-table"><thead><tr><th scope="col">Table</th><th scope="col">Marquee rows</th><th scope="col">Airtable rows</th><th scope="col">As of last sync</th></tr></thead><tbody>{TABLE_ORDER.map((table) => { const row = rowsByName.get(table); return <tr key={table}><th scope="row">{TABLE_LABELS[table]}</th><td class="tabular">{row?.local_row_count ?? 0}</td><td class="tabular">{row?.remote_row_count ?? 0}</td><td class="tabular">{dateOnly(row?.last_sync_at ?? null)}</td></tr>; })}</tbody></table></div>
      </CardBody>
    </section>
  </>;
}

export function AirtableConnectionFacts({ status }: { status: MirrorStatus }): JSX.Element | null {
  if (!status.configured) return null;
  return <div class="airtable-credential-facts"><span>Token fingerprint <code>{status.token_fingerprint ?? "—"}</code></span><span>Set {dateTime(status.set_at)}</span><span>Verified {dateTime(status.last_verified_at)}</span>{status.base_url && <a href={status.base_url} target="_blank" rel="noopener">Open base ↗</a>}</div>;
}

export function AirtablePage({ navigate }: { navigate: (target: string) => void }): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [token, setToken] = useState("");
  const [baseId, setBaseId] = useState("");
  const [tables, setTables] = useState<AirtableTable[]>([]);
  const [mapping, setMapping] = useState<Record<MirroredTableName, string>>({ submissions: "", speaker_tasks: "", people: "" });
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[]>([]);

  const status = state.kind === "ready" ? state.status : null;
  const expiry = expiryCopy(status?.webhook_expires_at ?? null);
  const mappingComplete = TABLE_ORDER.every((table) => mapping[table].length > 0)
    && new Set(TABLE_ORDER.map((table) => mapping[table])).size === TABLE_ORDER.length;

  async function loadStatus(): Promise<void> {
    try {
      const response = await apiFetch<{ data: MirrorStatus }>(STATUS_ROUTE, {
        cache: "no-store",
        route: STATUS_ROUTE,
      });
      setState({ kind: "ready", status: response.data });
    } catch (caught) {
      setState({ kind: "error", message: errorSummary(caught) });
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  function record(message: string): void {
    setLog((current) => [`${dateTime(Date.now())} · ${message}`, ...current].slice(0, 8));
  }

  async function connect(event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending("connect");
    setError("");
    setNotice("");
    try {
      const response = await apiFetch<{ data: { base_id: string; tables: AirtableTable[] } }>(CONNECT_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, base_id: baseId }),
        route: CONNECT_ROUTE,
      });
      setBaseId(response.data.base_id);
      setTables(response.data.tables);
      setMapping(initialMapping(response.data.tables));
      setNotice("Connection verified. Choose the three tables to turn the mirror on.");
      record("Connection verified; table schema received");
      await loadStatus();
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setPending(null);
    }
  }

  async function mapTables(): Promise<void> {
    setPending("mapping");
    setError("");
    setNotice("");
    try {
      await apiFetch(MAPPING_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mapping),
        route: MAPPING_ROUTE,
      });
      setNotice("The mirror is on. Local changes will queue for Airtable and signed Airtable edits will come back through the allowlist.");
      record("Three table mapping saved; mirror switched on");
      await loadStatus();
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setPending(null);
    }
  }

  async function syncNow(): Promise<void> {
    setPending("sync");
    setError("");
    setNotice("");
    try {
      const response = await apiFetch<{ data: { queued: boolean } }>(SYNC_ROUTE, {
        method: "POST",
        route: SYNC_ROUTE,
      });
      const message = response.data.queued ? "Sync queued. The worker will reconcile local truth with Airtable." : "Sync could not be queued because Airtable is not connected.";
      setNotice(message);
      record(message);
      await loadStatus();
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setPending(null);
    }
  }

  async function disconnect(): Promise<void> {
    if (!window.confirm("Disconnect Airtable? Pending mirror changes will be cleared, and future local writes will stop dispatching.")) return;
    setPending("disconnect");
    setError("");
    setNotice("");
    try {
      const response = await apiFetch<{ data: { disconnected: boolean; warning: string | null } }>(DISCONNECT_ROUTE, {
        method: "POST",
        route: DISCONNECT_ROUTE,
      });
      setNotice(response.data.warning ?? "Airtable disconnected. Pending mirror changes were cleared.");
      record("Airtable disconnected");
      setTables([]);
      setToken("");
      setMapping({ submissions: "", speaker_tasks: "", people: "" });
      await loadStatus();
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setPending(null);
    }
  }

  if (state.kind === "loading") {
    return <div class="settings-page airtable-page"><PageHeader title="Airtable" copy="One controlled bridge between Marquee and the base your team already uses." /><Card><CardBody><div class="airtable-skeleton" aria-busy="true"><span /><span /><span /></div></CardBody></Card></div>;
  }

  if (state.kind === "error") {
    return <div class="settings-page airtable-page"><PageHeader title="Airtable" copy="One controlled bridge between Marquee and the base your team already uses." /><div class="settings-error" role="alert"><strong>Airtable status unavailable</strong><span>{state.message}</span><Button small onClick={() => { setState({ kind: "loading" }); void loadStatus(); }}>Retry</Button></div></div>;
  }

  return <div class="settings-page airtable-page">
    <PageHeader
      title="Airtable"
      copy="A two-way mirror for the fields your program team has chosen. Marquee remains the source of truth for workflow."
      actions={<a class="button ghost" href="/org/server" onClick={(event) => { event.preventDefault(); navigate("/org/server"); }}>← Server</a>}
    />
    <div class="settings-banner airtable-traffic-note" role="note">
      <strong>Traffic-assisted</strong>
      <span>{status?.traffic_assisted ? "Requests keep the mirror moving while the deployment is active; the daily keepalive is the idle backstop." : "The mirror is waiting for its first configured connection."}</span>
    </div>
    {notice.length > 0 && <div class="settings-banner" role="status">{notice}</div>}
    {error.length > 0 && <div class="settings-error" role="alert"><strong>Action failed</strong><span>{error}</span></div>}

    <section class="card airtable-connection-card">
      <CardHeader title={status?.configured ? "Connected base" : "Connect a base"}>
        <Chip tone={status?.configured ? "success" : "warning"}>{status?.configured ? "connected" : "not connected"}</Chip>
      </CardHeader>
      <CardBody>
        <p class="airtable-lede">Paste an Airtable personal access token with access to this base. Marquee verifies the schema before storing an encrypted credential; the token is never shown again.</p>
        <form class="settings-fields airtable-connect-form" onSubmit={(event) => void connect(event)}>
          <label class="field"><span>Airtable personal access token</span><input type="password" value={token} onInput={(event) => setToken(event.currentTarget.value)} placeholder={status?.configured ? "Paste a replacement token to rotate" : "pat…"} autoComplete="new-password" /></label>
          <label class="field"><span>Base ID</span><input value={baseId || status?.base_id || ""} onInput={(event) => setBaseId(event.currentTarget.value)} placeholder="app…" /></label>
          <div class="airtable-form-actions"><Button variant="primary" type="submit" disabled={pending !== null || token.trim().length === 0 || (baseId || status?.base_id || "").trim().length === 0}>{pending === "connect" ? "Verifying…" : status?.configured ? "Verify and rotate" : "Verify connection"}</Button></div>
        </form>
        {status?.configured && <AirtableConnectionFacts status={status} />}
      </CardBody>
    </section>

    {status?.configured && !status.mapped && <section class="card airtable-mapping-card">
      <CardHeader title="Choose the three tables"><span class="subtle">The mapping is the on-switch</span></CardHeader>
      <CardBody>
        {tables.length === 0
          ? <div class="airtable-empty-mapping"><strong>Schema not loaded yet</strong><span>Verify the connection above to read the available tables.</span></div>
          : <div class="airtable-mapping-fields">{TABLE_ORDER.map((table) => <label class="field" key={table}><span>{TABLE_LABELS[table]}</span><select value={mapping[table]} onChange={(event) => setMapping((current) => ({ ...current, [table]: event.currentTarget.value }))}><option value="">Choose a table</option>{tables.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label>)}</div>}
        <div class="airtable-form-actions"><Button variant="primary" onClick={() => void mapTables()} disabled={pending !== null || tables.length === 0 || !mappingComplete}>{pending === "mapping" ? "Turning on…" : "Turn on mirror"}</Button></div>
      </CardBody>
    </section>}

    {status?.configured && status.mapped && <AirtableHealthCard
      status={status}
      pending={pending}
      expiry={expiry}
      onSync={() => void syncNow()}
      onDisconnect={() => void disconnect()}
    />}

    <section class="card airtable-log-card"><CardHeader title="Live log"><span class="subtle">This screen's connection actions</span></CardHeader><CardBody>{log.length > 0 ? <ol class="airtable-log">{log.map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol> : <div class="airtable-log-empty">No connection actions in this session.</div>}</CardBody></section>
  </div>;
}
