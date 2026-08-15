import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ROLE_HOME } from "../../src/lib/auth/role-home";
import { roleHome } from "../../src/lib/auth/signin-destination";

/**
 * A seat has one home, and every door reads it.
 *
 * The organizer once had two: `ROLE_HOME.staff` said `/dashboard` and the
 * landing page's demo buttons said `/submissions`, so the same person landed in
 * two different places depending on which door they used, and nothing failed.
 * That is the shape of the bug — not a wrong path, but a second opinion about
 * the path — so this is the shape of the guard.
 */

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const landing = source("../../src/routes/landing.route.tsx");

test("CONTRACT · the landing's demo doors derive their destination from ROLE_HOME", () => {
  // Literal seat paths in the doors are exactly how the two answers drifted
  // apart. The doors must interpolate, not restate.
  for (const [role] of [["organizer"], ["reviewer"], ["speaker"]] as const) {
    expect(landing, `the ${role} door must call demoDoor(), not hardcode a path`)
      .toContain(`href={demoDoor("${role}")} data-demo-role="${role}"`);
  }
  expect(landing).toContain("ROLE_HOME");
  for (const path of Object.values(ROLE_HOME)) {
    expect(landing, `${path} is spelled out in the landing rather than read from ROLE_HOME`)
      .not.toContain(`href="${path}`);
  }
});

test("CONTRACT · program staff land on the organization, and the seat table is the only definition", () => {
  expect(ROLE_HOME.staff).toBe("/org/home");
  expect(roleHome(["owner"])).toBe(ROLE_HOME.staff);
  expect(roleHome(["program_lead"])).toBe(ROLE_HOME.staff);
  expect(roleHome(["ops"])).toBe(ROLE_HOME.staff);
  // The other seats keep their own homes; staff moving must not move them.
  expect(roleHome(["reviewer"])).toBe(ROLE_HOME.reviewer);
  expect(roleHome(["speaker"])).toBe(ROLE_HOME.speaker);
  expect(roleHome([], { sponsorContact: true })).toBe(ROLE_HOME.sponsor);
});
