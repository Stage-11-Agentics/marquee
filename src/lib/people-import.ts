/**
 * Contacts CSV, auto-mapped.
 *
 * There is deliberately no column-mapping wizard. A speaker export's headers are
 * already the field names — "Email", "Full Name", "Company", "Job Title" — and a
 * three-step wizard between the organizer and the import is three steps of
 * nothing. Columns are mapped by header; whatever cannot be mapped comes back in
 * `unmapped[]` so the organizer is told what was ignored rather than left to
 * discover it.
 *
 * Matching is on the email address, so re-importing an updated export updates
 * people rather than duplicating them. That is the one thing an importer has to
 * get right.
 */
import { normalizeEmail, parseCsv } from "./sessionize-import";

export const PERSON_IMPORT_FIELDS = ["email", "name", "title", "company", "bio"] as const;
export type PersonImportField = (typeof PERSON_IMPORT_FIELDS)[number];

/**
 * Header spellings seen in real exports, normalized to lowercase alphanumerics
 * so "Job Title", "job_title", and "JobTitle" are one key.
 */
const HEADER_ALIASES: Record<string, PersonImportField> = {
  email: "email",
  emailaddress: "email",
  mail: "email",
  name: "name",
  fullname: "name",
  speakername: "name",
  displayname: "name",
  title: "title",
  jobtitle: "title",
  role: "title",
  position: "title",
  company: "company",
  organization: "company",
  organisation: "company",
  employer: "company",
  bio: "bio",
  biography: "bio",
  about: "bio",
};

function headerKey(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface PersonImportMapping {
  /** Column index per field, when the header names one. */
  columns: Partial<Record<PersonImportField, number>>;
  /** Headers no field claimed — reported, never silently dropped. */
  unmapped: string[];
}

export function mapPersonHeaders(headers: readonly string[]): PersonImportMapping {
  const columns: Partial<Record<PersonImportField, number>> = {};
  const unmapped: string[] = [];
  headers.forEach((header, index) => {
    const field = HEADER_ALIASES[headerKey(header)];
    // First column wins: an export carrying both "Name" and "Display Name"
    // should import the one the reader sees first, not the last one parsed.
    if (field && columns[field] === undefined) columns[field] = index;
    else unmapped.push(header.trim());
  });
  return { columns, unmapped };
}

export interface PersonImportRow {
  email: string;
  name: string;
  title: string | null;
  company: string | null;
  bio: string | null;
}

export interface PersonImportPlan {
  rows: PersonImportRow[];
  /** Rows with no usable email or name; counted as skipped rather than guessed at. */
  skipped: number;
  unmapped: string[];
  headers: string[];
}

/**
 * Read a contacts CSV into rows ready to write. A row needs an email and a
 * name; anything else is optional and lands as NULL rather than as "".
 */
export function planPersonImport(text: string): PersonImportPlan {
  const table = parseCsv(text);
  const mapping = mapPersonHeaders(table.headers);
  const rows: PersonImportRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const cell = (row: readonly string[], field: PersonImportField): string => {
    const index = mapping.columns[field];
    return index === undefined ? "" : (row[index] ?? "").trim();
  };
  for (const row of table.rows) {
    const email = normalizeEmail(cell(row, "email"));
    const name = cell(row, "name");
    if (!email.includes("@") || name.length === 0) {
      skipped += 1;
      continue;
    }
    // A file that lists the same address twice is one person, not two writes
    // racing each other for the last value.
    if (seen.has(email)) {
      skipped += 1;
      continue;
    }
    seen.add(email);
    rows.push({
      email,
      name,
      title: cell(row, "title") || null,
      company: cell(row, "company") || null,
      bio: cell(row, "bio") || null,
    });
  }
  return { rows, skipped, unmapped: mapping.unmapped, headers: table.headers.map((header) => header.trim()) };
}
