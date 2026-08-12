/**
 * The three decisions behind the sign-in door, tested as the arithmetic they
 * are. Each one fails silently in production: a reviewer landed on an organizer
 * dashboard, an open redirect wearing a `?next=`, or a sign-in mail filed
 * against a conference the person has nothing to do with.
 */
import { describe, expect, test } from "vitest";

import {
  pickOutboxEventId,
  roleHome,
  rolesOf,
  safeNext,
  signinRedirect,
} from "../../src/lib/auth/signin-destination";

describe("the seat's home", () => {
  test("CONTRACT · program staff land on the dashboard, whatever else they hold", () => {
    expect(roleHome(["owner"])).toBe("/dashboard");
    expect(roleHome(["program_lead"])).toBe("/dashboard");
    expect(roleHome(["ops"])).toBe("/dashboard");
    // The seeded program staffer holds `reviewer` alongside `owner`; staff wins.
    expect(roleHome(["reviewer", "owner"])).toBe("/dashboard");
  });

  test("CONTRACT · a reviewer lands on the review queue, not the organizer shell", () => {
    expect(roleHome(["reviewer"])).toBe("/reviewer");
    expect(roleHome(["speaker", "reviewer"])).toBe("/reviewer");
  });

  test("CONTRACT · everyone else lands on the portal, including a person with no membership", () => {
    expect(roleHome(["speaker"])).toBe("/portal");
    expect(roleHome([])).toBe("/portal");
  });

  test("CONTRACT · rolesOf reads the role column off membership rows", () => {
    expect(rolesOf([{ role: "owner" }, { role: "reviewer" }])).toEqual(["owner", "reviewer"]);
  });
});

describe("the ?next= target", () => {
  test("CONTRACT · a same-origin path survives", () => {
    expect(safeNext("/portal")).toBe("/portal");
    expect(safeNext("/submissions?status=in_review")).toBe("/submissions?status=in_review");
  });

  test("CONTRACT · nothing that can leave this origin survives", () => {
    for (const hostile of [
      "//evil.com",
      "http://evil.com",
      "https://evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "evil.com",
      "",
    ]) {
      expect(safeNext(hostile)).toBeNull();
    }
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });

  test("CONTRACT · a rejected next falls back to the seat's home rather than to nowhere", () => {
    expect(signinRedirect("//evil.com", ["reviewer"])).toBe("/reviewer");
    expect(signinRedirect("/portal", ["owner"])).toBe("/portal");
    expect(signinRedirect(undefined, ["owner"])).toBe("/dashboard");
  });
});

describe("outbox attribution", () => {
  const orgEvents = [
    { id: "evt_old", created_at: 100 },
    { id: "evt_new", created_at: 300 },
  ];

  test("CONTRACT · the person's most recent membership event wins", () => {
    const memberships = [
      { event_id: "evt_old", created_at: 100 },
      { event_id: "evt_mid", created_at: 200 },
    ];
    expect(pickOutboxEventId(memberships, orgEvents)).toBe("evt_mid");
  });

  test("CONTRACT · org-wide memberships carry no event and never win", () => {
    const memberships = [
      { event_id: null, created_at: 900 },
      { event_id: "evt_old", created_at: 100 },
    ];
    expect(pickOutboxEventId(memberships, orgEvents)).toBe("evt_old");
  });

  test("CONTRACT · with no event membership, the org's newest event is the fallback", () => {
    expect(pickOutboxEventId([{ event_id: null, created_at: 900 }], orgEvents)).toBe("evt_new");
    expect(pickOutboxEventId([], orgEvents)).toBe("evt_new");
  });

  test("CONTRACT · an org with no event at all has no answer, and must not be given one", () => {
    expect(pickOutboxEventId([], [])).toBeNull();
    expect(pickOutboxEventId([{ event_id: null, created_at: 1 }], [])).toBeNull();
  });

  test("CONTRACT · the pick does not mutate the caller's rows", () => {
    const memberships = [
      { event_id: "evt_a", created_at: 1 },
      { event_id: "evt_b", created_at: 2 },
    ];
    pickOutboxEventId(memberships, orgEvents);
    expect(memberships.map((row) => row.event_id)).toEqual(["evt_a", "evt_b"]);
  });
});
