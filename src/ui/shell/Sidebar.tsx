import type { JSX } from "preact";
import { routesFor, type RouteDefinition } from "./route-table";
import { chromeFor, useThemeId, type RegisterChrome } from "./register";

function Nav({ label, routes, activeId, navigate, chrome }: { label: string; routes: readonly RouteDefinition[]; activeId?: string; navigate: (target: string) => void; chrome: RegisterChrome }): JSX.Element {
  // Register chrome may rename and re-mark the nav (swyxy's lowercase
  // single-word labels, AI Engineer's zero-padded pipeline indices); the
  // routes, order, and structure are always Marquee's.
  const labelFor = (route: RouteDefinition) => chrome.navLabels[route.id] ?? route.label;
  const iconFor = (route: RouteDefinition) =>
    chrome.zeroPadNavIcons && /^\d$/.test(route.icon) ? `0${route.icon}` : route.icon;
  return <nav class="nav" aria-label={label}>{routes.map((route) => <a key={route.id} href={route.path} class={activeId === route.id ? "active" : ""} aria-current={activeId === route.id ? "page" : undefined} onClick={(event) => { if (!route.external) { event.preventDefault(); navigate(route.path); } }}><span class="nav-icon" aria-hidden="true">{iconFor(route)}</span><span>{labelFor(route)}</span></a>)}</nav>;
}

export function Sidebar({ activeId, eventName, navigate, resetting, onReset }: { activeId?: string; eventName: string; navigate: (target: string) => void; resetting: boolean; onReset: () => void }): JSX.Element {
  const chrome = chromeFor(useThemeId());
  return <aside class="sidebar">
    <a class="brand" href="/dashboard" onClick={(event) => { event.preventDefault(); navigate("/dashboard"); }}><span class="brand-mark">M</span><span class="brand-name">Marquee</span></a>
    <a class="event-switcher" href="/dashboard" onClick={(event) => { event.preventDefault(); navigate("/dashboard"); }}><small>Conference</small><strong>{eventName}</strong></a>
    <Nav label="Program home" routes={routesFor("home")} activeId={activeId} navigate={navigate} chrome={chrome} />
    <div class="nav-label">Pipeline</div>
    <Nav label="Program lifecycle" routes={routesFor("pipeline")} activeId={activeId} navigate={navigate} chrome={chrome} />
    <div class="nav-label">Modules</div>
    <Nav label="Program modules" routes={routesFor("modules")} activeId={activeId} navigate={navigate} chrome={chrome} />
    <div class="nav-label">System</div>
    <Nav label="System" routes={routesFor("utility")} activeId={activeId} navigate={navigate} chrome={chrome} />
    <div class="sidebar-foot">
      <a href="/api/docs">⌘ API &amp; CLI</a>
      <button type="button" class="reset-demo-button" onClick={onReset} disabled={resetting} aria-busy={resetting}>
        <span class="reset-demo-label">{resetting ? "Resetting…" : "↻ Reset demo"}</span>
      </button>
    </div>
  </aside>;
}
