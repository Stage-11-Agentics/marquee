import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Thin aliases so the assertions read like the statements they are.
const expectDeep = (actual: unknown, expected: unknown) => expect(actual).toEqual(expected);
const expectEqual = (actual: unknown, expected: unknown, message?: string) => expect(actual, message).toBe(expected);
const expectOk = (actual: unknown) => expect(actual).toBeTruthy();
const expectThrows = (run: () => unknown) => expect(run).toThrow();

import {
  currentCard,
  foldNotes,
  foldStageHistory,
  foldTags,
  PIPELINE_STAGES,
} from "../../src/lib/person-annotations";
import { mapPersonHeaders, planPersonImport } from "../../src/lib/people-import";
import { buildPeopleQuery, parseTags } from "../../src/routes/people.queries";
import { activeCriteria, saveControl } from "../../src/ui/people/people-api";
import { PIPELINE_STAGES as CLIENT_STAGES } from "../../src/ui/people/pipeline-stages";

const routeTable = readFileSync(new URL("../../src/ui/shell/route-table.ts", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../../src/ui/shell/Sidebar.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../migrations/0011_people_annotations.sql", import.meta.url), "utf8");
const peopleSources = [
  readFileSync(new URL("../../src/routes/people.routes.ts", import.meta.url), "utf8"),
  readFileSync(new URL("../../src/routes/person-lists.routes.ts", import.meta.url), "utf8"),
  readFileSync(new URL("../../src/ui/people/PeoplePage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src/ui/people/ListsPage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src/ui/people/SourcingPipelinePage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src/ui/people/PeopleModals.tsx", import.meta.url), "utf8"),
].join("\n");

function annotation(id, kind, value, createdAt) {
  return { id, person_id: "per_1", kind, value_json: JSON.stringify(value), actor_person_id: null, created_at: createdAt };
}

test("CONTRACT · MRQ-131 · one append-only table serves notes, tags, stages, and the history", () => {
  // The whole point of the design: three kinds in ONE table, and no
  // person_notes/person_tags siblings anywhere.
  expect(migration).toMatch(/CREATE TABLE person_events/);
  expect(migration).toMatch(/kind TEXT NOT NULL CHECK \(kind IN \('note', 'tag', 'stage'\)\)/);
  expect(migration).not.toMatch(/CREATE TABLE person_notes/);
  expect(migration).not.toMatch(/CREATE TABLE person_tags/);
  // No UPDATE or DELETE against the log: append-only is what makes the history free.
  const people = readFileSync(new URL("../../src/routes/people.routes.ts", import.meta.url), "utf8");
  expect(people).not.toMatch(/UPDATE person_events/);
  expect(people).not.toMatch(/DELETE FROM person_events/);
});

test("CONTRACT · MRQ-131 · a tag added, removed, and added again is carried", () => {
  const rows = [
    annotation("a1", "tag", { tag: "AI", op: "add" }, 100),
    annotation("a2", "tag", { tag: "AI", op: "remove" }, 200),
    annotation("a3", "tag", { tag: "AI", op: "add" }, 300),
    annotation("a4", "tag", { tag: "Platform", op: "add" }, 150),
    annotation("a5", "tag", { tag: "DevRel", op: "add" }, 120),
    annotation("a6", "tag", { tag: "DevRel", op: "remove" }, 400),
  ];
  expectDeep(foldTags(rows), ["AI", "Platform"]);
});

test("CONTRACT · MRQ-131 · two tag rows in the same millisecond resolve by id, not by chance", () => {
  const rows = [
    annotation("b1", "tag", { tag: "AI", op: "add" }, 100),
    annotation("b2", "tag", { tag: "AI", op: "remove" }, 100),
  ];
  expectDeep(foldTags(rows), []);
  expectDeep(foldTags([...rows].reverse()), []);
});

test("CONTRACT · MRQ-131 · the stage history falls out of the log, and the card is its last row", () => {
  const rows = [
    annotation("s1", "stage", { stage: "identified", score: 85, rationale: "Strong track record" }, 100),
    annotation("s2", "stage", { stage: "contacted" }, 200),
    annotation("s3", "stage", { stage: "interested" }, 300),
  ];
  const history = foldStageHistory(rows);
  expectDeep(history.map((entry) => entry.stage), ["identified", "contacted", "interested"]);
  expectDeep(history.map((entry) => entry.stage_name), ["Identified", "Contacted", "Interested"]);

  // A move records where the card went, not why the prospect was interesting —
  // so the score and rationale carry forward from the row that stated them.
  const card = currentCard(rows);
  expectEqual(card.stage, "interested");
  expectEqual(card.score, 85);
  expectEqual(card.rationale, "Strong track record");
  expectEqual(currentCard([]), null);
});

test("CONTRACT · MRQ-131 · notes read newest first and an unreadable payload never breaks the drawer", () => {
  const rows = [
    annotation("n1", "note", { body: "First" }, 100),
    annotation("n2", "note", { body: "Second" }, 200),
    { id: "n3", person_id: "per_1", kind: "note", value_json: "{not json", actor_person_id: null, created_at: 300 },
  ];
  expectDeep(foldNotes(rows).map((note) => note.body), ["Second", "First"]);
});

test("CONTRACT · MRQ-131 · the six stages include both terminal ones, and client and server agree", () => {
  expectEqual(PIPELINE_STAGES.length, 6);
  expectOk(PIPELINE_STAGES.some((stage) => stage.kind === "won"));
  expectOk(PIPELINE_STAGES.some((stage) => stage.kind === "lost"));
  expectDeep(
    CLIENT_STAGES.map((stage) => `${stage.id}:${stage.name}:${stage.kind}`),
    PIPELINE_STAGES.map((stage) => `${stage.id}:${stage.name}:${stage.kind}`),
  );
});

test("CONTRACT · MRQ-131 · one list query: event_id is the only difference between the two entrances", () => {
  const org = buildPeopleQuery({ orgId: "org_1" });
  const roster = buildPeopleQuery({ orgId: "org_1", eventId: "evt_1" });
  expect(org.dataSql).toMatch(/FROM people person/);
  expect(org.dataSql).not.toMatch(/FROM memberships/);
  // The roster narrows to the ONE definition of who speaks at a conference.
  expect(roster.dataSql).toMatch(/SELECT person_id FROM memberships/);
  expect(roster.dataSql).toMatch(/part\.role IN \('speaker', 'co_speaker'\)/);
  expectDeep(roster.countBindings, ["org_1", "evt_1", "evt_1"]);
  // And the roster's own module reaches for that same builder rather than
  // carrying a second list implementation.
  const rosterQueries = readFileSync(new URL("../../src/routes/speakers.queries.ts", import.meta.url), "utf8");
  expect(rosterQueries).toMatch(/buildPeopleQuery/);
});

test("CONTRACT · MRQ-131 · search, filters, and paging bind their values and never interpolate them", () => {
  const built = buildPeopleQuery({
    orgId: "org_1",
    q: "Priya",
    company: "Latticework Systems",
    title: "Principal Engineer",
    tag: "AI",
    stage: "identified",
    listId: "lst_1",
    page: { page: 2, perPage: 25, limit: 25, offset: 25 },
  });
  expect(built.dataSql).not.toMatch(/Priya|Latticework|lst_1/);
  expectOk(built.dataBindings.includes("%Priya%"));
  expectOk(built.dataBindings.includes("AI"));
  expectDeep(built.dataBindings.slice(-2), [25, 25]);
  expect(built.dataSql).toMatch(/LIMIT \? OFFSET \?/);
  // The count must not carry the page's window, or every total would read 25.
  // (The inner tag/stage folds legitimately use LIMIT 1, so this asks for the
  // paging clause specifically rather than for the word.)
  expect(built.countSql).not.toMatch(/LIMIT \? OFFSET \?/);
  expect(built.countBindings).toHaveLength(built.dataBindings.length - 2);
});

test("CONTRACT · MRQ-131 · an unknown sort is rejected rather than interpolated", () => {
  expectThrows(() => buildPeopleQuery({ orgId: "org_1", sort: "company; DROP TABLE people" }));
  expect(buildPeopleQuery({ orgId: "org_1", sort: "last_contact" }).dataSql).toMatch(/last_contact_at IS NULL ASC/);
});

test("CONTRACT · MRQ-131 · CSV columns map by header and whatever cannot map is reported", () => {
  const mapping = mapPersonHeaders(["Full Name", "Email Address", "Job Title", "Organization", "Twitter"]);
  expectDeep(mapping.columns, { name: 0, email: 1, title: 2, company: 3 });
  expectDeep(mapping.unmapped, ["Twitter"]);

  const plan = planPersonImport([
    "Full Name,Email Address,Company,Notes",
    "Priya Raman,PRIYA@example.test,Latticework,ignored",
    "Marcus Okafor,marcus@example.test,Northwind,",
    ",nobody@example.test,Nowhere,",
    "Duplicate Priya,priya@example.test,Latticework,",
  ].join("\n"));
  expectDeep(plan.rows.map((row) => row.email), ["priya@example.test", "marcus@example.test"]);
  // A row with no name, and a second row for an address already in the file.
  expectEqual(plan.skipped, 2);
  expectDeep(plan.unmapped, ["Notes"]);
});

test("CONTRACT · MRQ-131 · the save control swaps its label and its default kind, and nothing else", () => {
  expectDeep(saveControl(0), { label: "Save filter as list", kind: "live" });
  expectDeep(saveControl(3), { label: "Save selected as list", kind: "fixed" });
  // Fixed width, because the label swaps under the cursor and elements never jump.
  const css = readFileSync(new URL("../../src/ui/people/people.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.people-save-control \{ min-width: \d+px; \}/);
  expect(css).toMatch(/\.people-statusbar \{[^}]*min-height: 34px/s);
});

test("CONTRACT · MRQ-131 · active criteria render as removable chips", () => {
  const criteria = activeCriteria({ q: "priya", company: "Latticework", title: "", tag: "AI", listId: "" });
  expectDeep(criteria.map((entry) => entry.key), ["company", "tag"]);
  expectDeep(criteria.map((entry) => entry.label), ["company", "tag"]);
});

test("CONTRACT · MRQ-131 · tags arrive as a JSON array and a broken one degrades to none", () => {
  expectDeep(parseTags('["AI","Platform"]'), ["AI", "Platform"]);
  expectDeep(parseTags(null), []);
  expectDeep(parseTags("[not json"), []);
});

test("CONTRACT · MRQ-131 · People is org-level in the nav, above the conference boundary", () => {
  expect(routeTable).toMatch(/path: "\/people", label: "People"/);
  expect(routeTable).toMatch(/group: "organization"/);
  // All four paths resolve; agents guess URLs and a 404 costs turns.
  for (const path of ["/people", "/crm", "/directory", "/contacts"]) {
    expect(routeTable).toMatch(new RegExp(`path: "${path}"`));
  }
  // The Organization group is rendered BEFORE the conference caption.
  const organizationAt = sidebar.indexOf('routesFor("organization")');
  const captionAt = sidebar.indexOf('class="event-context"');
  expectOk(organizationAt > 0 && captionAt > 0 && organizationAt < captionAt);
});

test("CONTRACT · MRQ-131 · the area's language is People and List, never CRM or Segment", () => {
  // PHILOSOPHY §6: the organizer's language. "CRM" is software's word for this;
  // "Segment" is a marketer's word for a List.
  const userFacing = peopleSources
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"));
  for (const forbidden of [/\bCRM\b/, /\bSegments?\b/, /\bContacts\b/, /\bDirectory\b/]) {
    const offender = userFacing.find((line) => forbidden.test(line));
    expectEqual(offender, undefined, `forbidden vocabulary in a user-facing string: ${offender}`);
  }
});
