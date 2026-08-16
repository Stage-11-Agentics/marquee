/**
 * The merge-field vocabulary shared by the composer, validator, and renderer.
 *
 * Keep this list deliberately broader than the fields that are populated for
 * every recipient. A known field with no value is still rendered literally so
 * the operator can see the missing context; only a field name that can never
 * resolve is rejected before a bulk send.
 */
export const MERGE_FIELDS = [
  "speaker.first_name",
  "speaker.name",
  "speaker.email",
  "event.name",
  "reviewer.first_name",
  "submission.title",
  "session.title",
  "session.room",
  "session.building",
  "session.address",
  "session.accessNote",
  "session.leaveBy",
  "session.time",
  "round.name",
  "review.outstanding",
  "room.name",
  "task.title",
  "task.due_date",
  "form.closes_at",
  "auth.link",
  "portal.link",
  "draft.resume_link",
  "draft.missing_fields",
  "decision.feedback",
  "decision.resulting_status",
  "decision.recommendation",
  "message.body",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

/**
 * Organizer-authored communications have no decision or credential context.
 * Auth and portal links are minted by private flows, while decision facts are
 * supplied only by the decision writer, so keep those fields out of both the
 * generic palette and its send validator.
 */
export const COMMUNICATION_MERGE_FIELDS = MERGE_FIELDS.filter(
  (field): field is Exclude<
    MergeField,
    | "auth.link"
    | "portal.link"
    | "draft.resume_link"
    | "decision.feedback"
    | "decision.resulting_status"
    | "decision.recommendation"
    | "event.name"
  > => ![
    "auth.link",
    "portal.link",
    "draft.resume_link",
    "decision.feedback",
    "decision.resulting_status",
    "decision.recommendation",
    "event.name",
  ].includes(field),
);

/** The one token grammar used by both extraction and rendering. */
export const MERGE_TOKEN_PATTERN = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g;

const MERGE_FIELD_SET = new Set<string>(MERGE_FIELDS);
const COMMUNICATION_MERGE_FIELD_SET = new Set<string>(COMMUNICATION_MERGE_FIELDS);

/** Return each token key once, in the order it first appears. */
export function mergeFieldsIn(...sources: Array<string | null | undefined>): string[] {
  const fields: string[] = [];
  for (const source of sources) {
    if (source === null || source === undefined) continue;
    source.replace(MERGE_TOKEN_PATTERN, (_match, key: string) => {
      if (!fields.includes(key)) fields.push(key);
      return _match;
    });
  }
  return fields;
}

export function unknownMergeFields(...sources: Array<string | null | undefined>): string[] {
  return mergeFieldsIn(...sources).filter((field) => !MERGE_FIELD_SET.has(field));
}

export function unknownMergeFieldsForCommunication(...sources: Array<string | null | undefined>): string[] {
  return mergeFieldsIn(...sources).filter((field) => !COMMUNICATION_MERGE_FIELD_SET.has(field));
}

/**
 * The draft-close editor is a keyed automated context, not the general
 * composer. Its private resume capability may be authored only while editing
 * that one trigger; the palette and every other communication key retain the
 * ordinary credential-free validator.
 */
export function unknownMergeFieldsForCommunicationTemplate(
  templateKey: string | undefined,
  ...sources: Array<string | null | undefined>
): string[] {
  const unknown = unknownMergeFieldsForCommunication(...sources);
  if (templateKey === "draft_close_reminder") {
    return unknown.filter((field) => field !== "draft.resume_link");
  }
  if (templateKey === "acceptance" || templateKey === "rejection") {
    return unknown.filter((field) => ![
      "portal.link",
      "decision.feedback",
      "decision.resulting_status",
      "decision.recommendation",
      "event.name",
    ].includes(field));
  }
  return unknown;
}

export function mergeFieldErrorMessage(fields: readonly string[]): string {
  const tokens = fields.map((field) => `{{${field}}}`);
  return `${tokens.join(", ")} ${tokens.length === 1 ? "is not a merge field" : "are not merge fields"}. Available fields are listed under MERGE FIELDS.`;
}

export class UnknownMergeFieldsError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(mergeFieldErrorMessage(fields));
    this.name = "UnknownMergeFieldsError";
    this.fields = [...fields];
  }
}

export function assertKnownMergeFields(...sources: Array<string | null | undefined>): void {
  const unknown = unknownMergeFields(...sources);
  if (unknown.length > 0) throw new UnknownMergeFieldsError(unknown);
}
