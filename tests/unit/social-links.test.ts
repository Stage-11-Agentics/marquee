import { describe, expect, test } from "vitest";

import {
  classifySocialLink,
  composeSocialLinks,
  normalizeHandle,
  readEnabledPlatforms,
  socialPlatform,
  splitSocialLinks,
  type SocialPlatformId,
} from "../../src/lib/social-links";

const x = socialPlatform("x")!;
const linkedin = socialPlatform("linkedin")!;

describe("reading a stored link", () => {
  test("a twitter.com link imported years ago still reads as an X profile", () => {
    const classified = classifySocialLink("https://twitter.com/AarushSelvan");
    expect(classified.platform?.id).toBe("x");
    expect(classified.handle).toBe("AarushSelvan");
    expect(classified.label).toBe("@AarushSelvan");
  });

  test("a LinkedIn profile reads through www and a trailing slash", () => {
    const classified = classifySocialLink("https://www.linkedin.com/in/aarush-selvan-3a376a8b/");
    expect(classified.platform?.id).toBe("linkedin");
    expect(classified.handle).toBe("aarush-selvan-3a376a8b");
  });

  test("a LinkedIn company page is not a speaker, so it stays an unnamed link", () => {
    expect(classifySocialLink("https://www.linkedin.com/company/stage-11").platform).toBeNull();
  });

  test("an x.com product path is not a handle", () => {
    // Without the reserved-path guard this renders as the speaker being `@i`.
    expect(classifySocialLink("https://x.com/i/lists/12345").platform).toBeNull();
  });

  test("a link on no shipped platform keeps its host as the label", () => {
    const classified = classifySocialLink("https://example.com/talks");
    expect(classified.platform).toBeNull();
    expect(classified.label).toBe("example.com/talks");
  });

  test("a value that is not a URL at all does not throw", () => {
    expect(classifySocialLink("not a link").platform).toBeNull();
  });
});

describe("splitting a speaker's links", () => {
  test("named profiles come back in product order, everything else is kept", () => {
    const { profiles, other } = splitSocialLinks([
      "https://www.linkedin.com/in/someone",
      "https://example.com/talks",
      "https://twitter.com/someone",
    ]);
    expect(profiles.map((entry) => entry.platform.id)).toEqual(["x", "linkedin"]);
    expect(other).toEqual(["https://example.com/talks"]);
  });

  test("a second link on the same platform is kept rather than dropped", () => {
    const { profiles, other } = splitSocialLinks(["https://x.com/first", "https://x.com/second"]);
    expect(profiles).toHaveLength(1);
    expect(other).toEqual(["https://x.com/second"]);
  });
});

describe("reading what a speaker typed", () => {
  test("a bare handle, an @handle and a pasted profile URL all mean the same thing", () => {
    for (const input of ["AarushSelvan", "@AarushSelvan", "https://x.com/AarushSelvan", "twitter.com/AarushSelvan"]) {
      expect(normalizeHandle(x, input)).toEqual({ handle: "AarushSelvan", error: null });
    }
  });

  test("a LinkedIn URL pasted into the X field names the mistake", () => {
    const result = normalizeHandle(x, "https://linkedin.com/in/someone");
    expect(result.handle).toBe("");
    expect(result.error).toContain("LinkedIn");
  });

  test("an empty field is not an error", () => {
    expect(normalizeHandle(linkedin, "  ")).toEqual({ handle: "", error: null });
  });

  test("a handle that cannot exist on the platform is refused", () => {
    expect(normalizeHandle(x, "a-handle-far-too-long-for-x").error).not.toBeNull();
  });
});

describe("writing links back", () => {
  test("handles become canonical URLs and unnamed links are carried through", () => {
    const handles = new Map<SocialPlatformId, string>([["linkedin", "someone"], ["x", "someone"]]);
    expect(composeSocialLinks(handles, ["https://example.com/talks"])).toEqual([
      "https://x.com/someone",
      "https://www.linkedin.com/in/someone",
      "https://example.com/talks",
    ]);
  });

  test("a legacy twitter.com link round-trips into the canonical x.com form", () => {
    const { profiles, other } = splitSocialLinks(["https://twitter.com/someone"]);
    const handles = new Map(profiles.map((entry) => [entry.platform.id, entry.handle]));
    expect(composeSocialLinks(handles, other)).toEqual(["https://x.com/someone"]);
  });
});

describe("which platforms a conference asks for", () => {
  test("an unset setting means every shipped platform, not none", () => {
    expect(readEnabledPlatforms(null)).toEqual(["x", "linkedin"]);
    expect(readEnabledPlatforms("nonsense")).toEqual(["x", "linkedin"]);
  });

  test("an empty list is a real choice and is honored", () => {
    expect(readEnabledPlatforms(JSON.stringify({ platforms: [] }))).toEqual([]);
  });

  test("the stored order does not reshuffle the form, and unknown ids are ignored", () => {
    expect(readEnabledPlatforms(JSON.stringify({ platforms: ["linkedin", "myspace", "x"] }))).toEqual(["x", "linkedin"]);
  });
});
