import type { EmailTemplateRow } from "../../db/schema";
import { MERGE_TOKEN_PATTERN } from "../../lib/mail-merge-fields";

export type MergeValue = string | number | boolean | null | undefined;
export type MergeData = Record<string, MergeValue>;

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

/** Escape values before they enter the rendered HTML body. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Merge fields are deliberately boring: the template owns the field names,
 * and an absent value stays visible in previews rather than disappearing.
 * This keeps an operator from sending a message that silently lost context.
 */
export function mergeTemplate(source: string, data: MergeData): string {
  return source.replace(MERGE_TOKEN_PATTERN, (_match, key: string) => {
    const value = data[key];
    return value === null || value === undefined ? `{{${key}}}` : String(value);
  });
}

function markdownToText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    // Keep the destination visible in plain mail. Feedback is organizer-authored
    // markdown, and dropping the URL turns a useful decision fact into a dead
    // label for recipients whose client does not render HTML.
    .replace(/\[([^\]]+)\]\(([^\)]+)\)/g, "$1 ($2)")
    .replace(/[*`#>]/g, "")
    .trim();
}

function safeMarkdownHref(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function markdownParagraphToHtml(paragraph: string): string {
  const linkPattern = /\[([^\]]+)\]\(([^\)]+)\)/g;
  let html = "";
  let cursor = 0;
  for (const match of paragraph.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    html += escapeHtml(paragraph.slice(cursor, index));
    const label = match[1] ?? "";
    const destination = match[2] ?? "";
    const href = safeMarkdownHref(destination);
    html += href === null
      ? `${escapeHtml(label)} (${escapeHtml(destination)})`
      : `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
    cursor = index + match[0].length;
  }
  html += escapeHtml(paragraph.slice(cursor));
  return html.replace(/[*`#>]/g, "").replaceAll("\n", "<br>");
}

function markdownToHtml(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${markdownParagraphToHtml(paragraph)}</p>`)
    .join("");
}

/** The plan can show truthful copy without minting a credential it will not send. */
export const DECISION_PORTAL_PREVIEW_PLACEHOLDER = "(a private speaker portal link is generated for each recipient at send time)";

/**
 * Decision mail has one extra invariant beyond ordinary template rendering:
 * an organizer may remove the portal token while editing a template, but a
 * decision recipient must still receive the link minted for that recipient.
 */
export function renderDecisionMail(
  template: Pick<EmailTemplateRow, "subject" | "body_md">,
  data: MergeData,
  portalLink?: string,
): RenderedMail {
  const mergedData = { ...data, "portal.link": portalLink ?? DECISION_PORTAL_PREVIEW_PLACEHOLDER };
  const rendered = renderMail(template, mergedData);
  if (!portalLink || rendered.text.includes(portalLink)) return rendered;
  return renderMail(
    { ...template, body_md: `${template.body_md}\n\nOpen your speaker portal: ${portalLink}` },
    mergedData,
  );
}

/**
 * Render ad-hoc operator copy through the exact same merge and escaping path
 * as stored templates. Callers may choose the copy, but they do not get a
 * second renderer with subtly different merge-field or HTML behavior.
 */
export function renderAdHocMail(subject: string, body: string, data: MergeData): RenderedMail {
  const mergedBody = mergeTemplate(body, data);
  return {
    subject: mergeTemplate(subject, data),
    text: markdownToText(mergedBody),
    html: markdownToHtml(mergedBody),
  };
}

export function renderMail(
  template: Pick<EmailTemplateRow, "subject" | "body_md">,
  data: MergeData,
): RenderedMail {
  const subject = mergeTemplate(template.subject, data);
  const mergedBody = mergeTemplate(template.body_md, data);
  return { subject, text: markdownToText(mergedBody), html: markdownToHtml(mergedBody) };
}
