/**
 * Two people can share a name. The importer keys on the normalized email, so
 * two addresses are two records and that is correct — but a list that prints
 * only the name turns them into one indistinguishable pair, and an organizer
 * assigning a task picks whichever row their eye landed on.
 *
 * The fix is display-level: mark the collision so a human or an agent can tell
 * the rows apart. Nothing is written back; the stored name never changes.
 *
 * The marker is a statement about ONE RENDERED LIST: this view is showing more
 * than one person by this name. It is not an identity — a roster page that
 * happens to hold only one Marcus Okafor prints him plain, correctly, because
 * nothing on that screen is ambiguous. Reading it as a permanent second name
 * would be reading in something the display cannot know.
 *
 * Within a list, the suffix is ordered by record id rather than by list
 * position, so re-sorting or reversing the same set never moves "(2)" onto a
 * different human. Position-ordering would, and a marker that means a different
 * person each time you look is worse than no marker at all.
 */

export interface NamedRecord {
  id: string;
  name: string;
}

/**
 * Two names collide when they are indistinguishable to a reader: case, stray
 * whitespace, and Unicode composition all have to be folded away first. NFC
 * matters because an import can carry a decomposed "José" beside a composed one
 * — identical on screen, different byte for byte, and unmarked without this.
 */
function collationKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Ids of records whose displayed name collides, mapped to the suffix ordinal
 * they should carry. The first record of each colliding group is absent: it
 * keeps its plain name, and only the second and subsequent ones are marked.
 */
export function duplicateNameOrdinals(records: readonly NamedRecord[]): Map<string, number> {
  const groups = new Map<string, string[]>();
  const taken = new Set<string>();
  for (const record of records) {
    const key = collationKey(record.name);
    if (key === "") continue;
    taken.add(key);
    const group = groups.get(key);
    if (group) group.push(record.id);
    else groups.set(key, [record.id]);
  }
  const ordinals = new Map<string, number>();
  for (const [key, ids] of groups) {
    const ordered = [...new Set(ids)].sort();
    if (ordered.length < 2) continue;
    // Skip an ordinal whose label a real person already carries. Alex, Alex and
    // "Alex (2)" in one list would otherwise mint a second "Alex (2)" — the one
    // outcome this function exists to prevent.
    let ordinal = 1;
    for (const id of ordered.slice(1)) {
      do {
        ordinal += 1;
      } while (taken.has(collationKey(`${key} (${ordinal})`)));
      ordinals.set(id, ordinal);
    }
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

/**
 * The query to send to a SERVER-backed person search.
 *
 * A server cannot match "(2)": that marker is a property of one rendered result
 * set, so it does not exist until the search it would be filtering has already
 * run. Rather than pretend otherwise, strip a trailing disambiguator before
 * sending — pasting a label you can see then finds the person it belongs to,
 * and the marker is re-derived over whatever comes back.
 *
 * Client-side pickers over a fully loaded list have no such problem and match
 * the rendered label directly.
 */
export function searchableQuery(query: string): string {
  return query.replace(/\s*\(\d+\)\s*$/, "").trim();
}
