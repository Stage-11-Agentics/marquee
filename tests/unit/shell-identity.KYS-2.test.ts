/**
 * KYS-2. Found in judge-path QA: after entering a demo persona the admin shell
 * showed no indication of who you were — the avatar was the literal string
 * "MC" for everyone, the account menu answered "not installed", and there was
 * no sign-out on the organizer side at all while the speaker portal had one.
 *
 * The behaviour half of this lives in tests/integration/auth-demo.test.ts
 * (identity comes back from /auth/me; logout really ends the session). What is
 * asserted here is the shell's side: the formatting rules, and the wiring that
 * would silently regress to a hardcoded placeholder again.
 */
import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { initialsFor, primaryRole, roleLabel } from "../../src/ui/shell/identity-format";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const topbar = read("src/ui/shell/Topbar.tsx");
const appShell = read("src/ui/shell/AppShell.tsx");
const healthShell = read("src/ui/health/DeliveryHealthShell.tsx");
const identity = read("src/ui/shell/identity.tsx");
const components = read("src/styles/components.css");

test("CONTRACT · initials survive real-ugly names and are always one or two characters", () => {
  expect(initialsFor("Demo Organizer")).toBe("DO");
  expect(initialsFor("Prince")).toBe("P");
  // Long diacritic names are the house rule for test data, not an edge case.
  expect(initialsFor("Ada Ångström-Eklöf")).toBe("AÅ");
  expect(initialsFor("  padded   name  ")).toBe("PN");
  // Middle names must not widen the box.
  expect(initialsFor("Jean Luc Picard")).toBe("JP");
  for (const name of ["", "   ", "Prince", "Ada Ångström-Eklöf", "🙂 Emoji Person"]) {
    expect([...initialsFor(name)].length).toBeLessThanOrEqual(2);
  }
});

test("CONTRACT · roles read in the organizer's vocabulary, never the schema's", () => {
  expect(roleLabel("owner")).toBe("Organizer");
  expect(roleLabel("speaker")).toBe("Speaker");
  expect(roleLabel("program_lead")).toBe("Program lead");
  // An unknown role is still rendered as something a human can read.
  expect(roleLabel("track_chair")).toBe("Track chair");
  expect(roleLabel(undefined)).toBe("Signed in");
  expect(roleLabel(null)).toBe("Signed in");
});

test("CONTRACT · the shell reads its identity from the session, not from a placeholder", () => {
  // The original defect: a literal that rendered the same two letters for
  // every person who ever signed in.
  expect(appShell).not.toMatch(/userInitials/);
  expect(healthShell).not.toMatch(/userInitials/);
  expect(topbar).not.toMatch(/userInitials/);
  expect(identity).toContain("/api/v1/auth/me");
  // Both shells that render the Flight Deck chrome carry the same identity.
  expect(appShell).toMatch(/useIdentity\(\)/);
  expect(healthShell).toMatch(/useIdentity\(\)/);
});

test("CONTRACT · there is a sign-out on the organizer side and it calls logout", () => {
  expect(identity).toContain("/api/v1/auth/logout");
  expect(identity).toMatch(/Sign out/);
  expect(identity).toMatch(/method: "POST"/);
  // A menu that leaves the cookie alive is worse than no menu.
  expect(identity).toMatch(/window\.location\.assign\("\/"\)/);
  expect(topbar).toMatch(/AccountMenu/);
});

test("CONTRACT · the identity slot reserves its space so the topbar never jumps", () => {
  // Elements never jump (DESIGN.md): the slot renders before the read lands,
  // holding its width with an em dash rather than appearing late.
  expect(topbar).toMatch(/identity\?\.name \?\? "—"/);
  expect(topbar).toMatch(/identity\?\.role \?\? "—"/);
  expect(topbar).toMatch(/identity\?\.initials \?\? "—"/);
  expect(components).toMatch(/\.top-identity\s*\{[^}]*flex:\s*0 0 168px/);
  expect(components).toMatch(/\.top-identity\s*\{[^}]*width:\s*168px/);
  // A long name truncates inside the reserved box instead of widening it.
  expect(components).toMatch(/\.top-identity strong\s*\{[^}]*text-overflow: ellipsis/);
});

test("CONTRACT · the way out stays reachable at the narrow breakpoint", () => {
  // The name and role fold away with the breadcrumbs; the avatar must not,
  // because it is the only door out of a session.
  expect(components).toMatch(/@media \(max-width: 1220px\) \{ \.top-identity \{ display: none; \} \}/);
  // The avatar is never hidden at any width, in any rule.
  expect(components).not.toMatch(/\.top-user \{ display: none; \}/);
  expect(components).not.toMatch(/\.top-user,[^{]*\{[^}]*display: none/);
  // And the search control truncates rather than wrapping out of a 52px bar
  // when the identity slot takes its 168px.
  expect(components).toMatch(/\.global-search button\s*\{[^}]*white-space: nowrap/);
  expect(components).toMatch(/\.global-search button\s*\{[^}]*text-overflow: ellipsis/);
});

test("CONTRACT · the widest standing wins, not whichever membership sorted first", () => {
  // The seeded program committee really does hold four memberships, and the
  // API makes no ordering promise. Labelling an owner "Reviewer" because that
  // row came back first would be worse than showing nothing at all.
  expect(primaryRole([{ role: "reviewer" }, { role: "owner" }])).toBe("owner");
  expect(primaryRole([{ role: "reviewer" }, { role: "program_lead" }])).toBe("program_lead");
  expect(primaryRole([{ role: "speaker" }])).toBe("speaker");
  // An unrecognised role never outranks a known one, but is still returned
  // when it is all the person has.
  expect(primaryRole([{ role: "track_chair" }, { role: "reviewer" }])).toBe("reviewer");
  expect(primaryRole([{ role: "track_chair" }])).toBe("track_chair");
  expect(primaryRole([])).toBeUndefined();
  expect(primaryRole(undefined)).toBeUndefined();
  expect(roleLabel(primaryRole([{ role: "reviewer" }, { role: "owner" }]))).toBe("Organizer");
});
