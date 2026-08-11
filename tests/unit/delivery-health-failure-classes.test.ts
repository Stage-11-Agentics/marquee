import { describe, expect, test } from "vitest";

import {
  deriveOwed,
  owedVerdict,
  summarizeOwedReasons,
  type OwedFact,
} from "../../src/lib/delivery-health";

const NOW = Date.parse("2026-08-11T18:00:00.000Z");
const DAY = 86_400_000;

function failedFact(errorText: string | null, overrides: Partial<OwedFact> = {}): OwedFact {
  return {
    submission_id: "sub-1",
    submission_title: "Agents in production",
    person_name: "Ada Lovelace",
    decided_at: NOW - 3 * DAY,
    resulting_status: "accepted",
    outbox_status: "failed",
    outbox_created_at: NOW - 3 * DAY,
    suppressed_reason: null,
    has_error: errorText !== null,
    error_text: errorText,
    has_valid_address: true,
    changed_elsewhere: false,
    ...overrides,
  };
}

const options = { now: NOW, demoMode: false };

/**
 * The point of classifying is that two failures which used to read alike now
 * send the organizer to two different places. These tests are written against
 * that difference, not against the tokens underneath it.
 */
describe("a failed send is classified into an action", () => {
  test("a rejected address is that speaker's to fix", () => {
    const verdict = owedVerdict(failedFact("the address was rejected"), options);
    expect(verdict.state).toBe("undelivered");
    expect(verdict.level).toBe("alarm");
    expect(verdict.what_to_do).toMatch(/Correct the address on this speaker's record/);
  });

  test("a spent daily allowance is never filed under the speaker's name", () => {
    const verdict = owedVerdict(failedFact("You have reached your daily sending quota"), options);
    expect(verdict.state).toBe("send_blocked");
    expect(verdict.level).toBe("alarm");
    expect(verdict.what_to_do).toMatch(/^Nothing is wrong with this address\./);
    expect(verdict.what_to_do).not.toMatch(/Correct the address/);
  });

  test("a broken credential reads as the conference-wide stoppage it is", () => {
    const verdict = owedVerdict(failedFact("RESEND_API_KEY is not configured"), options);
    expect(verdict.state).toBe("send_blocked");
    expect(verdict.reason).toMatch(/mail account is not set up/);
  });

  test("an address the provider has suppressed asks for a different address, not a retry", () => {
    const verdict = owedVerdict(
      failedFact("Resend has suppressed sending to this address because it is on the account-level suppression list"),
      options,
    );
    expect(verdict.state).toBe("undelivered");
    expect(verdict.what_to_do).toMatch(/another one for this speaker/);
  });

  test("an unreadable failure stays an address-level unknown rather than guessing", () => {
    const verdict = owedVerdict(failedFact("wat"), options);
    expect(verdict.state).toBe("undelivered");
    expect(verdict.reason).toBe("The message did not go out.");
  });

  test("a fact carrying no error text at all still produces a usable row", () => {
    const verdict = owedVerdict(failedFact(null, { has_error: true }), options);
    expect(verdict.state).toBe("undelivered");
    expect(verdict.what_to_do.length).toBeGreaterThan(0);
  });

  test("no verdict claims the message came back, because nothing comes back to us", () => {
    for (const text of ["the address was rejected", "Too many requests", "wat"]) {
      expect(owedVerdict(failedFact(text), options).reason, text).not.toMatch(/came back/i);
    }
  });

  test("provider text never reaches the organizer", () => {
    const secret = "smtp 550 5.1.1 <ada@example.com> mailbox unavailable";
    const verdict = owedVerdict(failedFact(secret), options);
    expect(`${verdict.reason} ${verdict.what_to_do}`).not.toContain(secret);
    expect(`${verdict.reason} ${verdict.what_to_do}`).not.toMatch(/550|smtp/i);
  });
});

describe("the ledger keeps the two kinds apart", () => {
  const rows = [
    failedFact("You have reached your daily sending quota", { submission_id: "sub-quota-1" }),
    failedFact("You have reached your daily sending quota", { submission_id: "sub-quota-2" }),
    failedFact("the address was rejected", { submission_id: "sub-address" }),
  ];

  test("an address failure outranks a conference-wide one — it is the rarer, particular case", () => {
    const owed = deriveOwed(rows, options);
    expect(owed[0]?.submission_id).toBe("sub-address");
    expect(owed.map((row) => row.state)).toEqual(["undelivered", "send_blocked", "send_blocked"]);
  });

  test("the reason summary counts each distinct reason instead of collapsing a state", () => {
    const summary = summarizeOwedReasons(deriveOwed(rows, options));
    expect(summary).toHaveLength(2);
    expect(summary.map((entry) => entry.count)).toEqual([1, 2]);
    expect(summary[0]?.state).toBe("undelivered");
    expect(summary[1]?.count).toBe(2);
  });

  test("two distinct reasons inside one state are reported separately", () => {
    const mixed = deriveOwed([
      failedFact("the address was rejected", { submission_id: "sub-a" }),
      failedFact("on the account-level suppression list", { submission_id: "sub-b" }),
    ], options);
    const summary = summarizeOwedReasons(mixed);
    expect(summary).toHaveLength(2);
    expect(new Set(summary.map((entry) => entry.state))).toEqual(new Set(["undelivered"]));
    expect(new Set(summary.map((entry) => entry.reason)).size).toBe(2);
  });

  test("the summary order is stable across two reads of the same facts", () => {
    const once = summarizeOwedReasons(deriveOwed(rows, options));
    const twice = summarizeOwedReasons(deriveOwed([...rows].reverse(), options));
    expect(once.map((entry) => entry.reason)).toEqual(twice.map((entry) => entry.reason));
  });
});
