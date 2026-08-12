import type { JSX } from "preact";
import { routesFor, type RouteDefinition } from "./route-table";

function Nav({ label, routes, activeId, navigate }: { label: string; routes: readonly RouteDefinition[]; activeId?: string; navigate: (target: string) => void }): JSX.Element {
  return <nav class="nav" aria-label={label}>{routes.map((route) => <a key={route.id} href={route.path} class={activeId === route.id ? "active" : ""} aria-current={activeId === route.id ? "page" : undefined} onClick={(event) => { if (!route.external) { event.preventDefault(); navigate(route.path); } }}><span class="nav-icon" aria-hidden="true">{route.icon}</span><span>{route.label}</span></a>)}</nav>;
}

export function Sidebar({ activeId, eventName, navigate, resetting, onReset }: { activeId?: string; eventName: string; navigate: (target: string) => void; resetting: boolean; onReset: () => void }): JSX.Element {
  return <aside class="sidebar">
    <a class="brand" href="/dashboard" onClick={(event) => { event.preventDefault(); navigate("/dashboard"); }}><span class="brand-mark">M</span><span class="brand-name">Marquee</span></a>
    {/*
      Organization sits ABOVE the conference caption on purpose. The sidebar
      reads brand → what this organization owns → which conference you are in →
      that conference's work, so the caption is a visible scope boundary rather
      than a label. People nested under one conference would be a different,
      smaller product.
    */}
    <div class="nav-label">Organization</div>
    <Nav label="Organization" routes={routesFor("organization")} activeId={activeId} navigate={navigate} />
    {/*
      The name is a caption, not a picker. It was dressed as a control —
      bordered, hover-lit, two lines — wrapped around a link back to the page
      you were already on, so it promised a conference switch this build cannot
      perform. The conference name is worth showing; the affordance was not.
      When real multi-event lands, a genuine control replaces this element.

      The ＋ beside it is the one thing here that does go somewhere: next year's
      conference is the cold start most organizers actually live, and it opens
      the same screen — and therefore the same create endpoint — that setting up
      by hand uses.
    */}
    <div class="event-context-row">
      <div class="event-context"><small>Conference</small><strong>{eventName}</strong></div>
      <a class="event-add" href="/conferences/new" title="Create conference" aria-label="Create conference" onClick={(event) => { event.preventDefault(); navigate("/conferences/new"); }}>＋</a>
    </div>
    <Nav label="Program home" routes={routesFor("home")} activeId={activeId} navigate={navigate} />
    <div class="nav-label">Pipeline</div>
    <Nav label="Program lifecycle" routes={routesFor("pipeline")} activeId={activeId} navigate={navigate} />
    <div class="nav-label">Modules</div>
    <Nav label="Program modules" routes={routesFor("modules")} activeId={activeId} navigate={navigate} />
    <div class="nav-label">System</div>
    <Nav label="System" routes={routesFor("utility")} activeId={activeId} navigate={navigate} />
    <div class="sidebar-foot">
      <a href="/api/docs">⌘ API &amp; CLI</a>
      <button type="button" class="reset-demo-button" onClick={onReset} disabled={resetting} aria-busy={resetting}>
        <span class="reset-demo-label">{resetting ? "Resetting…" : "↻ Reset demo"}</span>
      </button>
    </div>
  </aside>;
}
