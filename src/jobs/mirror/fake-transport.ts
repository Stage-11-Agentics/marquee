import type {
  AirtableListRecord,
  AirtableRecord,
  AirtableTable,
  AirtableTransport,
  AirtableWebhookPayload,
} from "./transport";

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
    }
  | {
      kind: "schema" | "list" | "payloads" | "create_webhook" | "delete_webhook";
      tableId?: string;
      webhookId?: string;
      cursor?: string | null;
      at: number;
    };

export interface FakeAirtableTransportOptions {
  tables?: readonly AirtableTable[];
  webhookId?: string;
  webhookSecret?: string;
  payloads?: readonly AirtableWebhookPayload[];
}

/**
 * Recorded provider double used by every mirror acceptance test. Keeping the
 * call log as data makes batching and rate evidence inspectable, rather than a
 * claim inferred from a green assertion.
 */
export class FakeAirtableTransport implements AirtableTransport {
  readonly calls: FakeAirtableCall[] = [];
  readonly records = new Map<string, Map<string, AirtableRecord>>();
  readonly tables: AirtableTable[];
  readonly payloads: AirtableWebhookPayload[];
  readonly webhookId: string;
  readonly webhookSecret: string;

  constructor(
    private readonly clock: () => number = Date.now,
    options: FakeAirtableTransportOptions = {},
  ) {
    this.tables = [...options.tables ?? []];
    this.payloads = [...options.payloads ?? []];
    this.webhookId = options.webhookId ?? "whk_fake_mrq223";
    this.webhookSecret = options.webhookSecret ?? "fake-webhook-secret";
  }

  async readBaseSchema(): Promise<{ tables: readonly AirtableTable[] }> {
    this.calls.push({ kind: "schema", at: this.clock() });
    return { tables: structuredClone(this.tables) };
  }

  async listRecords({ tableId, offset }: { tableId: string; offset?: string }): Promise<{
    records: readonly AirtableListRecord[];
    offset: string | null;
  }> {
    this.calls.push({ kind: "list", tableId, at: this.clock() });
    if (offset) return { records: [], offset: null };
    const records = [...(this.records.get(tableId)?.entries() ?? [])].map(([id, record]) => ({
      id,
      fields: structuredClone(record.fields),
    }));
    return { records, offset: null };
  }

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

  async listPayloads({ webhookId, cursor }: { webhookId: string; cursor?: string | null }): Promise<{
    cursor: string | null;
    mightHaveMore: boolean;
    payloads: readonly AirtableWebhookPayload[];
  }> {
    this.calls.push({ kind: "payloads", webhookId, cursor: cursor ?? null, at: this.clock() });
    const start = cursor ? Number(cursor) : 0;
    const payloads = this.payloads.slice(start);
    return { cursor: String(this.payloads.length), mightHaveMore: false, payloads: structuredClone(payloads) };
  }

  async createWebhook(_input: { notificationUrl: string }): Promise<{
    id: string;
    expirationTime: number;
    macSecretBase64: string | null;
  }> {
    this.calls.push({ kind: "create_webhook", at: this.clock() });
    return {
      id: this.webhookId,
      expirationTime: this.clock() + 7 * 86_400_000,
      macSecretBase64: btoa(this.webhookSecret),
    };
  }

  async deleteWebhook({ webhookId }: { webhookId: string }): Promise<void> {
    this.calls.push({ kind: "delete_webhook", webhookId, at: this.clock() });
  }
}
