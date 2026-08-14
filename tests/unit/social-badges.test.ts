import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import { SocialBadges } from "../../src/ui/social/SocialBadges";

function render(links: string[]): string {
  return renderToString(h(SocialBadges, { links, ownerName: "Aarush Selvan" }));
}

describe("the badges a speaker's profiles get", () => {
  test("a profile link carries the platform in its accessible name, not just its mark", () => {
    const html = render(["https://twitter.com/AarushSelvan"]);
    expect(html).toContain('aria-label="Aarush Selvan on X"');
    expect(html).toContain("@AarushSelvan");
  });

  test("the canonical destination is used even when the stored link is the old host", () => {
    // The badge links where the speaker's link points; only the label is derived.
    expect(render(["https://twitter.com/AarushSelvan"])).toContain('href="https://twitter.com/AarushSelvan"');
  });

  test("every outbound link carries rel=me and opener hygiene", () => {
    const html = render(["https://x.com/someone", "https://example.com/talks"]);
    expect(html.match(/rel="me noopener noreferrer"/g)).toHaveLength(2);
  });

  test("a link on no shipped platform is still shown, under its host", () => {
    expect(render(["https://example.com/talks"])).toContain("example.com");
  });

  test("a speaker with no links renders nothing at all", () => {
    expect(render([])).toBe("");
  });
});
