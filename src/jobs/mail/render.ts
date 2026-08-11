import type { EmailTemplateRow } from "../../db/schema";

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
  return source.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) => {
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

export function renderMail(
  template: Pick<EmailTemplateRow, "subject" | "body_md">,
  data: MergeData,
): RenderedMail {
  const subject = mergeTemplate(template.subject, data);
  const text = mergeTemplate(markdownToText(template.body_md), data);
  const html = mergeTemplate(markdownToHtml(template.body_md), data);
  return { subject, text, html };
}
