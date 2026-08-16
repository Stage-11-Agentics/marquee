import type { D1Database } from "@cloudflare/workers-types";

import type { EmailTemplateRow, Id } from "../../db/schema";
import { PUBLIC_DRAFT_RESUME_EMAIL_SUBJECT } from "../../lib/auth/draft-resume-copy";
import { TRIGGER_TEMPLATE_KEYS } from "../../lib/mail-template-keys";
import { renderMail, type MergeData, type RenderedMail } from "./render";

export { TRIGGER_TEMPLATE_KEYS } from "../../lib/mail-template-keys";

export const SUPPORT_TEMPLATE_KEYS = ["reminder_generic", "custom"] as const;
/** Reviewer reminders use a direct reviewer recipient, not the speaker audience engine. */
export const REVIEWER_TEMPLATE_KEYS = ["reviewer_reminder"] as const;
export const AUTH_TEMPLATE_KEYS = ["magic_link_login", "portal_invite", "draft_resume", "task_link"] as const;
export const MAIL_TEMPLATE_KEYS = [
  ...TRIGGER_TEMPLATE_KEYS,
  ...SUPPORT_TEMPLATE_KEYS,
  ...REVIEWER_TEMPLATE_KEYS,
  ...AUTH_TEMPLATE_KEYS,
] as const;

/** Templates that belong in the organizer's Communications surface. */
export const COMMUNICATION_TEMPLATE_KEYS = [
  ...TRIGGER_TEMPLATE_KEYS,
  ...SUPPORT_TEMPLATE_KEYS,
] as const;

export type MailTemplateKey = (typeof MAIL_TEMPLATE_KEYS)[number];

export interface DefaultTemplate {
  name: string;
  subject: string;
  body_md: string;
}
export const DEFAULT_TEMPLATES: Record<MailTemplateKey, DefaultTemplate> = {
  submission_confirmation: {
    name: "Submission confirmation",
    subject: "We received {{submission.title}}",
    body_md: "Hi {{speaker.first_name}},\n\nWe received **{{submission.title}}**.",
  },
  form_closing_reminder: {
    name: "Form closing reminder",
    subject: "The call for proposals closes soon",
    body_md: "Hi {{speaker.first_name}},\n\nThe form closes on {{form.closes_at}}.",
  },
  draft_close_reminder: {
    name: "Draft close reminder",
    subject: "Finish {{submission.title}} before the call closes",
    body_md: "Hi {{speaker.first_name}},\n\nYour draft **{{submission.title}}** is still open, but the call closes on {{form.closes_at}}.\n\nStill needed: {{draft.missing_fields}}\n\nResume your draft: {{draft.resume_link}}",
  },
  added_to_submission: {
    name: "Added to a submission",
    subject: "You were added to {{submission.title}}",
    body_md: "Hi {{speaker.first_name}},\n\nYou were added to **{{submission.title}}**.",
  },
  acceptance: {
    name: "Acceptance",
    subject: "Your session was accepted",
    body_md: "Hi {{speaker.first_name}},\n\n**{{submission.title}}** was accepted.\n\n{{decision.feedback}}",
  },
  rejection: {
    name: "Rejection",
    subject: "An update about {{submission.title}}",
    body_md: "Hi {{speaker.first_name}},\n\nThank you for sharing **{{submission.title}}**.\n\n{{decision.feedback}}",
  },
  task_assigned: {
    name: "Task assigned",
    subject: "A new speaker task: {{task.title}}",
    body_md: "Hi {{speaker.first_name}},\n\nPlease complete **{{task.title}}** by {{task.due_date}}.",
  },
  task_overdue: {
    name: "Task overdue",
    subject: "Reminder: {{task.title}} is overdue",
    body_md: "Hi {{speaker.first_name}},\n\n**{{task.title}}** was due on {{task.due_date}}.",
  },
  reminder_generic: {
    name: "Generic reminder",
    subject: "A quick Marquee reminder",
    body_md: "Hi {{speaker.first_name}},\n\nThis is a reminder about your conference tasks.",
  },
  custom: {
    name: "Custom message",
    subject: "A message from the conference team",
    body_md: "Hi {{speaker.first_name}},\n\n{{message.body}}",
  },
  reviewer_reminder: {
    name: "Reviewer reminder",
    subject: "Reminder: {{round.name}} has {{review.outstanding}} reviews waiting",
    body_md: "Hi {{reviewer.first_name}},\n\nYou have {{review.outstanding}} assigned review(s) waiting in the {{round.name}} round. Please open your reviewer queue when you have a moment.",
  },
  magic_link_login: {
    name: "Magic link sign-in",
    subject: "Your Marquee sign-in link",
    body_md: "Sign in to Marquee: {{auth.link}}\n\nThis link works once and expires in 15 minutes.",
  },
  portal_invite: {
    name: "Speaker portal invitation",
    subject: "Your Marquee speaker portal invitation",
    body_md: "Open your Marquee speaker portal: {{auth.link}}\n\nThis invitation is valid for 15 days and can be opened again during that window.",
  },
  draft_resume: {
    name: "Resume your draft",
    subject: PUBLIC_DRAFT_RESUME_EMAIL_SUBJECT,
    body_md: "Resume your draft here: {{auth.link}}",
  },
  task_link: {
    name: "Speaker task link",
    subject: "Your Marquee task link",
    body_md: "Complete your task here: {{auth.link}}",
  },
};

export type CommunicationTemplateKey = (typeof COMMUNICATION_TEMPLATE_KEYS)[number];

export function defaultTemplateId(eventId: Id, key: CommunicationTemplateKey): string {
  return `default_${eventId}_${key}`;
}

export function defaultTemplateRow(eventId: Id, key: CommunicationTemplateKey): EmailTemplateRow {
  const fallback = DEFAULT_TEMPLATES[key];
  return {
    id: defaultTemplateId(eventId, key),
    event_id: eventId,
    key,
    name: fallback.name,
    subject: fallback.subject,
    body_md: fallback.body_md,
    enabled: 1,
    created_at: 0,
    updated_at: 0,
  };
}

/** Event-scoped overrides win, while a fresh event still exposes every trigger toggle. */
export async function listCommunicationTemplates(
  db: D1Database,
  eventId: Id,
): Promise<EmailTemplateRow[]> {
  const rows = await db
    .prepare("SELECT * FROM email_templates WHERE event_id = ?")
    .bind(eventId)
    .all<EmailTemplateRow>();
  const stored = new Map(rows.results.map((row) => [row.key, row]));
  return COMMUNICATION_TEMPLATE_KEYS.map((key) => stored.get(key) ?? defaultTemplateRow(eventId, key));
}

export function defaultTemplateKeyFromId(eventId: Id, id: string): CommunicationTemplateKey | null {
  const prefix = `default_${eventId}_`;
  if (!id.startsWith(prefix)) return null;
  const key = id.slice(prefix.length);
  return (COMMUNICATION_TEMPLATE_KEYS as readonly string[]).includes(key)
    ? key as CommunicationTemplateKey
    : null;
}

export async function findTemplate(
  db: D1Database,
  eventId: Id,
  key: string,
): Promise<EmailTemplateRow> {
  const row = await db
    .prepare("SELECT * FROM email_templates WHERE event_id = ? AND key = ?")
    .bind(eventId, key)
    .first<EmailTemplateRow>();
  if (row) return row;

  const communicationKey = (COMMUNICATION_TEMPLATE_KEYS as readonly string[]).includes(key)
    ? key as CommunicationTemplateKey
    : null;
  if (communicationKey) return defaultTemplateRow(eventId, communicationKey);
  const fallback = DEFAULT_TEMPLATES[key as MailTemplateKey] ?? DEFAULT_TEMPLATES.custom;
  return {
    id: `default_${eventId}_${key}`,
    event_id: eventId,
    key,
    name: fallback.name,
    subject: fallback.subject,
    body_md: fallback.body_md,
    enabled: 1,
    created_at: 0,
    updated_at: 0,
  };
}

export async function renderStoredTemplate(
  db: D1Database,
  eventId: Id,
  key: string,
  data: MergeData,
): Promise<{ template: EmailTemplateRow; rendered: RenderedMail }> {
  const template = await findTemplate(db, eventId, key);
  return { template, rendered: renderMail(template, data) };
}
