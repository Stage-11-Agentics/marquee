/**
 * What this sponsorship actually carries, derived from what is attached to it.
 *
 * The hero's deal line is the sponsor's boarding pass, and it is computed —
 * never a per-tier blurb somebody typed (sponsors-design §5.2 ruling 2, AC 6).
 * A tier is a name and a price; what a sponsor got is Sessions, a booth, and
 * passes, and those are rows. Tier-scoped *content* variation is a later band
 * precisely so this stays derivation rather than configuration.
 *
 * A chip appears only when its fact is true: no booth means no booth chip, zero
 * passes means no passes chip. An empty chip row is possible and legal — the
 * hero reserves its height, so nothing moves.
 */

export interface DealLineInput {
  sessionCount: number;
  boothNumber: string | null;
  passes: number;
}

export function dealLineChips(input: DealLineInput): string[] {
  const chips: string[] = [];
  if (input.sessionCount > 0) {
    chips.push(`${input.sessionCount} Session${input.sessionCount === 1 ? "" : "s"}`);
  }
  if (input.boothNumber) chips.push(`Booth ${input.boothNumber}`);
  if (input.passes > 0) {
    chips.push(`${input.passes} conference pass${input.passes === 1 ? "" : "es"}`);
  }
  return chips;
}
