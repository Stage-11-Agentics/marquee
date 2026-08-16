import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary, MarqueeApiError } from "../shell/api-client";
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
  fields: { id: string; name: string; type?: string; options?: Record<string, unknown> }[] | null;
}

interface MirrorReadinessRole {
  role: MirroredTableName;
  label: string;
  expected_field_count: number;
  candidate_table_ids: string[];
  selected_table_id: string | null;
  state: "ready" | "missing" | "conflict" | "unknown";
  conflict: unknown;
}

interface MirrorReadiness {
  needs_provisioning: boolean;
  provisionable: boolean;
  max_conformant_roles: number;
  roles: MirrorReadinessRole[];
}

interface MirrorProgress {
  role: MirroredTableName;
  label: string;
  table_id: string | null;
  state: "idle" | "created" | "adopted" | "conflict" | "complete";
  expected_field_count: number;
  conformant_field_count: number;
  fields: { name: string; state: "pending" | "created" | "adopted" | "conflict" }[];
  missing_fields: string[];
  organizer_fields: string[];
  conflicts: unknown[];
}

interface MirrorSetupResponse {
  base_id: string;
  tables: AirtableTable[];
  needs_provisioning: boolean;
  readiness: MirrorReadiness;
  progress?: MirrorProgress[];
  continuation?: MirroredTableName | null;
  complete?: boolean;
  table_actions?: { role: MirroredTableName; table_id: string; outcome: "created" | "adopted" }[];
}

export interface MirrorStatus {
  base_id: string | null;
  base_url: string | null;
  configured: boolean;
  last_error: string | null;
  last_sync_at: number | null;
  last_verified_at: number | null;
  mapped: boolean;
  rejected_edits: number;
  recent_rejections: {
    before: string | null;
    created_at: number;
    field: string;
    id: string;
    message: string;
    reason: "forbidden_while_published" | "illegal_transition" | "unrecognized_value";
    requested: string | null;
    title: string;
  }[];
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

export interface AirtableLogEntry {
  created_at: number;
  id: string;
  message: string;
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
  const normalized = (value: string): string => value.trim().toLocaleLowerCase().replaceAll(/\s+/g, " ");
  const used = new Set<string>();
  const find = (exact: readonly string[], terms: readonly string[], reject?: RegExp): string => {
    const exactMatch = tables.find((table) => !used.has(table.id) && exact.includes(normalized(table.name)));
    const match = exactMatch ?? tables.find((table) => {
      const name = normalized(table.name);
      return !used.has(table.id) && (!reject || !reject.test(name)) && terms.some((term) => name.includes(term));
    });
    if (match) used.add(match.id);
    return match?.id ?? "";
  };
  return {
    submissions: find(["submissions", "submissions / abstracts"], ["submission", "abstract", "session"], /task|follow/),
    speaker_tasks: find(["speaker tasks", "speaker task"], ["task", "follow"], /people|person/),
    people: find(["people", "speakers", "persons"], ["people", "speaker", "person"], /task|follow/),
  };
}

function mappingFromReadiness(
  tables: readonly AirtableTable[],
  readiness: MirrorReadiness,
): Record<MirroredTableName, string> {
  const fromRoles = Object.fromEntries(readiness.roles.map((role) => [role.role, role.selected_table_id ?? ""])) as Record<MirroredTableName, string>;
  const values = TABLE_ORDER.map((role) => fromRoles[role]).filter(Boolean);
  if (values.length === TABLE_ORDER.length && new Set(values).size === TABLE_ORDER.length) return fromRoles;
  return initialMapping(tables);
}

function mappingFromActions(
  actions: readonly { role: MirroredTableName; table_id: string }[] | undefined,
): Record<MirroredTableName, string> | null {
  if (!actions) return null;
  const byRole = new Map(actions.map((action) => [action.role, action.table_id]));
  const values = TABLE_ORDER.map((role) => byRole.get(role) ?? "");
  if (values.some((value) => !value) || new Set(values).size !== TABLE_ORDER.length) return null;
  return Object.fromEntries(TABLE_ORDER.map((role) => [role, byRole.get(role)!])) as Record<MirroredTableName, string>;
}

function idleProgress(readiness: MirrorReadiness | null): MirrorProgress[] {
  return TABLE_ORDER.map((role) => {
    const expected = readiness?.roles.find((candidate) => candidate.role === role)?.expected_field_count ?? 0;
    return {
      role,
      label: TABLE_LABELS[role],
      table_id: null,
      state: "idle",
      expected_field_count: expected,
      conformant_field_count: 0,
      fields: [],
      missing_fields: [],
      organizer_fields: [],
      conflicts: [],
    };
  });
}

function progressLabel(state: MirrorProgress["state"]): string {
  if (state === "created") return "Created";
  if (state === "adopted" || state === "complete") return "Adopted";
  if (state === "conflict") return "Needs attention";
  return "—";
}

function compactMapping(mapping: Readonly<Record<MirroredTableName, string>>): Partial<Record<MirroredTableName, string>> {
  return Object.fromEntries(TABLE_ORDER.flatMap((role) => {
    const tableId = mapping[role].trim();
    return tableId ? [[role, tableId]] : [];
  }));
}

export function mergeSetupProgress(
  current: readonly MirrorProgress[],
  incoming: readonly MirrorProgress[],
): MirrorProgress[] {
  const previous = new Map(current.map((row) => [row.role, row]));
  const next = new Map(incoming.map((row) => [row.role, row]));
  return TABLE_ORDER.flatMap((role) => {
    const row = next.get(role) ?? previous.get(role);
    if (!row) return [];
    const old = previous.get(role);
    if (!old) return [row];
    const oldFields = new Map(old.fields.map((field) => [field.name, field]));
    const fields = row.fields.map((field) => {
      const prior = oldFields.get(field.name);
      return prior?.state === "created" && field.state === "adopted" ? prior : field;
    });
    const state = row.state === "conflict"
      ? "conflict"
      : old.state === "created"
        ? "created"
        : row.state;
    return [{ ...row, state, fields }];
  });
}

function mirrorSetupDetails(error: unknown): { progress?: MirrorProgress[]; continuation?: MirroredTableName | null } | null {
  if (!(error instanceof MarqueeApiError) || !error.details || typeof error.details !== "object") return null;
  const details = error.details as { mirror_setup?: unknown; progress?: unknown; continuation?: unknown };
  if (details.mirror_setup !== true) return null;
  const progress = Array.isArray(details.progress) ? details.progress as MirrorProgress[] : undefined;
  const continuation = TABLE_ORDER.includes(details.continuation as MirroredTableName)
    ? details.continuation as MirroredTableName
    : details.continuation === null ? null : undefined;
  return { progress, continuation };
}

export function mirrorSetupErrorSummary(error: unknown): string {
  const details = mirrorSetupDetails(error);
  if (!(error instanceof MarqueeApiError) || !details || error.message.trim().length === 0) return errorSummary(error);
  const trimmed = error.message.trim();
  const sentence = `${trimmed[0]!.toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? "" : "."}`;
  return `${sentence} ${error.treatment.recovery} · ref ${error.reference}`;
}

function progressDetail(row: MirrorProgress | undefined): string {
  if (!row?.table_id) return "—";
  const conflictFields = row.fields.filter((field) => field.state === "conflict").map((field) => field.name);
  const createdFields = row.fields.filter((field) => field.state === "created").map((field) => field.name);
  const organizerCount = row.organizer_fields.length;
  const kept = organizerCount > 0 ? ` · kept ${organizerCount} organizer column${organizerCount === 1 ? "" : "s"}` : "";
  if (conflictFields.length > 0) return `conflict: ${conflictFields.join(", ")}${kept}`;
  if (row.missing_fields.length > 0) return `pending: ${row.missing_fields.join(", ")}${kept}`;
  if (createdFields.length === row.expected_field_count) return `created all ${row.expected_field_count} Marquee columns${kept}`;
  if (createdFields.length > 0) return `added ${createdFields.join(", ")}${kept}`;
  return `all ${row.expected_field_count} Marquee columns ready${kept}`;
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
        <div class="airtable-counts"><div><span>Queued</span><strong>{status.queued}</strong><small>Local changes waiting for Airtable</small></div><div><span>Rejected edits</span><strong class={status.rejected_edits > 0 ? "airtable-count-alarm" : ""}>{status.rejected_edits}</strong><small>Airtable edits Marquee wrote back</small></div><div><span>Stuck</span><strong class={status.stuck > 0 ? "airtable-count-alarm" : ""}>{status.stuck}</strong><small>At the retry cap and needing attention</small></div><div><span>Last sync</span><strong class="airtable-count-date">{dateOnly(status.last_sync_at)}</strong><small>All row counts are as of last sync</small></div></div>
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

export function AirtableLiveLog({
  log,
  status,
}: {
  log: readonly AirtableLogEntry[];
  status: MirrorStatus | null;
}): JSX.Element {
  const entries = [
    ...(status?.recent_rejections ?? []).map((entry) => ({
      created_at: entry.created_at,
      id: entry.id,
      message: entry.message,
    })),
    ...log,
  ].sort((left, right) => right.created_at - left.created_at || right.id.localeCompare(left.id)).slice(0, 8);
  return <section class="card airtable-log-card"><CardHeader title="Live log"><span class="subtle">Connection actions and edits Marquee did not apply</span></CardHeader><CardBody>{entries.length > 0 ? <ol class="airtable-log">{entries.map((entry) => <li key={entry.id}>{dateTime(entry.created_at)} · {entry.message}</li>)}</ol> : <div class="airtable-log-empty">No connection actions or rejected edits to show.</div>}</CardBody></section>;
}

export function AirtableSetupProgress({
  readiness,
  progress,
}: {
  readiness: MirrorReadiness | null;
  progress: readonly MirrorProgress[];
}): JSX.Element {
  const rows = new Map(progress.map((row) => [row.role, row]));
  return <div class="airtable-setup-progress" aria-live="polite">
    <div class="airtable-setup-progress-heading"><span>Table readiness</span><span>Fields</span><span>Status</span></div>
    {TABLE_ORDER.map((role) => {
      const row = rows.get(role);
      const expected = row?.expected_field_count ?? readiness?.roles.find((candidate) => candidate.role === role)?.expected_field_count ?? 0;
      const fields = row && expected > 0 ? `${row.conformant_field_count}/${expected}` : "—";
      return <div class="airtable-setup-progress-row" key={role}>
        <span><strong>{TABLE_LABELS[role]}</strong><small title={progressDetail(row)}>{progressDetail(row)}</small></span>
        <span class="tabular">{fields}</span>
        <span>{progressLabel(row?.state ?? "idle")}</span>
      </div>;
    })}
  </div>;
}

export function AirtablePage({ navigate }: { navigate: (target: string) => void }): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [token, setToken] = useState("");
  const [baseId, setBaseId] = useState("");
  const [tables, setTables] = useState<AirtableTable[]>([]);
  const [mapping, setMapping] = useState<Record<MirroredTableName, string>>({ submissions: "", speaker_tasks: "", people: "" });
  const [readiness, setReadiness] = useState<MirrorReadiness | null>(null);
  const [progress, setProgress] = useState<MirrorProgress[]>([]);
  const [setupActive, setSetupActive] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [log, setLog] = useState<AirtableLogEntry[]>([]);

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
    const created_at = Date.now();
    setLog((current) => [{ created_at, id: `local-${created_at}-${current.length}`, message }, ...current].slice(0, 8));
  }

  async function connect(event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending("connect");
    setError("");
    setNotice("");
    try {
      const response = await apiFetch<{ data: MirrorSetupResponse }>(CONNECT_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, base_id: baseId, intent: "verify" }),
        route: CONNECT_ROUTE,
      });
      setBaseId(response.data.base_id);
      setTables(response.data.tables);
      setReadiness(response.data.readiness);
      setMapping(mappingFromReadiness(response.data.tables, response.data.readiness));
      setProgress(response.data.progress ?? idleProgress(response.data.readiness));
      setSetupActive(true);
      setNotice(response.data.needs_provisioning
        ? "Connection verified. Choose existing tables or create the three canonical tables."
        : "Connection verified. Review the three table choices, then turn on the mirror.");
      record("Connection verified; table schema received");
      await loadStatus();
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setPending(null);
    }
  }

  async function provisionTables(): Promise<void> {
    setPending("provision");
    setError("");
    setNotice("");
    try {
      const response = await apiFetch<{ data: MirrorSetupResponse }>(CONNECT_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          base_id: baseId || status?.base_id || "",
          intent: "provision",
          ...(Object.keys(compactMapping(mapping)).length > 0 ? { mapping: compactMapping(mapping) } : {}),
        }),
        route: CONNECT_ROUTE,
      });
      setTables(response.data.tables);
      setReadiness(response.data.readiness);
      setMapping(mappingFromActions(response.data.table_actions) ?? mappingFromReadiness(response.data.tables, response.data.readiness));
      setProgress((current) => mergeSetupProgress(current, response.data.progress ?? idleProgress(response.data.readiness)));
      setNotice("Canonical tables are ready. Review the selected IDs, then turn on the mirror.");
      record("Canonical mirror tables created or adopted");
    } catch (caught) {
      const details = mirrorSetupDetails(caught);
      if (details?.progress) setProgress((current) => mergeSetupProgress(current, details.progress!));
      setError(mirrorSetupErrorSummary(caught));
    } finally {
      setPending(null);
    }
  }

  async function mapTables(): Promise<void> {
    setPending("mapping");
    setError("");
    setNotice("");
    try {
      let continuation: MirroredTableName | null = "submissions";
      while (continuation) {
        const response = await apiFetch<{ data: MirrorSetupResponse }>(MAPPING_ROUTE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...mapping, base_id: baseId || status?.base_id || "", token, intent: "adopt", continuation }),
          route: MAPPING_ROUTE,
        });
        setTables(response.data.tables);
        setReadiness(response.data.readiness);
        setProgress((current) => mergeSetupProgress(current, response.data.progress ?? idleProgress(response.data.readiness)));
        continuation = response.data.continuation ?? null;
      }
      setSetupActive(false);
      setTables([]);
      setNotice("The mirror is on. Local changes will queue for Airtable and signed Airtable edits will come back through the allowlist.");
      record("Three table mapping saved; mirror switched on");
      await loadStatus();
    } catch (caught) {
      const details = mirrorSetupDetails(caught);
      if (details?.progress) setProgress((current) => mergeSetupProgress(current, details.progress!));
      setError(mirrorSetupErrorSummary(caught));
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
      setReadiness(null);
      setProgress([]);
      setSetupActive(false);
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
        <p class="airtable-lede">Paste an Airtable personal access token with access to this base. Marquee verifies the schema first and stores the encrypted credential only when the final table mapping turns the mirror on.</p>
        <form class="settings-fields airtable-connect-form" onSubmit={(event) => void connect(event)}>
          <label class="field"><span>Airtable personal access token</span><input type="password" value={token} onInput={(event) => setToken(event.currentTarget.value)} placeholder={status?.configured ? "Paste a replacement token to rotate" : "pat…"} autoComplete="new-password" /></label>
          <label class="field"><span>Base ID</span><input value={baseId || status?.base_id || ""} onInput={(event) => setBaseId(event.currentTarget.value)} placeholder="app…" /></label>
          <div class="airtable-form-actions"><Button variant="primary" type="submit" disabled={pending !== null || token.trim().length === 0 || (baseId || status?.base_id || "").trim().length === 0}>{pending === "connect" ? "Verifying…" : status?.configured ? "Verify and rotate" : "Verify connection"}</Button></div>
        </form>
        {status?.configured && <AirtableConnectionFacts status={status} />}
      </CardBody>
    </section>

    {setupActive && <section class="card airtable-mapping-card">
      <CardHeader title="Choose the three tables"><span class="subtle">The mapping is the on-switch</span></CardHeader>
      <CardBody>
        <p class="airtable-lede">Choose existing tables first. Marquee uses the submitted table IDs exactly; it creates canonical tables only when you explicitly ask it to.</p>
        {tables.length === 0 && <div class="airtable-empty-mapping"><strong>No tables returned</strong><span>This base is ready for the three canonical mirror tables.</span></div>}
        <div class="airtable-mapping-fields">{TABLE_ORDER.map((table) => <label class="field" key={table}><span>{TABLE_LABELS[table]}</span><select value={mapping[table]} onChange={(event) => setMapping((current) => ({ ...current, [table]: event.currentTarget.value }))}><option value="">Choose a table</option>{tables.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label>)}</div>
        <AirtableSetupProgress readiness={readiness} progress={progress} />
        {!mappingComplete && readiness?.needs_provisioning && readiness.provisionable && <div class="airtable-provision-offer"><span>Fewer than three distinct conformant roles are ready.</span><Button onClick={() => void provisionTables()} disabled={pending !== null || token.trim().length === 0 || (baseId || status.base_id || "").trim().length === 0}>{pending === "provision" ? "Preparing tables…" : "Create the three tables for me"}</Button></div>}
        <div class="airtable-form-actions"><Button variant="primary" onClick={() => void mapTables()} disabled={pending !== null || tables.length === 0 || token.trim().length === 0 || !mappingComplete}>{pending === "mapping" ? "Turning on…" : "Turn on mirror"}</Button></div>
      </CardBody>
    </section>}

    {status?.configured && status.mapped && !setupActive && <AirtableHealthCard
      status={status}
      pending={pending}
      expiry={expiry}
      onSync={() => void syncNow()}
      onDisconnect={() => void disconnect()}
    />}

    {!setupActive && progress.length > 0 && <section class="card airtable-setup-report">
      <CardHeader title="Mirror setup report"><span class="subtle">Created and adopted columns from the completed setup</span></CardHeader>
      <CardBody><AirtableSetupProgress readiness={readiness} progress={progress} /></CardBody>
    </section>}

    <AirtableLiveLog status={status} log={log} />
  </div>;
}
