export type RouteGroup = "home" | "pipeline" | "modules" | "utility";

export interface RouteDefinition {
  id: string;
  path: string;
  label: string;
  icon: string;
  group: RouteGroup;
  sidebar?: boolean;
  external?: boolean;
}

export const routeTable: readonly RouteDefinition[] = [
  { id: "dashboard", path: "/dashboard", label: "Program home", icon: "⌂", group: "home", sidebar: true },
  { id: "board", path: "/board", label: "Program board", icon: "▥", group: "home", sidebar: true },
  // The whole list and its create action are entrances, not lifecycle stages —
  // the Pipeline group below is a numbered ladder and an unnumbered row in the
  // middle of it reads as a broken sequence.
  { id: "submissions", path: "/submissions", label: "Abstracts & sessions", icon: "▤", group: "home", sidebar: true },
  { id: "submission-new", path: "/submissions/new", label: "Add a session", icon: "+", group: "home", sidebar: true },
  { id: "submitted", path: "/submissions?status=submitted", label: "Submitted", icon: "1", group: "pipeline", sidebar: true },
  { id: "in-review", path: "/submissions?status=in_review", label: "In review", icon: "2", group: "pipeline", sidebar: true },
  { id: "waved", path: "/submissions?status=waved", label: "Waved", icon: "3", group: "pipeline", sidebar: true },
  { id: "accepted", path: "/submissions?status=accepted", label: "Ready to place", icon: "4", group: "pipeline", sidebar: true },
  { id: "onboarding", path: "/onboarding", label: "Onboarding", icon: "5", group: "pipeline", sidebar: true },
  { id: "scheduled", path: "/submissions?status=scheduled", label: "Scheduled", icon: "6", group: "pipeline", sidebar: true },
  { id: "published", path: "/submissions?status=published", label: "Published", icon: "7", group: "pipeline", sidebar: true },
  // The organizer's person list. The label is the noun organizers and the
  // conference world use — "Speakers" — not a synonym that reads as a synonym.
  // The PATH is /roster because /speakers is the public directory's SSR route
  // (`public-agenda.route.tsx`), which resolves before the SPA fallback. The
  // label is what the organizer reads; the path is only where the shell mounts.
  { id: "speakers", path: "/roster", label: "Speakers", icon: "◍", group: "modules", sidebar: true },
  { id: "forms", path: "/forms", label: "CFP forms", icon: "□", group: "modules", sidebar: true },
  { id: "evaluation", path: "/evaluation", label: "Evaluation plan", icon: "◇", group: "modules", sidebar: true },
  { id: "reviewer", path: "/reviewer", label: "Review queue", icon: "✓", group: "modules", sidebar: true },
  { id: "agenda", path: "/agenda-builder", label: "Agenda", icon: "▦", group: "modules", sidebar: true },
  // "Files" verbatim: this is the noun an organizer reaches for when they want
  // the deck, and renaming it to something cleverer only makes it unfindable.
  { id: "files", path: "/files", label: "Files", icon: "▤", group: "modules", sidebar: true },
  { id: "communications", path: "/communications", label: "Communications", icon: "✉", group: "modules", sidebar: true },
  { id: "tasks", path: "/tasks", label: "Tasks", icon: "☑", group: "modules", sidebar: true },
  { id: "portal", path: "/portal", label: "Speaker portal", icon: "○", group: "modules", sidebar: true, external: true },
  { id: "event-site", path: "/agenda", label: "Conference site", icon: "↗", group: "modules", sidebar: true, external: true },
  // Server-rendered outside the admin shell (`embed.route.tsx`), and `app.tsx`
  // treats every `/embed/` path as a public page — so this must navigate for
  // real. A client-side push would land the shell on a route it does not render
  // and draw an empty state over a builder that works.
  { id: "embeds", path: "/embed/config", label: "Embeds", icon: "◨", group: "modules", sidebar: true, external: true },
  { id: "settings", path: "/settings", label: "Conference settings", icon: "⚙", group: "modules", sidebar: true },
  // The people-facing page carries its own chrome, so the sidebar hands it a
  // real browser navigation rather than a client-side push.
  { id: "delivery-health", path: "/delivery-health", label: "Speaker follow-ups", icon: "◎", group: "modules", sidebar: true, external: true },
  // The query variant shares the health document entrypoint without adding an
  // unowned app bootstrap branch. It is deliberately outside the main flow.
  { id: "system-health", path: "/delivery-health?view=system", label: "System health", icon: "◌", group: "utility", sidebar: true, external: true },
  // Reached from a co-speaker's invitation link, never from navigation. It is
  // declared here because it is a real route, and a route map that omits a real
  // route is the same defect as one that invents a route that is not.
  { id: "co-speaker", path: "/co-speaker", label: "Co-speaker confirmation", icon: "", group: "utility", external: true },
  { id: "conference-new", path: "/conferences/new", label: "Create conference", icon: "", group: "utility" },
  { id: "handoff", path: "/handoff", label: "Instance handoff", icon: "", group: "utility" },
  { id: "venues", path: "/settings/venues", label: "Venues", icon: "⌖", group: "utility" },
  { id: "submission-detail", path: "/submissions/:id", label: "Submission record", icon: "", group: "utility" },
  // `/tasks` is where the sidebar sends an organizer; this row keeps the older
  // settings path working for anything that already links to it.
  { id: "task-templates", path: "/settings/tasks", label: "Task templates", icon: "", group: "utility" },
  { id: "api-tokens", path: "/settings/api", label: "API tokens", icon: "", group: "utility" },
  { id: "api-docs", path: "/api/docs", label: "API & CLI", icon: "⌘", group: "utility" },
  { id: "import", path: "/import", label: "Import speakers", icon: "", group: "utility" },
] as const;

/** Admin pages share AppShell; portal, reviewer, and API-doc rows use separate contracts. */
export function isAdminRoute(route: RouteDefinition): boolean {
  return !route.external && route.id !== "reviewer" && route.id !== "api-docs";
}

export const adminRouteTable: readonly RouteDefinition[] = routeTable.filter(isAdminRoute);

function pathPatternMatches(pattern: string, pathname: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[^/]+/g, "[^/]+");
  return new RegExp(`^${escaped}/?$`).test(pathname);
}

export function matchRoute(pathname: string, search = ""): RouteDefinition | undefined {
  const exact = routeTable.find((route) => route.path === `${pathname}${search}`);
  if (exact) return exact;
  return routeTable.find((route) => !route.path.includes("?") && pathPatternMatches(route.path, pathname));
}

export function routesFor(group: RouteGroup): readonly RouteDefinition[] {
  return routeTable.filter((route) => route.group === group && route.sidebar);
}
