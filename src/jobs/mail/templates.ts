import type { D1Database } from "@cloudflare/workers-types";

import type { EmailTemplateRow, Id } from "../../db/schema";
import { renderMail, type MergeData, type RenderedMail } from "./render";

export const TRIGGER_TEMPLATE_KEYS = [
  "submission_confirmation",
  "form_closing_reminder",
  "added_to_submission",
  "acceptance",
  "rejection",
  "task_assigned",
  "task_overdue",
] as const;

export const SUPPORT_TEMPLATE_KEYS = ["reminder_generic", "custom"] as const;
export const AUTH_TEMPLATE_KEYS = ["magic_link_login", "draft_resume", "task_link"] as const;
export const MAIL_TEMPLATE_KEYS = [
  ...TRIGGER_TEMPLATE_KEYS,
  ...SUPPORT_TEMPLATE_KEYS,
  ...AUTH_TEMPLATE_KEYS,
] as const;

export type MailTemplateKey = (typeof MAIL_TEMPLATE_KEYS)[number];

interface DefaultTemplate {
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
  added_to_submission: {
    name: "Added to a submission",
    subject: "You were added to {{submission.title}}",
    body_md: "Hi {{speaker.first_name}},\n\nYou were added to **{{submission.title}}**.",
  },
  acceptance: {
    name: "Acceptance",
    subject: "Your session was accepted",
    body_md: "Hi {{speaker.first_name}},\n\n**{{submission.title}}** was accepted.",
  },
  rejection: {
    name: "Rejection",
    subject: "An update about {{submission.title}}",
    body_md: "Hi {{speaker.first_name}},\n\nThank you for sharing **{{submission.title}}**.",
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
  magic_link_login: {
    name: "Magic link sign-in",
    subject: "Your Marquee sign-in link",
    body_md: "Sign in to Marquee: {{auth.link}}\n\nThis link works once and expires in 15 minutes.",
  },
  draft_resume: {
    name: "Resume your draft",
    subject: "Continue your Marquee submission",
    body_md: "Resume your draft here: {{auth.link}}",
  },
  task_link: {
    name: "Speaker task link",
    subject: "Your Marquee task link",
    body_md: "Complete your task here: {{auth.link}}",
  },
};

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

  const fallback = DEFAULT_TEMPLATES[key as MailTemplateKey] ?? DEFAULT_TEMPLATES.custom;
  return {
    id: `default_${key}`,
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
