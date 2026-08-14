import { describe, expect, test } from "vitest";

import { EMBED_KINDS, type EmbedKind } from "../../src/db/schema";
import {
  EMBED_SNIPPET_HEIGHT_PX,
  embedCalendarLink,
  embedIframeSnippet,
} from "../../src/lib/embed-snippet";
import { EMBED_CONFIG_SCRIPT, EmbedConfigPage } from "../../src/ui/embeds/EmbedPage";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";

/**
 * sbek round 11, manual EMB-15: the generated snippet carried
 * `style="width:100%;border:0"` with no height, no height attribute, and no
 * auto-resize script. Pasted onto a third-party page it rendered at the browser
 * default 150px — measured off-origin, `getBoundingClientRect().height` 150 —
 * so a visitor saw the header and the filter bar and essentially none of the
 * programme. Setting a height by hand revealed the whole correct widget.
 *
 * These assertions parse the generated tag and RUN the generated script, rather
 * than matching substrings of either. A source-string check passes against a
 * dead helper reference beside a hand-written tag, which is the shape of the
 * defect it claims to prevent.
 */

/**
 * The one layer of entity decoding a browser performs when a script reads
 * `textarea.value`, or a human selects and copies what is displayed.
 */
function decodeOnce(value: string): string {
  return value
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"').replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/** The snippet the server-rendered page hands over, as an organizer copies it. */
function renderedSnippet(eventName: string, output: string): { snippet: string; note: string } {
  const event = {
    id: "e", name: eventName, slug: "aie", tagline: null,
    starts_on: "2026-10-12", ends_on: "2026-10-14", timezone: "America/New_York", accent: "#0b6a72",
  } as never;
  const preview = {
    event, venue: { disclosed: false }, slug: "aie-agenda", kind: "agenda",
    config: { fields: [] }, tracks: [], formats: [], rooms: [], sessions: [], speakers: [],
  } as never;
  const html = renderToString(h(EmbedConfigPage, {
    event, tracks: [], kind: "agenda", track: "", status: "", layout: "cards",
    accent: "#0b6a72", fields: [], output, preview,
  } as never));
  const textarea = /data-embed-code="true"[^>]*>([\s\S]*?)<\/textarea>/.exec(html);
  const note = /class="embed-preview-note"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  return { snippet: decodeOnce(textarea?.[1] ?? ""), note: decodeOnce(note?.[1] ?? "") };
}

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

/** A name that closes the attribute it is written into. */
const HOSTILE_ATTRIBUTE = 'AIE" onload="alert(1)';
/** A name that opens a tag in a text context. */
const HOSTILE_TEXT = "AIE <img src=x onerror=alert(1)>";

/**
 * The config page's script, executed against the smallest DOM it will accept.
 *
 * The script is a string until it reaches a page, so nothing about it is
 * type-checked and a broken interpolation is invisible. Running it and reading
 * the textarea is the only way to assert what an organizer actually copies.
 */
function runConfigScript(options: { eventName: string; kind: EmbedKind; output: string }): {
  snippet: string;
  previewNote: string;
} {
  const code = { value: "" };
  const previewNote = { textContent: "" };
  const preview = { src: "", setAttribute: () => undefined };
  const button = (data: Record<string, string>) => ({
    dataset: data,
    classList: { contains: (name: string) => name === "active" && data.active === "1", add: () => undefined, remove: () => undefined, toggle: () => undefined },
    addEventListener: () => undefined,
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
    querySelectorAll: () => [],
  });
  const form = { addEventListener: () => undefined, querySelectorAll: () => [], querySelector: () => null };
  const byQuery: Record<string, unknown> = {
    "[data-embed-config]": form,
    "[data-embed-code]": code,
    "[data-embed-preview]": preview,
    "[data-copy-embed]": null,
    "[data-track-note]": null,
    "[data-status-note]": null,
    "[data-layout-note]": null,
    "[data-preview-note]": previewNote,
  };
  const listsByQuery: Record<string, unknown[]> = {
    "[data-embed-kind]": EMBED_KINDS.map((kind) => button({ embedKind: kind, active: kind === options.kind ? "1" : "0" })),
    "[data-embed-output]": ["html", "basic", "json", "xml", "ical"].map((output) => button({ embedOutput: output, active: output === options.output ? "1" : "0" })),
    "[data-embed-layout]": ["cards", "list"].map((layout) => button({ embedLayout: layout, active: layout === "cards" ? "1" : "0" })),
    "[data-embed-fields-for]": [],
  };

  const context = {
    document: {
      querySelector: (selector: string) => byQuery[selector] ?? null,
      querySelectorAll: (selector: string) => listsByQuery[selector] ?? [],
      getElementById: () => null,
    },
    window: { location: { origin: "https://host.example" } },
    FormData: class {
      get(name: string): string {
        return name === "event" ? options.eventName : "";
      }
    },
    URLSearchParams,
    Array,
    String,
    encodeURIComponent,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(...Object.keys(context), EMBED_CONFIG_SCRIPT)(...Object.values(context));
  return { snippet: code.value, previewNote: previewNote.textContent };
}

describe("generated embed snippet", () => {
  test("CONTRACT · every kind's snippet states a height twice, so a pasted embed is not a 150px sliver", () => {
    for (const kind of EMBED_KINDS) {
      const tag = embedIframeSnippet("https://marquee.stage11.dev/embed/x", "Conference agenda", kind);
      const attrs = attributes(tag);
      const style = styleOf(tag);
      const height = EMBED_SNIPPET_HEIGHT_PX[kind];

      // The attribute, because the inline style alone is not enough: measured, a
      // host CSP that permits the frame and blocks inline styles reverts it to
      // the 150px default while the attribute holds.
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

  test("CONTRACT · a conference name cannot escape the attribute or the text it is written into", () => {
    // The snippet is delivered through a textarea, which decodes one layer of
    // entities before anyone copies it — so an unescaped quote in a conference
    // name is an executable attribute on whatever page it is pasted into.
    const tag = embedIframeSnippet("https://marquee.stage11.dev/embed/x?a=1&b=2", `${HOSTILE_ATTRIBUTE} agenda`, "agenda");
    expect(tag).not.toContain('onload="');
    expect(attributes(tag).title).not.toContain('"');
    expect(attributes(tag).src).toBe("https://marquee.stage11.dev/embed/x?a=1&amp;b=2");

    // The calendar link writes the name into a TEXT context, where a tag needs
    // no quote at all to open.
    const link = embedCalendarLink("https://marquee.stage11.dev/embed/x.ics", HOSTILE_TEXT);
    expect(link).not.toContain("<img");
    expect(link).toContain("&lt;img");
    expect(embedCalendarLink("https://x.test/y", HOSTILE_ATTRIBUTE)).not.toContain('onload="');
  });

  test("CONTRACT · the config page's own script produces that same tag, run rather than read", () => {
    for (const kind of EMBED_KINDS) {
      const { snippet, previewNote } = runConfigScript({ eventName: "AIE NYC 2026", kind, output: "html" });
      const attrs = attributes(snippet);
      expect(attrs.height, `${kind} height in the copied snippet`).toBe(String(EMBED_SNIPPET_HEIGHT_PX[kind]));
      expect(attrs.width).toBe("100%");
      expect(styleOf(snippet).height).toBe(`${EMBED_SNIPPET_HEIGHT_PX[kind]}px`);
      // The note beside the preview follows the kind rather than freezing on the
      // one the page was rendered with.
      expect(previewNote, `${kind} preview note`).toContain(`${EMBED_SNIPPET_HEIGHT_PX[kind]}px tall`);
    }
  });

  test("CONTRACT · the script escapes the conference name the server-side builder escapes", () => {
    const { snippet } = runConfigScript({ eventName: HOSTILE_ATTRIBUTE, kind: "agenda", output: "html" });
    expect(snippet).not.toContain('onload="');
    expect(attributes(snippet).title).not.toContain('"');

    const calendar = runConfigScript({ eventName: HOSTILE_TEXT, kind: "agenda", output: "ical" });
    expect(calendar.snippet).not.toContain("<img");
    expect(calendar.snippet).toContain("&lt;img");
  });

  test("CONTRACT · what the server-rendered page hands over survives its own decoding", () => {
    // The snippet reaches an organizer through a textarea, which decodes one
    // layer of entities. What matters is the string AFTER that decode: a
    // conference name has to still be inert once the page has undone a layer.
    const { snippet } = renderedSnippet(`${HOSTILE_ATTRIBUTE} agenda`, "html");
    expect(snippet).toContain("<iframe");
    expect(attributes(snippet).height).toBe(String(EMBED_SNIPPET_HEIGHT_PX.agenda));
    // The name's quotes are still entities after the decode, so the title
    // attribute is not closed and no handler is created.
    expect(attributes(snippet).title).not.toContain('"');
    expect(snippet).not.toContain('onload="alert(1)"');
    expect(snippet).toContain("&quot;");

    const text = renderedSnippet(HOSTILE_TEXT, "ical");
    expect(text.snippet).not.toContain("<img");
  });

  test("CONTRACT · the note beside the preview is true of the output it describes", () => {
    // Only the HTML output is a frame. Telling someone copying a JSON URL that
    // their snippet is 720px tall is a plain untruth, on the surface whose whole
    // job is telling them what they just copied.
    expect(renderedSnippet("AIE NYC 2026", "html").note).toContain(`${EMBED_SNIPPET_HEIGHT_PX.agenda}px`);
    for (const output of ["json", "xml", "basic", "ical"]) {
      const { note } = renderedSnippet("AIE NYC 2026", output);
      expect(note, `${output} note`).not.toContain("px tall");
      expect(note, `${output} note`).toContain("link rather than a frame");
    }
    // And the script agrees, for the output an organizer switches to in place.
    expect(runConfigScript({ eventName: "AIE NYC 2026", kind: "agenda", output: "json" }).previewNote)
      .toContain("link rather than a frame");
  });

  test("CONTRACT · a call for speakers is shorter than a day of programme", () => {
    // Per kind because the content is, and measured rather than guessed.
    expect(EMBED_SNIPPET_HEIGHT_PX.cfp).toBeLessThan(EMBED_SNIPPET_HEIGHT_PX.agenda);
    expect(EMBED_SNIPPET_HEIGHT_PX.agenda).toBe(EMBED_SNIPPET_HEIGHT_PX.sessions);
    // A speakers gallery card is far taller than an agenda row, so it gets more
    // room — though no embeddable height fits one whole, which is a layout
    // question filed on its own rather than answered here.
    expect(EMBED_SNIPPET_HEIGHT_PX.speakers).toBeGreaterThan(EMBED_SNIPPET_HEIGHT_PX.agenda);
  });
});
