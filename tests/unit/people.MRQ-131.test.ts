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
import { activeCriteria, EMPTY_FILTERS, hasFilters, saveControl } from "../../src/ui/people/people-api";
import { matchRoute, routesFor } from "../../src/ui/shell/route-table";
import { PIPELINE_STAGES as CLIENT_STAGES } from "../../src/ui/people/pipeline-stages";
import { peopleImportBrief } from "../../src/ui/people/people-brief";

const routeTable = readFileSync(new URL("../../src/ui/shell/route-table.ts", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../../src/ui/shell/Sidebar.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../migrations/0012_people_annotations.sql", import.meta.url), "utf8");
const peopleSources = [
  readFileSync(new URL("../../src/routes/people.routes.ts", import.meta.url), "utf8"),
  readFileSync(new URL("../../src/routes/person-lists.routes.ts", import.meta.url), "utf8"),
  readFileSync(new URL("../../src/ui/people/PeoplePage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src/ui/people/ListsPage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src/ui/people/SourcingPipelinePage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src/ui/people/PeopleModals.tsx", import.meta.url), "utf8"),
].join("\n");

function annotation(id: string, kind: string, value: Record<string, unknown>, createdAt: number) {
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
  const card = currentCard(rows)!;
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

test("CONTRACT · MRQ-131 · a list is never rendered as its id, and still counts as a filter", () => {
  // The chip can only render what a filter carries, and a list carries an id.
  // Showing `list: lst_01K…` in the row that says what you are looking at is
  // the whole defect: the organizer named the thing, and the screen answered
  // in database.
  const criteria = activeCriteria({ q: "", company: "", title: "", tag: "", listId: "lst_01KZZZ" });
  expectDeep(criteria, []);
  // But it is still a narrowing, so "Clear all" appears and the empty state
  // reads "nobody matches" rather than "nobody here yet".
  expectEqual(hasFilters({ q: "", company: "", title: "", tag: "", listId: "lst_01KZZZ" }), true);
  expectEqual(hasFilters({ ...EMPTY_FILTERS }), false);

  // People names it instead, in a band that distinguishes all four states —
  // and in particular does not report a failed request as a deleted list.
  const page = readFileSync(new URL("../../src/ui/people/PeoplePage.tsx", import.meta.url), "utf8");
  expect(page).toMatch(/people-listband/);
  for (const state of ["resolving", "named", "missing", "error"]) {
    expect(page, `the band must handle the "${state}" state`).toContain(`"${state}"`);
  }
  // Reserved height: the name and its meta line arrive from a second request
  // and the table below must not move when they land.
  const css = readFileSync(new URL("../../src/ui/people/people.css", import.meta.url), "utf8");
  expectOk(/\.people-listband \{[^}]*min-height:/s.test(css));
});

test("CONTRACT · MRQ-131 · Lists is reached from People, not from a sidebar row of its own", () => {
  // A list is a lens on People. A permanent second destination for it makes
  // the nav longer and the relationship less obvious — but the route stays,
  // because saving a list lands on it and the URL is shareable.
  // Asserted through the resolver rather than the source text, so reordering a
  // property in the table cannot fail a test about navigation.
  expectDeep(routesFor("organization").map((route) => route.id), ["people", "sourcing"]);
  // The route itself survives — /lists still resolves, it just has no row.
  const lists = matchRoute("/lists");
  expectEqual(lists?.id, "lists");
  expectEqual(lists?.sidebar, undefined);
  // And on /lists the nav names where you are rather than highlighting nothing.
  const shell = readFileSync(new URL("../../src/ui/shell/AppShell.tsx", import.meta.url), "utf8");
  expect(shell).toMatch(/route\?\.id === "lists" \? "people"/);
});

test("CONTRACT · MRQ-131 · a radio in a field is never sized like a text entry", () => {
  // `.people-field input` caught the two radios in "Keep it up to date?" and
  // gave each `width: 100%`. Inside a flex label that stretches the control
  // across the dialog: the glyph pins to the far left and its words land on
  // the other side of the modal, one word per line.
  const css = readFileSync(new URL("../../src/ui/people/people.css", import.meta.url), "utf8");
  const selectors = css.split("\n").filter((line) => line.trimStart().startsWith(".people-field input"));
  expectOk(selectors.length > 0);
  for (const selector of selectors) {
    expectOk(selector.includes('not([type="radio"])') && selector.includes('not([type="checkbox"])'));
  }
  expect(css).toMatch(/\.people-radio-row input \{[^}]*width: auto/s);
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
  // The Organization group is rendered BEFORE the conference boundary. That
  // boundary is the switcher now rather than a caption — the element moved into
  // its own component when it became a real control, and the rule it has to
  // satisfy is unchanged: a person belongs to the organization, so People is
  // above the line where the conference scope begins.
  const organizationAt = sidebar.indexOf('routesFor("organization")');
  const conferenceBoundaryAt = sidebar.indexOf("<EventSwitcher");
  expectOk(organizationAt > 0 && conferenceBoundaryAt > 0 && organizationAt < conferenceBoundaryAt);
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

test("CONTRACT · MRQ-131 · the People import brief is paste-ready, and org-level on purpose", () => {
  const copy = peopleImportBrief("https://example.test");
  // The four load-bearing items MRQ-130's briefs carry.
  expect(copy.brief).toContain("https://example.test");
  expect(copy.brief).toContain("/api/openapi.json");
  expect(copy.brief).toContain("Settings → API tokens");
  expect(copy.brief).toMatch(/When you're done, tell me/);
  expect(copy.brief).toContain("import_id");
  expect(copy.brief).not.toContain("!");
  // And the one thing it deliberately does NOT carry: People is the
  // organization's record, so the brief names no conference and the endpoint
  // is org-scoped. That is why it is not in AGENT_BRIEF_SURFACES.
  expect(copy.endpoint).toBe("POST /api/v1/org/imports");
  expect(copy.endpoint).not.toMatch(/events\//);

  // It renders through MRQ-130's shared panel rather than a second copy of it.
  const modals = readFileSync(new URL("../../src/ui/people/PeopleModals.tsx", import.meta.url), "utf8");
  expect(modals).toMatch(/AgentBriefPanel/);
});
