import type { AirtableRecord, AirtableTransport } from "./transport";

export type FakeAirtableCall =
  | {
      kind: "patch";
      tableId: string;
      records: readonly AirtableRecord[];
      at: number;
      performUpsert: { fieldsToMergeOn: ["marquee_id"] };
    }
  | {
      kind: "delete";
      tableId: string;
      marqueeIds: readonly string[];
      at: number;
    };

/**
 * Recorded provider double used by every mirror acceptance test. Keeping the
 * call log as data makes batching and rate evidence inspectable, rather than a
 * claim inferred from a green assertion.
 */
export class FakeAirtableTransport implements AirtableTransport {
  readonly calls: FakeAirtableCall[] = [];
  readonly records = new Map<string, Map<string, AirtableRecord>>();

  constructor(private readonly clock: () => number = Date.now) {}

  async patchRecords({ tableId, records }: { tableId: string; records: readonly AirtableRecord[] }): Promise<void> {
    const table = this.records.get(tableId) ?? new Map<string, AirtableRecord>();
    this.records.set(tableId, table);
    for (const record of records) {
      const marqueeId = String(record.fields.marquee_id ?? "");
      table.set(marqueeId, structuredClone(record));
    }
    this.calls.push({
      kind: "patch",
      tableId,
      records: structuredClone(records),
      at: this.clock(),
      performUpsert: { fieldsToMergeOn: ["marquee_id"] },
    });
  }

  async deleteRecords({ tableId, marqueeIds }: { tableId: string; marqueeIds: readonly string[] }): Promise<void> {
    const table = this.records.get(tableId);
    for (const id of marqueeIds) table?.delete(id);
    this.calls.push({ kind: "delete", tableId, marqueeIds: [...marqueeIds], at: this.clock() });
  }
}
