import type {
  AirtableListRecord,
  AirtableRecord,
  AirtableTable,
  AirtableTableField,
  AirtableTransport,
  AirtableWebhookPayload,
} from "./transport";
import { AirtableTransportError } from "./transport";

export interface FakeAirtableFieldInput {
  name: string;
  type: string;
  options?: Record<string, unknown>;
}

export interface FakeAirtableMetadataFailure {
  call: number;
  status: number;
  message?: string;
}

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
    }
  | {
      kind: "create_table";
      name: string;
      fields: readonly FakeAirtableFieldInput[];
      tableId: string;
      at: number;
    }
  | {
      kind: "create_field";
      tableId: string;
      field: FakeAirtableFieldInput;
      at: number;
    };

export interface FakeAirtableTransportOptions {
  tables?: readonly AirtableTable[];
  webhookId?: string;
  webhookSecret?: string;
  payloads?: readonly AirtableWebhookPayload[];
  metadataFailure?: FakeAirtableMetadataFailure;
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
  private metadataCalls = 0;
  private readonly metadataFailure?: FakeAirtableMetadataFailure;

  constructor(
    private readonly clock: () => number = Date.now,
    options: FakeAirtableTransportOptions = {},
  ) {
    this.tables = [...options.tables ?? []];
    this.payloads = [...options.payloads ?? []];
    this.webhookId = options.webhookId ?? "whk_fake_mrq223";
    this.webhookSecret = options.webhookSecret ?? "fake-webhook-secret";
    this.metadataFailure = options.metadataFailure;
  }

  async readBaseSchema(): Promise<{ tables: readonly AirtableTable[] }> {
    this.calls.push({ kind: "schema", at: this.clock() });
    return { tables: structuredClone(this.tables) };
  }

  private beforeMetadataCall(): void {
    this.metadataCalls += 1;
    if (this.metadataFailure?.call === this.metadataCalls) {
      throw new AirtableTransportError(
        this.metadataFailure.status,
        this.metadataFailure.message ?? `fake metadata failure ${this.metadataFailure.status}`,
      );
    }
  }

  async createTable({ name, fields }: { name: string; fields: readonly FakeAirtableFieldInput[] }): Promise<{ table: AirtableTable }> {
    this.beforeMetadataCall();
    const tableId = `tbl_fake_${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_")}_${this.tables.length + 1}`;
    const table: AirtableTable = {
      id: tableId,
      name,
      fields: fields.map((field, index) => ({
        id: `fld_fake_${tableId}_${index + 1}`,
        ...structuredClone(field),
      })),
    };
    table.primaryFieldId = table.fields?.[0]?.id;
    this.tables.push(table);
    this.calls.push({ kind: "create_table", name, fields: structuredClone(fields), tableId, at: this.clock() });
    return { table: structuredClone(table) };
  }

  async createField({ tableId, name, type, options }: FakeAirtableFieldInput & { tableId: string }): Promise<{ field: AirtableTableField }> {
    this.beforeMetadataCall();
    const table = this.tables.find((candidate) => candidate.id === tableId);
    if (!table) throw new AirtableTransportError(404, "fake table not found");
    const field: AirtableTableField = {
      id: `fld_fake_${tableId}_${(table.fields?.length ?? 0) + 1}`,
      name,
      type,
      ...(options === undefined ? {} : { options: structuredClone(options) }),
    };
    table.fields = [...table.fields ?? [], field];
    this.calls.push({ kind: "create_field", tableId, field: structuredClone({ name, type, ...(options === undefined ? {} : { options }) }), at: this.clock() });
    return { field: structuredClone(field) };
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
