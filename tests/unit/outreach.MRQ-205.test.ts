import { readFileSync } from "node:fs";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";

import { isOutreachOverdue } from "../../src/lib/person-annotations";
import { buildPeopleQuery } from "../../src/routes/people.queries";
import { OutreachCard } from "../../src/ui/people/SourcingPipelinePage";

const page = readFileSync(new URL("../../src/ui/people/SourcingPipelinePage.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../../src/ui/people/PersonDrawer.tsx", import.meta.url), "utf8");
const people = readFileSync(new URL("../../src/ui/people/PeoplePage.tsx", import.meta.url), "utf8");
const peopleApi = readFileSync(new URL("../../src/ui/people/people-api.ts", import.meta.url), "utf8");
const compose = readFileSync(new URL("../../src/ui/people/PeopleModals.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../src/ui/people/people.css", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../migrations/0017_outreach_targeting.sql", import.meta.url), "utf8");

const stages = [
  { id: "researching", name: "Researching", kind: "open" },
  { id: "contacted", name: "Contacted", kind: "open" },
];

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

test("CONTRACT · MRQ-205 · the long-name DOM card carries a full-name tooltip, target line, and contained selector", () => {
  const name = "Margarethe von Habsburg-Lothringen, Erzherzogin zu Österreich";
  const html = renderToString(h(OutreachCard, {
    card: {
      person_id: "per_long",
      name,
      company: "Longform Signal Cooperative",
      stage: "contacted",
      score: 92,
      rationale: null,
      moved_at: 1,
      target_event_id: "evt_devflow",
      target_event_name: "DevFlow Conf 2027 with an exceptionally long conference name",
      next_touch_on: "2026-08-11",
    },
    displayName: name,
    stages,
    busy: false,
    onMove: () => undefined,
    onOpen: () => undefined,
  }));

  expect(html).toContain('data-outreach-card="true"');
  expect(html).toContain(`title="${name}"`);
  expect(html).toContain("→ DevFlow Conf 2027 with an exceptionally long conference name");
  expect(html).toContain('class="people-moveto"');
  expect(css).toMatch(/\.people-card \{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;/);
  expect(css).toMatch(/\.people-moveto \{[\s\S]*?flex: 1 1 auto;[\s\S]*?max-width: 100%;/);
  expect(page).toContain("element.scrollWidth > element.clientWidth + 1");
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
  expect(migration).toMatch(/ALTER TABLE person_events ADD COLUMN target_event_id TEXT REFERENCES events\(id\);/);
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
