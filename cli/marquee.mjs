#!/usr/bin/env node

import { COMMAND_REGISTRY, commandsUnder, renderHelp } from "./registry.mjs";
import { MarqueeClient } from "./client.mjs";
import { renderDiagnosticBundle, tailLogs } from "./diagnostics.mjs";

const VALUE_OPTIONS = new Set([
  "--url",
  "--token",
  "--event-id",
  "--filter",
  "--page",
  "--per-page",
  "--sort",
  "--template",
  "--subject",
  "--body",
  "--format",
  "--request-id",
  "--level",
  "--event",
  "--set",
  "--query",
  "--if-match",
]);
const FLAG_OPTIONS = new Set(["--json", "--help", "--overdue", "--tail", "--bundle"]);
const LIST_FILTER_KEYS = new Set(["kind", "status", "track", "format", "wave", "task", "placement", "q"]);
const REMINDER_FILTER_KEYS = new Set([
  "status",
  "track_id",
  "format_id",
  "task_state",
  "submission_ids",
  "person_ids",
  "recipient_pairs",
  "role",
]);

function usageError(message) {
  throw new Error(message);
}

function parseArgv(argv) {
  const positionals = [];
  const options = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : token.slice(equals + 1);
    if (FLAG_OPTIONS.has(name)) {
      if (inlineValue !== undefined) usageError(`${name} does not take a value`);
      flags.add(name);
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) usageError(`unknown option: ${name}`);
    const value = inlineValue ?? argv[++index];
    if (value === undefined || (inlineValue === undefined && value.startsWith("--"))) {
      usageError(`${name} requires a value`);
    }
    const values = options.get(name) ?? [];
    values.push(value);
    options.set(name, values);
  }
  return { positionals, options, flags };
}

function option(options, name) {
  return options.get(name)?.at(-1);
}

function optionValues(options, name) {
  return options.get(name) ?? [];
}

function commandAndArguments(positionals) {
  const match = COMMAND_REGISTRY
    .filter((command) => positionals.length >= command.path.length)
    .filter((command) => command.path.every((segment, index) => positionals[index] === segment))
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (!match) return { command: undefined, arguments_: positionals };
  return { command: match, arguments_: positionals.slice(match.path.length) };
}

function parseJsonValue(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    usageError(`${label} must be valid JSON or key=value`);
  }
}

function scalarOrList(value) {
  if (value === "") return [];
  if (value.startsWith("[")) return parseJsonValue(value, "filter");
  return value.includes(",") ? value.split(",").map((item) => item.trim()).filter(Boolean) : value;
}

function parseFilters(values, allowed, label) {
  const result = {};
  for (const value of values) {
    if (value.startsWith("{")) {
      const parsed = parseJsonValue(value, label);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") usageError(`${label} JSON must be an object`);
      for (const [key, item] of Object.entries(parsed)) {
        if (!allowed.has(key)) usageError(`unsupported ${label} key: ${key}`);
        result[key] = item;
      }
      continue;
    }
    const separator = value.indexOf("=");
    if (separator < 1) usageError(`${label} must use key=value`);
    const key = value.slice(0, separator);
    if (!allowed.has(key)) usageError(`unsupported ${label} key: ${key}`);
    result[key] = scalarOrList(value.slice(separator + 1));
  }
  return result;
}

/**
 * Body fields for a `--set` command. Values parse as JSON where they can, so
 * `30` is a number and `null` is null, while an unparseable value like
 * `Workshop` stays the string it looks like. A string that would parse as
 * something else is quoted through: `--set name='"2026"'`.
 */
function parseSetValues(command, options) {
  const allowed = new Set(command.set ?? []);
  const body = {};
  for (const value of optionValues(options, "--set")) {
    const separator = value.indexOf("=");
    if (separator < 1) usageError("--set must use key=value");
    const key = value.slice(0, separator);
    if (!allowed.has(key)) {
      usageError(`unsupported --set key: ${key}\n\nlegal keys: ${[...allowed].join(", ")}`);
    }
    const raw = value.slice(separator + 1);
    try {
      body[key] = JSON.parse(raw);
    } catch {
      body[key] = raw;
    }
  }
  return body;
}

function requireSetValues(command, options) {
  const body = parseSetValues(command, options);
  if (Object.keys(body).length === 0) usageError(`${command.usage} requires --set`);
  return body;
}

function eventIdFrom(command, arguments_, options) {
  if (!command.event) return undefined;
  const positional = arguments_[0];
  const selected = positional ?? option(options, "--event-id") ?? process.env.MARQUEE_EVENT_ID;
  if (!selected) usageError(`${command.usage} requires an event ID (or MARQUEE_EVENT_ID)`);
  return selected;
}

async function resolveEventId(client, command, arguments_, options) {
  const explicit = eventIdFrom(command, arguments_, options);
  if (explicit) return explicit;
  const auth = await client.get("/api/v1/auth/me");
  const id = auth?.demo_event_id;
  if (!id) usageError("the API did not return a demo_event_id; pass an event ID explicitly");
  return id;
}

function queryFromListFilters(filters, options) {
  return {
    ...filters,
    page: option(options, "--page"),
    per_page: option(options, "--per-page"),
    sort: option(options, "--sort"),
  };
}

function reminderSelector(filters) {
  return filters;
}

function requireFilters(command, options, allowed) {
  const values = optionValues(options, "--filter");
  if (values.length === 0) usageError(`${command.usage} requires --filter`);
  return parseFilters(values, allowed, "filter");
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRows(value) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : value?.sessions ?? [];
  if (rows.length === 0) return "";
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row ?? {})))];
  return [keys.join(","), ...rows.map((row) => keys.map((key) => csvCell(row?.[key])).join(","))].join("\n");
}

/**
 * The strong ETag for one placed agenda item. `updateAgendaItem` and
 * `removeAgendaItem` are the only two If-Match routes in the product, and the
 * agenda snapshot already carries each session's tag — so the caller states an
 * item ID and the CLI supplies the precondition, rather than making a human
 * carry a version string between two commands. `--if-match` stays available for
 * a script that already holds one.
 */
async function agendaItemEtag(client, eventId, itemId, options) {
  const supplied = option(options, "--if-match");
  if (supplied) return supplied;
  const agenda = await client.get(`/api/v1/events/${encodeURIComponent(eventId)}/agenda`);
  const item = (agenda?.sessions ?? []).find((session) => session.id === itemId);
  if (!item) usageError(`no agenda item ${itemId} is placed on this conference's agenda`);
  if (!item.etag) throw new Error(`the agenda returned item ${itemId} without an ETag`);
  return item.etag;
}

async function waitForReset(client, jobId) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    last = await client.get(`/api/v1/admin/reset-demo/${encodeURIComponent(jobId)}`);
    if (last.status === "done") return last;
    if (last.status === "failed") throw new Error(last.error ?? "the event seed reset failed");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`the event seed reset did not finish within 30 seconds (last status: ${last?.status ?? "unknown"})`);
}

async function execute(command, arguments_, options, flags, client) {
  const [root, verb] = command.path;
  if (root === "event" && verb === "seed") {
    const current = await client.get("/api/v1/auth/me");
    // The demo reset is destructive to credential rows. A token that already
    // sees the seeded conference has nothing to create and should remain
    // usable for the commands that follow.
    if (current?.demo_event_id) {
      return { event_id: current.demo_event_id, reset_job: null, seeded: true };
    }
    const queued = await client.request("/api/v1/admin/reset-demo", { method: "POST" });
    const finished = await waitForReset(client, queued.job_id);
    const eventId = finished.result?.event_id ?? null;
    if (!eventId) throw new Error("the seeded event reset completed without returning an event ID");
    return { event_id: eventId, reset_job: finished, seeded: true };
  }

  if (root === "event" && verb === "show") {
    const eventId = await resolveEventId(client, command, arguments_, options);
    return client.get(`/api/v1/events/${encodeURIComponent(eventId)}`);
  }
  if (root === "event" && verb === "set") {
    const eventId = await resolveEventId(client, command, arguments_, options);
    return client.patch(`/api/v1/events/${encodeURIComponent(eventId)}`, requireSetValues(command, options));
  }

  // Diagnostics and logs are about the deployment, not about one conference,
  // so they run before any event ID is resolved.
  if (root === "diagnose") {
    const diagnostics = await client.get("/api/v1/telemetry/diagnostics");
    return flags.has("--bundle")
      ? { __text: renderDiagnosticBundle(diagnostics), __value: diagnostics }
      : diagnostics;
  }
  if (root === "logs") {
    if (!flags.has("--tail")) {
      usageError("marquee logs currently reads the live stream only; pass --tail");
    }
    await tailLogs({
      requestId: option(options, "--request-id"),
      level: option(options, "--level"),
      event: option(options, "--event"),
    });
    return { streamed: true };
  }

  const eventId = await resolveEventId(client, command, arguments_, options);
  if (root === "submissions" && verb === "list") {
    const filters = parseFilters(optionValues(options, "--filter"), LIST_FILTER_KEYS, "filter");
    return client.get(`/api/v1/events/${encodeURIComponent(eventId)}/submissions`, { query: queryFromListFilters(filters, options) });
  }
  if (root === "submissions" && verb === "show") {
    const submissionId = arguments_[1];
    if (!submissionId) usageError(`${command.usage} requires a submission ID`);
    return client.get(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}`);
  }
  if (root === "submissions" && (verb === "accept" || verb === "reject")) {
    const filters = requireFilters(command, options, LIST_FILTER_KEYS);
    return client.post(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/bulk`, {
      selector: { filter: filters },
      action: verb,
    });
  }
  if (root === "tasks" && verb === "list") {
    const filter = option(options, "--filter") ?? (options.has("--overdue") ? "overdue" : "all");
    if (!["all", "overdue", "incomplete", "risk"].includes(filter)) usageError("--filter must be all, overdue, incomplete, or risk");
    return client.get(`/api/v1/events/${encodeURIComponent(eventId)}/onboarding`, { query: { filter } });
  }
  if (root === "remind") {
    const selector = reminderSelector(requireFilters(command, options, REMINDER_FILTER_KEYS));
    const template = option(options, "--template");
    const subject = option(options, "--subject");
    const body = option(options, "--body");
    if (template && (subject !== undefined || body !== undefined)) usageError("--template is exclusive with --subject and --body");
    if (!template && (subject === undefined || body === undefined)) usageError("remind requires --template or both --subject and --body");
    return client.post(`/api/v1/events/${encodeURIComponent(eventId)}/comms/send`, {
      selector,
      ...(template ? { template_key: template } : { subject, body }),
    });
  }
  if (root === "submissions" && (verb === "schedule" || verb === "publish")) {
    const submissionId = arguments_[1];
    if (!submissionId) usageError(`${command.usage} requires a submission ID`);
    const base = `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}`;
    return verb === "schedule"
      ? client.post(`${base}/schedule`, requireSetValues(command, options))
      : client.post(`${base}/publish`);
  }
  if (root === "tracks" || root === "formats") {
    const collection = `/api/v1/events/${encodeURIComponent(eventId)}/${root}`;
    if (verb === "list") return client.get(collection);
    if (verb === "add") return client.post(collection, requireSetValues(command, options));
    const id = arguments_[1];
    if (!id) usageError(`${command.usage} requires a ${root.slice(0, -1)} ID`);
    return client.remove(`${collection}/${encodeURIComponent(id)}`);
  }
  if (root === "search") {
    const query = option(options, "--query");
    if (!query) usageError(`${command.usage} requires --query`);
    return client.get(`/api/v1/events/${encodeURIComponent(eventId)}/search`, { query: { q: query } });
  }
  if (root === "agenda" && verb === "export") {
    const agenda = await client.get(`/api/v1/events/${encodeURIComponent(eventId)}/agenda`);
    return option(options, "--format") === "csv" ? { __csv: csvRows(agenda), __value: agenda } : agenda;
  }
  if (root === "agenda" && verb === "place") {
    return client.post(`/api/v1/events/${encodeURIComponent(eventId)}/agenda/items`, requireSetValues(command, options));
  }
  if (root === "agenda" && (verb === "move" || verb === "remove")) {
    const itemId = arguments_[1];
    if (!itemId) usageError(`${command.usage} requires an agenda item ID`);
    const path = `/api/v1/events/${encodeURIComponent(eventId)}/agenda/items/${encodeURIComponent(itemId)}`;
    // The body is parsed before the ETag is read so a bad --set key fails
    // without spending a request on the agenda.
    const body = verb === "move" ? requireSetValues(command, options) : undefined;
    const headers = { "if-match": await agendaItemEtag(client, eventId, itemId, options) };
    if (verb === "move") return client.patch(path, body, { headers });
    // The API answers a removal with 204 and no body, which is right for HTTP
    // and useless on stdout: a bare `null` cannot be told from a command that
    // did nothing. The CLI states what it did instead of echoing the silence.
    await client.remove(path, { headers });
    return { removed: itemId, event_id: eventId };
  }
  usageError(`unsupported command: ${command.path.join(" ")}`);
}

function output(value, json) {
  if (value && value.__csv !== undefined && !json) {
    process.stdout.write(`${value.__csv}\n`);
    return;
  }
  // A bundle is meant to be pasted into an issue, so plain mode prints the
  // pasteable text and --json still yields the machine-readable value.
  if (value && value.__text !== undefined && !json) {
    process.stdout.write(`${value.__text}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value && value.__value !== undefined ? value.__value : value, null, json ? 0 : 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgv(argv);
  const { command, arguments_ } = commandAndArguments(parsed.positionals);
  const helpPath = command ? command.path : parsed.positionals;
  if (parsed.flags.has("--help") || !command) {
    if (!command && parsed.positionals.length > 0 && commandsUnder(parsed.positionals).length === 0) {
      usageError(`unknown command: ${parsed.positionals.join(" ")}\n\n${renderHelp([])}`);
    }
    process.stdout.write(`${renderHelp(helpPath)}\n`);
    return;
  }
  // A local command reads the platform's own log stream and never calls the
  // API, so it must not demand a URL and a token it will not use.
  const client = command.local
    ? undefined
    : new MarqueeClient({ url: option(parsed.options, "--url"), token: option(parsed.options, "--token") });
  const result = await execute(command, arguments_, parsed.options, parsed.flags, client);
  output(result, parsed.flags.has("--json"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // `marquee submissions list … | head` closes stdout early. Node's default is
  // to raise EPIPE as an unhandled error event and print a stack trace, which
  // is the wrong answer for a command built to be piped: the reader got what it
  // asked for, so the writer exits quietly.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error) => {
      if (error.code === "EPIPE") process.exit(0);
      throw error;
    });
  }
  main().catch((error) => {
    process.stderr.write(`marquee: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
