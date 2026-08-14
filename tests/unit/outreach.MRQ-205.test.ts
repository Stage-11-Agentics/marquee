import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

import { isOutreachOverdue } from "../../src/lib/person-annotations";
import { buildPeopleQuery } from "../../src/routes/people.queries";

const page = readFileSync(new URL("../../src/ui/people/SourcingPipelinePage.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../../src/ui/people/PersonDrawer.tsx", import.meta.url), "utf8");
const people = readFileSync(new URL("../../src/ui/people/PeoplePage.tsx", import.meta.url), "utf8");
const peopleApi = readFileSync(new URL("../../src/ui/people/people-api.ts", import.meta.url), "utf8");
const compose = readFileSync(new URL("../../src/ui/people/PeopleModals.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../src/ui/people/people.css", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../migrations/0019_outreach_targeting.sql", import.meta.url), "utf8");

test("CONTRACT · MRQ-205 · Outreach static copy contains no baked-in four-digit year", () => {
  // This is intentionally grep-shaped: a future copy edit that sneaks a
  // conference year into the surface fails before a browser ever renders it.
  for (const source of [page, drawer, people, compose]) {
    expect(source).not.toMatch(/\b(?:19|20)\d{2}\b/);
  }
  expect(page).toContain('title="Outreach"');
  expect(page).toContain("People you want on a stage before any submission exists");
  expect(page).toContain("+ Add prospect");
});

test("CONTRACT · MRQ-205 · next-touch overdue state sorts and tints live cards", () => {
  const now = Date.UTC(2026, 7, 12);
  expect(isOutreachOverdue("2026-08-11", "contacted", now)).toBe(true);
  expect(isOutreachOverdue("2026-08-12", "contacted", now)).toBe(false);
  expect(isOutreachOverdue("2026-08-11", "confirmed", now)).toBe(false);
  expect(page).toContain("Overdue next touches stay at the top of each stage");
  expect(css).toMatch(/\.people-card \.people-card-next\.overdue \{[^}]*var\(--alarm\)/);
});

test("CONTRACT · MRQ-205 · target FK is additive and people filtering stays SQL-backed", () => {
  expect(migration).toMatch(/ALTER TABLE person_events ADD COLUMN target_event_id TEXT REFERENCES events\(id\) ON DELETE SET NULL;/);
  expect(migration).not.toMatch(/target_event_id TEXT NOT NULL/);
  expect(migration).toMatch(/ALTER TABLE person_events ADD COLUMN next_touch_on TEXT;/);
  expect(migration).toMatch(/ALTER TABLE people ADD COLUMN do_not_contact INTEGER NOT NULL DEFAULT 0/);

  const query = buildPeopleQuery({ orgId: "org_205", sort: "next_touch" });
  expect(query.dataSql).toContain("outreach_target_event_id");
  expect(query.dataSql).toContain("outreach_next_touch_on");
  expect(query.dataSql).toContain("ORDER BY outreach_next_touch_on IS NULL ASC");
  expect(peopleApi).toContain("format=csv");
  expect(compose).toContain("marked do-not-contact:");
  expect(drawer).toContain("Outreach:");
  expect(drawer).toContain("Open board");
});
