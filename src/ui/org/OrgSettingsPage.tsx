import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, EmptyState, PageHeader } from "../shell/components";
import { cacheOrgDefaultTheme } from "../shell/theme";
import { THEMES } from "../../lib/theme-registry";
import { ApiTokensPage } from "../settings/ApiTokensPage";
import { ServerPage } from "../settings/ServerPage";
import { OrganizersCard } from "../setup/OrganizersCard";
import "../settings/settings.css";
import "./org-settings.css";

/**
 * Organization settings — the steady-state home for everything that outlives a
 * conference (rulings O1, O2, O7).
 *
 * Conference settings answers "how does this event run". Nothing there answers
 * "who can sign in", because the machinery that decides it — organizer seats,
 * one-time invites, instance status — only ever surfaced during the cold-start
 * setup walk. This surface is that home, and the two-level model is taught by
 * the symmetry: the Organization group ends in a Settings row exactly as the
 * conference group does.
 *
 * API tokens moves here rather than staying under one conference because
 * `api_tokens` is an org-scoped row with a *nullable* event scope — a token
 * that can span conferences never belonged inside one. `/settings/api` still
 * resolves; a URL that has worked does not stop working because its home moved.
 */

export const ORG_SETTINGS_ROUTE = "/api/v1/org/settings";

const TABS = [
  { id: "organization", label: "Organization", path: "/org" },
  { id: "organizers", label: "Organizers", path: "/org/organizers" },
  // "Server", not "Instance": the row is about what this Marquee is connected
  // to, and an organizer does not have a word called "instance".
  { id: "server", label: "Server", path: "/org/server" },
  { id: "tokens", label: "API tokens", path: "/org/tokens" },
] as const;

export type OrgTab = (typeof TABS)[number]["id"];

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  default_timezone: string | null;
  default_theme: string | null;
  comms_from_name: string | null;
  comms_reply_to: string | null;
  logo_key: string | null;
  accent: string | null;
}

interface Props {
  tab: OrgTab;
  /** The conference in context, or null on an instance that has none yet. */
  eventId: string | null;
  navigate: (target: string) => void;
}

export function OrgSettingsPage({ tab, eventId, navigate }: Props): JSX.Element {
  return <div class="settings-page org-settings-page">
    <PageHeader
      title="Organization settings"
      copy="Who can run this Marquee, what every new conference starts from, and what the server underneath is connected to."
    />
    <nav class="org-tabs" role="tablist" aria-label="Organization settings">
      {TABS.map((entry) => <button
        key={entry.id}
        type="button"
        role="tab"
        aria-selected={entry.id === tab}
        class={entry.id === tab ? "active" : ""}
        onClick={() => navigate(entry.path)}
      >{entry.label}</button>)}
    </nav>
    <p class="org-tabs-scroll-note" role="note"><strong>4 tabs</strong><span>swipe sideways for more</span></p>
    {tab === "organization" && <OrganizationTab />}
    {tab === "organizers" && <div class="org-tab-body"><OrganizersCard /></div>}
    {/* MRQ-210 owns everything this tab says; this surface is only its home,
        which is what MRQ-210's own note asked for. Rendering their page whole —
        rather than reaching past it to ServerPanel — keeps its lead copy,
        request/status behaviour and recovery card in one place and copies none
        of it here. `/org/instance` redirects to `/org/server`, still theirs. */}
    {tab === "server" && <div class="org-tab-body"><ServerPage /></div>}
    {tab === "tokens" && <div class="org-tab-body">
      <ApiTokensPage eventId={eventId} navigate={navigate} chrome={false} />
    </div>}
  </div>;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; settings: OrgSettings }
  | { kind: "error"; message: string };

function OrganizationTab(): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void apiFetch<{ data: OrgSettings }>(ORG_SETTINGS_ROUTE, {
      credentials: "include",
      cache: "no-store",
      route: ORG_SETTINGS_ROUTE,
    })
      .then((response) => {
        if (!active) return;
        setState({ kind: "ready", settings: response.data });
        // The pre-paint script cannot call an API, so the default it will read
        // on the next load is refreshed here, where it has just been read.
        cacheOrgDefaultTheme(response.data.default_theme);
      })
      .catch((reason: unknown) => {
        if (active) setState({ kind: "error", message: errorSummary(reason) });
      });
    return () => { active = false; };
  }, []);

  async function save(patch: Partial<OrgSettings>): Promise<void> {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch<{ data: OrgSettings }>(ORG_SETTINGS_ROUTE, {
        credentials: "include",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        route: ORG_SETTINGS_ROUTE,
      });
      setState({ kind: "ready", settings: response.data });
      cacheOrgDefaultTheme(response.data.default_theme);
      setNotice("Saved.");
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setSaving(false);
    }
  }

  if (state.kind === "loading") {
    return <div class="org-tab-body"><Card><CardBody><p class="subtle">Reading the organization…</p></CardBody></Card></div>;
  }
  if (state.kind === "error") {
    return <div class="org-tab-body">
      <EmptyState
        title="The organization could not be read"
        copy={state.message}
      />
    </div>;
  }

  const settings = state.settings;
  return <div class="org-tab-body org-grid">
    {notice && <div class="settings-banner span-2" role="status"><span>{notice}</span></div>}
    {error && <div class="settings-error span-2" role="alert"><strong>Save failed</strong><span>{error}</span></div>}

    <Card class="span-2">
      <CardHeader title="Organization"><p class="subtle">The name every conference here runs under.</p></CardHeader>
      <CardBody>
        <form
          class="stack"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void save({
              name: String(form.get("name") ?? "").trim(),
              // An empty field means "we have not said", which is a different
              // state from a value — so it is sent as null, not "".
              default_timezone: emptyToNull(form.get("default_timezone")),
              comms_from_name: emptyToNull(form.get("comms_from_name")),
              comms_reply_to: emptyToNull(form.get("comms_reply_to")),
            });
          }}
        >
          <label class="field"><span>Organization name</span>
            <input name="name" required maxLength={200} defaultValue={settings.name} />
          </label>
          <label class="field"><span>Default timezone</span>
            <input
              name="default_timezone"
              maxLength={80}
              placeholder="America/New_York"
              defaultValue={settings.default_timezone ?? ""}
            />
            <small>Seeds the timezone when a conference is created. Each conference still owns its own afterwards.</small>
          </label>
          <fieldset class="org-proposed">
            <legend>Communication defaults</legend>
            <label class="field"><span>From name</span>
              <input name="comms_from_name" maxLength={120} placeholder="Infra Days Programme" defaultValue={settings.comms_from_name ?? ""} />
            </label>
            <label class="field"><span>Reply-to</span>
              <input name="comms_reply_to" maxLength={320} placeholder="programme@example.org" defaultValue={settings.comms_reply_to ?? ""} />
            </label>
            <small>The voice new conferences inherit. How mail is actually sent lives on the Server tab.</small>
          </fieldset>
          <div class="org-form-actions">
            <Button variant="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </CardBody>
    </Card>

    <Card class="span-2">
      <CardHeader title="Default appearance">
        <p class="subtle">What someone sees before they choose. Their own choice always wins once made.</p>
      </CardHeader>
      <CardBody>
        <div class="org-theme-gallery">
          {THEMES.map((theme) => {
            const selected = settings.default_theme === theme.id;
            return <div key={theme.id} class={`org-theme-card${selected ? " selected" : ""}`}>
              <span class="org-theme-name">{theme.label}</span>
              <Button
                variant={selected ? "primary" : "ghost"}
                type="button"
                disabled={saving}
                onClick={() => void save({ default_theme: selected ? null : theme.id })}
              >{selected ? "Selected" : "Select"}</Button>
            </div>;
          })}
        </div>
        <p class="subtle">
          {settings.default_theme === null
            ? "No default set — everyone starts on Marquee Light until they choose."
            : "Selecting the current default again clears it back to unset."}
        </p>
      </CardBody>
    </Card>
  </div>;
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text.length === 0 ? null : text;
}
