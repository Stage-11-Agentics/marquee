import type { EmbedKind } from "../db/schema";
import { escapeHtml } from "../jobs/mail/render";

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
 * The numbers are per kind because the content is, and they are measured rather
 * than guessed — rendered against a seeded runtime in Chromium at a 600px and a
 * 375px host. An agenda or sessions embed shows three complete cards at 720px.
 * A call for speakers block is a promotional card and a link, not the form: its
 * content ends around 174px, so 240px frames it without dead space beneath.
 * A speakers gallery card is far taller than either, so it takes 900px.
 *
 * The speakers gallery is the one kind NO embeddable height satisfies, and the
 * honest thing is to say so rather than pick a number and describe it well.
 * Measured: one whole card needs 2276px at a 600px host and 2432px at 375px,
 * and one whole card plus the next beginning needs 2355px / 2591px — taller
 * than most pages. The list layout is no escape either: with the default fields
 * its first row ends at 3752px / 3828px, worse than cards. 900px is the most of
 * that first card a reasonable embed can show, and the gallery scrolls from
 * there.
 *
 * Nothing about the snippet can fix that. The row height is the defect
 * underneath, it is a layout question rather than a snippet one, and it is
 * reported to the eval triage seat rather than absorbed here or minted as a
 * ticket by a delegator who is not the board's single writer.
 */
export const EMBED_SNIPPET_HEIGHT_PX: Readonly<Record<EmbedKind, number>> = {
  agenda: 720,
  sessions: 720,
  speakers: 900,
  cfp: 240,
};

/** The style attribute every generated HTML snippet carries. */
/**
 * What the page can honestly tell an organizer about the snippet they copied.
 *
 * Only the HTML output is an iframe. The others hand over a URL or an anchor,
 * and telling their user a pixel height is simply false. Changing the height
 * also means changing BOTH numbers: the inline style wins over the attribute,
 * so editing `height="900"` alone leaves the frame where it was.
 */
export function embedSnippetNote(kind: EmbedKind, output: string): string {
  if (output !== "html") return "Fitted to this panel. This output is a link rather than a frame, so it has no height of its own.";
  const height = EMBED_SNIPPET_HEIGHT_PX[kind];
  return `Fitted to this panel. Your snippet is ${height}px tall — change both the height attribute and the height in the style to resize it.`;
}

export function embedSnippetStyle(kind: EmbedKind): string {
  const height = EMBED_SNIPPET_HEIGHT_PX[kind];
  return `width:100%;height:${height}px;border:0`;
}

/**
 * The whole `<iframe>` a host pastes, so the three builders cannot disagree
 * about anything in it — not the height, and not the escaping either.
 *
 * The height is stated TWICE, as an attribute and in the style, because the
 * style alone is not enough: measured, under a host CSP that permits the frame
 * and blocks inline styles the frame reverts to the 150px default, while the
 * attribute still holds. It is also the number a host most easily finds and
 * edits.
 *
 * Neither is a guarantee, and this snippet does not pretend otherwise. A host
 * rule of `iframe { height: 96px !important }` measured 96px with `height="900"`
 * present — a page can always overrule its own embeds, and an earlier
 * `min-height` here claimed a floor it did not have.
 *
 * `title` and the calendar link's text are conference-controlled strings going
 * into an HTML attribute and into HTML text. The snippet is delivered through a
 * textarea, which decodes one layer of entities before anyone copies it, so an
 * unescaped quote in a conference name is an executable attribute on whatever
 * page it is pasted into.
 */
export function embedIframeSnippet(source: string, title: string, kind: EmbedKind): string {
  const height = EMBED_SNIPPET_HEIGHT_PX[kind];
  return `<iframe src="${escapeHtml(source)}" title="${escapeHtml(title)}" loading="lazy" width="100%" height="${height}" style="${embedSnippetStyle(kind)}"></iframe>`;
}

/** The calendar link, escaped on the same terms. */
export function embedCalendarLink(source: string, label: string): string {
  return `<a href="${escapeHtml(source)}">Add ${escapeHtml(label)} to calendar</a>`;
}
