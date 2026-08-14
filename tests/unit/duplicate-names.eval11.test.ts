import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import {
  disambiguatedName,
  disambiguatedNames,
  duplicateNameOrdinals,
} from "../../src/lib/duplicate-names";
import { AssigneePicker, type Assignee } from "../../src/ui/settings/TaskTemplatesPage";
import peoplePageSource from "../../src/ui/people/PeoplePage.tsx?raw";
import onboardingSource from "../../src/ui/onboarding/OnboardingPage.tsx?raw";
import speakersSource from "../../src/ui/speakers/SpeakersPage.tsx?raw";
import submissionRecordSource from "../../src/ui/submissions/SubmissionRecordPage.tsx?raw";

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
  });

  test("CONTRACT · every surface that lists people by name reads the shared derivation", () => {
    // A page that renders the raw name reopens the defect on its own screen, so
    // the wiring is asserted rather than assumed.
    const surfaces = [
      ["PeoplePage", peoplePageSource],
      ["OnboardingPage", onboardingSource],
      ["SpeakersPage", speakersSource],
      ["SubmissionRecordPage", submissionRecordSource],
    ] as const;
    for (const [name, source] of surfaces) {
      expect(source, `${name} imports the shared derivation`).toContain("lib/duplicate-names");
      expect(source, `${name} calls it`).toContain("disambiguatedNames(");
    }
  });
});
