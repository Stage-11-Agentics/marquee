import { describe, expect, test } from "vitest";

import { parseSpeakers } from "../../src/lib/public-site";

describe("MRQ-122 public speaker projection", () => {
  test("EMB-04 + EMB-12 · exposes demo avatar URLs and keeps the intentional fallback", () => {
    const speakers = parseSpeakers(JSON.stringify([
      { id: "person-avatar", name: "Grace Isford", title: null, company: null, bio: null, is_demo: 1, social_links: "[]" },
      { id: "person-fallback", name: "Aarush Selvan", title: null, company: null, bio: null, is_demo: 1, social_links: "[]" },
      { id: "person-real", name: "Grace Isford", title: null, company: null, bio: null, is_demo: 0, social_links: "[]" },
    ]));

    expect(speakers[0]?.headshotUrl).toBe("/headshots/grace-isford.svg");
    expect(speakers[1]?.headshotUrl).toBeNull();
    expect(speakers[2]?.headshotUrl).toBeNull();
    expect("is_demo" in (speakers[0] ?? {})).toBe(false);
  });
});
