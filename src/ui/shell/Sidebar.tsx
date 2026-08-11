import type { JSX } from "preact";
import { routesFor, type RouteDefinition } from "./route-table";

function Nav({ label, routes, activeId, navigate }: { label: string; routes: readonly RouteDefinition[]; activeId?: string; navigate: (target: string) => void }): JSX.Element {
  return <nav class="nav" aria-label={label}>{routes.map((route) => <a key={route.id} href={route.path} class={activeId === route.id ? "active" : ""} aria-current={activeId === route.id ? "page" : undefined} onClick={(event) => { if (!route.external) { event.preventDefault(); navigate(route.path); } }}><span class="nav-icon" aria-hidden="true">{route.icon}</span><span>{route.label}</span></a>)}</nav>;
}

export function Sidebar({ activeId, eventName, navigate, unavailable }: { activeId?: string; eventName: string; navigate: (target: string) => void; unavailable: (title: string, copy: string) => void }): JSX.Element {
  return <aside class="sidebar">
    <a class="brand" href="/dashboard" onClick={(event) => { event.preventDefault(); navigate("/dashboard"); }}><span class="brand-mark">M</span><span class="brand-name">Marquee</span></a>
    <button class="event-switcher" onClick={() => unavailable("Conference switcher", "Switching between conferences arrives with conference administration.")}><small>Conference</small><strong>{eventName}</strong></button>
    <Nav label="Program home" routes={routesFor("home")} activeId={activeId} navigate={navigate} />
    <div class="nav-label">Pipeline</div>
    <Nav label="Program lifecycle" routes={routesFor("pipeline")} activeId={activeId} navigate={navigate} />
    <div class="nav-label">Modules</div>
    <Nav label="Program modules" routes={routesFor("modules")} activeId={activeId} navigate={navigate} />
    <div class="sidebar-foot">
      <button onClick={() => unavailable("API & CLI", "API documentation and command-line access land with the API core.")}>⌘ API & CLI</button>
      <button onClick={() => unavailable("Reset demo", "The reset endpoint lands with the seeded demo lifecycle.")}>↻ Reset demo</button>
    </div>
  </aside>;
}
