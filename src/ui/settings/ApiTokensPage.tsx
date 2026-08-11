import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { EmptyState, PageHeader } from "../shell/components";
import { DEFAULT_EVENT_ID } from "../venues/venue-writer";
import "./settings.css";

const API_GRANTS = [
  "program:read",
  "program:write",
  "review:write",
  "speaker:write",
  "agenda:write",
  "comms:send",
  "mirror:write",
] as const;

type ApiGrant = (typeof API_GRANTS)[number];

interface ApiToken {
  id: string;
  event_id: string | null;
  name: string;
  prefix: string;
  scopes: { permissions: ApiGrant[]; event_ids: string[] };
  created_by: string;
  last_used_at: number | null;
  revoked_at: number | null;
  created_at: number;
  updated_at: number;
}

interface Props {
  eventId?: string;
  navigate: (target: string) => void;
}

type LoadState =
  | { kind: "loading"; tokens: ApiToken[] }
  | { kind: "ready"; tokens: ApiToken[] }
  | { kind: "error"; tokens: ApiToken[]; message: string };

async function readError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return new Error(body?.error?.message || fallback);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...init });
  if (!response.ok) throw await readError(response, `Request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

function formatDate(value: number | null): string {
  if (value === null) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value);
}

function TokenSkeleton(): JSX.Element {
  return <div class="token-skeleton" aria-busy="true" aria-label="Loading API tokens">
    <span class="skeleton-line wide" /><span class="skeleton-line" /><span class="skeleton-line" />
  </div>;
}

function GrantCheckbox({
  grant,
  checked,
  onChange,
}: {
  grant: ApiGrant;
  checked: boolean;
  onChange: (grant: ApiGrant, checked: boolean) => void;
}): JSX.Element {
  return <label class="token-scope-option">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(grant, event.currentTarget.checked)}
    />
    <code>{grant}</code>
  </label>;
}

function TokenRow({ token, onRevoke }: { token: ApiToken; onRevoke: (token: ApiToken) => void }): JSX.Element {
  const restricted = token.scopes.event_ids.length > 0;
  return <tr>
    <th scope="row"><strong>{token.name}</strong><span class="token-prefix"><code>{token.prefix}…</code></span></th>
    <td><div class="token-scope-list">{token.scopes.permissions.map((grant) => <code key={grant}>{grant}</code>)}</div></td>
    <td>{restricted ? <span class="chip warning">{token.scopes.event_ids.length} conference{token.scopes.event_ids.length === 1 ? "" : "s"}</span> : <span class="chip">All conferences</span>}</td>
    <td class="tabular">{formatDate(token.created_at)}</td>
    <td class="tabular">{formatDate(token.last_used_at)}</td>
    <td>{token.revoked_at === null
      ? <button class="button small danger" type="button" onClick={() => onRevoke(token)}>Revoke</button>
      : <span class="chip alarm">Revoked</span>}</td>
  </tr>;
}

export function ApiTokensPage({ eventId = DEFAULT_EVENT_ID, navigate }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading", tokens: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<ApiGrant[]>(["program:read"]);
  const [restrictToConference, setRestrictToConference] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState({ kind: "loading", tokens: [] });
    void requestJson<{ data: ApiToken[] }>("/api/v1/org/tokens")
      .then((response) => { if (active) setState({ kind: "ready", tokens: response.data }); })
      .catch((reason: unknown) => {
        if (active) setState({ kind: "error", tokens: [], message: reason instanceof Error ? reason.message : "API tokens could not be loaded." });
      });
    return () => { active = false; };
  }, [reloadKey]);

  const toggleGrant = (grant: ApiGrant, checked: boolean): void => {
    setPermissions((current) => checked
      ? [...current, grant].filter((value, index, values) => values.indexOf(value) === index)
      : current.filter((value) => value !== grant));
  };

  const createToken = async (event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (permissions.length === 0) {
      setError("Choose at least one named scope.");
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await requestJson<{ data: ApiToken; secret: string }>("/api/v1/org/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          scopes: {
            permissions,
            event_ids: restrictToConference ? [eventId] : [],
          },
        }),
      });
      setSecret(response.secret);
      setName("");
      setPermissions(["program:read"]);
      setRestrictToConference(false);
      setShowCreate(false);
      setNotice("Token created. Copy the secret now; Marquee will not show it again.");
      setReloadKey((value) => value + 1);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Token could not be created.");
    } finally {
      setPending(false);
    }
  };

  const revokeToken = async (token: ApiToken): Promise<void> => {
    if (!window.confirm(`Revoke ${token.name}? Its next request will be rejected.`)) return;
    setError(null);
    setNotice(null);
    try {
      await requestJson(`/api/v1/org/tokens/${encodeURIComponent(token.id)}`, { method: "DELETE" });
      setNotice(`${token.name} revoked immediately.`);
      setReloadKey((value) => value + 1);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Token could not be revoked.");
    }
  };

  const copySecret = async (): Promise<void> => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setNotice("Secret copied. Keep it somewhere safe; Marquee will not show it again.");
    } catch {
      setNotice("Copy was unavailable; select the secret manually before dismissing it.");
    }
  };

  const content = state.kind === "loading"
    ? <TokenSkeleton />
    : state.kind === "error"
      ? <div class="settings-error" role="alert"><strong>Tokens unavailable</strong><span>{state.message}</span><button class="button small" type="button" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></div>
      : state.tokens.length === 0
        ? <EmptyState class="token-empty" title="No API tokens yet" copy="Create a narrowly scoped token for the CLI or an integration. Secrets are shown once and stored only as hashes." action={<button class="button" type="button" onClick={() => setShowCreate(true)}>Create API token</button>} />
        : <section class="card token-table-card"><div class="table-scroll"><table class="token-table"><thead><tr><th scope="col">Token</th><th scope="col">Named scopes</th><th scope="col">Restriction</th><th scope="col">Created</th><th scope="col">Last used</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>{state.tokens.map((token) => <TokenRow key={token.id} token={token} onRevoke={revokeToken} />)}</tbody></table></div></section>;

  return <div class="settings-page api-tokens-page">
    <PageHeader
      title="API tokens"
      copy="Issue narrowly scoped credentials for the CLI and integrations. Every request still resolves against the issuer's conference membership."
      actions={<><a class="button ghost" href="/settings" onClick={(event) => { event.preventDefault(); navigate("/settings"); }}>← Conference settings</a><a class="button" href="/api/docs">Read API &amp; CLI docs</a><button class="button primary" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Close form" : "Create API token"}</button></>}
    />
    {notice && <div class="settings-banner" role="status"><span>{notice}</span></div>}
    {error && <div class="settings-error" role="alert"><strong>Action failed</strong><span>{error}</span></div>}
    {secret && <section class="card token-secret-card" aria-live="polite"><header class="card-head"><h2>Copy your token secret</h2><span class="chip warning">Shown once</span></header><div class="card-body"><p class="token-secret-warning">This is the only time Marquee will show this secret. Store it in your password manager before dismissing this panel.</p><code class="token-secret">{secret}</code><div class="token-secret-actions"><button class="button primary" type="button" onClick={() => void copySecret()}>Copy secret</button><button class="button" type="button" onClick={() => setSecret(null)}>I saved it</button></div></div></section>}
    {showCreate && <section class="card token-create-card"><header class="card-head"><div><h2>New API token</h2><p class="subtle">Named scopes are intersected with the issuer's membership on every request.</p></div></header><form class="card-body stack" onSubmit={(event) => void createToken(event)}><label class="field"><span>Token name</span><input required maxLength={120} value={name} placeholder="CI integration" onInput={(event) => setName(event.currentTarget.value)} /></label><fieldset class="token-scope-fieldset"><legend>Named scopes</legend><div class="token-scope-grid">{API_GRANTS.map((grant) => <GrantCheckbox key={grant} grant={grant} checked={permissions.includes(grant)} onChange={toggleGrant} />)}</div><small>Choose only what this integration needs. A grant never exceeds the issuer's membership.</small></fieldset><label class="token-restriction"><input type="checkbox" checked={restrictToConference} onChange={(event) => setRestrictToConference(event.currentTarget.checked)} /><span>Restrict this token to the current conference <code>{eventId}</code></span></label><div class="token-form-actions"><button class="button" type="button" onClick={() => setShowCreate(false)}>Cancel</button><button class="button primary" type="submit" disabled={pending}>{pending ? "Issuing…" : "Issue token"}</button></div></form></section>}
    <div class="token-list-heading"><div><span class="eyebrow">Organization credentials</span><h2>Issued tokens</h2></div><span class="subtle">Revocation is immediate</span></div>
    {content}
    <p class="token-docs-note">Need the wire contract? <a href="/api/docs">Open the rendered API reference</a>. Organizer-facing copy says “conference”; the API keeps its versioned <code>/api/v1/events/…</code> paths.</p>
    {state.kind === "ready" && state.tokens.length > 0 && <button class="button ghost token-secondary-create" type="button" onClick={() => setShowCreate(true)}>+ Create another token</button>}
  </div>;
}
