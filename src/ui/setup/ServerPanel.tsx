import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, Chip } from "../shell/components";
import { useDemoEventPresent } from "../shell/identity";
import { RESEND_DASHBOARD_URL } from "../../lib/mail/config";
import "./setup.css";

/** The shared server-panel seam: setup and organization settings use this body. */
export const INSTANCE_STATUS_ROUTE = "/api/v1/instance/status";
export const REMOVE_DEMO_ROUTE = "/api/v1/admin/remove-demo";

export const SERVER_LEAD_COPY = "What this Marquee is connected to, and whether each piece is working.";

type StatusKey = "mail" | "uploads" | "spam" | "domain" | "airtable";

interface StatusRow {
  key: StatusKey;
  label: string;
  configured: boolean;
  note: string;
  fix: string[];
  sender?: string | null;
  account?: string | null;
}

interface StatusBody {
  data: { host: string; rows: StatusRow[] };
}

/** The five rows never disappear or reorder while the status request resolves. */
const PLACEHOLDER_ROWS: StatusRow[] = [
  { key: "mail", label: "Email sending", configured: false, note: "Reading…", fix: [], sender: null, account: null },
  { key: "uploads", label: "File uploads", configured: false, note: "Reading…", fix: [] },
  { key: "spam", label: "Spam protection", configured: false, note: "Reading…", fix: [] },
  { key: "domain", label: "Web address", configured: false, note: "Reading…", fix: [] },
  { key: "airtable", label: "Airtable mirror", configured: false, note: "Reading…", fix: [] },
];

const PROVIDERS: Partial<Record<StatusKey, string>> = {
  mail: "Resend",
  uploads: "Cloudflare R2",
  spam: "Cloudflare Turnstile",
  airtable: "Airtable",
};

function mailNote(row: StatusRow): string {
  if (!row.configured) return row.note;
  const sender = row.sender ?? "not named in deployment configuration";
  const account = row.account ?? "not named in deployment configuration";
  return `via Resend · sending as ${sender} · account ${account}`;
}

function rowDetail(row: StatusRow): string {
  return row.key === "mail" ? mailNote(row) : row.note;
}

export interface ServerPanelProps {
  /** Setup owns the demo-removal control; steady-state settings does not. */
  showDemoControls?: boolean;
}

export function ServerPanel({ showDemoControls = false }: ServerPanelProps): JSX.Element {
  const [rows, setRows] = useState<StatusRow[]>(PLACEHOLDER_ROWS);
  const [host, setHost] = useState("");
  const [error, setError] = useState("");
  const [openFix, setOpenFix] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(false);
  const demoEventPresent = useDemoEventPresent();

  useEffect(() => {
    let cancelled = false;
    void apiFetch<StatusBody>(INSTANCE_STATUS_ROUTE, { route: INSTANCE_STATUS_ROUTE })
      .then((body) => {
        if (cancelled) return;
        setRows(body.data.rows);
        setHost(body.data.host);
      })
      .catch((caught) => { if (!cancelled) setError(errorSummary(caught)); });
    return () => { cancelled = true; };
  }, [showDemoControls]);

  const removeDemo = useCallback(async () => {
    if (removing) return;
    const confirmed = window.confirm(
      "Remove the demo conference?\n\nThe seeded conference and its submissions, speakers, and tasks are deleted. Your own conferences, organizers, and API tokens are untouched.",
    );
    if (!confirmed) return;
    setRemoving(true);
    try {
      await apiFetch<{ ok: true }>(REMOVE_DEMO_ROUTE, {
        method: "POST",
        route: REMOVE_DEMO_ROUTE,
      });
      setRemoved(true);
      window.setTimeout(() => window.location.reload(), 250);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setRemoving(false);
    }
  }, [removing]);

  return <Card>
    <CardHeader title="Server">
      <span class="subtle">{host.length > 0 ? `${SERVER_LEAD_COPY} · ${host}` : SERVER_LEAD_COPY}</span>
    </CardHeader>
    <CardBody>
      <div class="instance-rows" data-server-panel>
        {rows.map((row) => <div key={row.key} class="instance-row">
          <span class="instance-name">{row.label}</span>
          <Chip tone={row.configured ? "success" : "warning"}>
            {row.configured ? "working" : "not set up"}
          </Chip>
          <span class="instance-note">
            {PROVIDERS[row.key] && <small class="instance-provider">{PROVIDERS[row.key]}</small>}
            <span>{rowDetail(row)}</span>
          </span>
          <span class="instance-fix">
            {row.key === "airtable"
              ? <a class="button small" href="/settings/airtable">{row.configured ? "Manage Airtable" : "Connect Airtable"}</a>
              : row.key === "mail" && row.configured
              ? <a class="button small" href={RESEND_DASHBOARD_URL} target="_blank" rel="noopener">Open Resend ↗</a>
              : row.configured || row.fix.length === 0
                ? <span class="instance-fix-blank">—</span>
                : <Button small onClick={() => setOpenFix(openFix === row.key ? null : row.key)}>
                  How to set up
                </Button>}
          </span>
          {openFix === row.key && <pre class="instance-fix-commands">{row.fix.join("\n")}</pre>}
        </div>)}
      </div>
      {showDemoControls && <div class="instance-foot">
        <span class="setup-error" role="status" aria-live="polite">
          {error.length > 0 ? error : removed ? "Demo removed." : ""}
        </span>
        {demoEventPresent === true && <Button onClick={() => void removeDemo()} disabled={removing} aria-busy={removing}>
          {removing ? "Removing…" : "Remove demo data"}
        </Button>}
      </div>}
      {!showDemoControls && error.length > 0 && <div class="instance-foot">
        <span class="setup-error" role="status" aria-live="polite">{error}</span>
      </div>}
    </CardBody>
  </Card>;
}
