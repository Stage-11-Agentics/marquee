import { expect, test } from "vitest";

import { rollupSpeakerStatus } from "../../src/routes/speakers.queries";

/**
 * The roster badge is derived, never stored, so its precedence is the whole
 * contract. This is the rule that stops the roster and the session chips from
 * becoming two screens that disagree about the same speaker.
 */

const membership = (status: "pending" | "confirmed" | "declined", invitedAt: number | null = null) => ({
  confirmation_status: status,
  confirmed_at: null,
  invited_at: invitedAt,
});

test("CONTRACT · MRQ-111 · SPK-04 · one decline is the headline, however many roles are confirmed", () => {
  expect(rollupSpeakerStatus(
    [
      { confirmation_status: "confirmed", invited_at: 1 },
      { confirmation_status: "declined", invited_at: 1 },
    ],
    membership("confirmed"),
  )).toBe("declined");
});

test("CONTRACT · MRQ-111 · SPK-04 · every role confirmed is Confirmed; one outstanding is not", () => {
  expect(rollupSpeakerStatus(
    [{ confirmation_status: "confirmed", invited_at: 1 }, { confirmation_status: "confirmed", invited_at: 1 }],
    null,
  )).toBe("confirmed");
  expect(rollupSpeakerStatus(
    [{ confirmation_status: "confirmed", invited_at: 1 }, { confirmation_status: "pending", invited_at: 1 }],
    null,
  )).toBe("invited");
});

test("CONTRACT · MRQ-111 · SPK-04 · Invited is Pending plus a real invitation, not a fourth stored value", () => {
  expect(rollupSpeakerStatus([{ confirmation_status: "pending", invited_at: null }], null)).toBe("pending");
  expect(rollupSpeakerStatus([{ confirmation_status: "pending", invited_at: 1 }], null)).toBe("invited");
});

test("CONTRACT · MRQ-111 · SPK-04 · sessions outrank the membership row whenever any exist", () => {
  // The organizer marked the conference-level status Confirmed, then the
  // speaker declined their only session in the portal. The session is the
  // newer, more specific fact and the badge must say so.
  expect(rollupSpeakerStatus([{ confirmation_status: "declined", invited_at: 1 }], membership("confirmed"))).toBe("declined");
});

test("CONTRACT · MRQ-111 · SPK-04 · a speaker with no sessions falls through to the membership row", () => {
  expect(rollupSpeakerStatus([], membership("confirmed"))).toBe("confirmed");
  expect(rollupSpeakerStatus([], membership("pending", 42))).toBe("invited");
  expect(rollupSpeakerStatus([], membership("pending"))).toBe("pending");
  expect(rollupSpeakerStatus([], null)).toBe("pending");
});
