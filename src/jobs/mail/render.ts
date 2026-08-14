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
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*`#>]/g, "")
    .trim();
}

function markdownToHtml(markdown: string): string {
  return markdownToText(markdown)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
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
