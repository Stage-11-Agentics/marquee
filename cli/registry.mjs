/**
 * The public command registry. Help, dispatch, and the generated skill guide
 * all consume this table; adding a command in only one surface is a build
 * error in the CLI tests.
 */

export const GLOBAL_OPTIONS = [
  { name: "--url <url>", description: "Marquee instance URL (or MARQUEE_URL)." },
  { name: "--token <token>", description: "Scoped API token (or MARQUEE_TOKEN)." },
  { name: "--json", description: "Emit one parseable JSON value on stdout." },
  { name: "--help", description: "Show help for this command." },
];

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
    options: [{ name: "--event-id <id>", description: "Conference ID when it is not positional." }],
  },
  {
    path: ["submissions", "list"],
    usage: "marquee submissions list <event-id>",
    summary: "List Abstracts and Sessions with server-side filters.",
    operations: ["listEventSubmissions"],
    skill: "triage",
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
    options: [],
  },
  {
    path: ["submissions", "accept"],
    usage: "marquee submissions accept <event-id> --filter <key=value>",
    summary: "Accept every submission selected by a server-side filter.",
    operations: ["bulkDecideSubmissions"],
    skill: "triage",
    options: [{ name: "--filter <key=value>", description: "Required; repeat or pass a JSON filter object." }],
  },
  {
    path: ["submissions", "reject"],
    usage: "marquee submissions reject <event-id> --filter <key=value>",
    summary: "Reject every submission selected by a server-side filter.",
    operations: ["bulkDecideSubmissions"],
    skill: "triage",
    options: [{ name: "--filter <key=value>", description: "Required; repeat or pass a JSON filter object." }],
  },
  {
    path: ["tasks", "list"],
    usage: "marquee tasks list <event-id> --overdue",
    summary: "List speakers with outstanding tasks, optionally overdue only.",
    operations: ["getOnboardingBoard"],
    skill: "chase",
    options: [
      { name: "--overdue", description: "Restrict the chase board to overdue work." },
      { name: "--filter <name>", description: "all, overdue, incomplete, or risk." },
    ],
  },
  {
    path: ["remind"],
    usage: "marquee remind <event-id> --filter <key=value> (--template <key> | --subject <s> --body <b>)",
    summary: "Queue a templated or caller-composed reminder.",
    operations: ["sendCommunication"],
    skill: "chase",
    options: [
      { name: "--filter <key=value>", description: "Required; repeat or pass a JSON recipient selector." },
      { name: "--template <key>", description: "Use a stored mail template." },
      { name: "--subject <text>", description: "Ad-hoc subject; pair with --body." },
      { name: "--body <text>", description: "Ad-hoc body; pair with --subject." },
    ],
  },
  {
    path: ["agenda", "export"],
    usage: "marquee agenda export <event-id>",
    summary: "Export the current agenda snapshot.",
    operations: ["getAgenda"],
    skill: "agenda",
    options: [{ name: "--format <format>", description: "json or csv when --json is not selected." }],
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

export function registryCommandLines(path = []) {
  const commands = commandsUnder(path);
  return commands.map((command) => {
    const usage = command.usage.replace(/^marquee\s+/, "");
    const prefix = path.join(" ");
    const suffix = prefix && usage.startsWith(`${prefix} `) ? usage.slice(prefix.length + 1) : usage;
    return `  ${suffix.padEnd(24)} ${command.summary}`;
  });
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
