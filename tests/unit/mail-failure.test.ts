import { describe, expect, test } from "vitest";

import { classifySendFailure, sendFailure } from "../../src/lib/mail-failure";

/**
 * The classifier's whole job is to route an organizer to the right action, so
 * these tests assert the *scope* and the sentence rather than the class token —
 * the token is internal, the sentence is the product.
 */
describe("send-failure classification", () => {
  describe("the messages this codebase writes itself", () => {
    test("a missing credential is a conference problem, not a speaker's", () => {
      const failure = classifySendFailure("RESEND_API_KEY is not configured");
      expect(failure.class).toBe("not_configured");
      expect(failure.scope).toBe("conference");
      expect(failure.what_to_do).toMatch(/^Nothing is wrong with this address\./);
    });

    test("an unavailable provider is a conference problem", () => {
      expect(classifySendFailure("mail provider is unavailable").scope).toBe("conference");
      expect(classifySendFailure("mail provider returned no message id").class).toBe("provider_unavailable");
    });

    test("the bare `mail provider returned <status>` form is classified by its status", () => {
      expect(classifySendFailure("mail provider returned 401").class).toBe("not_configured");
      expect(classifySendFailure("mail provider returned 403").class).toBe("not_configured");
      expect(classifySendFailure("mail provider returned 429").class).toBe("quota_exhausted");
      expect(classifySendFailure("mail provider returned 422").class).toBe("address_rejected");
      expect(classifySendFailure("mail provider returned 500").class).toBe("provider_unavailable");
      expect(classifySendFailure("mail provider returned 503").class).toBe("provider_unavailable");
    });
  });

  describe("the provider's own prose", () => {
    test("a spent allowance never sends the organizer to check an address", () => {
      for (const text of [
        "You have reached your daily sending quota",
        "Too many requests",
        "Rate limit exceeded",
      ]) {
        const failure = classifySendFailure(text);
        expect(failure.class, text).toBe("quota_exhausted");
        expect(failure.scope, text).toBe("conference");
        expect(failure.reason, text).not.toMatch(/address/i);
      }
    });

    test("a suppressed address is named as a prior bounce, and asks for a different address", () => {
      const failure = classifySendFailure(
        "Resend has suppressed sending to this address because it is on the account-level suppression list",
      );
      expect(failure.class).toBe("address_suppressed");
      expect(failure.scope).toBe("address");
      expect(failure.reason).toMatch(/bounced before/);
      expect(failure.what_to_do).toMatch(/another one for this speaker/);
    });

    test("a rejected address reads the same whichever way the sentence runs", () => {
      for (const text of [
        "Invalid `to` field. The email address needs to follow the `email@example.com` format.",
        "the address was rejected",
        "Invalid email address",
        "recipient refused",
      ]) {
        expect(classifySendFailure(text).class, text).toBe("address_rejected");
        expect(classifySendFailure(text).scope, text).toBe("address");
      }
    });

    test("an unreachable provider is transient and says so", () => {
      for (const text of ["Network connection lost", "request timed out", "Bad Gateway"]) {
        expect(classifySendFailure(text).class, text).toBe("provider_unavailable");
      }
      expect(classifySendFailure("Network connection lost").what_to_do).toMatch(/again shortly/);
    });
  });

  describe("honesty about what it cannot read", () => {
    test("unrecognised text is unknown rather than forced into the nearest bucket", () => {
      for (const text of ["", "   ", null, undefined, "something nobody has seen before"]) {
        expect(classifySendFailure(text).class, String(text)).toBe("unknown");
      }
    });

    test("an unknown failure still gives the organizer a next move and an escape hatch", () => {
      const failure = classifySendFailure("something nobody has seen before");
      expect(failure.what_to_do).toMatch(/send the decision again/);
      expect(failure.what_to_do).toMatch(/whoever hosts this conference/);
    });

    test("no sentence anywhere claims a message was delivered, or echoes provider text", () => {
      const classes = [
        "quota_exhausted", "not_configured", "provider_unavailable",
        "address_rejected", "address_suppressed", "unknown",
      ] as const;
      for (const name of classes) {
        const failure = sendFailure(name);
        expect(failure.reason, name).not.toMatch(/deliver(ed|y)/i);
        // No status codes, no API vocabulary, no internal tokens on screen.
        expect(`${failure.reason} ${failure.what_to_do}`, name).not.toMatch(/\b\d{3}\b|API|Resend|_/);
      }
    });

    test("every conference-scope failure opens by clearing the speaker's address", () => {
      for (const name of ["quota_exhausted", "not_configured", "provider_unavailable"] as const) {
        expect(sendFailure(name).what_to_do, name).toMatch(/^Nothing is wrong with this address\./);
      }
    });
  });

  test("classification is stable — the same text always lands the same way", () => {
    const text = "You have reached your daily sending quota";
    expect(classifySendFailure(text)).toEqual(classifySendFailure(text));
  });
});
