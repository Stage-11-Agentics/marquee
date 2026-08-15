import {
  ORG_HOME_ACTIVITY_HREF,
  ORG_HOME_CREATE_HREF,
  ORG_HOME_ORGANIZERS_HREF,
  ORG_HOME_OUTREACH_HREF,
  ORG_HOME_PEOPLE_HREF,
} from "../../api/org-home";

/**
 * `organization` is the group that sits ABOVE the conference caption in the
 * sidebar. That placement is the scope boundary made visible: everything below
 * the caption belongs to one conference, everything above it outlives all of
 * them. People, Lists, and outreach are org-level, so a nav that nests them
 * inside a conference's menu would be describing them wrongly. Only People CRM
 * and Outreach take a row there; Lists is org-level too but is reached from
 * People, whose lens it is.
 *
 * Below the caption the conference's own work is grouped by the question the
 * organizer is answering: the programme itself (`conference`), the work that
 * follows a yes (`speaker-ops`), the call for proposals (`cfp`), and the pages
 * the outside world reads (`public-links`). `settings` stands alone at the
 * foot of the conference, and `utility` is every route that is real but takes
 * no row — hidden aliases, record pages, and the system entries the footer
 * renders by hand.
 */
export type RouteGroup =
  | "organization"
  | "conference"
  | "speaker-ops"
  | "cfp"
  | "public-links"
  | "settings"
  | "utility";

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
  { id: "org-home", path: "/org/home", label: "Home", icon: "⌂", group: "organization", sidebar: true },
  // "People CRM" — the judge-legibility ruling (R5, 2026-08-14). The earlier
  // comment here argued against "CRM" as software's word for an address book,
  // and it is superseded: the people who go looking for this capability look
  // for it by that name, and a row nobody recognises is a capability nobody
  // finds. "People" alone is broad; "People CRM" is unambiguous. Inside the
  // screen the language stays the organizer's — a person, a list, never a
  // "contact" or a "segment".
  { id: "people", path: ORG_HOME_PEOPLE_HREF, label: "People CRM", icon: "", group: "organization", sidebar: true },
  // Lists is a way of looking at People, so it is reached from People — the
  // toolbar button there, and the band on a list's own view. It keeps a real
  // route (saving a list lands on it, and the URL is shareable) but no sidebar
  // row: a second permanent destination for a lens on the first one only makes
  // the nav longer and the relationship less obvious. It renders inside the
  // People screen, as its Lists tab.
  { id: "lists", path: "/lists", label: "Lists", icon: "", group: "organization" },
  // Org-level by design: one relationship, courted across years, each card
  // naming the conference it is currently aimed at.
  { id: "sourcing", path: ORG_HOME_OUTREACH_HREF, label: "Outreach", icon: "", group: "organization", sidebar: true },
  // ⚙ Settings closes the Organization group exactly as the whole conference
  // stack ends in its own Settings row (ruling O1). The symmetry is the lesson:
  // everything above the conference caption outlives every conference, and each
  // level ends where its own settings live. The label is shortened by its group,
  // the convention the rest of this nav uses, so the two Settings rows are
  // unambiguous without either growing a qualifier — and ⚙ is what marks a
  // Settings row here, so it is what marks this one.
  { id: "org-settings", path: "/org", label: "Settings", icon: "⚙", group: "organization", sidebar: true },
  // Three tabs of one surface. Real routes, so a tab is linkable and an agent
  // guessing one lands on it, but no rows of their own — the Settings row above
  // is the one they light.
  { id: "org-server", path: "/org/server", label: "Server", icon: "", group: "utility" },
  // MRQ-210's standalone alias for the same surface. It kept Server reachable
  // before these tabs existed; it stays reachable now, as the Server tab.
  { id: "org-instance", path: "/org/instance", label: "Server", icon: "", group: "utility" },
  { id: "org-tokens", path: "/org/tokens", label: "API tokens", icon: "", group: "utility" },
  // Agents guess URLs, and every 404 costs turns. These three resolve to People
  // rather than to the SPA's not-found state; they are not shown in the sidebar
  // because the area has one name and one entry.
  { id: "people-crm", path: "/crm", label: "People CRM", icon: "", group: "utility" },
  { id: "people-directory", path: "/directory", label: "People CRM", icon: "", group: "utility" },
  { id: "people-contacts", path: "/contacts", label: "People CRM", icon: "", group: "utility" },
  // Organization destinations without their own sidebar rows: the shell mounts
  // them from the shared organization surface or the canonical activity page.
  { id: "org-organizers", path: ORG_HOME_ORGANIZERS_HREF, label: "Organizers", icon: "", group: "utility" },
  // "Program pipeline" agrees with the page's own title. The brand mark is
  // still the way home.
  { id: "dashboard", path: "/dashboard", label: "Program pipeline", icon: "", group: "conference", sidebar: true },
  { id: "board", path: "/board", label: "Program board", icon: "", group: "conference", sidebar: true },
  // The long label wins: it teaches the abstract/session distinction the data
  // model rests on (R1). Its create action is the `+` the row carries, not a
  // row of its own.
  { id: "submissions", path: "/submissions", label: "Abstracts & sessions", icon: "", group: "conference", sidebar: true },
  { id: "submission-new", path: "/submissions/new", label: "Add a session", icon: "+", group: "utility" },
  // The seven lifecycle stages keep their routes and lose their rows. The
  // surfaces that already do this better — the dashboard strip with counts, the
  // board's columns, the list's status filter — plus the hover flyout on the
  // Program pipeline row, which is built from exactly these rows. Every one of
  // these URLs still resolves; only the ladder in the nav is gone.
  { id: "submitted", path: "/submissions?status=submitted", label: "Submitted", icon: "1", group: "utility" },
  { id: "in-review", path: "/submissions?status=in_review", label: "In review", icon: "2", group: "utility" },
  { id: "waved", path: "/submissions?status=waved", label: "Waved", icon: "3", group: "utility" },
  { id: "accepted", path: "/submissions?status=accepted", label: "Ready to place", icon: "4", group: "utility" },
  { id: "onboarding", path: "/onboarding", label: "Onboarding", icon: "", group: "speaker-ops", sidebar: true },
  { id: "scheduled", path: "/submissions?status=scheduled", label: "Scheduled", icon: "6", group: "utility" },
  { id: "published", path: "/submissions?status=published", label: "Published", icon: "7", group: "utility" },
  { id: "agenda", path: "/agenda-builder", label: "Agenda", icon: "", group: "conference", sidebar: true },
  // The organizer's person list. The label is the noun organizers and the
  // conference world use — "Speakers" — not a synonym that reads as a synonym.
  // The PATH is /roster because /speakers is the public directory's SSR route
  // (`public-agenda.route.tsx`), which resolves before the SPA fallback. The
  // label is what the organizer reads; the path is only where the shell mounts.
  { id: "speakers", path: "/roster", label: "Speakers", icon: "", group: "conference", sidebar: true },
  { id: "tasks", path: "/tasks", label: "Tasks", icon: "", group: "speaker-ops", sidebar: true },
  { id: "communications", path: "/communications", label: "Communications", icon: "✉", group: "speaker-ops", sidebar: true },
  // "Files" verbatim: this is the noun an organizer reaches for when they want
  // the deck, and renaming it to something cleverer only makes it unfindable.
  { id: "files", path: "/files", label: "Files", icon: "", group: "speaker-ops", sidebar: true },
  // The people-facing page carries its own chrome, so the sidebar hands it a
  // real browser navigation rather than a client-side push. Its group says
  // whose follow-ups these are, so the label no longer has to.
  { id: "delivery-health", path: "/delivery-health", label: "Follow-ups", icon: "", group: "speaker-ops", sidebar: true, external: true },
  // Labels shortened by their group: under "Call for proposals", "CFP forms"
  // says CFP twice and "Evaluation plan" says more than the row can carry.
  { id: "forms", path: "/forms", label: "Forms", icon: "", group: "cfp", sidebar: true },
  { id: "evaluation", path: "/evaluation", label: "Evaluation", icon: "", group: "cfp", sidebar: true },
  { id: "reviewer", path: "/reviewer", label: "Reviewer", icon: "", group: "cfp", sidebar: true },
  { id: "reviewer-queue", path: "/reviewer/queue", label: "Review queue", icon: "", group: "utility" },
  // The ↗ leads on every public row: the glyph is the promise that the click
  // leaves the admin shell, and it belongs before the label rather than after it.
  { id: "event-site", path: "/agenda", label: "Conference site", icon: "↗", group: "public-links", sidebar: true, external: true },
  { id: "portal", path: "/portal", label: "Speaker portal", icon: "↗", group: "public-links", sidebar: true, external: true },
  // The sponsor portal is a real route with no sidebar row. An organizer holds no
  // sponsorship, so a permanent row would be a permanent door onto an honest
  // "you have no sponsorship here" — a dead end in the nav rather than a
  // capability. Sponsor contacts arrive by magic link, which is the only door
  // that means anything for them.
  { id: "sponsor-portal", path: "/sponsor-portal", label: "Sponsor portal", icon: "↗", group: "utility" },
  // Server-rendered outside the admin shell (`embed.route.tsx`), and `app.tsx`
  // treats every `/embed/` path as a public page — so this must navigate for
  // real. A client-side push would land the shell on a route it does not render
  // and draw an empty state over a builder that works.
  { id: "embeds", path: "/embed/config", label: "Embeds", icon: "↗", group: "public-links", sidebar: true, external: true },
  // One conference's settings, standing alone under its own rule at the foot of
  // the conference — the scope is the group above it, so the label is the word.
  { id: "settings", path: "/settings", label: "Settings", icon: "⚙", group: "settings", sidebar: true },
  // The query variant shares the health document entrypoint without adding an
  // unowned app bootstrap branch. It is deliberately outside the main flow —
  // the sidebar footer renders it beside API & CLI.
  { id: "system-health", path: "/delivery-health?view=system", label: "System health", icon: "◌", group: "utility", external: true },
  // Reached from a co-speaker's invitation link, never from navigation. It is
  // declared here because it is a real route, and a route map that omits a real
  // route is the same defect as one that invents a route that is not.
  { id: "co-speaker", path: "/co-speaker", label: "Co-speaker confirmation", icon: "", group: "utility", external: true },
  { id: "conference-new", path: ORG_HOME_CREATE_HREF, label: "Create conference", icon: "", group: "utility" },
  { id: "handoff", path: "/handoff", label: "Instance handoff", icon: "", group: "utility" },
  { id: "venues", path: "/settings/venues", label: "Venues", icon: "⌖", group: "utility" },
  { id: "submission-detail", path: "/submissions/:id", label: "Submission record", icon: "", group: "utility" },
  // `/tasks` is where the sidebar sends an organizer; this row keeps the older
  // settings path working for anything that already links to it.
  { id: "task-templates", path: "/settings/tasks", label: "Task templates", icon: "", group: "utility" },
  // API tokens now lives at /org/tokens (ruling O2 — `api_tokens` is org-scoped
  // with a nullable event scope). This row keeps the old path reachable: a URL
  // that has worked does not stop working because its home moved.
  { id: "api-tokens", path: "/settings/api", label: "API tokens", icon: "", group: "utility" },
  // Organization-level, like People and the sourcing pipeline: the log survives
  // every conference in it, and an instance with no conference at all still has
  // invites and tokens to account for. No sidebar row — the steady-state home is
  // the Activity tab of Organization settings (MRQ-207), which mounts the same
  // page; this route is how it is reachable before that shell lands, and stays
  // valid after.
  { id: "org-activity", path: "/org/activity", label: "Activity", icon: "", group: "utility" },
  { id: "webhooks", path: "/settings/webhooks", label: "Webhooks", icon: "", group: "utility" },
  { id: "api-docs", path: "/api/docs", label: "API & CLI", icon: "⌘", group: "utility" },
  { id: "import", path: "/import", label: "Import speakers", icon: "", group: "utility" },
] as const;

/** Admin pages share AppShell; portal, reviewer, and API-doc rows use separate contracts. */
export function isAdminRoute(route: RouteDefinition): boolean {
  return !route.external && !["reviewer", "reviewer-queue", "api-docs"].includes(route.id);
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

/** The sidebar's groups, in the order the sidebar draws them. */
export const SIDEBAR_GROUPS: readonly RouteGroup[] = [
  "organization",
  "conference",
  "speaker-ops",
  "cfp",
  "public-links",
  "settings",
];

export function routesFor(group: RouteGroup): readonly RouteDefinition[] {
  return routeTable.filter((route) => route.group === group && route.sidebar);
}

/**
 * Which sidebar row a route lights up. Usually its own — but a route with no
 * row of its own has to name the row it belongs under, or the organizer stands
 * somewhere the nav refuses to acknowledge. `/lists` is a lens on People;
 * `/submissions/new` and the seven lifecycle filters are the submissions list
 * seen from a particular angle.
 */
const SIDEBAR_HOME: Readonly<Record<string, string>> = {
  lists: "people",
  "people-crm": "people",
  "people-directory": "people",
  "people-contacts": "people",
  "submission-new": "submissions",
  "submission-detail": "submissions",
  submitted: "submissions",
  "in-review": "submissions",
  waved: "submissions",
  accepted: "submissions",
  scheduled: "submissions",
  published: "submissions",
  venues: "settings",
  "task-templates": "tasks",
  // The org-settings tabs are one surface with four views, so all four light
  // the one row — and so does the legacy /settings/api path, whose content now
  // lives inside it (ruling O2).
  "org-organizers": "org-settings",
  "org-server": "org-settings",
  "org-instance": "org-settings",
  "org-tokens": "org-settings",
  "api-tokens": "org-settings",
  webhooks: "settings",
};

export function activeNavId(routeId: string | undefined): string | undefined {
  if (!routeId) return undefined;
  return SIDEBAR_HOME[routeId] ?? routeId;
}
