/**
 * Two people can share a name. The importer keys on the normalized email, so
 * two addresses are two records and that is correct — but a list that prints
 * only the name turns them into one indistinguishable pair, and an organizer
 * assigning a task picks whichever row their eye landed on.
 *
 * The fix is display-level: mark the collision so a human or an agent can tell
 * the rows apart. Nothing is written back; the stored name never changes.
 *
 * The suffix is ordered by the record id, not by list position, so a given
 * person carries the same label under every sort. Position-ordering would hand
 * "(2)" to a different human each time the list was re-sorted, which is worse
 * than no marker at all.
 */

export interface NamedRecord {
  id: string;
  name: string;
}

function collationKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Ids of records whose displayed name collides, mapped to the suffix ordinal
 * they should carry. The first record of each colliding group is absent: it
 * keeps its plain name, and only the second and subsequent ones are marked.
 */
export function duplicateNameOrdinals(records: readonly NamedRecord[]): Map<string, number> {
  const groups = new Map<string, string[]>();
  for (const record of records) {
    const key = collationKey(record.name);
    if (key === "") continue;
    const group = groups.get(key);
    if (group) group.push(record.id);
    else groups.set(key, [record.id]);
  }
  const ordinals = new Map<string, number>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const ordered = [...new Set(ids)].sort();
    if (ordered.length < 2) continue;
    ordered.forEach((id, index) => {
      if (index > 0) ordinals.set(id, index + 1);
    });
  }
  return ordinals;
}

/** The name to print for one record, given the ordinals for its list. */
export function disambiguatedName(
  record: NamedRecord,
  ordinals: ReadonlyMap<string, number>,
): string {
  const ordinal = ordinals.get(record.id);
  return ordinal === undefined ? record.name : `${record.name} (${ordinal})`;
}

/**
 * The whole list in one call: the displayed name for every record, keyed by id.
 * Callers that render in a loop read from this rather than re-deriving.
 */
export function disambiguatedNames(records: readonly NamedRecord[]): Map<string, string> {
  const ordinals = duplicateNameOrdinals(records);
  return new Map(records.map((record) => [record.id, disambiguatedName(record, ordinals)]));
}
