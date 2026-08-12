/**
 * The public command registry. Help, dispatch, and the generated skill guide
 * all consume this table; adding a command in only one surface is a build
 * error in the CLI tests.
 *
 * `event: true` means the command is scoped to one conference and must resolve
 * an event ID before it runs. It is declared per command rather than derived
 * from the path, because a derived predicate silently gets the answer wrong for
 * every command added under an existing prefix.
 *
 * `set` names the allowlisted `--set key=value` body fields, mirroring the
 * route's own schema. Dispatch rejects anything outside the list, so a typo
 * fails locally with the legal keys rather than as a 400 from the server.
 */

export const GLOBAL_OPTIONS = [
  { name: "--url <url>", description: "Marquee instance URL (or MARQUEE_URL)." },
  { name: "--token <token>", description: "Scoped API token (or MARQUEE_TOKEN)." },
  { name: "--json", description: "Emit one parseable JSON value on stdout." },
  { name: "--help", description: "Show help for this command." },
];

const SET_OPTION = {
  name: "--set <key=value>",
  description: "Repeatable body field. Values parse as JSON when they can: 30 is a number, null is null, Workshop is a string. Quote to force a string: --set name='\"2026\"'.",
};

export const COMMAND_REGISTRY = [
  {
    path: ["event", "seed"],
    usage: "marquee event seed",
    summary: "Restore the seeded conference and return its ID.",
    operations: ["enqueueDemoReset", "getDemoResetJob", "getCurrentAuth"],
    skill: "seed",
    options: [],
  },
  {
    path: ["event", "show"],
    usage: "marquee event show <event-id>",
    summary: "Read conference details, formats, and tracks.",
    operations: ["getEventSettings"],
    skill: "seed",
    event: true,
    options: [{ name: "--event-id <id>", description: "Conference ID when it is not positional." }],
  },
  {
    path: ["event", "set"],
    usage: "marquee event set <event-id> --set <key=value>",
    summary: "Update conference name, dates, timezone, venue, or branding.",
    operations: ["updateEventSettings"],
    skill: "configure",
    event: true,
    set: ["name", "tagline", "starts_on", "ends_on", "timezone", "venue", "logo_key", "accent"],
    options: [SET_OPTION],
  },
  {
    path: ["tracks", "list"],
    usage: "marquee tracks list <event-id>",
    summary: "List the conference's tracks.",
    operations: ["listEventTracks"],
    skill: "configure",
    event: true,
    options: [],
  },
  {
    path: ["tracks", "add"],
    usage: "marquee tracks add <event-id> --set name=<name> --set color=<hex>",
    summary: "Create a track.",
    operations: ["createEventTrack"],
    skill: "configure",
    event: true,
    set: ["name", "color", "position"],
    options: [SET_OPTION],
  },
  {
    path: ["tracks", "remove"],
    usage: "marquee tracks remove <event-id> <track-id>",
    summary: "Delete a track.",
    operations: ["deleteEventTrack"],
    skill: "configure",
    event: true,
    options: [],
  },
  {
    path: ["formats", "list"],
    usage: "marquee formats list <event-id>",
    summary: "List the conference's session formats.",
    operations: ["listEventFormats"],
    skill: "configure",
    event: true,
    options: [],
  },
  {
    path: ["formats", "add"],
    usage: "marquee formats add <event-id> --set name=<name> --set default_duration_min=<n>",
    summary: "Create a session format with its duration range.",
    operations: ["createEventFormat"],
    skill: "configure",
    event: true,
    set: ["name", "default_duration_min", "min_duration_min", "max_duration_min", "position"],
    options: [SET_OPTION],
  },
  {
    path: ["formats", "remove"],
    usage: "marquee formats remove <event-id> <format-id>",
    summary: "Delete a session format.",
    operations: ["deleteEventFormat"],
    skill: "configure",
    event: true,
    options: [],
  },
  {
    path: ["submissions", "list"],
    usage: "marquee submissions list <event-id>",
    summary: "List Abstracts and Sessions with server-side filters.",
    operations: ["listEventSubmissions"],
    skill: "triage",
    event: true,
    options: [
      { name: "--filter <key=value>", description: "Repeat an allowlisted submission filter." },
      { name: "--page <n>", description: "One-based result page." },
      { name: "--per-page <n>", description: "Rows per page, up to 100." },
      { name: "--sort <key>", description: "newest, updated, title, or score." },
    ],
  },
  {
    path: ["submissions", "show"],
    usage: "marquee submissions show <event-id> <submission-id>",
    summary: "Read one submission record.",
    operations: ["getSubmissionRecord"],
    skill: "triage",
    event: true,
    options: [],
  },
  {
    path: ["submissions", "accept"],
    usage: "marquee submissions accept <event-id> --filter <key=value>",
    summary: "Accept every submission selected by a server-side filter.",
    operations: ["bulkDecideSubmissions"],
    skill: "triage",
    event: true,
    options: [{ name: "--filter <key=value>", description: "Required; repeat or pass a JSON filter object." }],
  },
  {
    path: ["submissions", "reject"],
    usage: "marquee submissions reject <event-id> --filter <key=value>",
    summary: "Reject every submission selected by a server-side filter.",
    operations: ["bulkDecideSubmissions"],
    skill: "triage",
    event: true,
    options: [{ name: "--filter <key=value>", description: "Required; repeat or pass a JSON filter object." }],
  },
  {
    path: ["submissions", "schedule"],
    usage: "marquee submissions schedule <event-id> <submission-id> --set starts_at=<ms> --set duration_min=<n> --set room_id=<id>",
    summary: "Place an accepted Session on the working agenda.",
    operations: ["scheduleSubmission"],
    skill: "agenda",
    event: true,
    set: ["starts_at", "duration_min", "room_id", "track_id"],
    options: [SET_OPTION],
  },
  {
    path: ["submissions", "publish"],
    usage: "marquee submissions publish <event-id> <submission-id>",
    summary: "Publish a scheduled Session to the public program.",
    operations: ["publishSubmission"],
    skill: "publish",
    event: true,
    options: [],
  },
  {
    path: ["tasks", "list"],
    usage: "marquee tasks list <event-id> --overdue",
    summary: "List speakers with outstanding tasks, optionally overdue only.",
    operations: ["getOnboardingBoard"],
    skill: "chase",
    event: true,
    options: [
      { name: "--overdue", description: "Restrict the chase board to overdue work." },
      { name: "--filter <name>", description: "all, overdue, incomplete, or risk." },
    ],
  },
  {
    path: ["files", "list"],
    usage: "marquee files list <event-id> --state <name>",
    summary: "List every requested deliverable with its speaker, session, and version history.",
    operations: ["listConferenceFiles"],
    skill: "chase",
    event: true,
    options: [
      { name: "--state <name>", description: "all, uploaded, missing, or overdue." },
      { name: "--task <template-id>", description: "Restrict to one file task." },
      { name: "--search <text>", description: "Match filename, speaker, or session." },
    ],
  },
  {
    path: ["remind"],
    usage: "marquee remind <event-id> --filter <key=value> (--template <key> | --subject <s> --body <b>)",
    summary: "Queue a templated or caller-composed reminder.",
    operations: ["sendCommunication"],
    skill: "chase",
    event: true,
    options: [
      { name: "--filter <key=value>", description: "Required; repeat or pass a JSON recipient selector." },
      { name: "--template <key>", description: "Use a stored mail template." },
      { name: "--subject <text>", description: "Ad-hoc subject; pair with --body." },
      { name: "--body <text>", description: "Ad-hoc body; pair with --subject." },
    ],
  },
  {
    path: ["diagnose"],
    usage: "marquee diagnose",
    summary: "Probe every binding and report an ok or degraded verdict.",
    operations: ["getDiagnostics"],
    skill: "diagnose",
    options: [
      { name: "--bundle", description: "Print a pasteable support report instead of raw JSON." },
    ],
  },
  {
    path: ["logs"],
    usage: "marquee logs --tail",
    summary: "Follow this deployment's structured logs, filtered.",
    // No API operation: logs are read from the platform's own log stream, not
    // from an endpoint this conference serves.
    operations: [],
    skill: "diagnose",
    local: true,
    options: [
      { name: "--tail", description: "Required; follow the live log stream." },
      { name: "--request-id <id>", description: "Only lines carrying this reference or correlation id." },
      { name: "--level <level>", description: "debug, info, warn, or error, and everything above it." },
      { name: "--event <name>", description: "Only this event name, e.g. api_error or http_request." },
    ],
  },
  {
    path: ["agenda", "export"],
    usage: "marquee agenda export <event-id>",
    summary: "Export the current agenda snapshot.",
    operations: ["getAgenda"],
    skill: "agenda",
    event: true,
    options: [{ name: "--format <format>", description: "json or csv when --json is not selected." }],
  },
  {
    path: ["agenda", "place"],
    usage: "marquee agenda place <event-id> --set submission_id=<id> --set starts_at=<ms> --set room_id=<id>",
    summary: "Place a Session into a room and time slot.",
    operations: ["placeAgendaItem"],
    skill: "agenda",
    event: true,
    set: ["submission_id", "starts_at", "room_id", "duration_min", "track_id"],
    options: [SET_OPTION],
  },
  {
    path: ["agenda", "move"],
    usage: "marquee agenda move <event-id> <item-id> --set starts_at=<ms>",
    summary: "Move or re-time a placed item, guarded by its current version.",
    operations: ["getAgenda", "updateAgendaItem"],
    skill: "agenda",
    event: true,
    set: ["starts_at", "room_id", "duration_min", "track_id"],
    options: [
      SET_OPTION,
      { name: "--if-match <etag>", description: "Supply the item's strong ETag instead of reading the agenda for it." },
    ],
  },
  {
    path: ["agenda", "remove"],
    usage: "marquee agenda remove <event-id> <item-id>",
    summary: "Unplace an item, guarded by its current version.",
    operations: ["getAgenda", "removeAgendaItem"],
    skill: "agenda",
    event: true,
    options: [{ name: "--if-match <etag>", description: "Supply the item's strong ETag instead of reading the agenda for it." }],
  },
  {
    path: ["search"],
    usage: "marquee search <event-id> --query <text>",
    summary: "Find Abstracts, Sessions, Speakers, and Forms by name.",
    operations: ["searchEvent"],
    skill: "triage",
    event: true,
    options: [{ name: "--query <text>", description: "Required; the search text." }],
  },
];

const byPath = new Map(COMMAND_REGISTRY.map((command) => [command.path.join(" "), command]));

export function commandFor(path) {
  return byPath.get(path.join(" "));
}

export function commandsUnder(path) {
  return COMMAND_REGISTRY.filter(
    (command) => path.every((segment, index) => command.path[index] === segment),
  );
}

/**
 * Command listings pad to the widest entry actually being listed rather than to
 * a fixed column, so a long usage string pushes the whole block over instead of
 * knocking one row out of alignment. Past a point a usage is wider than any
 * sane column, so those wrap to their own line and the rest stay in their
 * gutter — one long command never ragged-edges the other twenty.
 */
const MAXIMUM_USAGE_COLUMN = 44;

export function registryCommandLines(path = []) {
  const prefix = path.join(" ");
  const entries = commandsUnder(path).map((command) => {
    const usage = command.usage.replace(/^marquee\s+/, "");
    return {
      usage: prefix && usage.startsWith(`${prefix} `) ? usage.slice(prefix.length + 1) : usage,
      summary: command.summary,
    };
  });
  const column = Math.min(
    MAXIMUM_USAGE_COLUMN,
    Math.max(0, ...entries.map((entry) => entry.usage.length)),
  );
  return entries.flatMap((entry) =>
    entry.usage.length > column
      ? [`  ${entry.usage}`, `  ${" ".repeat(column)} ${entry.summary}`]
      : [`  ${entry.usage.padEnd(column)} ${entry.summary}`],
  );
}

function optionLines(options) {
  return [...GLOBAL_OPTIONS, ...options].map(
    (option) => `  ${option.name.padEnd(30)} ${option.description}`,
  );
}

export function renderHelp(path = []) {
  const command = commandFor(path);
  const children = commandsUnder(path);
  if (command) {
    return [
      `Usage: ${command.usage}`,
      "",
      command.summary,
      "",
      "Options:",
      ...optionLines(command.options),
    ].join("\n");
  }

  const label = path.length === 0 ? "marquee" : `marquee ${path.join(" ")}`;
  return [
    `Usage: ${label} <command> [options]`,
    "",
    path.length === 0 ? "Commands:" : `Commands under ${label}:`,
    ...registryCommandLines(path),
    "",
    "Global options:",
    ...optionLines([]),
  ].join("\n");
}

export function registryOperations() {
  return [...new Set(COMMAND_REGISTRY.flatMap((command) => command.operations))].sort();
}
