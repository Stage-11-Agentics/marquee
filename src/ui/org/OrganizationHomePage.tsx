import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import {
  ORG_HOME_ACTIVITY_HREF,
  ORG_HOME_ATTENTION_IDS,
  ORG_HOME_CREATE_HREF,
  ORG_HOME_ORGANIZERS_HREF,
  ORG_HOME_OUTREACH_HREF,
  ORG_HOME_PEOPLE_HREF,
  ORG_HOME_ROUTE,
  ORG_HOME_RETURNING_PEOPLE_HREF,
  ORG_HOME_SERVER_HREF,
  type OrgHomeActivity,
  type OrgHomeAttention,
  type OrgHomeAttentionId,
  type OrgHomeRelationshipMetric,
  type OrgHomeSeason,
  type OrgHomeSnapshot,
} from "../../api/org-home";
import { apiFetch } from "../shell/api-client";
import { Button, Chip, PageHeader } from "../shell/components";
import { ErrorBanner } from "../shell/ErrorSurface";
import { useEventContext } from "../shell/event-context";
import "./organization-home.css";

export const ORG_HOME_ATTENTION_ORDER = [...ORG_HOME_ATTENTION_IDS] as const;
export const ORG_HOME_RELATIONSHIP_ORDER = [
  "people",
  "returning_speakers",
  "in_outreach",
  "organizers",
] as const;

type Navigate = (target: string) => void;

interface LoadState {
  snapshot: OrgHomeSnapshot | null;
  error: unknown;
}

const RELATIONSHIP_LABELS: Record<(typeof ORG_HOME_RELATIONSHIP_ORDER)[number], string> = {
  people: "People",
  returning_speakers: "Returning speakers",
  in_outreach: "In outreach",
  organizers: "Organizers",
};

const RELATIONSHIP_HREFS: Record<(typeof ORG_HOME_RELATIONSHIP_ORDER)[number], string> = {
  people: ORG_HOME_PEOPLE_HREF,
  returning_speakers: ORG_HOME_RETURNING_PEOPLE_HREF,
  in_outreach: ORG_HOME_OUTREACH_HREF,
  organizers: ORG_HOME_ORGANIZERS_HREF,
};

const ATTENTION_HREFS: Record<OrgHomeAttentionId, string> = {
  overdue_outreach: ORG_HOME_OUTREACH_HREF,
  stale_seats: ORG_HOME_ORGANIZERS_HREF,
  server_status: ORG_HOME_SERVER_HREF,
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSeasonDates(season: Pick<OrgHomeSeason, "starts_on" | "ends_on">): string {
  const start = new Date(`${season.starts_on}T12:00:00Z`);
  const end = new Date(`${season.ends_on}T12:00:00Z`);
  const startMonth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(start);
  const endMonth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(end);
  const year = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "UTC" }).format(end);
  const startDay = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(start);
  const endDay = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(end);
  return startMonth === endMonth
    ? `${startMonth} ${startDay}–${endDay}, ${year}`
    : `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`;
}

function actionLabel(activity: OrgHomeActivity): string {
  const known: Record<string, string> = {
    invite_created: "Invite link minted",
    invite_claimed: "Invite claimed",
    api_token_created: "API token created",
    default_theme_updated: "Default theme set",
  };
  return known[activity.action] ?? activity.action.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function openSeason(
  eventId: string,
  dashboardHref: string,
  switchEvent: (eventId: string) => void,
  navigate: Navigate,
): void {
  // EventProvider does not re-resolve a changed `?event=` during SPA routing;
  // switch the shared context before taking the operator to the event dashboard.
  switchEvent(eventId);
  navigate(dashboardHref.split("?")[0] ?? "/dashboard");
}

function AttentionSlot({ slot, navigate }: { slot: OrgHomeAttention; navigate: Navigate }): JSX.Element {
  const className = `org-home-attention-slot ${slot.status}`;
  const href = slot.href ?? ATTENTION_HREFS[slot.id];
  const content = <>
    <span class="org-home-attention-mark" aria-hidden="true">{slot.status === "ok" ? "✓" : slot.status === "unavailable" ? "—" : "◆"}</span>
    <span class="org-home-attention-copy">
      <strong>{slot.title}</strong>
      <small>{slot.detail}</small>
    </span>
    <span class="org-home-attention-arrow" aria-hidden="true">→</span>
  </>;
  return href
    ? <a class={className} href={href} onClick={(event) => { event.preventDefault(); navigate(href); }} aria-label={`${slot.title}. ${slot.detail}`}>{content}</a>
    : <div class={className}>{content}</div>;
}

function AttentionLoading(): JSX.Element {
  return <section class="org-home-attention" aria-label="Needs attention" aria-busy="true">
    {ORG_HOME_ATTENTION_ORDER.map((id) => <div class="org-home-attention-slot loading" key={id}><span class="org-home-skeleton short" /><span class="org-home-skeleton long" /><span class="org-home-skeleton tiny" /></div>)}
  </section>;
}

function SeasonCard({ season, navigate, switchEvent }: { season: OrgHomeSeason; navigate: Navigate; switchEvent: (eventId: string) => void }): JSX.Element {
  return <article class={`org-home-season-card ${season.lifecycle}`}>
    <a href={season.links.dashboard} onClick={(event) => { event.preventDefault(); openSeason(season.id, season.links.dashboard, switchEvent, navigate); }}>
      <header>
        <div>
          <h3>{season.name}</h3>
          <span class="subtle">{formatSeasonDates(season)}</span>
        </div>
        <Chip tone={season.lifecycle === "live" ? "success" : season.lifecycle === "ended" ? "" : "warning"}>{season.lifecycle_label}</Chip>
      </header>
      <div class="org-home-season-counts" aria-label={`${season.name} counts`}>
        <span><strong class="tabular">{formatNumber(season.submission_count)}</strong> submissions</span>
        <span><strong class="tabular">{formatNumber(season.speaker_count)}</strong> speakers</span>
        <span><strong class="tabular">{formatNumber(season.session_count)}</strong> sessions</span>
      </div>
      <span class="org-home-season-link">Open conference →</span>
    </a>
  </article>;
}

function SeasonsSection({ snapshot, navigate, switchEvent }: { snapshot: OrgHomeSnapshot; navigate: Navigate; switchEvent: (eventId: string) => void }): JSX.Element {
  const years = snapshot.seasons.map((season) => season.starts_on.slice(0, 4)).filter((year, index, all) => all.indexOf(year) === index);
  const range = years.length > 1 ? `${years.at(-1)} – ${years[0]}` : years[0] ?? "—";
  return <section class="org-home-section" aria-labelledby="org-home-conferences">
    <header class="org-home-section-head">
      <div><span class="eyebrow">Conferences</span><h2 id="org-home-conferences">{snapshot.seasons.length} seasons · {range}</h2></div>
      <Button small onClick={() => navigate(ORG_HOME_CREATE_HREF)}>+ Create conference</Button>
    </header>
    {snapshot.seasons.length > 0
      ? <div class="org-home-season-grid">{snapshot.seasons.map((season) => <SeasonCard key={season.id} season={season} navigate={navigate} switchEvent={switchEvent} />)}</div>
      : <div class="org-home-reserved-empty"><strong>No conferences yet</strong><span>Create the first season and the work will have a home.</span><Button small variant="primary" onClick={() => navigate(ORG_HOME_CREATE_HREF)}>Create conference</Button></div>}
  </section>;
}

function NextConference({ snapshot, navigate, switchEvent }: { snapshot: OrgHomeSnapshot; navigate: Navigate; switchEvent: (eventId: string) => void }): JSX.Element {
  const season = snapshot.next_season;
  return <section class="org-home-next card instrument" aria-labelledby="org-home-next-title">
    <div class="org-home-next-copy">
      <span class="eyebrow">Next conference</span>
      <h2 id="org-home-next-title">{season?.name ?? "Your next season"}</h2>
      <p>{season ? "Same organizers, same people, a new season — the checklist scopes itself" : "Create a conference to carry the people and relationships forward."}</p>
    </div>
    {season
      ? <a class="button small primary" href={season.links.dashboard} onClick={(event) => { event.preventDefault(); openSeason(season.id, season.links.dashboard, switchEvent, navigate); }}>Open</a>
      : <Button small variant="primary" onClick={() => navigate(ORG_HOME_CREATE_HREF)}>Create</Button>}
  </section>;
}

function RelationshipMetric({ id, metric }: { id: (typeof ORG_HOME_RELATIONSHIP_ORDER)[number]; metric: OrgHomeRelationshipMetric }): JSX.Element {
  const value = metric.value === null ? "—" : formatNumber(metric.value);
  return <a class={`org-home-kpi ${metric.state}`} href={RELATIONSHIP_HREFS[id]}>
    <span class="eyebrow">{RELATIONSHIP_LABELS[id]}</span>
    <strong class="org-home-kpi-number tabular">{value}</strong>
    <span class="subtle">{metric.note}</span>
  </a>;
}

function RelationshipsSection({ snapshot }: { snapshot: OrgHomeSnapshot }): JSX.Element {
  return <section class="org-home-section" aria-labelledby="org-home-relationships">
    <header class="org-home-section-head">
      <div><span class="eyebrow">The relationships</span><h2 id="org-home-relationships">Org-level — people carry across conferences</h2></div>
      <a class="button small" href={ORG_HOME_PEOPLE_HREF}>Open CRM</a>
    </header>
    <div class="org-home-kpi-grid">
      {ORG_HOME_RELATIONSHIP_ORDER.map((id) => <RelationshipMetric key={id} id={id} metric={snapshot.relationships[id]} />)}
    </div>
  </section>;
}

function ActivityRow({ activity }: { activity: OrgHomeActivity }): JSX.Element {
  return <a class="org-home-activity-row" href={activity.href}>
    <span class="org-home-activity-main"><strong>{actionLabel(activity)}</strong><small>{activity.event_name}</small></span>
    <span class="org-home-activity-meta"><strong>{activity.actor_name}</strong><small>{formatDate(activity.created_at)}</small></span>
  </a>;
}

function ActivitySection({ snapshot }: { snapshot: OrgHomeSnapshot }): JSX.Element {
  return <section class="org-home-section" aria-labelledby="org-home-activity">
    <header class="org-home-section-head"><div><span class="eyebrow">Recent activity</span><h2 id="org-home-activity">Who changed what, org-wide</h2></div><a class="button small" href={ORG_HOME_ACTIVITY_HREF}>Full log →</a></header>
    <div class="org-home-activity-list">
      {snapshot.recent_activity.length > 0
        ? snapshot.recent_activity.map((activity) => <ActivityRow key={activity.id} activity={activity} />)
        : <div class="org-home-reserved-empty compact"><strong>No organization activity yet</strong><span>Changes made across conferences will appear here.</span></div>}
    </div>
  </section>;
}

function HomeContents({ snapshot, navigate, switchEvent }: { snapshot: OrgHomeSnapshot; navigate: Navigate; switchEvent: (eventId: string) => void }): JSX.Element {
  return <>
    <section class="org-home-attention" aria-label="Needs attention">
      {ORG_HOME_ATTENTION_ORDER.map((id) => {
        const slot = snapshot.attention.find((candidate) => candidate.id === id);
        return slot ? <AttentionSlot key={id} slot={slot} navigate={navigate} /> : <div class="org-home-attention-slot unavailable" key={id}><span>—</span><strong>Unavailable</strong></div>;
      })}
    </section>
    <SeasonsSection snapshot={snapshot} navigate={navigate} switchEvent={switchEvent} />
    <NextConference snapshot={snapshot} navigate={navigate} switchEvent={switchEvent} />
    <RelationshipsSection snapshot={snapshot} />
    <ActivitySection snapshot={snapshot} />
  </>;
}

function HomeLoading({ error }: { error: unknown }): JSX.Element {
  const unavailable = error !== null;
  return <>
    <AttentionLoading />
    <section class="org-home-section" aria-busy={!unavailable} aria-label={unavailable ? "Organization conferences unavailable" : "Loading conferences"}>
      <header class="org-home-section-head"><div><span class="eyebrow">Conferences</span><h2>— seasons · —</h2></div><span class="button small ghost">+ Create conference</span></header>
      <div class="org-home-season-grid">{["one", "two", "three"].map((id) => <div class="org-home-season-card loading" key={id}><span class="org-home-skeleton long" /><span class="org-home-skeleton medium" /><span class="org-home-skeleton short" /></div>)}</div>
    </section>
    <section class="org-home-next card instrument loading" aria-label="Loading next conference"><span class="org-home-skeleton medium" /><span class="org-home-skeleton long" /><span class="org-home-skeleton short" /></section>
    <section class="org-home-section" aria-label="Loading relationships"><header class="org-home-section-head"><div><span class="eyebrow">The relationships</span><h2>Org-level — people carry across conferences</h2></div></header><div class="org-home-kpi-grid">{ORG_HOME_RELATIONSHIP_ORDER.map((id) => <div class="org-home-kpi loading" key={id}><span class="org-home-skeleton short" /><span class="org-home-skeleton medium" /><span class="org-home-skeleton long" /></div>)}</div></section>
    <section class="org-home-section" aria-label="Loading recent activity"><header class="org-home-section-head"><div><span class="eyebrow">Recent activity</span><h2>Who changed what, org-wide</h2></div><span class="button small ghost">Full log →</span></header><div class="org-home-activity-list">{["one", "two", "three", "four"].map((id) => <div class="org-home-activity-row loading" key={id}><span class="org-home-skeleton medium" /><span class="org-home-skeleton short" /></div>)}</div></section>
  </>;
}

export function OrganizationHomePage({ navigate }: { navigate: Navigate }): JSX.Element {
  const { switchEvent } = useEventContext();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ snapshot: null, error: null });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void apiFetch<{ data: OrgHomeSnapshot }>(ORG_HOME_ROUTE, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
      route: ORG_HOME_ROUTE,
    }).then((body) => {
      if (active) setState({ snapshot: body.data, error: null });
    }).catch((error: unknown) => {
      if (active && !(error instanceof DOMException && error.name === "AbortError")) setState({ snapshot: null, error });
    });
    return () => { active = false; controller.abort(); };
  }, [reloadKey]);

  return <div class="org-home-page">
    <PageHeader
      title={state.snapshot?.organization.name ?? "Organization"}
      copy="The organization across its conferences. Each conference is one season; the people and relationships carry over."
      actions={<><Button onClick={() => navigate(ORG_HOME_PEOPLE_HREF)}>Open People CRM</Button><Button variant="primary" onClick={() => navigate(ORG_HOME_CREATE_HREF)}>+ Create conference</Button></>}
    />
    {state.error !== null && <ErrorBanner title="Organization Home could not be read" error={state.error} onRetry={() => { setState((current) => ({ ...current, error: null })); setReloadKey((value) => value + 1); }} route={ORG_HOME_ROUTE} />}
    {state.snapshot ? <HomeContents snapshot={state.snapshot} navigate={navigate} switchEvent={switchEvent} /> : <HomeLoading error={state.error} />}
  </div>;
}

export { RELATIONSHIP_HREFS, formatSeasonDates };
export { ORG_HOME_ROUTE };
