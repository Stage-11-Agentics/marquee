import { describe, expect, test } from "vitest";

import { buildIdempotencyKey } from "../../src/jobs/mail/outbox";
import { IDEMPOTENCY_REGISTRY } from "../../src/jobs/mail/idempotency";

/**
 * These are the pre-registry entity-id expressions whose grains remain
 * unchanged after the pure refactor and the corrected Bug A finding. Keeping
 * the old strings beside the named builders makes the registry auditable:
 * every resulting key is byte-for-byte identical for an unchanged grain.
 */
const inventory = [
  { name: "trigger", template: "submission_confirmation", person: "person-1", before: "submission-1", actual: IDEMPOTENCY_REGISTRY.trigger("submission-1") },
  { name: "decision", template: "acceptance", person: "person-1", before: "submission-1", actual: IDEMPOTENCY_REGISTRY.decision("submission-1") },
  { name: "decision retry", template: "rejection", person: "person-1", before: "decision-1", actual: IDEMPOTENCY_REGISTRY.decisionRetry("decision-1") },
  { name: "pre-close reminder", template: "form_closing_reminder", person: "person-1", before: "form-1", actual: IDEMPOTENCY_REGISTRY.preCloseReminder("form-1") },
  { name: "overdue reminder", template: "task_overdue", person: "person-1", before: "task-1", actual: IDEMPOTENCY_REGISTRY.overdueTaskReminder("task-1") },
  { name: "co-speaker invitation", template: "added_to_submission", person: "person-1", before: "participation-1", actual: IDEMPOTENCY_REGISTRY.coSpeakerInvitation("participation-1") },
  { name: "form confirmation", template: "submission_confirmation", person: "person-1", before: "submission-1", actual: IDEMPOTENCY_REGISTRY.formConfirmation("submission-1") },
  { name: "draft resume", template: "draft_resume", person: "person-1", before: "submission-1", actual: IDEMPOTENCY_REGISTRY.draftResume("submission-1") },
  { name: "admin notification", template: "custom", person: "admin-1", before: "submission-1:admin:admin-1", actual: IDEMPOTENCY_REGISTRY.adminNotification("submission-1", "admin-1") },
  { name: "attendee claim", template: "attendee_schedule_claim", person: null, before: "attendee_schedule_claim:ABC123:1720000000000", actual: IDEMPOTENCY_REGISTRY.attendeeClaim("ABC123", 1720000000000) },
  { name: "reviewer reminder", template: "reviewer_reminder", person: "person-1", before: "round-1:person-1:2026-08-15", actual: IDEMPOTENCY_REGISTRY.reviewerReminder("round-1", "person-1", "2026-08-15") },
  { name: "calendar request", template: "calendar_request", person: "person-1", before: "submission-1:person-1:2:REQUEST", actual: IDEMPOTENCY_REGISTRY.calendar("submission-1", "person-1", 2, "REQUEST") },
  { name: "calendar cancel", template: "calendar_cancel", person: "person-1", before: "submission-1:person-1:3:CANCEL", actual: IDEMPOTENCY_REGISTRY.calendar("submission-1", "person-1", 3, "CANCEL") },
  { name: "auth link", template: "magic_link_login", person: "person-1", before: "link-1", actual: IDEMPOTENCY_REGISTRY.authLink("link-1") },
  { name: "auth attempt", template: "task_link", person: "person-1", before: "task_link:person-1:1720000000000", actual: IDEMPOTENCY_REGISTRY.authAttempt("task_link", "person-1", 1720000000000) },
  { name: "custom recipient", template: "custom", person: "person-1", before: "submission-1", actual: IDEMPOTENCY_REGISTRY.customRecipient("submission-1") },
] as const;

describe("outbox idempotency registry", () => {
  test("CONTRACT · MRQ-226 · pure refactor preserves every inventoried entity id and hash byte", async () => {
    for (const entry of inventory) {
      expect(entry.actual, entry.name).toBe(entry.before);
      const beforeKey = await buildIdempotencyKey(entry.template, entry.before, entry.person);
      const afterKey = await buildIdempotencyKey(entry.template, entry.actual, entry.person);
      expect(afterKey, entry.name).toBe(beforeKey);
    }
  });

  test("CONTRACT · MRQ-226 · registry is frozen so a call site cannot replace a business grain", () => {
    expect(Object.isFrozen(IDEMPOTENCY_REGISTRY)).toBe(true);
  });

  test("CONTRACT · MRQ-226 · draft-resume grain preserves the submission audit join", () => {
    expect(IDEMPOTENCY_REGISTRY.draftResume("submission-1")).toBe("submission-1");
  });

  test("CONTRACT · MRQ-226 · Bug B custom-send seeds separate composes without changing the row entity", () => {
    expect(IDEMPOTENCY_REGISTRY.customSend("compose-1", "submission-1")).toBe("custom:compose-1:submission-1");
    expect(IDEMPOTENCY_REGISTRY.customSend("compose-2", "submission-1")).not.toBe(
      IDEMPOTENCY_REGISTRY.customSend("compose-1", "submission-1"),
    );
    expect(IDEMPOTENCY_REGISTRY.customRecipient("submission-1")).toBe("submission-1");
  });

  test("MRQ-228 · calendar retries use the UID revision slot for both methods", () => {
    expect(IDEMPOTENCY_REGISTRY.calendarRequest("uid-1", 4)).toBe("uid-1:4");
    expect(IDEMPOTENCY_REGISTRY.calendarCancellation("uid-1", 4)).toBe("uid-1:4");
    expect(IDEMPOTENCY_REGISTRY.calendarCancellation("uid-1", 5)).not.toBe(
      IDEMPOTENCY_REGISTRY.calendarCancellation("uid-1", 4),
    );
  });
});
