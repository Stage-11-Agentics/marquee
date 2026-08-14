import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import {
  disambiguatedName,
  disambiguatedNames,
  duplicateNameOrdinals,
  searchableQuery,
} from "../../src/lib/duplicate-names";
import {
  AssigneePicker,
  SessionChoicePicker,
  namedTaskPopulation,
  visibleAssignees,
  type Assignee,
  type SpeakerTask,
} from "../../src/ui/settings/TaskTemplatesPage";
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
    const displayNames = disambiguatedNames([MARCUS_A, MARCUS_B, PRIYA]);
    const shown = (query: string): string[] =>
      visibleAssignees([MARCUS_A, MARCUS_B, PRIYA], displayNames, query).map((person) => person.id);

    // Typing what you can see finds the row showing it, and only that row.
    expect(shown("Marcus Okafor (2)")).toEqual([MARCUS_B.id]);
    expect(shown("(2)")).toEqual([MARCUS_B.id]);
    // The stored name, the email, and the company all still match.
    expect(shown("Marcus Okafor")).toEqual([MARCUS_A.id, MARCUS_B.id]);
    expect(shown("m.okafor@lattice.example")).toEqual([MARCUS_B.id]);
    expect(shown("Northwind")).toEqual([MARCUS_A.id]);
    expect(shown("priya")).toEqual([PRIYA.id]);
    expect(shown("   ")).toHaveLength(3);
  });

  test("CONTRACT · a server-backed search strips a marker the server has never heard of", () => {
    // "(2)" is a property of one rendered result set, so it cannot exist before
    // the search that would be filtering by it has run. Pasting a visible label
    // must still find the person it belongs to.
    expect(searchableQuery("Marcus Okafor (2)")).toBe("Marcus Okafor");
    expect(searchableQuery("Marcus Okafor (12)  ")).toBe("Marcus Okafor");
    // A parenthesised number that is part of the query, not a marker, survives.
    expect(searchableQuery("Marcus Okafor (2) session")).toBe("Marcus Okafor (2) session");
    expect(searchableQuery("Marcus")).toBe("Marcus");
  });

  test("CONTRACT · a cancelled task's holder is not on the page and does not mark the one who is", () => {
    const task = (id: string, person: { id: string; name: string }, cancelled: boolean): SpeakerTask => ({
      id, template_id: "tmpl", title: "Upload slides", kind: "file", due_at: 0,
      status: "open", cancelled, person: { ...person, email: `${person.id}@example.com` },
      submission_title: null,
    });

    // The cancelled holder's row is filtered out of the table, so counting them
    // would put "(2)" on the only Marcus the organizer can actually see.
    const hidden = namedTaskPopulation([MARCUS_A], [task("t1", { id: "person_ghost", name: "Marcus Okafor" }, true)]);
    expect(hidden.map((person) => person.id)).toEqual([MARCUS_A.id]);
    expect(disambiguatedNames(hidden).get(MARCUS_A.id)).toBe("Marcus Okafor");

    // A live task from someone no longer assignable IS on the page, and counts.
    const visible = namedTaskPopulation([MARCUS_A], [task("t2", { id: "person_removed", name: "Marcus Okafor" }, false)]);
    expect(visible.map((person) => person.id)).toEqual([MARCUS_A.id, "person_removed"]);
    expect(disambiguatedNames(visible).get("person_removed")).toBe("Marcus Okafor (2)");
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
    ["the reviewer picker, participants card, message recipient, person search, and recorded evidence", submissionRecordSource, [
      "participantResultNames.get(person.id) ?? person.title",
      "evidenceNames.get(evaluation.reviewer_person_id) ?? evaluation.reviewer_name",
      "evidenceNames.get(comparison.reviewer_person_id) ?? comparison.reviewer_name",
      // The evidence row prints the display name in its header, its superseded
      // line, and both override controls' accessible names.
      "aria-label={`Override score for ${displayName}`}",
      "aria-label={`Reason for overriding ${displayName}`}",
      "reviewerNames.get(reviewer.id) ?? reviewer.name",
      "reviewerNames.get(assignment.reviewer_person_id) ?? assignment.reviewer_name",
      "participantNames.get(group.person_id) ?? group.name",
      "participantNames.get(participant.person_id) ?? participant.name",
    ]],
    ["the submitter picker", createSubmissionSource, ["submitterNames.get(person.id) ?? person.title"]],
    ["global search speaker results", quickSearchSource, ["speakerNames.get(result.id) ?? result.title"]],
    ["the committee rows, reviewer pool drawer, and distribution result", evaluationSource, [
      "memberNames.get(member.id) ?? member.name",
      "poolNames.get(member.id) ?? member.name",
      "coverageNames.get(reviewer.person_id) ?? reviewer.name",
      // Remind and Remove repeat their own words; the person has to be in the
      // ACCESSIBLE name, not only in a hover title a screen reader never reads.
      "aria-label={`Remind ${memberLabel}`}",
      "aria-label={`Remove ${poolNames.get(member.id) ?? member.name} from ${pool.name}`}",
    ]],
    ["the sourcing pipeline cards and stage control", sourcingSource, ["cardNames.get(card.person_id) ?? card.name"]],
    ["the files board", filesSource, ["personNames.get(row.person.id) ?? row.person.name", "personNames={personNames}"]],
    // The dialog takes the board's map as a prop rather than deriving its own,
    // so it names people exactly as the list it was opened from did.
    ["the bulk export dialog", bulkExportSource, ["personNames.get(row.person.id) ?? row.person.name"], true],
    // Removal is the consequential step: the confirm, the receipt, and the
    // button's accessible name all have to say which person.
    ["the organizer rows and their removal", organizersSource, [
      "memberNames.get(member.person_id) ?? member.name",
      "const label = memberNames.get(member.person_id) ?? member.name;",
      "`Remove ${label}?",
      "aria-label={`Remove ${memberNames.get(member.person_id) ?? member.name}`}",
    ]],
    ["the form administrator rows, each beside a Remove", formsSource, ["?? admin.name", "aria-label={`Remove ${disambiguatedNames("]],
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
