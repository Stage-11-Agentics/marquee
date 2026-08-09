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
  { id: "submitted", path: "/submissions?status=submitted", label: "Submitted", icon: "1", group: "pipeline", sidebar: true },
  { id: "in-review", path: "/submissions?status=in_review", label: "In review", icon: "2", group: "pipeline", sidebar: true },
  { id: "waved", path: "/submissions?status=waved", label: "Waved", icon: "3", group: "pipeline", sidebar: true },
  { id: "accepted", path: "/submissions?status=accepted", label: "Accepted", icon: "4", group: "pipeline", sidebar: true },
  { id: "onboarding", path: "/onboarding", label: "Onboarding", icon: "5", group: "pipeline", sidebar: true },
  { id: "scheduled", path: "/submissions?status=scheduled", label: "Scheduled", icon: "6", group: "pipeline", sidebar: true },
  { id: "published", path: "/submissions?status=published", label: "Published", icon: "7", group: "pipeline", sidebar: true },
  { id: "forms", path: "/forms", label: "CFP forms", icon: "□", group: "modules", sidebar: true },
  { id: "evaluation", path: "/evaluation", label: "Evaluation plan", icon: "◇", group: "modules", sidebar: true },
  { id: "reviewer", path: "/reviewer", label: "Review queue", icon: "✓", group: "modules", sidebar: true },
  { id: "agenda", path: "/agenda-builder", label: "Agenda", icon: "▦", group: "modules", sidebar: true },
  { id: "communications", path: "/communications", label: "Communications", icon: "✉", group: "modules", sidebar: true },
  { id: "portal", path: "/portal", label: "Speaker portal", icon: "○", group: "modules", sidebar: true, external: true },
  { id: "event-site", path: "/agenda", label: "Event site", icon: "↗", group: "modules", sidebar: true, external: true },
  { id: "settings", path: "/settings", label: "Event settings", icon: "⚙", group: "modules", sidebar: true },
  { id: "submission-detail", path: "/submissions/:id", label: "Submission record", icon: "", group: "utility" },
  { id: "submission-new", path: "/submissions/new", label: "Create submission", icon: "", group: "utility" },
  { id: "task-templates", path: "/settings/tasks", label: "Task templates", icon: "", group: "utility" },
  { id: "airtable", path: "/settings/airtable", label: "Airtable mirror", icon: "", group: "utility" },
  { id: "api-tokens", path: "/settings/api", label: "API tokens", icon: "", group: "utility" },
  { id: "api-docs", path: "/api/docs", label: "API & CLI", icon: "⌘", group: "utility" },
  { id: "import", path: "/import", label: "Sessionize importer", icon: "", group: "utility" },
  { id: "ai-assist", path: "/evaluation/ai", label: "AI assist", icon: "", group: "utility" },
] as const;

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
