import type { FormFieldType } from "../db/schema";

export const PUBLIC_FORM_STATES = [
  "open",
  "closed",
  "at_limit",
  "resumed",
  "submitted",
] as const;

export type PublicFormStateName = (typeof PUBLIC_FORM_STATES)[number];

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
  resume_url: string | null;
  portal_url: string | null;
}

export interface PublicFormState {
  conference: {
    name: string;
    slug: string;
  };
  form: {
    id: string;
    name: string;
    slug: string;
    kind: "abstract" | "session";
    welcome_md: string;
    closes_at: number | null;
    per_submitter_limit: number;
    min_speakers: number;
    max_speakers: number;
    max_sponsors: number;
  };
  state: PublicFormStateName;
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
}
