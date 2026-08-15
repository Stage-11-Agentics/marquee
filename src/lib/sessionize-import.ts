import type { ImportRowRow, MembershipRow } from "../db/schema";

import { speakerMembershipStatement } from "./speaker-membership";

export type SessionizeEntity = "sessions" | "speakers";

export interface SessionizeMapping {
  sessions: Record<string, string | null>;
  speakers: Record<string, string | null>;
}

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export interface SessionizePreview {
  headers: string[];
  mapped: Record<string, string | null>;
  rows: Array<Record<string, string>>;
  missing: string[];
}

export interface SessionizeManifest {
  sessions_csv?: string;
  speakers_csv: string;
}

export interface ImportRunCounts {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  sessions: number;
  speakers: number;
  evaluations: number;
}

interface EventRow {
  id: string;
  org_id: string;
}

interface PersonRow {
  id: string;
  org_id: string;
  email: string;
  name: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshot_attachment_id: string | null;
  social_links: string;
  is_demo: number;
  last_write_source: string;
  created_at: number;
  updated_at: number;
}

interface AttachmentRow {
  id: string;
  event_id: string;
  owner_type: string;
  owner_id: string;
  r2_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: string;
  sha256: string | null;
  r2_etag: string | null;
  created_at: number;
  updated_at: number;
}

interface SubmissionRow {
  id: string;
  event_id: string;
  form_id: string | null;
  kind: string;
  bypass_evaluation: number;
  title: string;
  abstract: string | null;
  status: string;
  format_id: string | null;
  primary_track_id: string | null;
  origin: string;
  vendor_affiliation: string;
  wave_id: string | null;
  submitter_person_id: string;
  decided_at: number | null;
  decided_by_person_id: string | null;
  submitted_at: number | null;
  last_saved_at: number | null;
  resume_token_hash: string | null;
  is_published: number;
  external_ref: string | null;
  search_blob: string;
  applied_rule_id: string | null;
  last_write_source: string;
  created_at: number;
  updated_at: number;
}

interface SubmissionTrackRow {
  id: string;
  submission_id: string;
  track_id: string;
  is_primary: number;
  created_at: number;
  updated_at: number;
}

interface ParticipationRow {
  id: string;
  submission_id: string;
  person_id: string;
  role: string;
  position: number;
  confirmation_status: string;
  confirmed_at: number | null;
  invited_at: number | null;
  created_at: number;
  updated_at: number;
}

interface AnswerRow {
  id: string;
  submission_id: string;
  field_id: string;
  value_text: string | null;
  value_json: string | null;
  created_at: number;
  updated_at: number;
}

interface EvaluationRow {
  id: string;
  round_id: string;
  submission_id: string;
  reviewer_person_id: string;
  recommendation: string | null;
  score: number | null;
  criteria_scores: string | null;
  comment: string;
  abstained: number;
  created_at: number;
  updated_at: number;
}

interface FormRow {
  id: string;
  event_id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  opens_at: number | null;
  closes_at: number | null;
  welcome_md: string;
  per_submitter_limit: number;
  min_speakers: number;
  max_speakers: number;
  max_sponsors: number;
  password_hash: string | null;
  reminder_offset_hours: number | null;
  thankyou_template_key: string | null;
  admin_notify_person_ids: string;
  turnstile_required: number;
  created_at: number;
  updated_at: number;
}

type SpeakerField = "email" | "name" | "title" | "company" | "bio";

interface SpeakerFieldChange {
  before: string | null;
  after: string | null;
}

interface ImportSnapshot {
  kind: "speaker" | "session";
  person: PersonRow | null;
  attachment: AttachmentRow | null;
  // Speaker imports use this to make undo conditional: only a value that is
  // still exactly what this import wrote is eligible for restoration. That
  // keeps a later organizer edit safe, while the empty object records that a
  // new-format snapshot intentionally made no profile-field changes.
  speaker_changes?: Partial<Record<SpeakerField, SpeakerFieldChange>>;
  speaker_attachment_changed?: boolean;
  speaker_attachment_after_id?: string | null;
  membership_created?: boolean;
  membership_id?: string | null;
  submission: SubmissionRow | null;
  tracks?: SubmissionTrackRow[];
  participations: ParticipationRow[];
  answers: AnswerRow[];
  evaluations: EvaluationRow[];
}

interface ImportRowInput {
  importId: string;
  rowIndex: number;
  entity: string;
  outcome: "created" | "updated" | "skipped" | "failed";
  reason: string | null;
  targetId: string | null;
  before: ImportSnapshot | null;
}

const SESSION_FIELDS = [
  "external_ref",
  "title",
  "abstract",
  "status",
  "kind",
  "track",
  "format",
  "speaker_emails",
  "reviewer_email",
  "score",
  "reviewer_comment",
  "custom_fields",
] as const;

const SPEAKER_FIELDS = [
  "external_ref",
  "name",
  "first_name",
  "last_name",
  "email",
  "title",
  "company",
  "bio",
  "headshot_url",
  "custom_fields",
] as const;

const FIELD_ALIASES: Record<SessionizeEntity, Record<string, string[]>> = {
  sessions: {
    external_ref: ["external ref", "external id", "session id", "sessionid", "id", "code", "key"],
    title: ["title", "session title", "name"],
    abstract: ["abstract", "description", "session description", "summary", "abstract/description"],
    status: ["status", "session status", "state", "decision", "result"],
    kind: ["kind", "type", "session type"],
    track: ["track", "tracks", "track name"],
    format: ["format", "session format", "format name"],
    speaker_emails: ["speaker emails", "speakers emails", "speaker email", "speakers", "speaker"],
    reviewer_email: ["reviewer email", "reviewer", "evaluator email", "evaluator", "reviewer e-mail"],
    score: ["score", "evaluation score", "rating", "average score", "evaluation"],
    reviewer_comment: ["reviewer comment", "evaluation comment", "comment", "feedback", "review notes"],
    custom_fields: ["custom fields", "custom_fields", "fields", "answers", "additional fields"],
  },
  speakers: {
    external_ref: ["external ref", "external id", "speaker id", "speakerid", "id", "code", "key"],
    name: ["name", "speaker name", "full name"],
    first_name: ["first name", "firstname", "given name", "forename"],
    last_name: ["last name", "lastname", "family name", "surname"],
    email: ["email", "e-mail", "email address", "speaker email"],
    title: ["title", "job title", "role", "position"],
    company: ["company", "company name", "organization", "organisation", "affiliation"],
    bio: ["bio", "biography", "description", "about"],
    headshot_url: ["headshot url", "headshot", "photo url", "photo", "picture", "image url", "avatar"],
    custom_fields: ["custom fields", "custom_fields", "fields", "answers", "additional fields"],
  },
};

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[._-]+/g, " ")
    .replaceAll(/\s+/g, " ");
}

function hashPart(value: string): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function stableImportId(prefix: string, ...parts: string[]): string {
  return `${prefix}_import_${hashPart(parts.join("\u001f"))}`;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function csvRow(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

/** Parse RFC-4180-style CSV, including quoted commas, newlines and quotes. */
export function parseCsv(text: string): CsvTable {
  // A document with nothing in it has no header row. Without this, the empty
  // string parsed to a single nameless column, which read downstream as "this
  // export has one header I cannot recognise" rather than "there is no export
  // here" — and the sessions half of a speakers-only import is exactly that
  // empty string. See the mapping step's required-field check.
  if (text.trim() === "") return { headers: [], rows: [] };
  const rows: string[][] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        current += '""';
        index += 1;
      } else {
        quoted = !quoted;
        current += character;
      }
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      if (current.length > 0 || rows.length > 0) rows.push(csvRow(current));
      current = "";
    } else {
      current += character;
    }
  }
  if (current.length > 0 || rows.length === 0) rows.push(csvRow(current));
  const headers = (rows.shift() ?? []).map((header) => header.replace(/^\uFEFF/, "").trim());
  return { headers, rows: rows.filter((row) => row.some((value) => value.trim() !== "")) };
}

function fieldNames(entity: SessionizeEntity): readonly string[] {
  return entity === "sessions" ? SESSION_FIELDS : SPEAKER_FIELDS;
}

export function defaultMapping(entity: SessionizeEntity, headers: readonly string[]): Record<string, string | null> {
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  return Object.fromEntries(fieldNames(entity).map((field) => {
    const aliases = FIELD_ALIASES[entity][field] ?? [field.replaceAll("_", " ")];
    const match = aliases.map(normalizeHeader).map((alias) => normalized.get(alias)).find(Boolean) ?? null;
    return [field, match];
  }));
}

export function previewCsv(entity: SessionizeEntity, text: string, mapping?: Record<string, string | null>): SessionizePreview {
  const table = parseCsv(text);
  const mapped = mapping ?? defaultMapping(entity, table.headers);
  const missing = fieldNames(entity).filter((field) => !mapped[field]);
  const rows = table.rows.slice(0, 5).map((row) => Object.fromEntries(
    fieldNames(entity).map((field) => {
      const header = mapped[field];
      const column = header === null || header === undefined ? -1 : table.headers.indexOf(header);
      return [field, column < 0 ? "" : row[column] ?? ""];
    }),
  ));
  return { headers: table.headers, mapped, rows, missing };
}

function mappedRows(entity: SessionizeEntity, text: string, mapping: Record<string, string | null>): Array<Record<string, string>> {
  const table = parseCsv(text);
  return table.rows.map((row) => Object.fromEntries(fieldNames(entity).map((field) => {
    const header = mapping[field];
    const column = header === null || header === undefined ? -1 : table.headers.indexOf(header);
    return [field, column < 0 ? "" : (row[column] ?? "").trim()];
  })));
}

function splitValues(value: string): string[] {
  return value
    .split(/[;,|\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonObject(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Sessionize exports sometimes use `key=value; key2=value2` for extras.
  }
  return Object.fromEntries(value.split(/[;|]/).map((part) => {
    const separator = part.indexOf("=");
    return separator < 1 ? [part.trim(), ""] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }).filter(([key]) => key));
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function canonicalStatus(raw: string): { status: string | null; note: string | null } {
  const normalized = raw.trim().toLowerCase().replaceAll(/[ -]+/g, "_");
  const direct = new Set(["draft", "submitted", "in_review", "accepted", "waitlisted", "rejected", "withdrawn"]);
  if (direct.has(normalized)) return { status: normalized, note: null };
  if (["undecided", "pending", "new", "maybe", "under_review", "review", "inprogress"].includes(normalized)) {
    return { status: "in_review", note: `source status '${raw}' mapped to in_review` };
  }
  if (!normalized) return { status: "in_review", note: "source status was empty; mapped to in_review" };
  return { status: "in_review", note: `source status '${raw}' is not in Marquee's vocabulary; mapped to in_review` };
}

function customFieldKey(value: string): string {
  const normalized = value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_|_$/g, "");
  return `sessionize_${normalized || "field"}`;
}

function contentTypeForUrl(url: string): string {
  const path = url.toLowerCase().split("?")[0] ?? "";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function nowAfter(current: number | null | undefined): number {
  return Math.max(Date.now(), (current ?? 0) + 1);
}

function rowJson(value: unknown): string {
  return JSON.stringify(value);
}

function upgradeLegacySpeakerSnapshot(snapshot: ImportSnapshot, current: PersonRow | null, importRowCreatedAt: number): ImportSnapshot {
  if (snapshot.kind !== "speaker" || snapshot.speaker_changes !== undefined || !snapshot.person) return snapshot;
  // Old snapshots do not contain the value written by the import. If the
  // person changed after the row was recorded, restoring the old whole row is
  // unsafe; an empty change set makes this legacy undo a no-op instead.
  // created_at is intentionally immutable across same-import reruns. Using
  // updated_at here would move the receipt's boundary forward on every rerun
  // and could mistake an earlier organizer edit for the import's own write.
  if (!current || current.updated_at > importRowCreatedAt) return { ...snapshot, speaker_changes: {} };
  const speakerChanges: Partial<Record<SpeakerField, SpeakerFieldChange>> = {};
  for (const field of ["email", "name", "title", "company", "bio"] as const) {
    if (snapshot.person[field] !== current[field]) {
      speakerChanges[field] = { before: snapshot.person[field], after: current[field] };
    }
  }
  const upgraded: ImportSnapshot = { ...snapshot, speaker_changes: speakerChanges };
  if (snapshot.person.headshot_attachment_id !== current.headshot_attachment_id) {
    upgraded.speaker_attachment_changed = true;
    upgraded.speaker_attachment_after_id = current.headshot_attachment_id;
  }
  return upgraded;
}

async function eventFor(db: D1Database, eventId: string): Promise<EventRow> {
  const event = await db.prepare("SELECT id, org_id FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  if (!event) throw new Error("conference not found");
  return event;
}

async function saveImportRow(db: D1Database, input: ImportRowInput): Promise<void> {
  const existing = await db.prepare("SELECT before_json, outcome, target_id, created_at FROM import_rows WHERE import_id = ? AND row_index = ?")
    .bind(input.importId, input.rowIndex)
    .first<Pick<ImportRowRow, "before_json" | "outcome" | "target_id" | "created_at">>();
  let beforeJson = existing
    ? existing.before_json ?? (existing.outcome === "failed" && input.before ? rowJson(input.before) : null)
    : (input.before ? rowJson(input.before) : null);
  if (existing?.before_json && input.before?.kind === "speaker" && input.before.person) {
    try {
      const prior = JSON.parse(existing.before_json) as ImportSnapshot;
      if (prior.kind === "speaker" && prior.speaker_changes === undefined) {
        beforeJson = rowJson(upgradeLegacySpeakerSnapshot(prior, input.before.person, existing.created_at));
      }
    } catch {
      // Keep an existing receipt intact if a historical snapshot is malformed.
    }
  }
  const targetId = existing?.before_json && existing.target_id ? existing.target_id : input.targetId;
  await db.prepare(
    `INSERT INTO import_rows (id, import_id, row_index, entity, outcome, reason, target_id, before_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(import_id, row_index) DO UPDATE SET
       entity = excluded.entity, outcome = excluded.outcome, reason = excluded.reason,
       target_id = excluded.target_id, before_json = COALESCE(import_rows.before_json, excluded.before_json),
       updated_at = excluded.updated_at`,
  ).bind(
    stableImportId("row", input.importId, String(input.rowIndex)), input.importId, input.rowIndex,
    input.entity, input.outcome, input.reason, targetId, beforeJson, Date.now(), Date.now(),
  ).run();
}

async function personByEmail(db: D1Database, orgId: string, email: string): Promise<PersonRow | null> {
  return db.prepare("SELECT * FROM people WHERE org_id = ? AND lower(email) = lower(?) ORDER BY id LIMIT 1")
    .bind(orgId, email).first<PersonRow>();
}

async function personByName(db: D1Database, orgId: string, name: string): Promise<PersonRow | null> {
  if (!name) return null;
  const matches = await db.prepare("SELECT * FROM people WHERE org_id = ? AND lower(name) = lower(?) ORDER BY id LIMIT 2")
    .bind(orgId, name).all<PersonRow>();
  return matches.results.length === 1 ? matches.results[0] ?? null : null;
}

async function attachmentForPerson(db: D1Database, eventId: string, personId: string): Promise<AttachmentRow | null> {
  return db.prepare("SELECT * FROM attachments WHERE event_id = ? AND owner_type = 'person_headshot' AND owner_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1")
    .bind(eventId, personId).first<AttachmentRow>();
}

async function speakerMembershipForPerson(db: D1Database, eventId: string, personId: string): Promise<MembershipRow | null> {
  return db.prepare("SELECT * FROM memberships WHERE event_id = ? AND person_id = ? AND role = 'speaker' LIMIT 1")
    .bind(eventId, personId).first<MembershipRow>();
}

async function importSpeaker(
  db: D1Database,
  event: EventRow,
  row: Record<string, string>,
  importId: string,
  rowIndex: number,
): Promise<{ person: PersonRow; outcome: "created" | "updated" | "skipped"; reason: string | null }> {
  const externalRef = row.external_ref.trim();
  const firstName = row.first_name.trim();
  const lastName = row.last_name.trim();
  const name = row.name.trim() || [firstName, lastName].filter(Boolean).join(" ");
  if (!name) throw new Error("speaker name is required");
  const email = normalizeEmail(row.email);
  if (!email) throw new Error("speaker email is required");
  const priorImportRow = await db.prepare("SELECT target_id, before_json FROM import_rows WHERE import_id = ? AND row_index = ?")
    .bind(importId, rowIndex).first<Pick<ImportRowRow, "target_id" | "before_json">>();
  const priorTargetId = priorImportRow?.before_json ? priorImportRow.target_id : null;
  const priorTarget = priorTargetId
    ? await db.prepare("SELECT * FROM people WHERE id = ? AND org_id = ?").bind(priorTargetId, event.org_id).first<PersonRow>()
    : null;
  if (priorTargetId && !priorTarget) throw new Error("the original speaker target no longer exists; rerun refused");
  const byEmail = await personByEmail(db, event.org_id, email);
  // A source-system id is a stronger identity key than a display name. A new
  // import has no prior row to anchor it, but it can still find the person
  // created by an earlier import when Sessionize keeps that id and changes the
  // exported email address.
  const byExternalRef = !priorTarget && !byEmail && externalRef
    ? await db.prepare("SELECT * FROM people WHERE id = ? AND org_id = ?")
      .bind(stableImportId("person", event.id, externalRef), event.org_id).first<PersonRow>()
    : null;
  // A fresh row is only allowed to identify an existing person by normalized
  // email or source external_ref. Same-name rows with another address are
  // separate people until an organizer explicitly reconciles them; name alone
  // is not an identity key.
  const sameName = !priorTarget && !byEmail && !byExternalRef ? await personByName(db, event.org_id, name) : null;
  const current = priorTarget ?? byEmail ?? byExternalRef;
  const matchedBy = !current
    ? null
    : priorTarget ? "prior import target"
      : byEmail ? "normalized email"
        : "source external_ref";
  const keepsStoredEmail = Boolean(current && byEmail?.id !== current.id);
  const beforeAttachment = current ? await attachmentForPerson(db, event.id, current.id) : null;
  const beforeMembership = current ? await speakerMembershipForPerson(db, event.id, current.id) : null;
  const before: ImportSnapshot = current ? {
    kind: "speaker", person: current, attachment: beforeAttachment, speaker_changes: {}, membership_created: false, membership_id: null, submission: null,
    tracks: [], participations: [], answers: [], evaluations: [],
  } : { kind: "speaker", person: null, attachment: null, speaker_changes: {}, membership_created: false, membership_id: null, submission: null, tracks: [], participations: [], answers: [], evaluations: [] };
  const now = nowAfter(current?.updated_at);
  const id = current?.id ?? stableImportId("person", event.id, externalRef || email);
  // An import is additive, never destructive. A blank CSV cell means "this
  // export does not carry that field", not "delete what the speaker wrote in
  // their portal", and profile fields live on the org-level `people` row, so
  // an erase here reaches every conference that person speaks at. A filled
  // cell also cannot replace an existing value: imports may fill a missing
  // profile field, but an organizer's current value stays authoritative until
  // they explicitly edit it in Marquee.
  const merge = (incoming: string, stored: string | null): string | null => stored?.trim() ? stored : incoming.trim() || null;
  const next = {
    email: keepsStoredEmail ? current!.email : email,
    // A repeat of this import is anchored to its prior target, so a later
    // organizer rename cannot be treated as a new import correction. A fresh
    // match is email-keyed; a different address never reuses a name match.
    name: priorTarget ? priorTarget.name : name,
    title: merge(row.title, current?.title ?? null),
    company: merge(row.company, current?.company ?? null),
    bio: merge(row.bio, current?.bio ?? null),
  };
  if (current) {
    for (const field of ["email", "name", "title", "company", "bio"] as const) {
      if (current[field] !== next[field]) {
        before.speaker_changes![field] = { before: current[field], after: next[field] };
      }
    }
  }
  const hasStoredValue = (field: "title" | "company" | "bio"): boolean => Boolean(current?.[field]?.trim());
  const preserved = current
    ? (["title", "company", "bio"] as const).filter((field) => row[field].trim() && hasStoredValue(field))
    : [];
  const filled = current
    ? (["title", "company", "bio"] as const).filter((field) => row[field].trim() && !hasStoredValue(field) && next[field] !== null)
    : [];
  const blankRetained = current
    ? (["title", "company", "bio"] as const).filter((field) => !row[field].trim() && hasStoredValue(field))
    : [];
  const changed = !current || current.email !== next.email || current.name !== next.name || current.title !== next.title || current.company !== next.company || current.bio !== next.bio;
  if (!current) {
    await db.prepare(
      `INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', 0, 'marquee', ?, ?)`,
    ).bind(id, event.org_id, next.email, next.name, next.title, next.company, next.bio, now, now).run();
  } else if (changed) {
    await db.prepare(
      `UPDATE people SET email = ?, name = ?, title = ?, company = ?, bio = ?, last_write_source = 'marquee', updated_at = ? WHERE id = ? AND org_id = ?`,
    ).bind(next.email, next.name, next.title, next.company, next.bio, now, current.id, event.org_id).run();
  }
  let person = await db.prepare("SELECT * FROM people WHERE id = ?").bind(id).first<PersonRow>();
  if (!person) throw new Error("imported speaker disappeared");
  const headshot = row.headshot_url.trim();
  let attachmentChanged = false;
  if (headshot) {
    const wantedKey = `external:${headshot}`;
    const existing = await attachmentForPerson(db, event.id, person.id);
    if (!existing || existing.r2_key !== wantedKey || existing.status !== "pending") {
      const attachmentId = stableImportId("attachment", event.id, person.id, headshot);
      const attachmentExists = await db.prepare("SELECT id FROM attachments WHERE id = ?").bind(attachmentId).first();
      const attachmentWrites = [];
      if (!attachmentExists) {
        attachmentWrites.push(db.prepare(
          `INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, created_at, updated_at)
           VALUES (?, ?, 'person_headshot', ?, ?, ?, ?, 0, 'pending', ?, ?)`,
        ).bind(attachmentId, event.id, person.id, wantedKey, `sessionize-${hashPart(headshot)}.jpg`, contentTypeForUrl(headshot), now, now));
      }
      attachmentWrites.push(db.prepare("UPDATE people SET headshot_attachment_id = ?, updated_at = ? WHERE id = ?").bind(attachmentId, now, person.id));
      if (existing && existing.id !== attachmentId) {
        attachmentWrites.push(db.prepare("DELETE FROM attachments WHERE id = ? AND owner_type = 'person_headshot' AND owner_id = ?").bind(existing.id, person.id));
      }
      await db.batch(attachmentWrites);
      attachmentChanged = true;
    }
  }
  person = (await db.prepare("SELECT * FROM people WHERE id = ?").bind(id).first<PersonRow>())!;
  const membershipWrite = await speakerMembershipStatement(db, { orgId: event.org_id, eventId: event.id, personId: person.id, now }).run();
  if (!beforeMembership && membershipWrite.meta.changes > 0) {
    before.membership_created = true;
    before.membership_id = (await speakerMembershipForPerson(db, event.id, person.id))?.id ?? null;
  }
  if (attachmentChanged) {
    before.speaker_attachment_changed = true;
    before.speaker_attachment_after_id = person.headshot_attachment_id;
  }
  const outcome = !current ? "created" : changed || attachmentChanged ? "updated" : "skipped";
  // An organizer auditing an import has to be able to tell why a row landed the
  // way it did. A created row matched nothing, so it must not claim a match;
  // a matched row says which key found the person; and an updated row names the
  // fields it kept, filled, and the ones the CSV left blank and therefore
  // retained. This is the durable audit trail an organizer sees after the
  // import; it must never claim that an existing profile value was overwritten.
  const reason = [
    current
      ? `matched by ${matchedBy}`
      : externalRef ? `new person, keyed by external_ref ${externalRef}` : "new person, keyed by normalized email",
    sameName ? "same name exists with a different email; created separate person" : null,
    keepsStoredEmail ? "kept email (existing profile)" : null,
    preserved.length ? `kept ${preserved.join(", ")} (existing value)` : null,
    filled.length ? `filled ${filled.join(", ")}` : null,
    blankRetained.length ? `kept ${blankRetained.join(", ")} (blank in CSV)` : null,
    headshot ? "headshot retained as a pending external attachment" : null,
  ].filter(Boolean).join("; ");
  await saveImportRow(db, {
    importId, rowIndex, entity: "speaker", outcome, reason, targetId: person.id, before,
  });
  return { person, outcome, reason };
}

async function ensureSessionizeForm(db: D1Database, eventId: string, customFields: Record<string, unknown>, now: number): Promise<{ form: FormRow; fields: Map<string, string> }> {
  const formId = stableImportId("form", eventId);
  let form = await db.prepare("SELECT * FROM forms WHERE id = ? AND event_id = ?").bind(formId, eventId).first<FormRow>();
  if (!form) {
    await db.prepare(
      `INSERT INTO forms (id, event_id, name, slug, kind, status, welcome_md, per_submitter_limit, min_speakers, max_speakers, max_sponsors, admin_notify_person_ids, turnstile_required, created_at, updated_at)
       VALUES (?, ?, 'Sessionize import fields', ?, 'session', 'closed', 'Imported fields are retained for organizer review.', 100, 0, 20, 0, '[]', 0, ?, ?)`,
    ).bind(formId, eventId, `sessionize-import-${hashPart(eventId)}`, now, now).run();
    form = await db.prepare("SELECT * FROM forms WHERE id = ?").bind(formId).first<FormRow>();
  }
  if (!form) throw new Error("import form disappeared");
  const existing = await db.prepare("SELECT id, key FROM form_fields WHERE form_id = ? ORDER BY position ASC").bind(form.id).all<{ id: string; key: string }>();
  const fields = new Map(existing.results.map((field) => [field.key, field.id]));
  let position = existing.results.length;
  for (const key of Object.keys(customFields)) {
    const fieldKey = customFieldKey(key);
    if (fields.has(fieldKey)) continue;
    const fieldId = stableImportId("field", form.id, fieldKey);
    await db.prepare(
      `INSERT INTO form_fields (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Imported from Sessionize; retained for organizer review.', 'short_text', 0, ?, '{}', NULL, ?, ?)`,
    ).bind(fieldId, form.id, fieldKey, key.trim() || fieldKey, position, now, now).run();
    fields.set(fieldKey, fieldId);
    position += 1;
  }
  return { form, fields };
}

async function importedSessionRelations(db: D1Database, submissionId: string): Promise<{ tracks: SubmissionTrackRow[]; participations: ParticipationRow[]; answers: AnswerRow[]; evaluations: EvaluationRow[] }> {
  const [tracks, participations, answers, evaluations] = await Promise.all([
    db.prepare("SELECT * FROM submission_tracks WHERE submission_id = ? ORDER BY is_primary DESC, id").bind(submissionId).all<SubmissionTrackRow>(),
    db.prepare("SELECT * FROM participations WHERE submission_id = ? AND id LIKE 'part_import_%' ORDER BY id").bind(submissionId).all<ParticipationRow>(),
    db.prepare("SELECT * FROM submission_answers WHERE submission_id = ? AND id LIKE 'answer_import_%' ORDER BY id").bind(submissionId).all<AnswerRow>(),
    db.prepare("SELECT * FROM evaluations WHERE submission_id = ? AND id LIKE 'eval_import_%' ORDER BY id").bind(submissionId).all<EvaluationRow>(),
  ]);
  return { tracks: tracks.results, participations: participations.results, answers: answers.results, evaluations: evaluations.results };
}

function importedPrimaryTrackStatements(db: D1Database, submissionId: string, trackId: string | null, now: number): D1PreparedStatement[] {
  if (!trackId) return [];
  return [
    db.prepare(
      "UPDATE submission_tracks SET is_primary = 0, updated_at = ? WHERE submission_id = ? AND is_primary = 1 AND track_id <> ?",
    ).bind(now, submissionId, trackId),
    db.prepare(
      `INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(submission_id, track_id) DO UPDATE SET is_primary = 1, updated_at = excluded.updated_at`,
    ).bind(stableImportId("track", submissionId, trackId), submissionId, trackId, now, now),
  ];
}

/** Repair rows written before the importer populated the canonical track join. */
async function backfillImportedPrimaryTracks(db: D1Database, eventId: string): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at)
     SELECT 'track_import_backfill_' || submission.id, submission.id, submission.primary_track_id, 1,
       submission.created_at, submission.updated_at
     FROM submissions submission
     WHERE submission.event_id = ?
       AND submission.origin = 'import'
       AND submission.primary_track_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM submission_tracks carried WHERE carried.submission_id = submission.id
       )`,
  ).bind(eventId).run();
}

async function speakerForToken(db: D1Database, orgId: string, token: string, speakerMap: Map<string, PersonRow>): Promise<PersonRow | null> {
  if (speakerMap.has(normalizeEmail(token))) return speakerMap.get(normalizeEmail(token)) ?? null;
  const email = normalizeEmail(token);
  if (email.includes("@")) return personByEmail(db, orgId, email);
  return personByName(db, orgId, token);
}

async function ensureImportedReviewer(db: D1Database, event: EventRow, email: string, sessionId: string, now: number): Promise<{ person: PersonRow; unattributed: boolean }> {
  if (email.trim()) {
    const matched = await personByEmail(db, event.org_id, normalizeEmail(email));
    if (matched) return { person: matched, unattributed: false };
  }
  const id = stableImportId("person_reviewer", event.id, sessionId);
  const syntheticEmail = `unattributed+${hashPart(`${event.id}|${sessionId}`)}@example.invalid`;
  let person = await db.prepare("SELECT * FROM people WHERE id = ?").bind(id).first<PersonRow>();
  if (!person) {
    await db.prepare(
      `INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, 'Unattributed Sessionize reviewer', 'Sessionize import', NULL, 'No reviewer email was present in the export.', NULL, '[]', 0, 'marquee', ?, ?)`,
    ).bind(id, event.org_id, syntheticEmail, now, now).run();
    person = await db.prepare("SELECT * FROM people WHERE id = ?").bind(id).first<PersonRow>();
  }
  if (!person) throw new Error("synthetic reviewer disappeared");
  return { person, unattributed: true };
}

async function evaluationRound(db: D1Database, eventId: string, now: number): Promise<{ planId: string; roundId: string }> {
  const planId = stableImportId("plan", eventId);
  const roundId = stableImportId("round", eventId);
  if (!(await db.prepare("SELECT id FROM evaluation_plans WHERE id = ?").bind(planId).first())) {
    await db.prepare(
      `INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at)
       VALUES (?, ?, 'Sessionize import evaluation', 'Imported evaluation results; retained for organizer review.', 0, 5, 'closed', ?, ?)`,
    ).bind(planId, eventId, now, now).run();
  }
  if (!(await db.prepare("SELECT id FROM evaluation_rounds WHERE id = ?").bind(roundId).first())) {
    await db.prepare(
      `INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at)
       VALUES (?, ?, 0, 'Sessionize import results', 'scorecard', 0, 1, ?, ?)`,
    ).bind(roundId, planId, now, now).run();
  }
  return { planId, roundId };
}

interface TaxonomyResolution {
  /** The raw value from the export, already trimmed. Empty means the column said nothing. */
  name: string;
  matched: boolean;
  /** What the row actually ends up carrying, after the fall back to the current value. */
  resolvedId: string | null;
}

/**
 * Tracks and formats resolve by exact, case-insensitive name. A real Sessionize
 * export whose taxonomy does not match the event's configuration is the normal
 * case, not the edge case, and a miss used to be silent: the row reported
 * success and the categorization was simply gone.
 *
 * The distinction worth reporting is "the CSV said nothing" versus "the CSV said
 * `Platform` and this event has no track by that name". Only the second is
 * noted, or the message becomes noise on every blank column. The value is named
 * because the operator's next move — create that track, or fix the export —
 * needs the name.
 */
export function unmatchedTaxonomyNotes(fields: { track: TaxonomyResolution; format: TaxonomyResolution }): string[] {
  return (["track", "format"] as const).flatMap((kind) => {
    const field = fields[kind];
    if (!field.name || field.matched) return [];
    // An unmatched name falls back to whatever the record already carried, so a
    // re-import over a row categorized inside Marquee keeps its value rather
    // than clearing it. Saying "left unset" there would be untrue.
    const effect = field.resolvedId === null ? "left unset" : "existing value kept";
    return [`${kind} "${field.name}" not recognized, ${effect}`];
  });
}

async function importSession(
  db: D1Database,
  event: EventRow,
  row: Record<string, string>,
  speakerMap: Map<string, PersonRow>,
  importId: string,
  rowIndex: number,
): Promise<{ outcome: "created" | "updated" | "skipped"; evaluation: boolean }> {
  const externalRef = row.external_ref.trim();
  const title = row.title.trim();
  if (!externalRef) throw new Error("session external_ref is required");
  if (!title) throw new Error("session title is required");
  const status = canonicalStatus(row.status);
  if (!status.status) throw new Error("session status is required");
  const current = await db.prepare("SELECT * FROM submissions WHERE event_id = ? AND external_ref = ?")
    .bind(event.id, externalRef).first<SubmissionRow>();
  const relations = current ? await importedSessionRelations(db, current.id) : { tracks: [], participations: [], answers: [], evaluations: [] };
  const before: ImportSnapshot = current ? {
    kind: "session", person: null, attachment: null, submission: current,
    tracks: relations.tracks, participations: relations.participations, answers: relations.answers, evaluations: relations.evaluations,
  } : { kind: "session", person: null, attachment: null, submission: null, tracks: [], participations: [], answers: [], evaluations: [] };
  const now = nowAfter(current?.updated_at);
  const speakerTokens = splitValues(row.speaker_emails);
  const speakers: PersonRow[] = [];
  for (const token of speakerTokens) {
    const person = await speakerForToken(db, event.org_id, token, speakerMap);
    if (person && !speakers.some((candidate) => candidate.id === person.id)) speakers.push(person);
  }
  if (speakers.length === 0) throw new Error("at least one speaker email or name must match the speakers export");
  const submitter = speakers[0]!;
  const trackName = row.track.trim();
  const formatName = row.format.trim();
  const track = trackName ? await db.prepare("SELECT id FROM tracks WHERE event_id = ? AND lower(name) = lower(?)").bind(event.id, trackName).first<{ id: string }>() : null;
  const format = formatName ? await db.prepare("SELECT id FROM formats WHERE event_id = ? AND lower(name) = lower(?)").bind(event.id, formatName).first<{ id: string }>() : null;
  const customFields = parseJsonObject(row.custom_fields);
  let formId = current?.form_id ?? null;
  let fields = new Map<string, string>();
  if (Object.keys(customFields).length > 0) {
    const form = await ensureSessionizeForm(db, event.id, customFields, now);
    formId = form.form.id;
    fields = form.fields;
  }
  const id = current?.id ?? stableImportId("submission", event.id, externalRef);
  const next = {
    formId,
    title,
    abstract: row.abstract.trim() || null,
    status: status.status,
    formatId: format?.id ?? current?.format_id ?? null,
    trackId: track?.id ?? current?.primary_track_id ?? null,
    submitterId: submitter.id,
  };
  const changed = !current || current.form_id !== next.formId || current.title !== next.title || current.abstract !== next.abstract || current.status !== next.status || current.format_id !== next.formatId || current.primary_track_id !== next.trackId || current.submitter_person_id !== next.submitterId;
  const trackChanged = next.trackId !== null && !relations.tracks.some((trackRow) => trackRow.track_id === next.trackId && trackRow.is_primary === 1);
  if (!current) {
    await db.batch([
      db.prepare(
        `INSERT INTO submissions (id, event_id, form_id, kind, bypass_evaluation, title, abstract, status, format_id, primary_track_id, origin, vendor_affiliation, wave_id, submitter_person_id, submitted_at, last_saved_at, is_published, external_ref, last_write_source, created_at, updated_at)
         VALUES (?, ?, ?, 'session', 1, ?, ?, ?, ?, ?, 'import', 'none', NULL, ?, ?, ?, 0, ?, 'marquee', ?, ?)`,
      ).bind(id, event.id, next.formId, next.title, next.abstract, next.status, next.formatId, next.trackId, next.submitterId, now, now, externalRef, now, now),
      ...importedPrimaryTrackStatements(db, id, next.trackId, now),
    ]);
  } else if (changed || trackChanged) {
    await db.batch([
      ...(changed ? [db.prepare(
        `UPDATE submissions SET form_id = ?, title = ?, abstract = ?, status = ?, format_id = ?, primary_track_id = ?, submitter_person_id = ?, last_write_source = 'marquee', updated_at = ? WHERE id = ? AND event_id = ?`,
      ).bind(next.formId, next.title, next.abstract, next.status, next.formatId, next.trackId, next.submitterId, now, current.id, event.id)] : []),
      ...importedPrimaryTrackStatements(db, id, next.trackId, now),
    ]);
  }
  const desiredParticipationIds = new Set<string>();
  for (const [position, speaker] of speakers.entries()) {
    const role = position === 0 ? "speaker" : "co_speaker";
    const participationId = stableImportId("part", id, speaker.id, role);
    desiredParticipationIds.add(participationId);
    if (!(await db.prepare("SELECT id FROM participations WHERE id = ?").bind(participationId).first())) {
      await db.prepare(
        `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).bind(participationId, id, speaker.id, role, position, now, now).run();
    } else {
      await db.prepare("UPDATE participations SET person_id = ?, role = ?, position = ?, updated_at = ? WHERE id = ? AND submission_id = ?")
        .bind(speaker.id, role, position, now, participationId, id).run();
    }
  }
  for (const old of relations.participations) {
    if (!desiredParticipationIds.has(old.id)) await db.prepare("DELETE FROM participations WHERE id = ? AND submission_id = ?").bind(old.id, id).run();
  }
  const desiredAnswerIds = new Set<string>();
  for (const [key, value] of Object.entries(customFields)) {
    const fieldId = fields.get(customFieldKey(key));
    if (!fieldId) continue;
    const answerId = stableImportId("answer", id, fieldId);
    desiredAnswerIds.add(answerId);
    const valueText = textValue(value);
    if (await db.prepare("SELECT id FROM submission_answers WHERE id = ?").bind(answerId).first()) {
      await db.prepare("UPDATE submission_answers SET value_text = ?, value_json = NULL, updated_at = ? WHERE id = ? AND submission_id = ?").bind(valueText, now, answerId, id).run();
    } else {
      await db.prepare("INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)").bind(answerId, id, fieldId, valueText, now, now).run();
    }
  }
  for (const old of relations.answers) {
    if (!desiredAnswerIds.has(old.id)) await db.prepare("DELETE FROM submission_answers WHERE id = ? AND submission_id = ?").bind(old.id, id).run();
  }
  const score = row.score.trim() ? Number(row.score.trim()) : null;
  if (row.score.trim() && !Number.isFinite(score)) throw new Error("evaluation score must be numeric");
  const comment = row.reviewer_comment.trim();
  let evaluation = false;
  if (score !== null || comment) {
    const reviewer = await ensureImportedReviewer(db, event, row.reviewer_email, id, now);
    const round = await evaluationRound(db, event.id, now);
    const evaluationId = stableImportId("eval", id, reviewer.person.id);
    const evaluationComment = reviewer.unattributed ? `[unattributed reviewer] ${comment}`.trim() : comment;
    evaluation = true;
    if (await db.prepare("SELECT id FROM evaluations WHERE id = ?").bind(evaluationId).first()) {
      await db.prepare("UPDATE evaluations SET round_id = ?, reviewer_person_id = ?, score = ?, comment = ?, updated_at = ? WHERE id = ? AND submission_id = ?")
        .bind(round.roundId, reviewer.person.id, score, evaluationComment, now, evaluationId, id).run();
    } else {
      await db.prepare(
        `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, 0, ?, ?)`,
      ).bind(evaluationId, round.roundId, id, reviewer.person.id, score, evaluationComment, now, now).run();
    }
    for (const old of relations.evaluations) {
      if (old.id !== evaluationId) await db.prepare("DELETE FROM evaluations WHERE id = ? AND submission_id = ?").bind(old.id, id).run();
    }
  } else {
    for (const old of relations.evaluations) await db.prepare("DELETE FROM evaluations WHERE id = ? AND submission_id = ?").bind(old.id, id).run();
  }
  const currentAfter = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<SubmissionRow>();
  const relationsAfter = await importedSessionRelations(db, id);
  const sameTracks = JSON.stringify(relations.tracks.map(({ created_at: _a, updated_at: _b, ...value }) => value)) === JSON.stringify(relationsAfter.tracks.map(({ created_at: _a, updated_at: _b, ...value }) => value));
  const sameRelations = sameTracks
    && JSON.stringify(relations.participations.map(({ created_at: _a, updated_at: _b, ...value }) => value)) === JSON.stringify(relationsAfter.participations.map(({ created_at: _a, updated_at: _b, ...value }) => value))
    && JSON.stringify(relations.answers.map(({ created_at: _a, updated_at: _b, ...value }) => value)) === JSON.stringify(relationsAfter.answers.map(({ created_at: _a, updated_at: _b, ...value }) => value))
    && JSON.stringify(relations.evaluations.map(({ created_at: _a, updated_at: _b, ...value }) => value)) === JSON.stringify(relationsAfter.evaluations.map(({ created_at: _a, updated_at: _b, ...value }) => value));
  const actualChanged = !current || changed || trackChanged || !sameRelations;
  const outcome = !current ? "created" : actualChanged ? "updated" : "skipped";
  const reason = [
    status.note,
    actualChanged ? "session, relationships, scores, or custom fields reconciled" : "same external_ref and values already present",
    evaluation ? "evaluation result imported" : null,
    ...unmatchedTaxonomyNotes({
      track: { name: trackName, matched: track !== null, resolvedId: next.trackId },
      format: { name: formatName, matched: format !== null, resolvedId: next.formatId },
    }),
  ].filter(Boolean).join("; ");
  await saveImportRow(db, {
    importId, rowIndex, entity: "session", outcome, reason: reason || null, targetId: currentAfter?.id ?? id, before,
  });
  return { outcome, evaluation };
}

async function cleanupImportedPerson(db: D1Database, personId: string): Promise<void> {
  const references = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM participations WHERE person_id = ?) AS participations,
       (SELECT COUNT(*) FROM submissions WHERE submitter_person_id = ? OR decided_by_person_id = ?) AS submissions,
       (SELECT COUNT(*) FROM evaluations WHERE reviewer_person_id = ?) AS evaluations,
       (SELECT COUNT(*) FROM memberships WHERE person_id = ?) AS memberships`,
  ).bind(personId, personId, personId, personId, personId).first<{ participations: number; submissions: number; evaluations: number; memberships: number }>();
  if (!references || Number(references.participations) || Number(references.submissions) || Number(references.evaluations) || Number(references.memberships)) return;
  await db.prepare("UPDATE people SET headshot_attachment_id = NULL WHERE id = ? AND id LIKE '%_import_%'").bind(personId).run();
  await db.prepare("DELETE FROM attachments WHERE owner_type = 'person_headshot' AND owner_id = ?").bind(personId).run();
  await db.prepare("DELETE FROM people WHERE id = ? AND id LIKE '%_import_%'").bind(personId).run();
}

async function removeImportedSpeakerMembership(db: D1Database, eventId: string, personId: string, snapshot: ImportSnapshot): Promise<void> {
  if (snapshot.membership_created !== true) return;
  if (snapshot.membership_id) {
    await db.prepare("DELETE FROM memberships WHERE id = ? AND event_id = ? AND person_id = ? AND role = 'speaker'")
      .bind(snapshot.membership_id, eventId, personId).run();
    return;
  }
  await db.prepare("DELETE FROM memberships WHERE event_id = ? AND person_id = ? AND role = 'speaker'").bind(eventId, personId).run();
}

async function restoreSnapshot(db: D1Database, snapshot: ImportSnapshot): Promise<void> {
  if (snapshot.kind === "speaker") {
    if (!snapshot.person) {
      if (snapshot.attachment) await db.prepare("DELETE FROM attachments WHERE id = ?").bind(snapshot.attachment.id).run();
      return;
    }
    if (snapshot.speaker_changes !== undefined) {
      const current = await db.prepare("SELECT * FROM people WHERE id = ?").bind(snapshot.person.id).first<PersonRow>();
      if (!current) return;
      const updates: string[] = [];
      const values: Array<string | number | null> = [];
      for (const field of ["email", "name", "title", "company", "bio"] as const) {
        const change = snapshot.speaker_changes[field];
        if (!change || current[field] !== change.after) continue;
        updates.push(`${field} = ?`);
        values.push(change.before);
      }
      const afterAttachmentId = snapshot.speaker_attachment_after_id ?? null;
      const restoreAttachment = snapshot.speaker_attachment_changed === true && current.headshot_attachment_id === afterAttachmentId;
      const restoreAttachmentId = snapshot.attachment?.id ?? null;
      if (restoreAttachment && snapshot.attachment && restoreAttachmentId !== afterAttachmentId) {
        await db.prepare(
          `INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, sha256, r2_etag, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET event_id = excluded.event_id, owner_type = excluded.owner_type, owner_id = excluded.owner_id, r2_key = excluded.r2_key, filename = excluded.filename, content_type = excluded.content_type, size_bytes = excluded.size_bytes, status = excluded.status, sha256 = excluded.sha256, r2_etag = excluded.r2_etag, updated_at = excluded.updated_at`,
        ).bind(snapshot.attachment.id, snapshot.attachment.event_id, snapshot.attachment.owner_type, snapshot.attachment.owner_id, snapshot.attachment.r2_key, snapshot.attachment.filename, snapshot.attachment.content_type, snapshot.attachment.size_bytes, snapshot.attachment.status, snapshot.attachment.sha256, snapshot.attachment.r2_etag, snapshot.attachment.created_at, snapshot.attachment.updated_at).run();
      }
      if (restoreAttachment) {
        updates.push("headshot_attachment_id = ?");
        values.push(snapshot.person.headshot_attachment_id);
      }
      if (updates.length > 0) {
        updates.push("updated_at = ?");
        values.push(Date.now());
        values.push(snapshot.person.id);
        await db.prepare(`UPDATE people SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
      }
      if (snapshot.speaker_attachment_changed === true && afterAttachmentId) {
        if (restoreAttachment) {
          if (restoreAttachmentId !== afterAttachmentId) {
            await db.prepare("DELETE FROM attachments WHERE id = ? AND owner_type = 'person_headshot' AND owner_id = ?")
              .bind(afterAttachmentId, snapshot.person.id).run();
          }
        } else if (!restoreAttachment) {
          await db.prepare("DELETE FROM attachments WHERE id = ? AND owner_type = 'person_headshot' AND owner_id = ?")
            .bind(afterAttachmentId, snapshot.person.id).run();
        }
      }
      return;
    }
    await db.prepare(
      `UPDATE people SET org_id = ?, email = ?, name = ?, title = ?, company = ?, bio = ?, headshot_attachment_id = ?, social_links = ?, is_demo = ?, last_write_source = ?, updated_at = ? WHERE id = ?`,
    ).bind(snapshot.person.org_id, snapshot.person.email, snapshot.person.name, snapshot.person.title, snapshot.person.company, snapshot.person.bio, snapshot.person.headshot_attachment_id, snapshot.person.social_links, snapshot.person.is_demo, snapshot.person.last_write_source, snapshot.person.updated_at, snapshot.person.id).run();
    await db.prepare("DELETE FROM attachments WHERE owner_type = 'person_headshot' AND owner_id = ? AND id LIKE 'attachment_import_%' AND id <> ?")
      .bind(snapshot.person.id, snapshot.attachment?.id ?? "").run();
    if (snapshot.attachment) {
      await db.prepare(
        `INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, sha256, r2_etag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET event_id = excluded.event_id, owner_type = excluded.owner_type, owner_id = excluded.owner_id, r2_key = excluded.r2_key, filename = excluded.filename, content_type = excluded.content_type, size_bytes = excluded.size_bytes, status = excluded.status, sha256 = excluded.sha256, r2_etag = excluded.r2_etag, updated_at = excluded.updated_at`,
      ).bind(snapshot.attachment.id, snapshot.attachment.event_id, snapshot.attachment.owner_type, snapshot.attachment.owner_id, snapshot.attachment.r2_key, snapshot.attachment.filename, snapshot.attachment.content_type, snapshot.attachment.size_bytes, snapshot.attachment.status, snapshot.attachment.sha256, snapshot.attachment.r2_etag, snapshot.attachment.created_at, snapshot.attachment.updated_at).run();
    }
    return;
  }
  if (!snapshot.submission) return;
  const submission = snapshot.submission;
  await db.prepare(
    `UPDATE submissions SET event_id = ?, form_id = ?, kind = ?, bypass_evaluation = ?, title = ?, abstract = ?, status = ?, format_id = ?, primary_track_id = ?, origin = ?, vendor_affiliation = ?, wave_id = ?, submitter_person_id = ?, decided_at = ?, decided_by_person_id = ?, submitted_at = ?, last_saved_at = ?, resume_token_hash = ?, is_published = ?, external_ref = ?, applied_rule_id = ?, last_write_source = ?, created_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(submission.event_id, submission.form_id, submission.kind, submission.bypass_evaluation, submission.title, submission.abstract, submission.status, submission.format_id, submission.primary_track_id, submission.origin, submission.vendor_affiliation, submission.wave_id, submission.submitter_person_id, submission.decided_at, submission.decided_by_person_id, submission.submitted_at, submission.last_saved_at, submission.resume_token_hash, submission.is_published, submission.external_ref, submission.applied_rule_id, submission.last_write_source, submission.created_at, submission.updated_at, submission.id).run();
  await db.batch([
    ...(snapshot.tracks !== undefined ? [db.prepare("DELETE FROM submission_tracks WHERE submission_id = ?").bind(submission.id)] : []),
    db.prepare("DELETE FROM participations WHERE submission_id = ? AND id LIKE 'part_import_%'").bind(submission.id),
    db.prepare("DELETE FROM submission_answers WHERE submission_id = ? AND id LIKE 'answer_import_%'").bind(submission.id),
    db.prepare("DELETE FROM evaluations WHERE submission_id = ? AND id LIKE 'eval_import_%'").bind(submission.id),
    ...(snapshot.tracks ?? []).map((row) => db.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(row.id, row.submission_id, row.track_id, row.is_primary, row.created_at, row.updated_at)),
    ...snapshot.participations.map((row) => db.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, confirmed_at, invited_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET person_id = excluded.person_id, role = excluded.role, position = excluded.position, confirmation_status = excluded.confirmation_status, confirmed_at = excluded.confirmed_at, invited_at = excluded.invited_at, updated_at = excluded.updated_at").bind(row.id, row.submission_id, row.person_id, row.role, row.position, row.confirmation_status, row.confirmed_at, row.invited_at, row.created_at, row.updated_at)),
    ...snapshot.answers.map((row) => db.prepare("INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET field_id = excluded.field_id, value_text = excluded.value_text, value_json = excluded.value_json, updated_at = excluded.updated_at").bind(row.id, row.submission_id, row.field_id, row.value_text, row.value_json, row.created_at, row.updated_at)),
    ...snapshot.evaluations.map((row) => db.prepare("INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET round_id = excluded.round_id, reviewer_person_id = excluded.reviewer_person_id, score = excluded.score, comment = excluded.comment, updated_at = excluded.updated_at").bind(row.id, row.round_id, row.submission_id, row.reviewer_person_id, row.recommendation, row.score, row.criteria_scores, row.comment, row.abstained, row.created_at, row.updated_at)),
  ]);
}

async function deleteCreatedSubmission(db: D1Database, submissionId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM evaluations WHERE submission_id = ? AND id LIKE 'eval_import_%'").bind(submissionId),
    db.prepare("DELETE FROM submission_answers WHERE submission_id = ? AND id LIKE 'answer_import_%'").bind(submissionId),
    db.prepare("DELETE FROM participations WHERE submission_id = ? AND id LIKE 'part_import_%'").bind(submissionId),
    db.prepare("DELETE FROM submission_tracks WHERE submission_id = ?").bind(submissionId),
    db.prepare("DELETE FROM submissions WHERE id = ? AND origin = 'import'").bind(submissionId),
  ]);
}

async function cleanupImportSetup(db: D1Database, eventId: string): Promise<void> {
  const roundId = stableImportId("round", eventId);
  const planId = stableImportId("plan", eventId);
  const evaluationCount = await db.prepare("SELECT COUNT(*) AS count FROM evaluations WHERE round_id = ?").bind(roundId).first<{ count: number }>();
  if (Number(evaluationCount?.count ?? 0) > 0) return;
  await db.batch([
    db.prepare("DELETE FROM evaluation_rounds WHERE id = ?").bind(roundId),
    db.prepare("DELETE FROM evaluation_plans WHERE id = ?").bind(planId),
  ]);
  const formId = stableImportId("form", eventId);
  const submissionCount = await db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE form_id = ?").bind(formId).first<{ count: number }>();
  if (Number(submissionCount?.count ?? 0) === 0) {
    await db.batch([
      db.prepare("DELETE FROM form_fields WHERE form_id = ?").bind(formId),
      db.prepare("DELETE FROM forms WHERE id = ?").bind(formId),
    ]);
  }
}

export function manifestPreview(manifest: SessionizeManifest, mapping?: SessionizeMapping): { sessions: SessionizePreview; speakers: SessionizePreview } {
  return {
    sessions: previewCsv("sessions", manifest.sessions_csv ?? "", mapping?.sessions),
    speakers: previewCsv("speakers", manifest.speakers_csv, mapping?.speakers),
  };
}

export function speakerEmailMappingError(mapping: SessionizeMapping, speakersCsv: string): string | null {
  const emailColumn = mapping.speakers.email;
  return emailColumn && parseCsv(speakersCsv).headers.includes(emailColumn)
    ? null
    : "speakers.email column is required before import";
}

export async function runSessionizeImport(
  db: D1Database,
  eventId: string,
  importId: string,
  manifest: SessionizeManifest,
  mapping: SessionizeMapping,
): Promise<{ counts: ImportRunCounts; rows: ImportRowRow[] }> {
  const event = await eventFor(db, eventId);
  await backfillImportedPrimaryTracks(db, eventId);
  const counts: ImportRunCounts = { created: 0, updated: 0, skipped: 0, failed: 0, sessions: 0, speakers: 0, evaluations: 0 };
  const speakerMap = new Map<string, PersonRow>();
  const speakerRows = mappedRows("speakers", manifest.speakers_csv, mapping.speakers);
  for (const [index, row] of speakerRows.entries()) {
    counts.speakers += 1;
    try {
      const result = await importSpeaker(db, event, row, importId, 1_000_000 + index);
      speakerMap.set(normalizeEmail(row.email), result.person);
      if (row.external_ref) speakerMap.set(row.external_ref.trim().toLowerCase(), result.person);
      counts[result.outcome] += 1;
    } catch (error) {
      counts.failed += 1;
      await saveImportRow(db, { importId, rowIndex: 1_000_000 + index, entity: "speaker", outcome: "failed", reason: error instanceof Error ? error.message : "speaker row failed", targetId: null, before: null });
    }
  }
  const sessionRows = mappedRows("sessions", manifest.sessions_csv ?? "", mapping.sessions);
  for (const [index, row] of sessionRows.entries()) {
    counts.sessions += 1;
    try {
      const result = await importSession(db, event, row, speakerMap, importId, index);
      if (result.evaluation) counts.evaluations += 1;
      counts[result.outcome] += 1;
    } catch (error) {
      counts.failed += 1;
      await saveImportRow(db, { importId, rowIndex: index, entity: "session", outcome: "failed", reason: error instanceof Error ? error.message : "session row failed", targetId: null, before: null });
    }
  }
  await db.prepare("UPDATE imports SET status = 'completed', updated_at = ? WHERE id = ? AND event_id = ?").bind(Date.now(), importId, eventId).run();
  const rows = await db.prepare("SELECT * FROM import_rows WHERE import_id = ? ORDER BY row_index").bind(importId).all<ImportRowRow>();
  return { counts, rows: rows.results };
}

export async function undoSessionizeImport(db: D1Database, eventId: string, importId: string): Promise<{ undone: number; retained_manifest: boolean }> {
  await eventFor(db, eventId);
  const imported = await db.prepare("SELECT id, file_key, status, undone_at FROM imports WHERE id = ? AND event_id = ?").bind(importId, eventId).first<{ id: string; file_key: string; status: string; undone_at: number | null }>();
  if (!imported) throw new Error("import not found");
  if (imported.undone_at !== null || imported.status === "undone") return { undone: 0, retained_manifest: true };
  const rows = await db.prepare("SELECT * FROM import_rows WHERE import_id = ? ORDER BY CASE WHEN entity = 'session' THEN 0 ELSE 1 END, row_index DESC").bind(importId).all<ImportRowRow>();
  let undone = 0;
  for (const row of rows.results) {
    let snapshot = row.before_json ? JSON.parse(row.before_json) as ImportSnapshot : null;
    if (row.entity === "speaker" && snapshot?.kind === "speaker" && snapshot.person && snapshot.speaker_changes === undefined) {
      const current = await db.prepare("SELECT * FROM people WHERE id = ?").bind(snapshot.person.id).first<PersonRow>();
      snapshot = upgradeLegacySpeakerSnapshot(snapshot, current, row.created_at);
    }
    const createdMarker = snapshot?.submission === null && snapshot?.person === null;
    const membershipCreatedMarker = row.entity === "speaker" && snapshot?.membership_created === true;
    const speakerChangesMarker = row.entity === "speaker" && (
      Object.keys(snapshot?.speaker_changes ?? {}).length > 0
      || snapshot?.speaker_attachment_changed === true
    );
    if (!row.target_id || row.outcome === "failed" || (row.outcome === "skipped" && !createdMarker && !membershipCreatedMarker && !speakerChangesMarker)) continue;
    if (snapshot && membershipCreatedMarker) await removeImportedSpeakerMembership(db, eventId, row.target_id, snapshot);
    if (snapshot && snapshot.submission === null && snapshot.person === null) {
      if (row.entity === "session") await deleteCreatedSubmission(db, row.target_id);
      else await cleanupImportedPerson(db, row.target_id);
    } else if (snapshot) {
      await restoreSnapshot(db, snapshot);
    } else if (row.entity === "session") {
      await deleteCreatedSubmission(db, row.target_id);
    } else if (row.entity === "speaker") {
      await cleanupImportedPerson(db, row.target_id);
    }
    if (row.entity === "speaker" && snapshot?.person === null) {
      await cleanupImportedPerson(db, row.target_id);
    }
    undone += 1;
  }
  const syntheticReviewers = await db.prepare("SELECT id FROM people WHERE id LIKE 'person_reviewer_import_%'").all<{ id: string }>();
  for (const person of syntheticReviewers.results) await cleanupImportedPerson(db, person.id);
  await cleanupImportSetup(db, eventId);
  const now = Date.now();
  await db.prepare("UPDATE imports SET status = 'undone', undone_at = ?, updated_at = ? WHERE id = ? AND event_id = ?").bind(now, now, importId, eventId).run();
  return { undone, retained_manifest: true };
}

export async function readImportManifest(media: R2Bucket, fileKey: string): Promise<SessionizeManifest> {
  const object = await media.get(fileKey);
  if (!object) throw new Error("import manifest is missing");
  const parsed: unknown = JSON.parse(await object.text());
  if (!parsed || typeof parsed !== "object") throw new Error("import manifest is malformed");
  const manifest = parsed as Partial<SessionizeManifest>;
  if (manifest.sessions_csv !== undefined && typeof manifest.sessions_csv !== "string") throw new Error("import manifest sessions CSV is malformed");
  if (typeof manifest.speakers_csv !== "string") throw new Error("import manifest is incomplete");
  return { ...(manifest.sessions_csv === undefined ? {} : { sessions_csv: manifest.sessions_csv }), speakers_csv: manifest.speakers_csv };
}

export function normalizeMapping(value: Partial<SessionizeMapping> | undefined, sessionsCsv: string | undefined, speakersCsv: string): SessionizeMapping {
  return {
    sessions: { ...defaultMapping("sessions", parseCsv(sessionsCsv ?? "").headers), ...(value?.sessions ?? {}) },
    speakers: { ...defaultMapping("speakers", parseCsv(speakersCsv).headers), ...(value?.speakers ?? {}) },
  };
}
