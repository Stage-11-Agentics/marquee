import type { FormFieldType } from "../db/schema";

export const PUBLIC_FORM_STATES = [
  "open",
  "closed",
  "at_limit",
  "resumed",
  "submitted",
] as const;

export type PublicFormStateName = (typeof PUBLIC_FORM_STATES)[number];

export const PUBLIC_FORM_OUTCOMES = ["accepted", "waitlisted", "rejected"] as const;

export type PublicFormOutcome = (typeof PUBLIC_FORM_OUTCOMES)[number];

export interface PublicFormField {
  id: string;
  key: string;
  label: string;
  help_text: string | null;
  type: FormFieldType;
  required: boolean;
  position: number;
  config: Record<string, unknown>;
  condition: unknown;
}

export interface PublicFormFile {
  attachment_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: "pending" | "ready";
}

export interface PublicFormConfirmation {
  title: string;
  message: string;
  email: string;
  /**
   * The address a confirmation email was actually enqueued to, or null when
   * none was. An organizer can disable the confirmation template, so the page
   * may only promise a receipt when one exists.
   */
  receipt_email: string | null;
  /** Whether that confirmation has left the outbox, which decides the tense. */
  receipt_sent: boolean;
  resume_url: string | null;
  portal_url: string | null;
}

/**
 * The roles a public submitter may name someone in.
 *
 * A panel is a moderator plus co-speakers rather than a role of its own, so
 * this list is deliberately short: an applicant naming a "chairperson" would be
 * claiming a program decision the conference has not made, and `speaker` is the
 * primary card rather than a slot anyone adds.
 */
export const PUBLIC_PARTICIPANT_ROLES = ["co_speaker", "moderator"] as const;

export type PublicParticipantRole = (typeof PUBLIC_PARTICIPANT_ROLES)[number];

/** One additional person a submitter named, as the form holds them. */
export interface PublicFormParticipant {
  name: string;
  email: string;
  role: PublicParticipantRole;
}

/**
 * "I'm submitting on behalf of someone else": the submitter's own identity,
 * kept apart from the speaker's. Null means the two are the same person, which
 * is the ordinary case and is exactly what shipped before.
 */
export interface PublicFormOnBehalfOf {
  name: string;
  email: string;
}

export interface PublicFormState {
  conference: {
    name: string;
    slug: string;
    timezone: string;
  };
  form: {
    id: string;
    name: string;
    slug: string;
    kind: "abstract" | "session";
    status: "open" | "closed";
    welcome_md: string;
    closes_at: number | null;
    per_submitter_limit: number;
    min_speakers: number;
    max_speakers: number;
    max_sponsors: number;
  };
  state: PublicFormStateName;
  outcome: PublicFormOutcome | null;
  fields: PublicFormField[];
  answers: Record<string, unknown>;
  files: PublicFormFile[];
  draft_id: string | null;
  resume_token: string | null;
  resume_url: string | null;
  last_saved_at: number | null;
  submitted_at: number | null;
  submission_editable: boolean;
  submission_edit_reason: string | null;
  turnstile_site_key: string | null;
  confirmation: PublicFormConfirmation | null;
  message: string | null;
  /** Everyone beyond the primary speaker, in the order the submitter added them. */
  participants: PublicFormParticipant[];
  on_behalf_of: PublicFormOnBehalfOf | null;
}
