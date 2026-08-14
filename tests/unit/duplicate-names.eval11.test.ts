import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import {
  disambiguatedName,
  disambiguatedNames,
  duplicateNameOrdinals,
} from "../../src/lib/duplicate-names";
import { AssigneePicker, SessionChoicePicker, type Assignee } from "../../src/ui/settings/TaskTemplatesPage";
import peoplePageSource from "../../src/ui/people/PeoplePage.tsx?raw";
import onboardingSource from "../../src/ui/onboarding/OnboardingPage.tsx?raw";
import speakersSource from "../../src/ui/speakers/SpeakersPage.tsx?raw";
import submissionRecordSource from "../../src/ui/submissions/SubmissionRecordPage.tsx?raw";
import taskTemplatesSource from "../../src/ui/settings/TaskTemplatesPage.tsx?raw";
import createSubmissionSource from "../../src/ui/submissions/CreateSubmissionPage.tsx?raw";
import quickSearchSource from "../../src/ui/shell/QuickSearch.tsx?raw";
import evaluationSource from "../../src/ui/evaluation/EvaluationPage.tsx?raw";
import sourcingSource from "../../src/ui/people/SourcingPipelinePage.tsx?raw";
import filesSource from "../../src/ui/files/FilesPage.tsx?raw";
import bulkExportSource from "../../src/ui/files/BulkExportDialog.tsx?raw";
import organizersSource from "../../src/ui/setup/OrganizersCard.tsx?raw";
import formsSource from "../../src/ui/forms/FormsPage.tsx?raw";

/**
 * sbek round 11, speaker-management: a CSV import created two "Marcus Okafor"
 * and two "Priya Raman" rows, and every list printed both of each pair as the
 * same name. The same shape was filed again against the task-assignment picker,
 * where the cost is not confusion but assigning work to the wrong person.
 *
 * The importer is right — two addresses are two people — and a merge feature is
 * out of scope. The remedy is display-level: mark the collision.
 */

const MARCUS_A: Assignee = { id: "person_marcus_a", name: "Marcus Okafor", email: "marcus@northwind.example", company: "Northwind", accepted_session_count: 1, sessions: [] };
const MARCUS_B: Assignee = { id: "person_marcus_b", name: "Marcus Okafor", email: "m.okafor@lattice.example", company: "Lattice", accepted_session_count: 1, sessions: [] };
const PRIYA: Assignee = { id: "person_priya", name: "Priya Raman", email: "priya@example.com", company: null, accepted_session_count: 0, sessions: [] };

describe("duplicate person names", () => {
  test("CONTRACT · a repeated name is marked from the second occurrence, and a unique one is left alone", () => {
    const names = disambiguatedNames([MARCUS_A, MARCUS_B, PRIYA]);
    expect(names.get("person_marcus_a")).toBe("Marcus Okafor");
    expect(names.get("person_marcus_b")).toBe("Marcus Okafor (2)");
    // A name nobody else carries is never decorated.
    expect(names.get("person_priya")).toBe("Priya Raman");
  });

  test("CONTRACT · a third and fourth namesake keep counting", () => {
    const names = disambiguatedNames([
      { id: "p1", name: "Marcus Okafor" },
      { id: "p2", name: "Marcus Okafor" },
      { id: "p3", name: "Marcus Okafor" },
      { id: "p4", name: "Marcus Okafor" },
    ]);
    expect([...names.values()]).toEqual([
      "Marcus Okafor",
      "Marcus Okafor (2)",
      "Marcus Okafor (3)",
      "Marcus Okafor (4)",
    ]);
  });

  test("CONTRACT · the same person carries the same label under any sort order", () => {
    // Numbering by list position would hand "(2)" to a different human every
    // time the roster was re-sorted — a marker that means nothing is worse than
    // no marker at all.
    const ascending = disambiguatedNames([MARCUS_A, MARCUS_B]);
    const descending = disambiguatedNames([MARCUS_B, MARCUS_A]);
    expect(descending.get("person_marcus_a")).toBe(ascending.get("person_marcus_a"));
    expect(descending.get("person_marcus_b")).toBe(ascending.get("person_marcus_b"));
    expect(descending.get("person_marcus_b")).toBe("Marcus Okafor (2)");
  });

  test("CONTRACT · a collision is read past case and stray whitespace, and blanks are left alone", () => {
    const names = disambiguatedNames([
      { id: "a", name: "Marcus Okafor" },
      { id: "b", name: "  marcus   okafor " },
      { id: "c", name: "" },
      { id: "d", name: "" },
    ]);
    expect(names.get("b")).toBe("  marcus   okafor  (2)");
    // Two people with no name recorded are not a name collision to report.
    expect(names.get("c")).toBe("");
    expect(names.get("d")).toBe("");
  });

  test("CONTRACT · a name that already ends in a suffix does not get a twin minted for it", () => {
    // "Alex (2)" is a name a real person can carry. Handing the second Alex that
    // same label produces the one outcome this exists to prevent.
    const names = disambiguatedNames([
      { id: "a", name: "Alex" },
      { id: "b", name: "Alex" },
      { id: "c", name: "Alex (2)" },
    ]);
    expect(names.get("b")).not.toBe(names.get("c"));
    expect(new Set(names.values()).size).toBe(3);
  });

  test("CONTRACT · canonically equivalent names collide even when their bytes differ", () => {
    // An import can carry a decomposed "José" beside a composed one: identical
    // on screen, different byte for byte, and unmarked without NFC folding.
    const names = disambiguatedNames([
      { id: "a", name: "Jos\u00e9 Alvarez" },
      { id: "b", name: "Jose\u0301 Alvarez" },
    ]);
    expect(names.get("b")).toMatch(/ \(2\)$/);
  });

  test("CONTRACT · a record absent from the list keeps its plain name", () => {
    const ordinals = duplicateNameOrdinals([MARCUS_A, MARCUS_B]);
    expect(disambiguatedName({ id: "person_elsewhere", name: "Marcus Okafor" }, ordinals)).toBe("Marcus Okafor");
  });

  test("CONTRACT · the task-assignment picker tells two namesakes apart", () => {
    // The defect an organizer pays for: ticking a checkbox against the wrong
    // Marcus Okafor and assigning that speaker's work to a stranger.
    const html = renderToString(h(AssigneePicker, {
      assignees: [MARCUS_A, MARCUS_B, PRIYA],
      displayNames: disambiguatedNames([MARCUS_A, MARCUS_B, PRIYA]),
      selected: [],
      onChange: () => undefined,
      idPrefix: "task-assign-test",
    }));
    expect(html).toContain("Marcus Okafor (2)");
    expect(html).not.toContain("Priya Raman (2)");
    // Both records are still offered; disambiguation is not deduplication.
    expect(html).toContain("person_marcus_a");
    expect(html).toContain("person_marcus_b");
    // The property the defect violated: no two choices print the same label.
    const labels = [...html.matchAll(/<strong>([^<]*)<\/strong>/g)].map((match) => match[1]);
    expect(labels).toHaveLength(3);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("CONTRACT · the session control beside the picker names the same people the same way", async () => {
    const withSession: Assignee = { ...MARCUS_B, sessions: [{ id: "sub_1", title: "Shipping agents" }, { id: "sub_2", title: "CI at scale" }] };
    const html = renderToString(h(SessionChoicePicker, {
      assignees: [MARCUS_A, withSession],
      displayNames: disambiguatedNames([MARCUS_A, withSession]),
      selected: [MARCUS_A.id, withSession.id],
      choices: {},
      onChange: () => undefined,
      idPrefix: "task-assign-test",
    }));
    expect(html).toContain("Marcus Okafor (2)");
    expect(html).toContain("Session for Marcus Okafor (2)");
  });

  test("CONTRACT · the picker finds a person by the name it is showing", () => {
    // Typing what you can see — "Marcus Okafor (2)" — has to find the row that
    // shows it. A picker whose search and render disagree is a picker that
    // cannot be searched.
    expect(taskTemplatesSource).toContain("`${displayNames.get(person.id) ?? person.name} ${person.name}");
    const html = renderToString(h(AssigneePicker, {
      assignees: [MARCUS_A, MARCUS_B, PRIYA],
      displayNames: disambiguatedNames([MARCUS_A, MARCUS_B, PRIYA]),
      selected: [],
      onChange: () => undefined,
      idPrefix: "task-assign-test",
    }));
    expect(html).toContain("Search speakers by name, company, or email");
  });

  test("CONTRACT · a cancelled task's holder is not on the page and does not mark the one who is", () => {
    // Cancelled tasks are filtered out of the assignment table, so their holders
    // are invisible. Counting them would put "(2)" on the only visible Marcus —
    // a marker about somebody the organizer cannot see.
    expect(taskTemplatesSource).toContain("!task.cancelled && !assignees.some((person) => person.id === task.person.id)");
  });

  test("CONTRACT · someone who holds a task but is no longer assignable keeps their label", () => {
    // Removing a co-speaker deletes the participation and keeps the task, so a
    // person can hold work while dropping out of the assignable list. Deriving
    // from the assignable list alone dropped exactly those people back to a raw
    // name in the table where their task still sits.
    expect(taskTemplatesSource).toContain("!assignees.some((person) => person.id === task.person.id)");
    const stillHeld = disambiguatedNames([MARCUS_A, { id: MARCUS_B.id, name: MARCUS_B.name }]);
    expect(stillHeld.get(MARCUS_B.id)).toBe("Marcus Okafor (2)");
  });

  /**
   * Every place a person is chosen or acted on by name, named individually.
   *
   * A test that only checks each file imports the helper passes while a raw
   * picker sits three lines below one that was fixed — which is exactly the
   * shape of the defect. Each entry below pins one render site, so reverting any
   * single one fails here.
   *
   * Deliberately absent, and not an oversight: attendee-facing surfaces (the
   * public speaker directory, embeds, the speaker's own portal), where the
   * reader has no records to confuse and a disambiguator is noise on a
   * conference's public face; and card-level lists that carry one session's own
   * speakers (program board cards, agenda pool rows), where the ambiguity would
   * have to be derived board-wide and the card is not a control that acts on a
   * person.
   */
  // The fourth field marks a surface that receives the map as a prop rather
  // than importing the helper itself.
  const WIRED_SITES: ReadonlyArray<readonly [string, string, readonly string[], boolean?]> = [
    ["the roster", peoplePageSource, ["displayNames.get(row.id) ?? row.name"]],
    ["the speaker roster", speakersSource, ["displayNames.get(row.id) ?? row.name"]],
    ["the onboarding grid, compose drawer, and invite results", onboardingSource, [
      "displayNames.get(row.person.id) ?? row.person.name",
      "displayNames.get(row.person_id)",
      "displayNames.get(item.person_id) ?? item.name",
    ]],
    ["the task assignee picker and assignment table", taskTemplatesSource, [
      "displayNames.get(person.id) ?? person.name",
      "assigneeNames.get(row.person.id) ?? row.person.name",
    ]],
    ["the reviewer picker, participants card, message recipient, and person search", submissionRecordSource, [
      "participantResultNames.get(person.id) ?? person.title",
      "reviewerNames.get(reviewer.id) ?? reviewer.name",
      "reviewerNames.get(assignment.reviewer_person_id) ?? assignment.reviewer_name",
      "participantNames.get(group.person_id) ?? group.name",
      "participantNames.get(participant.person_id) ?? participant.name",
    ]],
    ["the submitter picker", createSubmissionSource, ["submitterNames.get(person.id) ?? person.title"]],
    ["global search speaker results", quickSearchSource, ["speakerNames.get(result.id) ?? result.title"]],
    ["the committee rows and reviewer pool drawer", evaluationSource, [
      "memberNames.get(member.id) ?? member.name",
      "poolNames.get(member.id) ?? member.name",
    ]],
    ["the sourcing pipeline cards and stage control", sourcingSource, ["cardNames.get(card.person_id) ?? card.name"]],
    ["the files board", filesSource, ["personNames.get(row.person.id) ?? row.person.name", "personNames={personNames}"]],
    // The dialog takes the board's map as a prop rather than deriving its own,
    // so it names people exactly as the list it was opened from did.
    ["the bulk export dialog", bulkExportSource, ["personNames.get(row.person.id) ?? row.person.name"], true],
    ["the organizer rows, each beside a Remove", organizersSource, ["memberNames.get(member.person_id) ?? member.name"]],
    ["the form administrator rows, each beside a Remove", formsSource, ["?? admin.name"]],
  ];

  test("CONTRACT · every surface where a person is chosen or acted on by name reads the shared derivation", () => {
    for (const [what, source, expressions, viaProp] of WIRED_SITES) {
      if (!viaProp) expect(source, `${what} imports the shared derivation`).toContain("lib/duplicate-names");
      for (const expression of expressions) {
        expect(source, `${what} renders through it: ${expression}`).toContain(expression);
      }
    }
  });
});
