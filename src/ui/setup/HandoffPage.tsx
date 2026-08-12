import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, PageHeader } from "../shell/components";
import "./setup.css";

/**
 * The moment after the claim: authority flows from the human to their agent,
 * visibly (ruling D5).
 *
 * The token minted here is an ORDINARY `api_tokens` row through the ordinary
 * route — no new table, no new kind, nothing this screen can do that Settings →
 * API tokens cannot (AC-278). Declining mints nothing and costs nothing: the
 * session is already live and the same screen is reachable forever.
 */

const AGENT_TOKEN_GRANTS = [
  "program:read",
  "program:write",
  "agenda:write",
  "comms:send",
  "speaker:write",
] as const;

const TOKENS_ROUTE = "/api/v1/org/tokens";
const AUTH_ME_ROUTE = "/api/v1/auth/me";

interface Identity {
  person_name?: string | null;
  person_email?: string | null;
}

interface TokenCreated {
  secret: string;
  data: { name: string };
}

export function HandoffPage({ navigate }: { navigate: (target: string) => void }): JSX.Element {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<Identity>(AUTH_ME_ROUTE, { route: AUTH_ME_ROUTE })
      .then((body) => { if (!cancelled) setIdentity(body); })
      .catch(() => { if (!cancelled) setIdentity({}); });
    return () => { cancelled = true; };
  }, []);

  const mintToken = async (): Promise<void> => {
    if (minting) return;
    setMinting(true);
    setError("");
    try {
      const created = await apiFetch<TokenCreated>(TOKENS_ROUTE, {
        method: "POST",
        route: TOKENS_ROUTE,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Setup agent",
          scopes: { permissions: [...AGENT_TOKEN_GRANTS], event_ids: [] },
        }),
      });
      setSecret(created.secret);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setMinting(false);
    }
  };

  const who = [identity?.person_name, identity?.person_email].filter(Boolean).join(" · ");

  return <div class="setup-page">
    <PageHeader
      title="You own this instance"
      copy={who.length > 0 ? who : "Your session is live. Everything below is optional."}
    />

    <Card>
      <CardHeader title="Hand your agent its keys">
        <span class="subtle">Shown once · revoke or reissue any time in Settings → API tokens</span>
      </CardHeader>
      <CardBody>
        <div class="setup-token-line">
          {/* The slot holds its size before and after minting, so the button
              beside it never moves under the pointer. */}
          <code class="setup-token" aria-live="polite">
            {secret ?? "A scoped token appears here once — Marquee will not show it again."}
          </code>
          {secret
            ? <Button onClick={() => { void navigator.clipboard?.writeText(secret); setCopied(true); }}>
                {copied ? "Copied" : "Copy token"}
              </Button>
            : <Button variant="primary" onClick={() => void mintToken()} disabled={minting} aria-busy={minting}>
                {minting ? "Minting…" : "Mint agent token"}
              </Button>}
        </div>
        <div class="setup-grants">
          {AGENT_TOKEN_GRANTS.map((grant) => <span key={grant} class="chip">{grant}</span>)}
        </div>
        <p class="subtle">
          Scoped, named, and yours to revoke. The agent drives the same API every screen here is
          built on — nothing it does is invisible to you.
        </p>
        <span class="setup-error" role="status" aria-live="polite">{error}</span>
      </CardBody>
    </Card>

    <div class="setup-doors">
      <button class="setup-door primary" type="button" onClick={() => navigate("/dashboard")}>
        <strong>Let your agent finish setup</strong>
        <span>Conference, tracks, formats, rooms, the call for speakers, the evaluation plan — watch it happen, verify it on the dashboard.</span>
        <span class="setup-door-go">Open the dashboard →</span>
      </button>
      <button class="setup-door" type="button" onClick={() => navigate("/conferences/new")}>
        <strong>Set up by hand</strong>
        <span>The same steps, through the screens. Nothing here requires an agent — it is just slower.</span>
        <span class="setup-door-go">Create the conference →</span>
      </button>
      <button class="setup-door" type="button" onClick={() => navigate("/submissions")}>
        <strong>Explore the demo first</strong>
        <span>A seeded conference at real scale, labelled and never mixed with your data. Removable in one action.</span>
        <span class="setup-door-go">Open the demo →</span>
      </button>
    </div>
  </div>;
}
