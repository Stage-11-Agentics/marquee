import { describe, expect, test } from "vitest";

import {
  DAILY_SEND_LIMIT,
  QUEUE_PATIENCE_MS,
  deriveDeliveryHealth,
  deriveOwed,
  deriveQuota,
  readInfrastructure,
  type DeliveryHealthFacts,
  type InfrastructureFacts,
  type OwedFact,
} from "../../src/lib/delivery-health";

const NOW = Date.parse("2026-08-11T18:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;

function owedFact(overrides: Partial<OwedFact> = {}): OwedFact {
  return {
    submission_id: "sub-1",
    submission_title: "Agents in production",
    person_name: "Ada Lovelace",
    decided_at: NOW - 3 * DAY,
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
    forms: [{ id: "form-1", name: "Call for speakers", status: "open", opens_at: NOW - 10 * DAY, closes_at: NOW + 5 * DAY }],
    outbox: { queued: 0, sent: 40, suppressed: 0, failed: 0, stuck_queued: 0, sent_last_7_days: 40, last_sent_at: NOW - HOUR },
    quota: { sent_today: 10, waiting: 0 },
    owed: [],
    owed_total: 0,
    calendar: { invites_total: 12, invites_unsent: 0, invite_sends_failed: 0 },
    uploads: { files_held: 30 },
    mirror: { configured: false, pending: 0, stuck: 0, last_sync_at: null, has_error: false },
    webhooks: { endpoints: 0, failed: 0, retrying: 0 },
    ...overrides,
  };
}

const UNREPORTED: InfrastructureFacts = readInfrastructure(null);

function everyString(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) everyString(item, into);
  else if (value !== null && typeof value === "object") for (const item of Object.values(value)) everyString(item, into);
  return into;
}

describe("MRQ-74 · who is owed a message", () => {
  test("CONTRACT · a decision with no message at all is the catastrophic case and reads as one", () => {
    const [row] = deriveOwed([owedFact()], { now: NOW, demoMode: false });
    expect(row.state).toBe("never_prepared");
    expect(row.level).toBe("alarm");
    expect(row.reason).toBe("The decision is recorded but no message was ever written.");
    expect(row.what_to_do).toContain("this speaker does not know yet");
    expect(row.href).toBe("/submissions/sub-1");
    expect(row.waiting_days).toBe(3);
  });

  test("CONTRACT · a bounced message outranks every other reading of the same row", () => {
    const [row] = deriveOwed(
      [owedFact({ outbox_status: "failed", has_error: true, has_valid_address: false, changed_elsewhere: true })],
      { now: NOW, demoMode: false },
    );
    expect(row.state).toBe("undelivered");
    expect(row.level).toBe("alarm");
  });

  test("CONTRACT · demo mode holding mail back is expected, so it stays green and says why", () => {
    const held = owedFact({ outbox_status: "suppressed", suppressed_reason: "demo_mode_not_allowlisted" });
    const [inDemo] = deriveOwed([held], { now: NOW, demoMode: true });
    expect(inDemo.state).toBe("held_back_demo");
    expect(inDemo.level).toBe("ok");
    expect(inDemo.what_to_do).toContain("Conference settings");

    const [live] = deriveOwed([held], { now: NOW, demoMode: false });
    expect(live.state).toBe("held_back");
    expect(live.level).toBe("alarm");
  });

  test("CONTRACT · a suppression reason we do not recognise never leaks its internal token", () => {
    const [row] = deriveOwed(
      [owedFact({ outbox_status: "suppressed", suppressed_reason: "provider_hard_bounce_5xx" })],
      { now: NOW, demoMode: true },
    );
    expect(row.reason).toBe("Held back before it left the building.");
    expect(everyString(row).join(" ")).not.toContain("provider_hard_bounce_5xx");
  });

  test("CONTRACT · a queued message is calm until it has waited longer than it should", () => {
    const fresh = owedFact({ outbox_status: "queued", outbox_created_at: NOW - 60_000 });
    expect(deriveOwed([fresh], { now: NOW, demoMode: false })[0].level).toBe("ok");

    const stale = owedFact({ outbox_status: "queued", outbox_created_at: NOW - QUEUE_PATIENCE_MS - 60_000 });
    const [row] = deriveOwed([stale], { now: NOW, demoMode: false });
    expect(row.state).toBe("waiting_too_long");
    expect(row.level).toBe("warn");
  });

  test("CONTRACT · a missing address is red because no amount of retrying will fix it", () => {
    const [row] = deriveOwed([owedFact({ has_valid_address: false })], { now: NOW, demoMode: false });
    expect(row.state).toBe("no_address");
    expect(row.level).toBe("alarm");
    expect(row.what_to_do).toContain("Add an address");
  });

  test("CONTRACT · an Airtable edit after the decision asks for a human look rather than a resend", () => {
    const [row] = deriveOwed([owedFact({ changed_elsewhere: true })], { now: NOW, demoMode: false });
    expect(row.state).toBe("changed_elsewhere");
    expect(row.level).toBe("warn");
  });

  test("CONTRACT · the ledger puts the worst first and the longest-waiting first within that", () => {
    const rows = deriveOwed([
      owedFact({ submission_id: "calm", outbox_status: "queued", outbox_created_at: NOW - 60_000, decided_at: NOW - 9 * DAY }),
      owedFact({ submission_id: "recent-bounce", outbox_status: "failed", has_error: true, decided_at: NOW - DAY }),
      owedFact({ submission_id: "old-bounce", outbox_status: "failed", has_error: true, decided_at: NOW - 8 * DAY }),
      owedFact({ submission_id: "airtable", changed_elsewhere: true, decided_at: NOW - 2 * DAY }),
    ], { now: NOW, demoMode: false });
    expect(rows.map((row) => row.submission_id)).toEqual(["old-bounce", "recent-bounce", "airtable", "calm"]);
  });

  test("CONTRACT · a handful of bounces is never buried under a thousand that were simply never sent", () => {
    const many = Array.from({ length: 600 }, (_, index) =>
      owedFact({ submission_id: `never-${index}`, decided_at: NOW - 30 * DAY }));
    const bounced = owedFact({ submission_id: "bounced", outbox_status: "failed", has_error: true, decided_at: NOW - DAY });
    const snapshot = deriveDeliveryHealth(facts({ owed: [...many, bounced], owed_total: 601 }), UNREPORTED);
    expect(snapshot.owed[0].submission_id).toBe("bounced");
    expect(snapshot.owed_reasons.map((reason) => [reason.state, reason.count])).toEqual([
      ["undelivered", 1],
      ["never_prepared", 600],
    ]);
  });
});

describe("MRQ-74 · the daily send allowance", () => {
  test("CONTRACT · a wave well inside the ceiling says how much room is left", () => {
    const quota = deriveQuota({ sent_today: 10, waiting: 5 });
    expect(quota.level).toBe("ok");
    expect(quota.remaining).toBe(DAILY_SEND_LIMIT - 10);
    expect(quota.detail).toContain("10 of 100 sent today · 90 left");
  });

  test("CONTRACT · approaching the ceiling is amber before anything has failed", () => {
    const quota = deriveQuota({ sent_today: 60, waiting: 25 });
    expect(quota.level).toBe("warn");
    expect(quota.remaining).toBe(40);
  });

  test("CONTRACT · a wave larger than the remaining allowance names the people who would not hear", () => {
    const quota = deriveQuota({ sent_today: 60, waiting: 140 });
    expect(quota.level).toBe("alarm");
    expect(quota.headline).toBe("100 speakers would not hear from you today.");
    expect(quota.detail).toContain("only 40 can go out");
  });

  test("CONTRACT · a spent allowance is red and says nothing more leaves today", () => {
    const quota = deriveQuota({ sent_today: DAILY_SEND_LIMIT, waiting: 3 });
    expect(quota.level).toBe("alarm");
    expect(quota.remaining).toBe(0);
    expect(quota.headline).toBe("Today's send allowance is used up.");
  });

  test("CONTRACT · the ceiling is readable rather than assumed, so a paid plan is not reported as a crisis", () => {
    const quota = deriveQuota({ sent_today: 400, waiting: 100 }, 50_000);
    expect(quota.level).toBe("ok");
  });
});

describe("MRQ-74 · capability verdicts", () => {
  test("CONTRACT · a healthy conference is green and the screen says so plainly", () => {
    const snapshot = deriveDeliveryHealth(facts(), UNREPORTED);
    expect(snapshot.summary.level).toBe("ok");
    expect(snapshot.summary.headline).toBe("Everyone who has been decided has been told.");
    expect(snapshot.capabilities).toHaveLength(8);
  });

  test("CONTRACT · the capability rows are the same eight, in the same order, whatever the state", () => {
    const healthy = deriveDeliveryHealth(facts(), UNREPORTED).capabilities.map((row) => row.id);
    const broken = deriveDeliveryHealth(
      facts({
        demo_mode: true,
        outbox: { queued: 4, sent: 2, suppressed: 30, failed: 9, stuck_queued: 4, sent_last_7_days: 2, last_sent_at: NOW - DAY },
        mirror: { configured: true, pending: 40, stuck: 12, last_sync_at: NOW - 4 * HOUR, has_error: true },
        webhooks: { endpoints: 2, failed: 3, retrying: 1 },
        calendar: { invites_total: 8, invites_unsent: 3, invite_sends_failed: 2 },
      }),
      readInfrastructure({ status: "degraded", checks: { d1: { ok: false }, r2: { ok: false } }, crons: [{ cron: "0 * * * *", last_success_at: NOW - 9 * HOUR }] }),
    ).capabilities.map((row) => row.id);
    expect(broken).toEqual(healthy);
    expect(healthy).toEqual(["storage", "submissions", "email", "calendar", "uploads", "mirror", "webhooks", "scheduled"]);
  });

  test("CONTRACT · undelivered mail is red and the summary names the people rather than the system", () => {
    const snapshot = deriveDeliveryHealth(
      facts({
        outbox: { queued: 0, sent: 30, suppressed: 0, failed: 2, stuck_queued: 0, sent_last_7_days: 30, last_sent_at: NOW - HOUR },
        owed: [owedFact({ submission_id: "a", outbox_status: "failed", has_error: true }), owedFact({ submission_id: "b", has_valid_address: false })],
        owed_total: 2,
      }),
      UNREPORTED,
    );
    expect(snapshot.summary.level).toBe("alarm");
    expect(snapshot.summary.headline).toBe("2 speakers have not heard from you.");
    expect(snapshot.owed).toHaveLength(2);
    expect(snapshot.owed_total).toBe(2);
    expect(snapshot.owed_urgent).toBe(2);
  });

  test("CONTRACT · the verdict counts everyone waiting, not only the rows the ledger carries", () => {
    const many = Array.from({ length: 120 }, (_, index) => owedFact({ submission_id: `sub-${index}` }));
    const snapshot = deriveDeliveryHealth(facts({ owed: many, owed_total: 120 }), UNREPORTED);
    // A capped page must never understate the number of people who were not told.
    expect(snapshot.owed).toHaveLength(50);
    expect(snapshot.owed_shown).toBe(50);
    expect(snapshot.owed_counted).toBe(120);
    expect(snapshot.owed_urgent).toBe(120);
    expect(snapshot.summary.headline).toBe("120 speakers have not heard from you.");
  });

  test("CONTRACT · demo mode alone never raises an alarm — a screen that cries wolf gets ignored", () => {
    const snapshot = deriveDeliveryHealth(
      facts({
        demo_mode: true,
        outbox: { queued: 0, sent: 0, suppressed: 120, failed: 0, stuck_queued: 0, sent_last_7_days: 0, last_sent_at: null },
        owed: [owedFact({ outbox_status: "suppressed", suppressed_reason: "demo_mode_not_allowlisted" })],
        owed_total: 1,
      }),
      UNREPORTED,
    );
    expect(snapshot.summary.level).toBe("ok");
    expect(snapshot.capabilities.find((row) => row.id === "email")?.level).toBe("ok");
  });

  test("CONTRACT · mail waiting too long is amber, not red — it may still be moving", () => {
    const snapshot = deriveDeliveryHealth(
      facts({ outbox: { queued: 6, sent: 20, suppressed: 0, failed: 0, stuck_queued: 6, sent_last_7_days: 20, last_sent_at: NOW - DAY } }),
      UNREPORTED,
    );
    expect(snapshot.capabilities.find((row) => row.id === "email")?.level).toBe("warn");
    expect(snapshot.summary.level).toBe("warn");
  });

  test("CONTRACT · a form left open past its closing date is caught before a speaker notices", () => {
    const snapshot = deriveDeliveryHealth(
      facts({ forms: [{ id: "form-1", name: "Call for speakers", status: "open", opens_at: NOW - 30 * DAY, closes_at: NOW - DAY }] }),
      UNREPORTED,
    );
    const submissions = snapshot.capabilities.find((row) => row.id === "submissions");
    expect(submissions?.level).toBe("warn");
    expect(submissions?.headline).toContain("past the closing date");
  });

  test("CONTRACT · an unconnected mirror is not a failure", () => {
    const snapshot = deriveDeliveryHealth(facts(), UNREPORTED);
    const mirror = snapshot.capabilities.find((row) => row.id === "mirror");
    expect(mirror?.level).toBe("ok");
    expect(mirror?.headline).toBe("Airtable is not connected.");
  });

  test("CONTRACT · a mirror that has stopped draining is red because the other room is looking at stale data", () => {
    const snapshot = deriveDeliveryHealth(
      facts({ mirror: { configured: true, pending: 30, stuck: 30, last_sync_at: NOW - 6 * HOUR, has_error: true } }),
      UNREPORTED,
    );
    expect(snapshot.capabilities.find((row) => row.id === "mirror")?.level).toBe("alarm");
  });
});

describe("MRQ-74 · scheduled jobs and the infrastructure report", () => {
  function scheduled(crons: unknown): { level: string; headline: string; detail: string } {
    const snapshot = deriveDeliveryHealth(facts(), readInfrastructure({ status: "ok", checks: { d1: "ok" }, crons }));
    const row = snapshot.capabilities.find((capability) => capability.id === "scheduled");
    return { level: row?.level ?? "", headline: row?.headline ?? "", detail: row?.detail ?? "" };
  }

  test("CONTRACT · an hourly job that ran within the hour is fine", () => {
    expect(scheduled([{ cron: "0 * * * *", last_success_at: NOW - 20 * 60_000 }]).level).toBe("ok");
  });

  test("CONTRACT · an hourly job two hours late is amber", () => {
    expect(scheduled([{ cron: "0 * * * *", last_success_at: NOW - 2 * HOUR }]).level).toBe("warn");
  });

  test("CONTRACT · an hourly job that has not run all day is red and says what stopped", () => {
    const row = scheduled([{ cron: "0 * * * *", last_success_at: NOW - 10 * HOUR }]);
    expect(row.level).toBe("alarm");
    expect(row.headline).toBe("Deadline reminders has not run in 10 hours.");
    expect(row.detail).toContain("reminder emails before your form closes");
  });

  test("CONTRACT · a job that has never checked in is unknown, not broken", () => {
    expect(scheduled([{ cron: "0 * * * *", last_success_at: null }]).level).toBe("unknown");
  });

  test("CONTRACT · no report at all leaves the platform rows honestly unknown rather than green", () => {
    const snapshot = deriveDeliveryHealth(facts(), UNREPORTED);
    expect(snapshot.infrastructure_reported).toBe(false);
    expect(snapshot.capabilities.find((row) => row.id === "scheduled")?.level).toBe("unknown");
    expect(snapshot.capabilities.find((row) => row.id === "storage")?.level).toBe("unknown");
  });

  test("CONTRACT · the report is read defensively across the shapes it plausibly takes", () => {
    expect(readInfrastructure({ status: "ok", checks: { d1: { ok: true }, r2: "degraded", kv: true, queues: { bound: false } } }).components)
      .toEqual({ storage: true, files: false, cache: true, queues: false });
    expect(readInfrastructure({ components: { database: { latency_ms: 4 }, media: { status: "healthy" } } }).components.storage).toBe(true);
    expect(readInfrastructure({ cron_heartbeats: [{ id: "0 * * * *", lastSuccessAt: NOW }] }).crons).toEqual([{ id: "0 * * * *", last_success_at: NOW }]);
    expect(readInfrastructure({ nothing: "recognised" }).components).toEqual({ storage: null, files: null, cache: null, queues: null });
    expect(readInfrastructure("not an object").reported).toBe(false);
  });

  test("CONTRACT · unreachable storage is the loudest thing on the screen", () => {
    const snapshot = deriveDeliveryHealth(facts(), readInfrastructure({ status: "degraded", checks: { d1: { ok: false } } }));
    expect(snapshot.summary.level).toBe("alarm");
    expect(snapshot.capabilities[0].id).toBe("storage");
    expect(snapshot.capabilities[0].level).toBe("alarm");
  });
});

describe("MRQ-74 · nothing technical reaches the organizer", () => {
  test("CONTRACT · no rendered string carries an internal token, a status code, or SQL", () => {
    const snapshot = deriveDeliveryHealth(
      facts({
        demo_mode: false,
        outbox: { queued: 3, sent: 12, suppressed: 5, failed: 7, stuck_queued: 3, sent_last_7_days: 12, last_sent_at: NOW - DAY },
        quota: { sent_today: 98, waiting: 60 },
        owed: [
          owedFact({ submission_id: "a", outbox_status: "failed", has_error: true }),
          owedFact({ submission_id: "b", outbox_status: "suppressed", suppressed_reason: "demo_mode_not_allowlisted" }),
          owedFact({ submission_id: "c", has_valid_address: false }),
          owedFact({ submission_id: "d", changed_elsewhere: true }),
        ],
        owed_total: 4,
        mirror: { configured: true, pending: 9, stuck: 4, last_sync_at: NOW - HOUR, has_error: true },
        webhooks: { endpoints: 1, failed: 2, retrying: 1 },
      }),
      readInfrastructure({ status: "degraded", checks: { d1: { ok: true }, r2: { ok: false } }, crons: [{ cron: "30 4 * * *", last_success_at: NOW - 5 * DAY }] }),
    );
    const prose = everyString({
      summary: snapshot.summary,
      capabilities: snapshot.capabilities.map((row) => ({ headline: row.headline, detail: row.detail })),
      quota: { headline: snapshot.quota.headline, detail: snapshot.quota.detail },
      owed: snapshot.owed.map((row) => ({ reason: row.reason, what_to_do: row.what_to_do })),
    }).join(" ");

    for (const forbidden of [
      "demo_mode_not_allowlisted",
      "suppressed_reason",
      "outbox",
      "D1",
      "R2",
      "KV",
      "SELECT",
      "cron",
      "null",
      "undefined",
      "NaN",
      "500",
      "429",
      "Error",
    ]) {
      expect(prose).not.toContain(forbidden);
    }
    expect(prose).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    expect(prose).not.toMatch(/\bstatus code\b|\bHTTP\b/i);
  });
});
