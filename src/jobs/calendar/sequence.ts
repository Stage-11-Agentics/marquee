import type { D1Database } from "@cloudflare/workers-types";

export interface CalendarSequenceClaimInput {
  currentSequence: number | null;
  knownLastSequence?: number | null;
  now: number;
  uid: string;
}

export interface CalendarSequenceClaim {
  expectedPrior: number;
  sequence: number;
}

/**
 * Claim one UID revision with a real conditional write. The optional known
 * floor lets a batch load all ledgers once; only a lost CAS rereads its UID.
 */
export async function claimCalendarSequence(
  db: D1Database,
  input: CalendarSequenceClaimInput,
): Promise<CalendarSequenceClaim> {
  let lastSequence = input.knownLastSequence;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (lastSequence === undefined) {
      const row = await db.prepare("SELECT last_sequence FROM calendar_sequence_ledger WHERE uid = ?").bind(input.uid).first<{ last_sequence: number }>();
      lastSequence = row?.last_sequence ?? null;
    }

    if (lastSequence === null) {
      if (input.currentSequence !== null) {
        const initialized = await db.prepare(
          "INSERT OR IGNORE INTO calendar_sequence_ledger (uid, last_sequence, updated_at) VALUES (?, ?, ?)",
        ).bind(input.uid, input.currentSequence, input.now).run();
        if ((initialized.meta.changes ?? 0) === 1) {
          lastSequence = input.currentSequence;
          continue;
        }
        lastSequence = undefined;
        continue;
      }
      const initialized = await db.prepare(
        "INSERT OR IGNORE INTO calendar_sequence_ledger (uid, last_sequence, updated_at) VALUES (?, 0, ?)",
      ).bind(input.uid, input.now).run();
      if ((initialized.meta.changes ?? 0) === 1) return { expectedPrior: -1, sequence: 0 };
      lastSequence = undefined;
      continue;
    }

    // A legacy invite can be newer than an unexpectedly absent/stale ledger.
    // Repair that floor with the same CAS discipline, then claim the next slot.
    if (input.currentSequence !== null && input.currentSequence > lastSequence) {
      const repaired = await db.prepare(
        "UPDATE calendar_sequence_ledger SET last_sequence = ?, updated_at = ? WHERE uid = ? AND last_sequence = ?",
      ).bind(input.currentSequence, input.now, input.uid, lastSequence).run();
      if ((repaired.meta.changes ?? 0) === 1) {
        lastSequence = input.currentSequence;
        continue;
      }
      lastSequence = undefined;
      continue;
    }

    const next = lastSequence + 1;
    const claimed = await db.prepare(
      "UPDATE calendar_sequence_ledger SET last_sequence = ?, updated_at = ? WHERE uid = ? AND last_sequence = ?",
    ).bind(next, input.now, input.uid, lastSequence).run();
    if ((claimed.meta.changes ?? 0) === 1) return { expectedPrior: lastSequence, sequence: next };
    lastSequence = undefined;
  }
  throw new Error(`calendar sequence contention exceeded retry budget for ${input.uid}`);
}
