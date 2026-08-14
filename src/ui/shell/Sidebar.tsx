import type { JSX } from "preact";
import { EventSwitcher } from "./EventSwitcher";
import { useEventContext } from "./event-context";
import { matchRoute, routesFor, type RouteDefinition } from "./route-table";
import { chromeFor, useThemeId, type RegisterChrome } from "./register";
import { StageFlyout } from "./StageFlyout";

/**
 * The public site and the speaker portal are real browser navigations out of
 * the shell, and both resolve their conference from `?event=<slug>` with a
 * fallback to whichever one the instance considers default. Left alone, "Conference
 * site" opens conference A's programme while the organizer is standing in
 * conference B — the one place in the product where switching would look like it
 * had not worked.
 */
export function eventScopedPath(path: string, slug: string | null): string {
  if (!slug || !path.startsWith("/")) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}event=${encodeURIComponent(slug)}`;
}

/** Rows whose icon column is deliberately empty still reserve it, so no label
 *  in the sidebar sits at a different x than the one above it. */
function NavIcon({ glyph }: { glyph: string }): JSX.Element {
  return <span class="nav-icon" aria-hidden="true">{glyph}</span>;
}

/**
 * The create action left the nav and became this: a `+` on the row that owns
 * the list it adds to. It is inside the row's link, so the click has to be
 * taken off the row before it becomes a navigation to the list instead.
 */
function AddSessionPlus({ navigate }: { navigate: (target: string) => void }): JSX.Element {
  const open = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    navigate("/submissions/new");
  };
  return <span
    class="row-plus"
    role="button"
    tabIndex={0}
    title="Add a session"
    aria-label="Add a session"
    onClick={open}
    onKeyDown={(event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") open(event); }}
  >+</span>;
}

function Nav({ label, routes, activeId, navigate, slug, chrome, extraClass = "" }: { label: string; routes: readonly RouteDefinition[]; activeId?: string; navigate: (target: string) => void; slug: string | null; chrome: RegisterChrome; extraClass?: string }): JSX.Element {
  // Register chrome may rename the nav (swyxy's lowercase single-word labels);
  // the routes, order, and structure are always Marquee's.
  const labelFor = (route: RouteDefinition) => chrome.navLabels[route.id] ?? route.label;
  return <nav class={`nav${extraClass ? ` ${extraClass}` : ""}`} aria-label={label}>{routes.map((route) => {
    const href = route.external ? eventScopedPath(route.path, slug) : route.path;
    const active = activeId === route.id;
    return <a
      key={route.id}
      href={href}
      data-nav-id={route.id}
      class={active ? "active" : ""}
      aria-current={active ? "page" : undefined}
      onClick={(event) => { if (!route.external) { event.preventDefault(); navigate(route.path); } }}
    >
      <NavIcon glyph={route.icon} />
      <span>{labelFor(route)}</span>
      {route.id === "submissions" ? <AddSessionPlus navigate={navigate} /> : null}
    </a>;
  })}</nav>;
}

/** The two system destinations the footer renders, read from the table so a
 *  path change moves them rather than orphaning them. */
const SYSTEM_HEALTH_PATH = matchRoute("/delivery-health", "?view=system")?.path ?? "/delivery-health?view=system";
const API_DOCS_PATH = matchRoute("/api/docs")?.path ?? "/api/docs";

export function Sidebar({ activeId, eventName, navigate, resetting, onReset }: { activeId?: string; eventName: string; navigate: (target: string) => void; resetting: boolean; onReset: () => void }): JSX.Element {
  const { event } = useEventContext();
  const slug = event?.slug ?? null;
  const chrome = chromeFor(useThemeId());
  const group = (label: string, name: Parameters<typeof routesFor>[0], extraClass = "") =>
    <Nav label={label} routes={routesFor(name)} activeId={activeId} navigate={navigate} slug={slug} chrome={chrome} extraClass={extraClass} />;
  return <aside class="sidebar">
    <a class="brand" href="/dashboard" onClick={(event) => { event.preventDefault(); navigate("/dashboard"); }}><span class="brand-mark">M</span><span class="brand-name">Marquee</span></a>
{/*
      Organization sits ABOVE the conference switcher on purpose. The sidebar
      reads brand → what this organization owns → which conference you are in →
      that conference's work, so the switcher is a visible scope boundary rather
      than a label. People nested under one conference would be a different,
      smaller product.
    */}
    <div class="nav-label">Organization</div>
    {group("Organization", "organization")}
{/*
      The switcher wears the same group label as everything else — the eyebrow
      that used to live inside the button said "Conference" in a second voice,
      in a place no other group's name appears.
    */}
    <div class="nav-label">Conference</div>
    <EventSwitcher eventName={eventName} navigate={navigate} />
    {group("Conference", "conference")}
    <div class="nav-label">Speaker ops</div>
    {group("Speaker ops", "speaker-ops")}
    <div class="nav-label">Call for proposals</div>
    {group("Call for proposals", "cfp")}
    <div class="nav-label">Public links</div>
    {group("Public links", "public-links")}
{/* Settings stands alone under its own rule: it is the conference's own
        settings, and the group above it is what says so. */}
    {group("Settings", "settings", "settings-nav")}
    <div class="sidebar-foot">
      <a href={API_DOCS_PATH}>⌘ API &amp; CLI</a>
      <a href={SYSTEM_HEALTH_PATH}>◌ System health</a>
      <button type="button" class="reset-demo-button" onClick={onReset} disabled={resetting} aria-busy={resetting}>
        <span class="reset-demo-label">{resetting ? "Resetting…" : "↻ Reset demo"}</span>
      </button>
    </div>
    <StageFlyout navigate={navigate} />
  </aside>;
}
