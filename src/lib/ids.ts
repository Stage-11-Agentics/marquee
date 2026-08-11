/**
 * Deterministic ID helpers for the seed generator.
 *
 * Rows the app writes at runtime use ULIDs (SPEC §2.4); rows the seed writes
 * must instead be stable across re-runs so `npm run seed` stays idempotent.
 * Seed IDs are readable slugs (`evt_aie-ny-2026`, `sub_<session-slug>`),
 * which also makes demo debugging and `external_ref` provenance legible.
 */

/** Lowercase, strip diacritics, collapse every non-alphanumeric run to `-`. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/-{2,}/g, "-")
    .replaceAll(/^-|-$/g, "");
}

/** A deterministic seed row ID: `<prefix>_<slugified key>`. */
export function seedId(prefix: string, key: string): string {
  const slug = slugify(key);
  if (!slug) throw new Error(`seedId(${prefix}) got an unsluggable key: ${JSON.stringify(key)}`);
  return `${prefix}_${slug}`;
}

/**
 * A synthetic email for a seeded person: `firstname.lastname@example.com`.
 * Real addresses must never enter the repo (SPEC §6 hard prohibition);
 * `example.com` is reserved for documentation, so these can never deliver.
 * `taken` enforces per-org uniqueness deterministically (`-2`, `-3`, …) —
 * callers must iterate people in a stable order.
 */
export function syntheticEmail(name: string, taken: Set<string>): string {
  const parts = name.trim().split(/\s+/);
  const first = slugify(parts[0] ?? "person").replaceAll("-", "") || "person";
  const last = slugify(parts.at(-1) ?? "speaker") || "speaker";
  const base = `${first}.${last}`;
  let local = base;
  for (let suffix = 2; taken.has(`${local}@example.com`); suffix += 1) {
    local = `${base}-${suffix}`;
  }
  const email = `${local}@example.com`;
  taken.add(email);
  return email;
}
