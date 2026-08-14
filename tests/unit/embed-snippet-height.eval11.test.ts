import { describe, expect, test } from "vitest";

import { EMBED_KINDS, type EmbedKind } from "../../src/db/schema";
import {
  EMBED_SNIPPET_HEIGHT_PX,
  embedCalendarLink,
  embedIframeSnippet,
} from "../../src/lib/embed-snippet";
import { EMBED_CONFIG_SCRIPT } from "../../src/ui/embeds/EmbedPage";

/**
 * sbek round 11, manual EMB-15: the generated snippet carried
 * `style="width:100%;border:0"` with no height, no height attribute, and no
 * auto-resize script. Pasted onto a third-party page it rendered at the browser
 * default 150px — measured off-origin, `getBoundingClientRect().height` 150 —
 * so a visitor saw the header and the filter bar and essentially none of the
 * programme. Setting a height by hand revealed the whole correct widget.
 *
 * These assertions parse the generated tag rather than matching substrings of
 * it: a source-string check passes against a dead helper reference beside a
 * hand-written tag, which is the shape of the defect it claims to prevent.
 */

/** The generated snippet's attributes, read as a browser would read them. */
function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) found[name] = value;
  return found;
}

function styleOf(tag: string): Record<string, string> {
  return Object.fromEntries((attributes(tag).style ?? "")
    .split(";")
    .filter(Boolean)
    .map((rule) => rule.split(":").map((part) => part.trim()) as [string, string]));
}

const HOSTILE = 'AIE" onload="alert(1)';

describe("generated embed snippet", () => {
  test("CONTRACT · every kind's snippet states a height twice, so a pasted embed is not a 150px sliver", () => {
    for (const kind of EMBED_KINDS) {
      const tag = embedIframeSnippet("https://marquee.stage11.dev/embed/x", "Conference agenda", kind);
      const attrs = attributes(tag);
      const style = styleOf(tag);
      const height = EMBED_SNIPPET_HEIGHT_PX[kind];

      // The attribute, because an inline style is not a floor: a host CSP that
      // permits the frame and blocks inline styles reverts it to the 150px
      // default, and a host `!important` rule collapses it outright.
      expect(attrs.height, `${kind} carries a height attribute`).toBe(String(height));
      expect(attrs.width, `${kind} carries a width attribute`).toBe("100%");
      expect(style.height, `${kind} states the same height in its style`).toBe(`${height}px`);
      expect(style.width).toBe("100%");
      expect(style.border).toBe("0");
      // 150 is the default the defect rendered at; anything near it is the same
      // defect with extra steps.
      expect(height).toBeGreaterThan(200);
    }
  });

  test("CONTRACT · a conference name cannot escape the attribute it is written into", () => {
    // The snippet is delivered through a textarea, which decodes one layer of
    // entities before anyone copies it — so an unescaped quote in a conference
    // name is an executable attribute on whatever page it is pasted into.
    const tag = embedIframeSnippet("https://marquee.stage11.dev/embed/x?a=1&b=2", `${HOSTILE} agenda`, "agenda");
    expect(tag).not.toContain('onload="');
    expect(tag).toContain("&quot;");
    expect(attributes(tag).title).not.toContain('"');
    // The source is escaped on the same terms; its ampersand is not a new entity.
    expect(attributes(tag).src).toBe("https://marquee.stage11.dev/embed/x?a=1&amp;b=2");

    const link = embedCalendarLink("https://marquee.stage11.dev/embed/x.ics", HOSTILE);
    expect(link).not.toContain('onload="');
    expect(link).not.toContain(`>Add ${HOSTILE}`);
  });

  test("CONTRACT · the config page's own script builds the same tag, from the same numbers", () => {
    // The browser script is a string until it reaches a page, so a broken
    // interpolation is invisible to the type checker. Execute it.
    const built = new Function(`
      ${EMBED_CONFIG_SCRIPT.slice(EMBED_CONFIG_SCRIPT.indexOf("const SNIPPET_STYLE"), EMBED_CONFIG_SCRIPT.indexOf("const OUTPUT_LABEL"))}
      return { SNIPPET_STYLE, SNIPPET_HEIGHT, escapeAttr };
    `)() as {
      SNIPPET_STYLE: Record<EmbedKind, string>;
      SNIPPET_HEIGHT: Record<EmbedKind, number>;
      escapeAttr: (value: string) => string;
    };

    for (const kind of EMBED_KINDS) {
      expect(built.SNIPPET_HEIGHT[kind], `${kind} height matches the shared constant`).toBe(EMBED_SNIPPET_HEIGHT_PX[kind]);
      expect(built.SNIPPET_STYLE[kind]).toBe(styleAsWritten(kind));
    }
    // And it escapes the same hostile name the server-side builder does.
    expect(built.escapeAttr(HOSTILE)).not.toContain('"');
    expect(built.escapeAttr(HOSTILE)).toContain("&quot;");
  });

  test("CONTRACT · a call for speakers is shorter than a day of programme", () => {
    // Per kind because the content is, and measured rather than guessed: the
    // call for speakers block is a promotional card and a link, not the form.
    expect(EMBED_SNIPPET_HEIGHT_PX.cfp).toBeLessThan(EMBED_SNIPPET_HEIGHT_PX.agenda);
    expect(EMBED_SNIPPET_HEIGHT_PX.agenda).toBe(EMBED_SNIPPET_HEIGHT_PX.sessions);
    // A speakers gallery card is taller than an agenda row, so it gets more room.
    expect(EMBED_SNIPPET_HEIGHT_PX.speakers).toBeGreaterThan(EMBED_SNIPPET_HEIGHT_PX.agenda);
  });
});

function styleAsWritten(kind: EmbedKind): string {
  const height = EMBED_SNIPPET_HEIGHT_PX[kind];
  return `width:100%;height:${height}px;border:0`;
}
