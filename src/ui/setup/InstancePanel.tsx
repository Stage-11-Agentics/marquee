import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, Chip } from "../shell/components";
import "./setup.css";

/**
 * The machine under the conference.
 *
 * Four rows, always four, always in this order, whatever the answers are — a
 * row that disappears when it goes green is a row the operator has to remember
 * used to exist. Only the chip and the note change (AC-284).
 *
 * The fix command comes from the server, which reads it from the same constant
 * the README's deploy sequence is checked against — so the command on screen is
 * the command in the docs, or the test fails.
 */

export const INSTANCE_STATUS_ROUTE = "/api/v1/instance/status";
export const REMOVE_DEMO_ROUTE = "/api/v1/admin/remove-demo";
const AUTH_ME_ROUTE = "/api/v1/auth/me";

interface StatusRow {
  key: string;
  label: string;
  configured: boolean;
  note: string;
  fix: string[];
}

interface StatusBody {
  data: { host: string; rows: StatusRow[] };
}

/** The four rows, in their fixed order, before the server has answered. */
const PLACEHOLDER_ROWS: StatusRow[] = [
  { key: "mail", label: "Mail · Resend", configured: false, note: "Reading…", fix: [] },
  { key: "uploads", label: "Uploads · R2", configured: false, note: "Reading…", fix: [] },
  { key: "spam", label: "Spam · Turnstile", configured: false, note: "Reading…", fix: [] },
  { key: "domain", label: "Domain", configured: false, note: "Reading…", fix: [] },
];

export function InstancePanel(): JSX.Element {
  const [rows, setRows] = useState<StatusRow[]>(PLACEHOLDER_ROWS);
  const [host, setHost] = useState("");
  const [error, setError] = useState("");
  const [openFix, setOpenFix] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(false);
  // The demo's presence is read from the session's own context rather than
  // added to the dashboard payload: the "Remove demo data" button must not
  // exist on an instance that has no demo to remove.
  const [demoPresent, setDemoPresent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<StatusBody>(INSTANCE_STATUS_ROUTE, { route: INSTANCE_STATUS_ROUTE })
      .then((body) => {
        if (cancelled) return;
        setRows(body.data.rows);
        setHost(body.data.host);
      })
      .catch((caught) => { if (!cancelled) setError(errorSummary(caught)); });
    void apiFetch<{ demo_event_id: string | null }>(AUTH_ME_ROUTE, { route: AUTH_ME_ROUTE })
      .then((body) => { if (!cancelled) setDemoPresent(body.demo_event_id !== null); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

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
    <CardHeader title="Instance">
      <span class="subtle">{host.length > 0 ? `The machine under the conference · ${host}` : "The machine under the conference"}</span>
    </CardHeader>
    <CardBody>
      <div class="instance-rows">
        {rows.map((row) => <div key={row.key} class="instance-row">
          <span class="instance-name">{row.label}</span>
          <Chip tone={row.configured ? "success" : "warning"}>
            {row.configured ? "configured" : "not configured"}
          </Chip>
          <span class="instance-note">{row.note}</span>
          {/* The fix slot is always occupied so the row never re-flows when a
              button appears or disappears. */}
          <span class="instance-fix">
            {row.configured || row.fix.length === 0
              ? <span class="instance-fix-blank">—</span>
              : <Button small onClick={() => setOpenFix(openFix === row.key ? null : row.key)}>
                  How to configure
                </Button>}
          </span>
          {openFix === row.key && <pre class="instance-fix-commands">{row.fix.join("\n")}</pre>}
        </div>)}
      </div>
      <div class="instance-foot">
        <span class="setup-error" role="status" aria-live="polite">
          {error.length > 0 ? error : removed ? "Demo removed." : ""}
        </span>
        {demoPresent && <Button onClick={() => void removeDemo()} disabled={removing} aria-busy={removing}>
          {removing ? "Removing…" : "Remove demo data"}
        </Button>}
      </div>
    </CardBody>
  </Card>;
}
