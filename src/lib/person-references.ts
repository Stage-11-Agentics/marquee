/**
 * Every direct foreign key to `people`, in one place.
 *
 * Two callers need the same answer to the same question — "is anything still
 * pointing at this person?" — and they must never disagree. An import undo asks
 * it before removing a person it created; unlinking an attendee claim asks it
 * before removing a person the claim minted. A second inventory would be a
 * second, quieter bug: the caller that forgot a table deletes a row somebody
 * else's record still references.
 *
 * The predicates are fixed strings. `PERSON_ID` is substituted with an
 * expression the caller controls, never with anything from a request.
 */
export const PERSON_REFERENCE_CHECKS = [
  { label: "memberships", table: "memberships", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM memberships WHERE memberships.person_id = PERSON_ID)" },
  { label: "auth_sessions", table: "auth_sessions", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM auth_sessions WHERE auth_sessions.person_id = PERSON_ID)" },
  { label: "magic_links", table: "magic_links", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM magic_links WHERE magic_links.person_id = PERSON_ID)" },
  { label: "api_tokens", table: "api_tokens", columns: ["created_by", "acts_as_person_id"], predicate: "EXISTS (SELECT 1 FROM api_tokens WHERE api_tokens.created_by = PERSON_ID OR api_tokens.acts_as_person_id = PERSON_ID)" },
  { label: "form_admins", table: "form_admins", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM form_admins WHERE form_admins.person_id = PERSON_ID)" },
  { label: "outbox", table: "outbox", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM outbox WHERE outbox.person_id = PERSON_ID)" },
  { label: "submissions", table: "submissions", columns: ["submitter_person_id", "decided_by_person_id"], predicate: "EXISTS (SELECT 1 FROM submissions WHERE submissions.submitter_person_id = PERSON_ID OR submissions.decided_by_person_id = PERSON_ID)" },
  { label: "submission_decisions", table: "submission_decisions", columns: ["decided_by_person_id"], predicate: "EXISTS (SELECT 1 FROM submission_decisions WHERE submission_decisions.decided_by_person_id = PERSON_ID)" },
  { label: "saved_views", table: "saved_views", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM saved_views WHERE saved_views.person_id = PERSON_ID)" },
  { label: "participations", table: "participations", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM participations WHERE participations.person_id = PERSON_ID)" },
  { label: "committee_members", table: "committee_members", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM committee_members WHERE committee_members.person_id = PERSON_ID)" },
  { label: "reviewer_track_scopes", table: "reviewer_track_scopes", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM reviewer_track_scopes WHERE reviewer_track_scopes.person_id = PERSON_ID)" },
  { label: "round_assignments", table: "round_assignments", columns: ["reviewer_person_id"], predicate: "EXISTS (SELECT 1 FROM round_assignments WHERE round_assignments.reviewer_person_id = PERSON_ID)" },
  { label: "evaluations", table: "evaluations", columns: ["reviewer_person_id", "override_person_id"], predicate: "EXISTS (SELECT 1 FROM evaluations WHERE evaluations.reviewer_person_id = PERSON_ID OR evaluations.override_person_id = PERSON_ID)" },
  { label: "comparisons", table: "comparisons", columns: ["reviewer_person_id"], predicate: "EXISTS (SELECT 1 FROM comparisons WHERE comparisons.reviewer_person_id = PERSON_ID)" },
  { label: "round_promotions", table: "round_promotions", columns: ["promoted_by"], predicate: "EXISTS (SELECT 1 FROM round_promotions WHERE round_promotions.promoted_by = PERSON_ID)" },
  { label: "speaker_tasks", table: "speaker_tasks", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM speaker_tasks WHERE speaker_tasks.person_id = PERSON_ID)" },
  { label: "speaker_tasks.completed_by_person_id", table: "speaker_tasks", columns: ["completed_by_person_id"], predicate: "EXISTS (SELECT 1 FROM speaker_tasks WHERE speaker_tasks.completed_by_person_id = PERSON_ID)" },
  { label: "calendar_invites", table: "calendar_invites", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM calendar_invites WHERE calendar_invites.person_id = PERSON_ID)" },
  { label: "audit_log", table: "audit_log", columns: ["actor_person_id"], predicate: "EXISTS (SELECT 1 FROM audit_log WHERE audit_log.actor_person_id = PERSON_ID)" },
  { label: "file_comments", table: "file_comments", columns: ["author_person_id"], predicate: "EXISTS (SELECT 1 FROM file_comments WHERE file_comments.author_person_id = PERSON_ID)" },
  { label: "person_events", table: "person_events", columns: ["person_id", "actor_person_id"], predicate: "EXISTS (SELECT 1 FROM person_events WHERE person_events.person_id = PERSON_ID OR person_events.actor_person_id = PERSON_ID)" },
  { label: "person_lists", table: "person_lists", columns: ["created_by"], predicate: "EXISTS (SELECT 1 FROM person_lists WHERE person_lists.created_by = PERSON_ID)" },
  { label: "person_list_members", table: "person_list_members", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM person_list_members WHERE person_list_members.person_id = PERSON_ID)" },
  // MRQ-208. An attendance row is a reference like any other: a person the
  // organizer imported as a ticket-holder must survive unlinking a claim, and a
  // person who attends two conferences must survive unlinking one of them.
  { label: "event_attendances", table: "event_attendances", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM event_attendances WHERE event_attendances.person_id = PERSON_ID)" },
  // And the claim itself carries a real foreign key to people. Leaving it out
  // made unlinking one of two codes claimed by the same address throw on the
  // person delete — after the other two deletes had already landed.
  { label: "schedule_claims", table: "schedule_claims", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM schedule_claims WHERE schedule_claims.person_id = PERSON_ID)" },
  { label: "sponsorship_contacts", table: "sponsorship_contacts", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM sponsorship_contacts WHERE sponsorship_contacts.person_id = PERSON_ID)" },
  { label: "mirror_credentials", table: "mirror_credentials", columns: ["set_by_person_id"], predicate: "EXISTS (SELECT 1 FROM mirror_credentials WHERE mirror_credentials.set_by_person_id = PERSON_ID)" },
  { label: "person_aliases", table: "person_aliases", columns: ["person_id"], predicate: "EXISTS (SELECT 1 FROM person_aliases WHERE person_aliases.person_id = PERSON_ID)" },
] as const;

export const PERSON_NO_FK_REFERENCES = [
  { label: "forms.admin_notify_person_ids", table: "forms", column: "admin_notify_person_ids" },
  { label: "attachments.person_headshot", table: "attachments", column: "owner_id" },
  { label: "import_rows.target_id", table: "import_rows", column: "target_id" },
  { label: "mirror_outbox.people.row_id", table: "mirror_outbox", column: "row_id" },
  { label: "audit_log.person.entity_id", table: "audit_log", column: "entity_id" },
] as const;

const PERSON_NO_FK_PREDICATES = [
  {
    label: "forms.admin_notify_person_ids",
    predicate: "EXISTS (SELECT 1 FROM forms WHERE json_valid(forms.admin_notify_person_ids) AND EXISTS (SELECT 1 FROM json_each(forms.admin_notify_person_ids) WHERE json_each.value = PERSON_ID))",
  },
  {
    label: "attachments.person_headshot",
    predicate: "EXISTS (SELECT 1 FROM attachments WHERE attachments.owner_type = 'person_headshot' AND attachments.owner_id = PERSON_ID) OR EXISTS (SELECT 1 FROM people other JOIN people target_person ON target_person.id = PERSON_ID WHERE other.id <> target_person.id AND target_person.headshot_attachment_id IS NOT NULL AND other.headshot_attachment_id = target_person.headshot_attachment_id)",
  },
  {
    label: "import_rows.target_id",
    predicate: "EXISTS (SELECT 1 FROM import_rows JOIN imports ON imports.id = import_rows.import_id JOIN events ON events.id = imports.event_id WHERE import_rows.target_id = PERSON_ID AND import_rows.entity IN ('person', 'speaker') AND events.org_id = (SELECT target_person.org_id FROM people target_person WHERE target_person.id = PERSON_ID))",
  },
  {
    label: "mirror_outbox.people.row_id",
    predicate: "EXISTS (SELECT 1 FROM mirror_outbox WHERE mirror_outbox.table_name IN ('people', 'person') AND mirror_outbox.row_id = PERSON_ID)",
  },
  {
    label: "audit_log.person.entity_id",
    predicate: "EXISTS (SELECT 1 FROM audit_log WHERE audit_log.entity_type = 'person' AND audit_log.entity_id = PERSON_ID)",
  },
] as const;

export const PERSON_HISTORICAL_IDENTIFIERS = [
  "calendar_cancellations.person_id",
  "person_merges.retired_person_id",
  "person_merges.survivor_person_id",
] as const;

export type PersonForeignKey = { table_name: string; child_column: string; parent_table: string };

/**
 * Schema parity guard used by migration/unit checks.  It intentionally accepts
 * pragma-shaped rows rather than a D1 handle so a future migration can fail
 * with the exact missing table/column instead of silently growing a second
 * hand-maintained merge inventory.
 */
export function missingPersonReferenceForeignKeys(rows: readonly PersonForeignKey[]): string[] {
  const actual = new Set(
    rows
      .filter((row) => row.parent_table === "people")
      .map((row) => `${row.table_name}.${row.child_column}`),
  );
  return PERSON_REFERENCE_CHECKS.flatMap(({ table, columns }) =>
    columns.filter((column) => !actual.has(`${table}.${column}`)).map((column) => `${table}.${column}`),
  );
}

export function personReferenceInventory(): string[] {
  return PERSON_REFERENCE_CHECKS.flatMap(({ table, columns }) => columns.map((column) => `${table}.${column}`));
}

export function personReferencePredicates(personExpression: string): string[] {
  return PERSON_REFERENCE_CHECKS.map(({ predicate }) => predicate.replaceAll("PERSON_ID", personExpression));
}

export function personReferenceSelect(): string {
  return [
    ...PERSON_REFERENCE_CHECKS,
    ...PERSON_NO_FK_PREDICATES,
  ].map(({ label, predicate }) =>
    `${predicate.replaceAll("PERSON_ID", "target.id")} AS "${label}"`).join(",\n       ");
}

export function noPersonReferencesPredicate(): string {
  return [
    ...personReferencePredicates("people.id"),
    ...PERSON_NO_FK_PREDICATES.map(({ predicate }) => predicate.replaceAll("PERSON_ID", "people.id")),
  ].map((predicate) => `NOT (${predicate})`).join(" AND ");
}

/** Which tables still point at this person; empty means nothing does. */
export async function personReferences(db: D1Database, personId: string): Promise<string[]> {
  const references = await db.prepare(
    `WITH target AS (SELECT ? AS id)
     SELECT ${personReferenceSelect()}
     FROM target`,
  ).bind(personId).first<Record<string, number>>();
  if (!references) return [];
  return [...PERSON_REFERENCE_CHECKS, ...PERSON_NO_FK_PREDICATES]
    .filter(({ label }) => Number(references[label]) > 0)
    .map(({ label }) => label);
}
