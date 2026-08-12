/**
 * The one normalizer for a person's profile.
 *
 * A speaker's title, company, bio, social links, headshot, and logistics are
 * written from two directions — the speaker editing their own profile in the
 * portal, and an organizer editing the same person on the roster. Two
 * normalizers is how the round trip diverges: the portal trims a field the
 * organizer stores raw, one treats `null` as "clear" and the other as "leave
 * alone", and a bio saved on one screen comes back different on the other.
 * Both paths resolve their patch here instead.
 *
 * Headshot *validation* deliberately stays at each call site: it is
 * authorization, not normalization. The portal may only attach an upload owned
 * by the authenticated speaker; the organizer path checks the roster person it
 * is editing. A shared helper that took the attachment id on trust would be a
 * way to attach someone else's photo.
 */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { z } from "@hono/zod-openapi";

export interface PersonProfileColumns {
  title: string | null;
  company: string | null;
  bio: string | null;
  social_links: string;
  custom_fields?: string;
}

/** The patch shape both surfaces accept. `undefined` leaves a field alone; `null` clears it. */
export const personProfilePatchShape = {
  title: z.string().trim().max(200).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  bio: z.string().max(20_000).nullable().optional(),
  social_links: z.array(z.string().url()).max(12).optional(),
  headshot_attachment_id: z.string().min(1).nullable().optional(),
};

export type PersonProfilePatch = {
  title?: string | null;
  company?: string | null;
  bio?: string | null;
  social_links?: string[];
  headshot_attachment_id?: string | null;
};

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Stored social links are a JSON array of strings; anything else reads as none. */
export function parseSocialLinks(value: string | null | undefined): string[] {
  const parsed = parseJsonValue<unknown>(value, []);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
}

/** Stored custom fields are a flat JSON object; anything else reads as empty. */
export function parseCustomFields(value: string | null | undefined): Record<string, string> {
  const parsed = parseJsonValue<unknown>(value, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .filter(([, entry]) => typeof entry === "string")
      .map(([key, entry]) => [key, entry as string]),
  );
}

/**
 * Custom fields are a rider, not a schema: an organizer types "Dietary" and a
 * value, and it persists. Empty values delete their key rather than storing an
 * empty string, so a cleared field reads as absent on both surfaces.
 */
export function normalizeCustomFields(input: Record<string, string> | undefined, current: string | null): string {
  if (input === undefined) return current ?? "{}";
  const entries = Object.entries(input)
    .map(([key, value]) => [key.trim().slice(0, 80), value.trim().slice(0, 2_000)] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .slice(0, 40)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(Object.fromEntries(entries));
}

export interface ResolvedPersonProfile {
  title: string | null;
  company: string | null;
  bio: string | null;
  socialLinksJson: string;
}

/**
 * Fold a patch onto the stored row. An absent key means "leave alone" on both
 * surfaces; an explicit `null` clears. Empty strings normalize to `null` so a
 * cleared bio is absent rather than present-and-blank — the difference the
 * organizer record and the portal used to disagree about.
 */
export function resolvePersonProfile(current: PersonProfileColumns, patch: PersonProfilePatch): ResolvedPersonProfile {
  const fold = (next: string | null | undefined, stored: string | null): string | null => {
    if (next === undefined) return stored;
    if (next === null) return null;
    const trimmed = next.trim();
    return trimmed.length === 0 ? null : trimmed;
  };
  return {
    title: fold(patch.title, current.title),
    company: fold(patch.company, current.company),
    bio: fold(patch.bio, current.bio),
    socialLinksJson: JSON.stringify(patch.social_links ?? parseSocialLinks(current.social_links)),
  };
}

/**
 * The single `UPDATE people` both surfaces run. It is a prepared statement
 * rather than a call so the organizer path can compose it into the same
 * `batch()` as its audit row — an audit row in a separate transaction from the
 * change it describes reads as authoritative while being free to disagree.
 */
export function personProfileUpdateStatement(
  db: D1Database,
  personId: string,
  resolved: ResolvedPersonProfile,
  headshotAttachmentId: string | null,
  now: number,
  customFieldsJson?: string,
): D1PreparedStatement {
  if (customFieldsJson === undefined) {
    return db
      .prepare(
        `UPDATE people
         SET title = ?, company = ?, bio = ?, social_links = ?, headshot_attachment_id = ?,
             last_write_source = 'marquee', updated_at = ?
         WHERE id = ?`,
      )
      .bind(resolved.title, resolved.company, resolved.bio, resolved.socialLinksJson, headshotAttachmentId, now, personId);
  }
  return db
    .prepare(
      `UPDATE people
       SET title = ?, company = ?, bio = ?, social_links = ?, headshot_attachment_id = ?,
           custom_fields = ?, last_write_source = 'marquee', updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      resolved.title,
      resolved.company,
      resolved.bio,
      resolved.socialLinksJson,
      headshotAttachmentId,
      customFieldsJson,
      now,
      personId,
    );
}
