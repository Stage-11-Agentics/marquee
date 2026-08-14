import type { EmbedKind } from "../db/schema";

/**
 * The height the generated snippet carries.
 *
 * An iframe with no height renders at the browser's default 150px, and the
 * snippet already sets width and border — so omitting height was an oversight,
 * not a choice. Pasted onto a third-party page the visitor saw the header and
 * the filter bar and essentially none of the programme.
 *
 * A fixed height rather than an auto-resize script, deliberately. A resize
 * script stops the snippet being one self-contained tag, is stripped outright
 * by a good number of CMS and newsletter editors, and needs a cross-origin
 * postMessage contract on the embed page to exist at all — and when any of that
 * fails the visitor gets back exactly today's 150px sliver. One attribute has
 * no such failure mode: the widget scrolls inside whatever height it is given,
 * and a host who wants a different one edits a number they can see.
 *
 * The numbers are per kind because the content is: an agenda is a day of rows,
 * a call for speakers is a short card.
 */
export const EMBED_SNIPPET_HEIGHT_PX: Readonly<Record<EmbedKind, number>> = {
  agenda: 720,
  sessions: 720,
  speakers: 720,
  cfp: 420,
};

/** The style attribute every generated HTML snippet carries. */
export function embedSnippetStyle(kind: EmbedKind): string {
  const height = EMBED_SNIPPET_HEIGHT_PX[kind];
  return `width:100%;height:${height}px;min-height:${height}px;border:0`;
}
