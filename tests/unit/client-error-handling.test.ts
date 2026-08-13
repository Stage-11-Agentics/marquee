/**
 * The browser's failure path, tested as the arithmetic it is.
 *
 * Two things here would be very expensive to get wrong and are invisible until
 * they are: the taxonomy (a code with no sentence renders a raw status to an
 * organizer) and the throttle (an unthrottled beacon on a five-second poll is
 * a self-inflicted denial of service).
 */
import { describe, expect, test, vi } from "vitest";

import { ERROR_STATUS_CODES } from "../../src/api/errors";
import {
  API_ERROR_CODES,
  apiFetch,
  backoffDelayMs,
  ERROR_TREATMENTS,
  MarqueeApiError,
  describeError,
  errorSummary,
  fieldError,
  onUnauthenticated,
  referenceCode,
} from "../../src/ui/shell/api-client";
import {
  createReporter,
  errorSignature,
  rateVital,
  routeTemplate,
  type TelemetryReport,
} from "../../src/ui/shell/error-reporting";

describe("the error taxonomy", () => {
  test("CONTRACT · the client's code list has not drifted from the server envelope", () => {
    expect([...API_ERROR_CODES].sort()).toEqual(Object.keys(ERROR_STATUS_CODES).sort());
  });

  test("CONTRACT · every code an operator can be shown has a plain sentence and a recovery", () => {
    for (const code of Object.keys(ERROR_TREATMENTS)) {
      const treatment = ERROR_TREATMENTS[code as keyof typeof ERROR_TREATMENTS];
      expect(treatment.sentence.length).toBeGreaterThan(10);
      expect(treatment.recovery.length).toBeGreaterThan(10);
      // No status codes, no jargon. "429" is not a sentence.
      expect(`${treatment.sentence} ${treatment.recovery}`).not.toMatch(/\b[45]\d\d\b/);
    }
  });

  test("CONTRACT · rate limiting reads as pace, not as a number", () => {
    expect(ERROR_TREATMENTS.rate_limited.sentence).toContain("faster than the system allows");
  });

  test("CONTRACT · offline and server failure are different sentences", () => {
    expect(ERROR_TREATMENTS.offline.sentence).not.toBe(ERROR_TREATMENTS.internal_error.sentence);
    expect(ERROR_TREATMENTS.offline.sentence).toContain("connection");
  });
});

describe("the reference code", () => {
  test("CONTRACT · it is a greppable prefix of the correlation id, not a hash of it", () => {
    const requestId = "8f2a4c90-5f0b-4b1e-9d2a-9b1d2f0a1c2d";
    expect(referenceCode(requestId)).toBe("8f2a4c");
    expect(requestId.replaceAll("-", "")).toContain(referenceCode(requestId));
  });

  test("CONTRACT · a request that never reached the server says so instead of inventing one", () => {
    expect(referenceCode(undefined)).toBe("none");
    expect(describeError(new MarqueeApiError({ code: "offline", message: "x", status: 0, route: "/" })).reference)
      .toBe("none");
  });

  test("CONTRACT · an unknown throw still lands on a sentence rather than a stack", () => {
    const described = describeError(new Error("Cannot read properties of undefined"));
    expect(described.sentence).not.toContain("undefined");
    expect(described.retryable).toBe(false);
  });

  test("CONTRACT · MRQ-127 field detail maps to the named control and an unmapped field stays available globally", () => {
    const direct = new MarqueeApiError({
      code: "unprocessable",
      message: "Choose a format from this conference's settings.",
      status: 422,
      field: "format_id",
      route: "/api/v1/events/{eventId}/submissions",
    });
    expect(fieldError(direct, ["format_id"])).toBe("Choose a format from this conference's settings.");
    expect(fieldError(direct, ["track_ids"])).toBeUndefined();

    const details = new MarqueeApiError({
      code: "malformed_request",
      message: "The submission has invalid values.",
      status: 422,
      details: { issues: [{ fieldKey: "submitter.email", message: "Enter a reachable email address." }] },
      route: "/api/v1/events/{eventId}/submissions",
    });
    expect(fieldError(details, ["submitter.email"])).toBe("Enter a reachable email address.");
    expect(details.message).toBe("The submission has invalid values.");
  });
});

describe("backoff with jitter", () => {
  test("CONTRACT · a healthy poll keeps its interval exactly", () => {
    expect(backoffDelayMs(0, 5_000)).toBe(5_000);
  });

  test("CONTRACT · failures back off, and never below the healthy interval", () => {
    for (const failures of [1, 2, 3, 5, 12]) {
      for (const random of [0, 0.5, 1]) {
        const delay = backoffDelayMs(failures, 5_000, { random: () => random });
        expect(delay).toBeGreaterThanOrEqual(5_000);
        expect(delay).toBeLessThanOrEqual(60_000);
      }
    }
  });

  test("CONTRACT · the cap holds however long the outage lasts", () => {
    expect(backoffDelayMs(50, 5_000, { random: () => 1 })).toBe(60_000);
  });

  test("CONTRACT · jitter actually spreads: two tabs failing together do not retry together", () => {
    const low = backoffDelayMs(4, 5_000, { random: () => 0.01 });
    const high = backoffDelayMs(4, 5_000, { random: () => 0.99 });
    expect(high - low).toBeGreaterThan(10_000);
  });
});

describe("the beacon throttle", () => {
  function harness(startAt = 1_000_000) {
    const sent: TelemetryReport[] = [];
    let clock = startAt;
    const reporter = createReporter({
      send: (report) => sent.push(report),
      build: "abc123",
      session: "sess1",
      currentRoute: () => "/dashboard",
      now: () => clock,
    });
    return { sent, reporter, advance: (ms: number) => { clock += ms; } };
  }

  test("CONTRACT · the same failure on a five-second poll is reported once, not every tick", () => {
    const { sent, reporter, advance } = harness();
    const failure = new Error("dashboard refresh failed");
    for (let tick = 0; tick < 60; tick += 1) {
      reporter.report("error", failure);
      advance(5_000);
    }
    // Five minutes of a broken dashboard, not 60 requests at the wounded origin.
    expect(sent.length).toBeLessThanOrEqual(3);
    expect(reporter.sentCount()).toBe(sent.length);
  });

  test("CONTRACT · a repeat report carries how many were collapsed into it", () => {
    const { sent, reporter, advance } = harness();
    const failure = new Error("same failure");
    reporter.report("error", failure);
    expect(sent[0]).toMatchObject({ occurrences: 1 });
    for (let index = 0; index < 5; index += 1) reporter.report("error", failure);
    advance(200_000);
    reporter.report("error", failure);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ occurrences: 6 });
  });

  test("CONTRACT · distinct failures are still spaced, so a burst is not a burst of requests", () => {
    const { sent, reporter } = harness();
    for (let index = 0; index < 10; index += 1) reporter.report("error", new Error(`failure ${index}`));
    expect(sent).toHaveLength(1);
  });

  test("CONTRACT · the per-session cap is a stop, not a slowdown", () => {
    const { sent, reporter, advance } = harness();
    for (let index = 0; index < 200; index += 1) {
      reporter.report("error", new Error(`distinct failure ${index}`));
      advance(60_000);
    }
    expect(sent).toHaveLength(20);
  });

  test("CONTRACT · switching telemetry off sends nothing at all", () => {
    const sent: TelemetryReport[] = [];
    const reporter = createReporter({
      send: (report) => sent.push(report),
      build: "abc123",
      session: "sess1",
      currentRoute: () => "/dashboard",
      enabled: () => false,
    });
    reporter.report("error", new Error("boom"));
    reporter.vital("LCP", 1_200, "good");
    expect(sent).toHaveLength(0);
    // Recent events are still kept locally for the diagnostic report; they
    // just never leave the browser.
    expect(reporter.recentEvents()).toHaveLength(1);
  });

  test("CONTRACT · two failures with the same message but different frames are different failures", () => {
    expect(errorSignature("boom", "    at renderWaves (a.ts:1:1)")).not.toBe(
      errorSignature("boom", "    at renderTasks (b.ts:1:1)"),
    );
  });
});

describe("MRQ-169 · a refusal the server wrote for this case", () => {
  test("CONTRACT · a 422 with an authored message keeps that sentence, plus the reference", async () => {
    const requestId = "3c9d1b70-1111-2222-3333-444455556666";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "unprocessable",
        field: "reviewer_person_id",
        message: "Sam Whitfield reviews Evals and Infra; this abstract carries RAG/Retrieval. Widen their responsibilities or pick another reviewer.",
      },
      request_id: requestId,
    }), { status: 422, headers: { "content-type": "application/json" } })));
    try {
      const failure = await apiFetch("/api/v1/events/evt/rounds/rnd/assignments", {
        method: "POST",
        route: "/api/v1/events/{eventId}/rounds/{roundId}/assignments",
      }).catch((error: unknown) => error) as MarqueeApiError;
      expect(describeError(failure).sentence).toContain("Sam Whitfield reviews Evals and Infra");
      expect(describeError(failure).sentence).not.toContain("state it cannot be in");
      expect(errorSummary(failure)).toContain("ref 3c9d1b");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("CONTRACT · a refusal with no message of its own still lands on the taxonomy sentence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "unprocessable" } }), {
      status: 422,
      headers: { "content-type": "application/json" },
    })));
    try {
      const failure = await apiFetch("/api/v1/events/evt/rounds/rnd/assignments", {
        method: "POST",
        route: "/api/v1/events/{eventId}/rounds/{roundId}/assignments",
      }).catch((error: unknown) => error) as MarqueeApiError;
      expect(describeError(failure).sentence).toBe("That change would leave the program in a state it cannot be in.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("CONTRACT · codes whose taxonomy sentence is the better answer keep it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { code: "forbidden", message: "evaluation management requires program access for this conference" },
    }), { status: 403, headers: { "content-type": "application/json" } })));
    try {
      const failure = await apiFetch("/api/v1/events/evt/plans", { route: "/api/v1/events/{eventId}/plans" })
        .catch((error: unknown) => error) as MarqueeApiError;
      expect(describeError(failure).sentence).toBe("Your account does not have access to this.");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("route templates leaving the browser", () => {
  test("CONTRACT · opaque record ids collapse and free text never appears", () => {
    expect(routeTemplate("/submissions/sub_01JQZ8XK2M3N4P5Q6R7S8T")).toBe("/submissions/{id}");
    expect(routeTemplate("/dashboard")).toBe("/dashboard");
    expect(routeTemplate("/")).toBe("/");
  });
});

describe("shared fetch client", () => {
  test("CONTRACT · an API envelope keeps its reference details and route template", async () => {
    const requestId = "8f2a4c90-5f0b-4b1e-9d2a-9b1d2f0a1c2d";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { code: "unprocessable", message: "Add the requested details", details: { issues: [{ fieldKey: "title", message: "Title is required" }] } },
      request_id: requestId,
    }), { status: 422, headers: { "content-type": "application/json" } })));
    try {
      const failure = await apiFetch("/api/v1/events/evt_test/submissions/sub_test", {
        method: "POST",
        route: "/api/v1/events/{eventId}/submissions/{submissionId}",
      }).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: "unprocessable",
        requestId,
        details: { issues: [{ fieldKey: "title", message: "Title is required" }] },
        route: "/api/v1/events/{eventId}/submissions/{submissionId}",
      });
      expect((failure as MarqueeApiError).reference).toBe("8f2a4c");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("CONTRACT · a successful empty mutation response resolves without parsing JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(apiFetch<undefined>("/api/v1/events/evt_test/agenda/items/item_test", {
        method: "DELETE",
        route: "/api/v1/events/{eventId}/agenda/items/{itemId}",
      })).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * The wall's trigger. Getting this wrong is invisible in either direction: a
 * listener that never fires leaves an operator clicking a dead screen, and one
 * that fires on `forbidden` raises "your session ended" at somebody whose
 * session is perfectly alive and merely lacks a permission.
 */
describe("the session-ended signal", () => {
  async function failWith(code: string, status: number): Promise<void> {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { code, message: "no" } }),
      { status, headers: { "content-type": "application/json" } },
    )));
    try {
      await apiFetch("/api/v1/auth/me", { route: "/api/v1/auth/me" }).catch(() => undefined);
    } finally {
      vi.unstubAllGlobals();
    }
  }

  test("CONTRACT · it fires on unauthenticated and not on forbidden", async () => {
    const fired = vi.fn();
    const unsubscribe = onUnauthenticated(fired);
    try {
      await failWith("forbidden", 403);
      expect(fired).not.toHaveBeenCalled();
      await failWith("unauthenticated", 401);
      expect(fired).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  test("CONTRACT · unsubscribing actually detaches the listener", async () => {
    const fired = vi.fn();
    onUnauthenticated(fired)();
    await failWith("unauthenticated", 401);
    expect(fired).not.toHaveBeenCalled();
  });

  test("CONTRACT · a 401 stays a thrown error for the caller that asked", async () => {
    const unsubscribe = onUnauthenticated(() => undefined);
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(
        JSON.stringify({ error: { code: "unauthenticated", message: "no" } }),
        { status: 401, headers: { "content-type": "application/json" } },
      )));
      const failure = await apiFetch("/api/v1/auth/me", { route: "/api/v1/auth/me" })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(MarqueeApiError);
      expect((failure as MarqueeApiError).code).toBe("unauthenticated");
    } finally {
      vi.unstubAllGlobals();
      unsubscribe();
    }
  });
});

describe("web vitals", () => {
  test("CONTRACT · thresholds are the published ones", () => {
    expect(rateVital("LCP", 2_000)).toBe("good");
    expect(rateVital("LCP", 3_000)).toBe("needs-improvement");
    expect(rateVital("LCP", 5_000)).toBe("poor");
    expect(rateVital("INP", 150)).toBe("good");
    expect(rateVital("INP", 900)).toBe("poor");
  });
});
