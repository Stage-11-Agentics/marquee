import { describe, expect, test } from "vitest";

import { EMBED_KINDS } from "../../src/db/schema";
import { EMBED_SNIPPET_HEIGHT_PX, embedSnippetStyle } from "../../src/lib/embed-snippet";
import embedPageSource from "../../src/ui/embeds/EmbedPage.tsx?raw";
import embedsRoutesSource from "../../src/routes/embeds.routes.ts?raw";

/**
 * sbek round 11, manual EMB-15: the generated snippet carried
 * `style="width:100%;border:0"` with no height, no height attribute, and no
 * auto-resize script. Pasted onto a third-party page it rendered at the browser
 * default 150px — measured off-origin, `getBoundingClientRect().height` 150 —
 * so a visitor saw the header and the filter bar and essentially none of the
 * programme. Setting a height by hand revealed the whole correct widget, so the
 * content was never the problem.
 *
 * That the snippet sets width and border and not height is what makes it an
 * oversight rather than a choice.
 */

describe("generated embed snippet", () => {
  test("CONTRACT · every kind's snippet carries a height, so a pasted embed is not a 150px sliver", () => {
    for (const kind of EMBED_KINDS) {
      const style = embedSnippetStyle(kind);
      expect(style, `${kind} sets a height`).toMatch(/(^|;)height:\d+px(;|$)/);
      // A host stylesheet must not be able to collapse it back.
      expect(style, `${kind} floors that height`).toMatch(/(^|;)min-height:\d+px(;|$)/);
      expect(style, `${kind} keeps the width and border it already had`).toContain("width:100%");
      expect(style, `${kind} keeps the width and border it already had`).toContain("border:0");
      // 150 is the browser default the defect rendered at; anything near it is
      // the same defect with extra steps.
      expect(EMBED_SNIPPET_HEIGHT_PX[kind]).toBeGreaterThan(300);
    }
  });

  test("CONTRACT · the height is stated once and every snippet builder reads it", () => {
    // Three builders generate this snippet — the saved-embed API, the config
    // page's server render, and the config page's own browser script. A height
    // written into one of them is a height the other two do not have.
    expect(embedsRoutesSource).toContain("embedSnippetStyle(config.kind)");
    expect(embedPageSource).toContain("embedSnippetStyle(kind)");
    expect(embedPageSource).toContain("SNIPPET_STYLE[kind]");
    expect(embedPageSource).toContain("embedSnippetStyle(kind)])))}");

    // And none of them may go back to hand-writing the style.
    for (const source of [embedsRoutesSource, embedPageSource]) {
      expect(source).not.toContain('style="width:100%;border:0"');
    }
  });

  test("CONTRACT · a call for speakers is shorter than a day of programme", () => {
    // The numbers are per kind because the content is. This is the ordering,
    // not the exact pixels, so tuning one does not fail the suite.
    expect(EMBED_SNIPPET_HEIGHT_PX.cfp).toBeLessThan(EMBED_SNIPPET_HEIGHT_PX.agenda);
    expect(EMBED_SNIPPET_HEIGHT_PX.agenda).toBe(EMBED_SNIPPET_HEIGHT_PX.sessions);
  });
});
