import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { emit, parseArguments, REPOSITORY_ROOT, writeReport } from "./lib/command.mjs";

const execFileAsync = promisify(execFile);
const WRANGLER = resolve(REPOSITORY_ROOT, "node_modules/wrangler/bin/wrangler.js");
const INBOX_CONFIG = resolve(REPOSITORY_ROOT, "tooling/inbox-worker/wrangler.jsonc");
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DEFAULT_INBOX_DOMAIN = "inbox.marquee.stage11.dev";
const DEFAULT_FORM_SLUG = "cfp";
const DEFAULT_INBOX_DATABASE = "DB";
const POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export class SmokeNeedsHuman extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SmokeNeedsHuman";
    this.needsHuman = true;
    this.details = details;
  }
}

export class SmokeTimeout extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SmokeTimeout";
    this.timeout = true;
    this.details = details;
  }
}

export function smokeAssert(condition, message) {
  if (!condition) throw new Error(message);
}

function encodeUlidTime(milliseconds) {
  let value = BigInt(Math.max(0, Math.min(milliseconds, 0xffffffffffff)));
  let encoded = "";
  for (let index = 0; index < 10; index += 1) {
    encoded = ULID_ALPHABET[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return encoded;
}

function encodeUlidRandom(bytes) {
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let encoded = "";
  for (let index = 0; index < 16; index += 1) {
    encoded = ULID_ALPHABET[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return encoded;
}

/** A valid 26-character Crockford ULID, not a UUID substring or timestamp. */
export function ulid(now = Date.now()) {
  return `${encodeUlidTime(now)}${encodeUlidRandom(randomBytes(10))}`;
}

function requestedRecipients(args, environment = process.env) {
  const requested = args.to ?? environment.MARQUEE_SMOKE_TO;
  if (requested === undefined || requested === null || requested === "") return [];
  const values = Array.isArray(requested) ? requested : String(requested).split(",");
  return values.map((value) => String(value).trim()).filter(Boolean).map((value) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new SmokeNeedsHuman(`Smoke recipient is not a complete email address: ${value || "<empty>"}`);
    }
    return value;
  });
}

function requestedDomain(args, environment = process.env) {
  const configured = args.domain ?? environment.MARQUEE_INBOX_DOMAIN ?? DEFAULT_INBOX_DOMAIN;
  const normalized = String(configured).trim().toLowerCase().replace(/^@/, "");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized)) {
    throw new SmokeNeedsHuman(`Inbox catch-all domain is invalid: ${normalized || "<empty>"}`);
  }
  return normalized;
}

export function freshSmokeAddress(args = {}, environment = process.env) {
  const runId = ulid();
  const domain = requestedDomain(args, environment);
  const requestedTo = requestedRecipients(args, environment);
  const generatedAddress = requestedTo.length > 0 ? null : `smoke-${runId.toLowerCase()}@${domain}`;
  const addresses = requestedTo.length > 0 ? requestedTo : [generatedAddress];
  return {
    runId,
    domain,
    address: addresses[0],
    addresses,
    generatedAddress,
    generated: requestedTo.length === 0,
    // --to is an exact recipient contract. It never selects a domain and its
    // localpart is never rewritten. Operators must supply a new address for
    // every run when using it; omitted --to is the safer fresh-catch-all path.
    requestedTo: requestedTo.length > 0 ? requestedTo : null,
  };
}

function originFrom(args, environment = process.env) {
  const origin = String(args.origin ?? environment.MARQUEE_SMOKE_ORIGIN ?? "https://marquee.stage11.dev").replace(/\/$/, "");
  try {
    const parsed = new URL(origin);
    smokeAssert(/^https?:$/.test(parsed.protocol), "smoke origin must use http or https");
    return parsed.origin;
  } catch {
    throw new SmokeNeedsHuman(`Smoke origin is not a URL: ${origin}`);
  }
}

function formSlugFrom(args, environment = process.env) {
  return String(args.form ?? environment.MARQUEE_SMOKE_FORM ?? DEFAULT_FORM_SLUG).trim();
}

function authHeaders(args, environment = process.env) {
  const headers = {};
  const token = args.token ?? environment.MARQUEE_SMOKE_TOKEN;
  const cookie = args.cookie ?? environment.MARQUEE_SMOKE_COOKIE;
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  return headers;
}

export function smokeContext(args = {}, environment = process.env) {
  return {
    origin: originFrom(args, environment),
    formSlug: formSlugFrom(args, environment),
    inbox: freshSmokeAddress(args, environment),
    auth: authHeaders(args, environment),
    timeoutMs: Number(args.timeout ?? environment.MARQUEE_SMOKE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    inboxDatabase: String(args.database ?? environment.MARQUEE_INBOX_DATABASE ?? DEFAULT_INBOX_DATABASE),
    inboxConfig: String(args["inbox-config"] ?? environment.MARQUEE_INBOX_WRANGLER_CONFIG ?? INBOX_CONFIG),
    inboxPersistTo: String(args["inbox-persist-to"] ?? environment.MARQUEE_INBOX_PERSIST_TO ?? "").trim() || null,
    inboxLocal: args.local === true || environment.MARQUEE_INBOX_LOCAL === "1",
  };
}

export function smokeContexts(args = {}, environment = process.env) {
  const recipients = requestedRecipients(args, environment);
  if (recipients.length === 0) return [smokeContext(args, environment)];
  return recipients.map((recipient) => smokeContext({ ...args, to: [recipient] }, environment));
}

export function isCatchAllRecipient(context) {
  const at = context.inbox.address.lastIndexOf("@");
  return at > 0 && context.inbox.address.slice(at + 1).toLowerCase() === context.inbox.domain;
}

function errorBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2_000);
  }
}

export async function requestJson(base, path, options = {}) {
  const response = await fetch(new URL(path, `${base}/`).toString(), {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = errorBody(text);
  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    if (response.status === 403 && /turnstile|security check|captcha/i.test(detail)) {
      throw new SmokeNeedsHuman(`Public form security check needs operator-provided Turnstile access: ${detail}`);
    }
    throw new Error(`${options.method ?? "GET"} ${path} returned ${response.status}: ${detail}`);
  }
  return body;
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseWranglerJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    // Wrangler can prefix JSON with a warning. Use the last complete JSON
    // document rather than asking the caller to scrape CLI output.
    for (let index = trimmed.length - 1; index >= 0; index -= 1) {
      if (trimmed[index] !== "{" && trimmed[index] !== "[") continue;
      try {
        return JSON.parse(trimmed.slice(index));
      } catch {
        // Keep looking for the start of the JSON document.
      }
    }
  }
  throw new Error(`Wrangler did not return JSON: ${trimmed.slice(0, 1_000)}`);
}

function rowsFromD1(payload) {
  const batches = Array.isArray(payload) ? payload : [payload];
  return batches.flatMap((batch) => Array.isArray(batch?.results) ? batch.results : []);
}

export async function queryInbox(context, toEmail, since) {
  const query = `SELECT id, received_at, from_email, to_email, subject, raw_rfc822
FROM inbox_messages
WHERE to_email = ${sqlQuote(toEmail)} AND received_at >= ${sqlQuote(since)}
ORDER BY received_at ASC, id ASC`;
  const args = [
    WRANGLER,
    "d1",
    "execute",
    context.inboxDatabase,
    "--json",
    "--config",
    context.inboxConfig,
    ...(context.inboxPersistTo ? ["--persist-to", context.inboxPersistTo] : []),
    "--command",
    query,
    context.inboxLocal ? "--local" : "--remote",
  ];
  try {
    const result = await execFileAsync(process.execPath, args, {
      cwd: REPOSITORY_ROOT,
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    });
    return rowsFromD1(parseWranglerJson(result.stdout));
  } catch (error) {
    const detail = error?.stderr?.trim() || error?.message || "unknown Wrangler error";
    throw new SmokeNeedsHuman(`Inbox D1 could not be queried. Check Wrangler auth, database, migration, and config: ${detail.slice(0, 1_500)}`);
  }
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

export async function waitForInboxMessage(context, toEmail, since, predicate, label) {
  const deadline = Date.now() + context.timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      const rows = await queryInbox(context, toEmail, since);
      const match = rows.find(predicate);
      if (match) return match;
    } catch (error) {
      lastError = error;
      if (error instanceof SmokeNeedsHuman) throw error;
    }
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(50, deadline - Date.now())));
  }
  throw new SmokeTimeout(
    `${label} did not arrive at ${toEmail} within ${context.timeoutMs}ms${lastError ? `; last query error: ${lastError.message}` : ""}`,
    { label, to_email: toEmail, last_query_error: lastError?.message ?? null },
  );
}

function configOptions(field) {
  return Array.isArray(field.config?.options) ? field.config.options : [];
}

function conditionMatches(condition, answers) {
  if (!condition || !Array.isArray(condition.all)) return true;
  return condition.all.every((clause) => {
    const actual = answers[clause.fieldKey];
    switch (clause.op) {
      case "equals":
      case "eq":
      case "is":
        return Array.isArray(actual) ? actual.some((value) => String(value) === String(clause.value)) : String(actual) === String(clause.value);
      case "not_equals":
      case "neq":
      case "is_not":
        return String(actual) !== String(clause.value);
      case "answered":
        return actual !== undefined && actual !== null && actual !== "" && (!Array.isArray(actual) || actual.length > 0);
      case "not_answered":
        return actual === undefined || actual === null || actual === "" || (Array.isArray(actual) && actual.length === 0);
      default:
        return true;
    }
  });
}

function answerForField(field, runId, email) {
  const key = field.key.toLowerCase();
  const options = configOptions(field);
  switch (field.type) {
    case "short_text":
      if (key.includes("title")) return `MRQ-238 smoke ${runId}`;
      if (key.includes("name")) return "Marquee Smoke Speaker";
      if (key.includes("role")) return "Smoke tester";
      if (key.includes("company")) return "Marquee";
      if (key.includes("product")) return "Marquee inbox oracle";
      return `Smoke answer ${runId}`;
    case "long_text":
      if (key.includes("abstract")) return `This is a real public-form smoke submission for ${runId}; it proves the confirmation link and live mail path without using a fixture shortcut.`;
      if (key.includes("outcome")) return "Attendees will be able to verify a live conference workflow end to end.";
      if (key.includes("bio")) return "Marquee Smoke Speaker tests the live conference submission workflow and delivery oracle.";
      return `This is a sufficiently long smoke answer for ${runId}, written to exercise the public form contract.`;
    case "email":
      return email;
    case "url":
      return "https://example.com/marquee-smoke";
    case "number":
      return Number(field.config?.min ?? 1);
    case "date":
      return "2026-09-09";
    case "single_select":
      if (key === "vendor_content") return options.includes("No") ? "No" : options[0];
      return options[0] ?? (key === "format" ? "Stage Talk" : "Option 1");
    case "multi_select":
      return options.length > 0 ? [options[0]] : [key === "tracks" ? "Infrastructure" : "Option 1"];
    case "file":
      return undefined;
    default:
      return `Smoke answer ${runId}`;
  }
}

export function buildSmokeAnswers(fields, runId, email) {
  const answers = {};
  for (const field of fields) {
    if (!conditionMatches(field.condition, answers)) continue;
    const answer = answerForField(field, runId, email);
    if (answer !== undefined) answers[field.key] = answer;
  }
  return answers;
}

function acceptedFileType(field) {
  const accepted = Array.isArray(field.config?.accept) ? field.config.accept : [];
  if (accepted.includes("image/png")) return { contentType: "image/png", filename: "marquee-smoke.png" };
  if (accepted.includes("image/jpeg")) return { contentType: "image/jpeg", filename: "marquee-smoke.jpg" };
  throw new Error(`Required file field ${field.key} does not accept the smoke image type`);
}

async function uploadRequiredFiles(context, fields, answers, resumeToken, draftId) {
  for (const field of fields) {
    if (field.type !== "file" || !field.required || !conditionMatches(field.condition, answers)) continue;
    const file = acceptedFileType(field);
    const response = await requestJson(context.origin, "/api/v1/public/uploads/sign", {
      method: "POST",
      headers: context.auth,
      body: JSON.stringify({
        draftId,
        resumeToken,
        fieldKey: field.key,
        filename: file.filename,
        contentType: file.contentType,
        sizeBytes: ONE_PIXEL_PNG.byteLength,
      }),
    });
    smokeAssert(response?.attachmentId && response?.putUrl && response?.completionToken, `Upload presign for ${field.key} was incomplete`);
    const putHeaders = new Headers(response.requiredHeaders ?? {});
    const put = await fetch(new URL(response.putUrl, `${context.origin}/`).toString(), { method: "PUT", headers: putHeaders, body: ONE_PIXEL_PNG });
    if (!put.ok) throw new Error(`PUT ${field.key} upload returned ${put.status}: ${(await put.text()).slice(0, 500)}`);
    await requestJson(context.origin, `/api/v1/public/uploads/${encodeURIComponent(response.attachmentId)}/complete`, {
      method: "POST",
      headers: context.auth,
      body: JSON.stringify({ completionToken: response.completionToken }),
    });
    answers[field.key] = response.attachmentId;
  }
}

export async function submitPublicSmoke(context) {
  const { address, runId } = context.inbox;
  const form = await requestJson(context.origin, `/api/v1/public/forms/${encodeURIComponent(context.formSlug)}`);
  smokeAssert(form?.state === "open" || form?.state === "resumed", `Public form ${context.formSlug} is not open: ${form?.state ?? "unknown"}`);
  const answers = buildSmokeAnswers(form.fields ?? [], runId, address);
  const draft = await requestJson(context.origin, `/api/v1/public/forms/${encodeURIComponent(context.formSlug)}/drafts`, {
    method: "POST",
    headers: context.auth,
    body: JSON.stringify({ answers, email: address }),
  });
  const resumeToken = draft?.resume_token;
  const draftId = draft?.draft_id;
  smokeAssert(typeof resumeToken === "string" && typeof draftId === "string", "Public form draft did not return its resume capability");
  await uploadRequiredFiles(context, form.fields ?? [], answers, resumeToken, draftId);
  const submitted = await requestJson(context.origin, `/api/v1/public/forms/${encodeURIComponent(context.formSlug)}/submissions`, {
    method: "POST",
    headers: context.auth,
    body: JSON.stringify({ answers, email: address, resumeToken }),
  });
  smokeAssert(submitted?.state === "submitted", `Public form did not reach submitted state: ${submitted?.state ?? "unknown"}`);
  return {
    form,
    draft,
    submitted,
    answers,
    submissionId: draftId,
    resumeToken,
    resumeUrl: submitted?.confirmation?.resume_url ?? submitted?.resume_url ?? null,
  };
}

function unfoldedLines(text) {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) unfolded[unfolded.length - 1] += line.slice(1);
    else unfolded.push(line);
  }
  return unfolded;
}

function headerValue(raw, name) {
  const prefix = `${name.toLowerCase()}:`;
  const lines = unfoldedLines(raw);
  const line = lines.find((candidate) => candidate.toLowerCase().startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : null;
}

function decodeHeaderValue(value) {
  if (!value) return null;
  return value.replace(/=\?([^?]+)\?[bB]\?([^?]+)\?=/g, (_match, charset, encoded) => {
    try {
      return Buffer.from(encoded, "base64").toString(charset.toLowerCase() === "utf-8" ? "utf8" : "latin1");
    } catch {
      return encoded;
    }
  }).replace(/=\?([^?]+)\?[qQ]\?([^?]+)\?=/g, (_match, _charset, encoded) => encoded.replaceAll("_", " ").replace(/=([0-9a-f]{2})/gi, (_hex, pair) => String.fromCharCode(Number.parseInt(pair, 16))));
}

export function fromName(raw) {
  const value = decodeHeaderValue(headerValue(raw, "From"));
  if (!value) return null;
  const match = value.match(/^(.+?)\s*<\s*[^<>\s]+@[^<>\s]+\s*>$/);
  if (!match) return null;
  const displayName = match[1].trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  return displayName || null;
}

function decodeCalendarTransfer(raw) {
  const decodedCandidates = [];
  const transferPattern = /Content-Transfer-Encoding:\s*base64\s*\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/gi;
  for (const match of raw.matchAll(transferPattern)) {
    try {
      decodedCandidates.push(Buffer.from(match[1].replace(/\s+/g, ""), "base64").toString("utf8"));
    } catch {
      // Ignore unrelated malformed MIME parts and keep looking for an ICS.
    }
  }
  const quotedPattern = /Content-Transfer-Encoding:\s*quoted-printable\s*\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/gi;
  for (const match of raw.matchAll(quotedPattern)) {
    const value = match[1].replace(/=\r?\n/g, "");
    const bytes = [];
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      const pair = value.slice(index + 1, index + 3);
      if (character === "=" && /^[0-9a-f]{2}$/i.test(pair)) {
        bytes.push(Number.parseInt(pair, 16));
        index += 2;
        continue;
      }
      bytes.push(...new TextEncoder().encode(character));
    }
    decodedCandidates.push(new TextDecoder().decode(Uint8Array.from(bytes)));
  }
  // A multipart envelope can contain the encoded body's literal text, so the
  // raw RFC-822 document must be the fallback, never candidate zero. Otherwise
  // a QP soft break and =3D parameter are parsed before their decoding path.
  return [...decodedCandidates, raw].find((candidate) => /BEGIN:VCALENDAR/i.test(candidate)) ?? null;
}

export function extractIcs(raw) {
  const decoded = decodeCalendarTransfer(raw);
  if (!decoded) return null;
  const start = decoded.search(/BEGIN:VCALENDAR/i);
  const end = decoded.search(/END:VCALENDAR/i);
  return end >= start ? decoded.slice(start, end + "END:VCALENDAR".length) : decoded;
}

export function parseIcs(raw) {
  const ics = extractIcs(raw);
  if (!ics) throw new Error("Inbound message did not contain a VCALENDAR payload");
  const lines = unfoldedLines(ics);
  const eventStart = lines.findIndex((candidate) => /^BEGIN:VEVENT$/i.test(candidate));
  const eventEnd = lines.findIndex((candidate, index) => index > eventStart && /^END:VEVENT$/i.test(candidate));
  const eventLines = eventStart >= 0 && eventEnd > eventStart ? lines.slice(eventStart + 1, eventEnd) : lines;
  const property = (name) => {
    const source = name === "METHOD" ? lines : eventLines;
    const line = source.find((candidate) => new RegExp(`^${name}(?:;[^:]*)?:`, "i").test(candidate));
    return line?.slice(line.indexOf(":") + 1).trim() ?? null;
  };
  const propertyLine = (name) => eventLines.find((candidate) => new RegExp(`^${name}(?:;[^:]*)?:`, "i").test(candidate)) ?? null;
  const uid = property("UID");
  const sequence = Number(property("SEQUENCE"));
  const method = property("METHOD");
  const location = property("LOCATION");
  const dtstart = propertyLine("DTSTART");
  smokeAssert(uid, "ICS UID is missing");
  smokeAssert(Number.isInteger(sequence) && sequence >= 0, "ICS SEQUENCE is missing or invalid");
  smokeAssert(method === "REQUEST" || method === "CANCEL", `ICS METHOD is invalid: ${method ?? "missing"}`);
  smokeAssert(location, "ICS LOCATION is missing");
  smokeAssert(dtstart && /(?:^|;)TZID=[^:;]+:/i.test(dtstart), "ICS DTSTART is missing TZID");
  return { uid, sequence, method, location, dtstart, raw: ics };
}

export function inboxRowHasLink(row, url) {
  if (!url) return false;
  const parsed = new URL(url);
  return row.raw_rfc822.includes(url) || row.raw_rfc822.includes(`${parsed.pathname}${parsed.search}`);
}

export function inboxRowHasIcs(row, predicate) {
  try {
    return predicate(parseIcs(row.raw_rfc822));
  } catch {
    return false;
  }
}

export function commandArguments(argv = process.argv.slice(2)) {
  const parsed = parseArguments(argv);
  const recipients = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const [rawKey, inlineValue] = argument.slice(2).split("=", 2);
    if (rawKey !== "to") continue;
    const value = inlineValue ?? (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--") ? argv[++index] : null);
    if (value !== null) recipients.push(value);
  }
  if (recipients.length > 0) parsed.to = recipients;
  return parsed;
}

export function smokeHarnessHeaders(context) {
  return { ...context.auth, "x-marquee-smoke-harness": "1" };
}

export async function runSmoke(command, args, run) {
  const startedAt = Date.now();
  let result;
  let status = "pass";
  let error = null;
  let details = null;
  try {
    result = await run();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    status = caught?.needsHuman ? "needs-human" : caught?.timeout ? "timeout" : "fail";
    details = caught?.details ?? null;
    result = {};
  }
  const reportResult = {
    command,
    status,
    gate: process.env.MARQUEE_GATE === "1",
    elapsedMs: Date.now() - startedAt,
    ...(result ?? {}),
    ...(details ? { details } : {}),
    ...(error ? { error } : {}),
  };
  const report = await writeReport(`artifacts/checks/${command.replaceAll(":", "-")}.json`, reportResult);
  emit({ ...reportResult, report });
  if (status !== "pass") process.exitCode = status === "needs-human" ? 2 : 1;
  return reportResult;
}
