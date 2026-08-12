import { describe, expect, test } from "vitest";

import {
  deriveDeliveryHealth,
  deriveQuota,
  readInfrastructure,
  summarizeSpeakerFollowups,
  summarizeSystemHealth,
  type DeliveryHealthFacts,
  type OwedFact,
} from "../../src/lib/delivery-health";

const NOW = Date.parse("2026-08-12T12:00:00.000Z");

function owed(overrides: Partial<OwedFact> = {}): OwedFact {
  return {
    submission_id: "sub-1",
    submission_title: "Agents in production",
    person_name: "Ada Lovelace",
    decided_at: NOW - 86_400_000,
    resulting_status: "accepted",
    outbox_status: null,
    outbox_created_at: null,
    suppressed_reason: null,
    has_error: false,
    has_valid_address: true,
    changed_elsewhere: false,
    ...overrides,
  };
}

function facts(overrides: Partial<DeliveryHealthFacts> = {}): DeliveryHealthFacts {
  return {
    now: NOW,
    event_id: "evt-1",
    demo_mode: false,
    forms: [],
    outbox: { queued: 1, sent: 12, suppressed: 0, failed: 1, stuck_queued: 0, sent_last_7_days: 12, last_sent_at: NOW - 60_000 },
    quota: { sent_today: 10, waiting: 1 },
    owed: [],
    owed_total: 0,
    calendar: { invites_total: 0, invites_unsent: 0, invite_sends_failed: 0 },
    uploads: { files_held: 0 },
    mirror: { configured: false, pending: 0, stuck: 0, last_sync_at: null, has_error: false },
    webhooks: { endpoints: 0, failed: 0, retrying: 0 },
    ...overrides,
  };
}

describe("MRQ-102 · split health summaries", () => {
  test("AC-2 · speaker follow-ups never headline a capability alarm", () => {
    const summary = summarizeSpeakerFollowups(4, 4, 0, deriveQuota({ sent_today: 10, waiting: 0 }));

    expect(summary).toMatchObject({ level: "alarm", headline: "4 speakers have not heard from you." });
    expect(summary.headline).not.toContain("storage");
    expect(summary.detail).toContain("follow-up list");
  });

  test("AC-3 · system health never receives owed-speaker facts", () => {
    const summary = summarizeSystemHealth([
      { id: "storage", label: "Your conference data", level: "alarm", headline: "The system cannot reach your conference data.", detail: "Screens will fail to load.", href: null },
      { id: "email", label: "Sending email", level: "ok", headline: "Email is reaching your speakers.", detail: "Nothing is waiting.", href: "/communications" },
    ]);

    expect(summary).toMatchObject({ level: "alarm", headline: "The system cannot reach your conference data." });
    expect(summary.headline).not.toContain("speaker");
  });

  test("AC-4 · the linked headline counts the same full gap as the owed destination", () => {
    const snapshot = deriveDeliveryHealth(
      facts({
        owed: [
          owed({ submission_id: "failed", outbox_status: "failed", has_error: true }),
          owed({ submission_id: "queued", outbox_status: "queued", outbox_created_at: NOW - 60_000 }),
        ],
        owed_total: 2,
      }),
      readInfrastructure(null),
    );

    expect(snapshot.summary.headline).toBe("2 speakers have not heard from you.");
    expect(snapshot.owed_href).toBe("/submissions?status=not_notified");
    expect(snapshot.owed).toHaveLength(2);
    expect(snapshot.owed_urgent).toBe(1);
  });

  test("AC-5 · every allowance verdict names the connected email configuration", () => {
    for (const quota of [
      deriveQuota({ sent_today: 10, waiting: 1 }),
      deriveQuota({ sent_today: 90, waiting: 5 }),
      deriveQuota({ sent_today: 100, waiting: 5 }),
    ]) {
      expect(quota.detail).toContain("connected email configuration");
      expect(quota.detail).toContain("production Resend key");
    }
  });

  test("CONTRACT · capability health remains the same fixed eight-row shape", () => {
    const snapshot = deriveDeliveryHealth(facts(), readInfrastructure(null));
    expect(snapshot.capabilities.map((capability) => capability.id)).toEqual([
      "storage", "submissions", "email", "calendar", "uploads", "mirror", "webhooks", "scheduled",
    ]);
  });
});
