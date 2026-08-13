import { describe, expect, test } from "vitest";

import {
  deriveDeliveryHealth,
  owedVerdict,
  readInfrastructure,
  type DeliveryHealthFacts,
  type OwedFact,
} from "../../src/lib/delivery-health";

const NOW = Date.parse("2026-08-12T12:00:00.000Z");

function owed(overrides: Partial<OwedFact> = {}): OwedFact {
  return {
    submission_id: "sub-mrq79",
    submission_title: "A talk",
    person_name: "Ada Lovelace",
    decided_at: NOW - 86_400_000,
    resulting_status: "accepted",
    outbox_status: "sent",
    outbox_created_at: NOW - 86_400_000,
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
    event_id: "evt-mrq79",
    demo_mode: false,
    forms: [],
    outbox: { queued: 0, sent: 1, suppressed: 0, failed: 0, stuck_queued: 0, sent_last_7_days: 1, last_sent_at: NOW },
    quota: { sent_today: 1, waiting: 0 },
    owed: [],
    owed_total: 0,
    calendar: { invites_total: 0, invites_unsent: 0, invite_sends_failed: 0 },
    uploads: { files_held: 0 },
    mirror: { configured: false, pending: 0, stuck: 0, last_sync_at: null, has_error: false },
    webhooks: { endpoints: 0, failed: 0, retrying: 0 },
    ...overrides,
  };
}

const UNREPORTED = readInfrastructure(null);

describe("MRQ-79 · delivery truth on the health surface", () => {
  test("CONTRACT · a hard bounce is an actionable undelivered alarm", () => {
    const verdict = owedVerdict(owed({ delivery_state: "bounced_hard" }), { now: NOW, demoMode: false });

    expect(verdict).toEqual({
      state: "undelivered",
      level: "alarm",
      reason: "The mail service rejected this message after it was sent.",
      what_to_do: "Correct the address on this speaker's record, then send the decision again.",
    });
  });

  test("CONTRACT · a soft bounce is calm and explicitly says the service is still trying", () => {
    const verdict = owedVerdict(owed({ delivery_state: "bounced_soft" }), { now: NOW, demoMode: false });

    expect(verdict.state).toBe("delivery_retrying");
    expect(verdict.level).toBe("warn");
    expect(verdict.what_to_do).toBe("Nothing to do yet — we will tell you if it stops.");
  });

  test("CONTRACT · a provider complaint is an undelivered alarm without exposing provider vocabulary", () => {
    const verdict = owedVerdict(owed({ delivery_state: "complained" }), { now: NOW, demoMode: false });

    expect(verdict.state).toBe("undelivered");
    expect(verdict.level).toBe("alarm");
    expect(verdict.reason).toContain("unwanted");
    expect(JSON.stringify(verdict)).not.toMatch(/complain|spam|webhook/i);
  });

  test("CONTRACT · an accepted send without a provider signal stays unknown, never green", () => {
    const snapshot = deriveDeliveryHealth(facts({
      webhooks: {
        endpoints: 0,
        failed: 0,
        retrying: 0,
        delivery: { delivered: 0, bounced_hard: 0, bounced_soft: 0, complained: 0, unknown: 1 },
      },
    }), UNREPORTED);
    const email = snapshot.capabilities.find((capability) => capability.id === "email");

    expect(email?.level).toBe("unknown");
    expect(email?.headline).toBe("Your mail provider does not report delivery.");
    expect(snapshot.summary.level).toBe("unknown");
    expect(snapshot.summary.headline).toBe("Your mail provider does not report delivery.");
  });

  test("CONTRACT · a received provider signal keeps the capability green while a later hard bounce raises it", () => {
    const delivered = deriveDeliveryHealth(facts({
      webhooks: {
        endpoints: 0,
        failed: 0,
        retrying: 0,
        delivery: { delivered: 1, bounced_hard: 0, bounced_soft: 0, complained: 0, unknown: 0 },
      },
    }), UNREPORTED);
    expect(delivered.capabilities.find((capability) => capability.id === "email")?.level).toBe("ok");

    const hardBounce = deriveDeliveryHealth(facts({
      owed: [owed({ delivery_state: "bounced_hard" })],
      owed_total: 1,
      webhooks: {
        endpoints: 0,
        failed: 0,
        retrying: 0,
        delivery: { delivered: 0, bounced_hard: 1, bounced_soft: 0, complained: 0, unknown: 0 },
      },
    }), UNREPORTED);
    expect(hardBounce.capabilities.find((capability) => capability.id === "email")?.level).toBe("alarm");
    expect(hardBounce.summary.level).toBe("alarm");
  });
});
