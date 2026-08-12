import type { JSX } from "preact";
import { EventSwitcher } from "./EventSwitcher";
import { useEventContext } from "./event-context";
import { routesFor, type RouteDefinition } from "./route-table";

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

function Nav({ label, routes, activeId, navigate, slug }: { label: string; routes: readonly RouteDefinition[]; activeId?: string; navigate: (target: string) => void; slug: string | null }): JSX.Element {
  return <nav class="nav" aria-label={label}>{routes.map((route) => {
    const href = route.external ? eventScopedPath(route.path, slug) : route.path;
    return <a key={route.id} href={href} class={activeId === route.id ? "active" : ""} aria-current={activeId === route.id ? "page" : undefined} onClick={(event) => { if (!route.external) { event.preventDefault(); navigate(route.path); } }}><span class="nav-icon" aria-hidden="true">{route.icon}</span><span>{route.label}</span></a>;
  })}</nav>;
}

export function Sidebar({ activeId, eventName, navigate, resetting, onReset }: { activeId?: string; eventName: string; navigate: (target: string) => void; resetting: boolean; onReset: () => void }): JSX.Element {
  const { event } = useEventContext();
  const slug = event?.slug ?? null;
  return <aside class="sidebar">
    <a class="brand" href="/dashboard" onClick={(event) => { event.preventDefault(); navigate("/dashboard"); }}><span class="brand-mark">M</span><span class="brand-name">Marquee</span></a>
    <EventSwitcher eventName={eventName} navigate={navigate} />
    <Nav label="Program home" routes={routesFor("home")} activeId={activeId} navigate={navigate} slug={slug} />
    <div class="nav-label">Pipeline</div>
    <Nav label="Program lifecycle" routes={routesFor("pipeline")} activeId={activeId} navigate={navigate} slug={slug} />
    <div class="nav-label">Modules</div>
    <Nav label="Program modules" routes={routesFor("modules")} activeId={activeId} navigate={navigate} slug={slug} />
    <div class="nav-label">System</div>
    <Nav label="System" routes={routesFor("utility")} activeId={activeId} navigate={navigate} slug={slug} />
    <div class="sidebar-foot">
      <a href="/api/docs">⌘ API &amp; CLI</a>
      <button type="button" class="reset-demo-button" onClick={onReset} disabled={resetting} aria-busy={resetting}>
        <span class="reset-demo-label">{resetting ? "Resetting…" : "↻ Reset demo"}</span>
      </button>
    </div>
  </aside>;
}
