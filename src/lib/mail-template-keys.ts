/**
 * Automated communication keys have one shared authority for the API,
 * scheduler, and organizer UI. Keep this module dependency-free so the UI
 * does not import the worker-side template implementation.
 */
export const TRIGGER_TEMPLATE_KEYS = [
  "submission_confirmation",
  "form_closing_reminder",
  "draft_close_reminder",
  "added_to_submission",
  "acceptance",
  "rejection",
  "task_assigned",
  "task_overdue",
] as const;

export type TriggerTemplateKey = (typeof TRIGGER_TEMPLATE_KEYS)[number];
