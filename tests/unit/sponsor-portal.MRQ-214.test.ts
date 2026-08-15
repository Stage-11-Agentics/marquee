/**
 * The sponsor portal's pure decisions, tested as the arithmetic they are.
 *
 * Each one fails silently in production: a sponsor contact landed on the speaker
 * portal's honest "you have no speaker record" dead end, a hero claiming a booth
 * that does not exist, or a load-in guide shown to a sponsor who has no booth and
 * left wondering what they missed.
 */
import { describe, expect, test } from "vitest";

import { ROLE_HOME } from "../../src/lib/auth/role-home";
import { roleHome, signinRedirect } from "../../src/lib/auth/signin-destination";
import { dealLineChips } from "../../src/lib/sponsors/deal-line";
import { sponsorHandbookChapters } from "../../src/lib/sponsors/handbook";
import { SPONSOR_WRITEBACK_TEMPLATE_IDS } from "../../src/lib/sponsors/deliverable-templates";

describe("where a sponsorship contact lands", () => {
  test("CONTRACT · a contact who holds no membership lands on the sponsor portal", () => {
    expect(roleHome([], { sponsorContact: true })).toBe("/sponsor-portal");
  });

  test("CONTRACT · every membership role still wins over the sponsor seat", () => {
    // A sponsor contact who is also program staff is running the conference.
    // What this asserts is the precedence, not the path — read the staff home
    // from the seat table so moving it never reads as a precedence failure.
    expect(roleHome(["owner"], { sponsorContact: true })).toBe(ROLE_HOME.staff);
    expect(roleHome(["program_lead"], { sponsorContact: true })).toBe(ROLE_HOME.staff);
    expect(roleHome(["reviewer"], { sponsorContact: true })).toBe("/reviewer");
    // Someone who both speaks and holds a deal lands where the conference is
    // asking things OF them; their sponsorship is one link from there.
    expect(roleHome(["speaker"], { sponsorContact: true })).toBe("/portal");
  });

  test("CONTRACT · the pre-existing answers are unchanged when no sponsor seat is passed", () => {
    expect(roleHome([])).toBe("/portal");
    expect(roleHome(["speaker"])).toBe("/portal");
    expect(roleHome(["reviewer"])).toBe("/reviewer");
    expect(roleHome(["ops"])).toBe(ROLE_HOME.staff);
    expect(roleHome([], { sponsorContact: false })).toBe("/portal");
  });

  test("CONTRACT · a safe ?next= still beats the sponsor seat's home", () => {
    expect(signinRedirect("/agenda", [], { sponsorContact: true })).toBe("/agenda");
    // And an unsafe one is still refused rather than followed.
    expect(signinRedirect("//evil.example.com", [], { sponsorContact: true })).toBe("/sponsor-portal");
  });
});

describe("the derived deal line", () => {
  test("CONTRACT · every chip is a fact that is true, and nothing is a tier blurb", () => {
    expect(dealLineChips({ sessionCount: 2, boothNumber: "214", passes: 6 }))
      .toEqual(["2 Sessions", "Booth 214", "6 conference passes"]);
  });

  test("CONTRACT · a boothless sponsorship simply has no booth chip", () => {
    expect(dealLineChips({ sessionCount: 1, boothNumber: null, passes: 2 }))
      .toEqual(["1 Session", "2 conference passes"]);
  });

  test("CONTRACT · nothing attached means no chips, not a zero", () => {
    // "0 Sessions · 0 conference passes" is three claims about emptiness where
    // the truthful answer is silence. The hero reserves the row's height.
    expect(dealLineChips({ sessionCount: 0, boothNumber: null, passes: 0 })).toEqual([]);
  });

  test("CONTRACT · singulars read as singulars", () => {
    expect(dealLineChips({ sessionCount: 1, boothNumber: null, passes: 1 }))
      .toEqual(["1 Session", "1 conference pass"]);
  });
});

describe("the sponsor handbook", () => {
  const organizerEmail = "sponsors@example.com";

  test("CONTRACT · a boothless sponsorship is never shown a load-in guide", () => {
    const chapters = sponsorHandbookChapters({ eventSlug: "aie-ny-2026", hasBooth: false, boothNumber: null, organizerEmail });
    expect(chapters.map((chapter) => chapter.id)).toEqual(["brand", "faq"]);
    for (const chapter of chapters) expect(chapter.markdown).not.toMatch(/load-in/i);
  });

  test("CONTRACT · a booth-bearing sponsorship gets the load-in chapter, naming its own booth", () => {
    const chapters = sponsorHandbookChapters({ eventSlug: "aie-ny-2026", hasBooth: true, boothNumber: "214", organizerEmail });
    expect(chapters.map((chapter) => chapter.id)).toEqual(["load-in", "brand", "faq"]);
    expect(chapters[0]!.markdown).toContain("**214**");
  });

  test("CONTRACT · the FAQ names the organizer to write to, or says where to find them", () => {
    expect(sponsorHandbookChapters({ eventSlug: "e", hasBooth: false, boothNumber: null, organizerEmail })
      .find((chapter) => chapter.id === "faq")!.markdown).toContain(organizerEmail);
    // A conference with no staff member on file must not print an empty mailto.
    const orphan = sponsorHandbookChapters({ eventSlug: "e", hasBooth: false, boothNumber: null, organizerEmail: null })
      .find((chapter) => chapter.id === "faq")!.markdown;
    expect(orphan).not.toContain("**null**");
    expect(orphan).toContain("in the header of this page");
  });
});

describe("the write-back template identities", () => {
  test("CONTRACT · the three write-back templates are distinct and namespaced", () => {
    const ids = Object.values(SPONSOR_WRITEBACK_TEMPLATE_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^tpl_sponsor-/);
  });
});
