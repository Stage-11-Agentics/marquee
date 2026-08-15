export interface AirtableRecord {
  fields: Record<string, unknown>;
}

export interface AirtableListRecord extends AirtableRecord {
  id: string;
}

export interface AirtableTableField {
  id: string;
  name: string;
  type?: string;
}

export interface AirtableTable {
  id: string;
  name: string;
  fields?: readonly AirtableTableField[];
}

export interface AirtableWebhookPayload {
  changedTablesById?: Record<string, {
    changedRecordsById?: Record<string, {
      current?: Record<string, unknown>;
      previous?: Record<string, unknown>;
    }>;
  }>;
  [key: string]: unknown;
}

export interface AirtableTransport {
  readBaseSchema(): Promise<{ tables: readonly AirtableTable[] }>;
  listRecords(input: { tableId: string; offset?: string }): Promise<{
    records: readonly AirtableListRecord[];
    offset: string | null;
  }>;
  patchRecords(input: {
    tableId: string;
    records: readonly AirtableRecord[];
  }): Promise<void>;
  deleteRecords(input: {
    tableId: string;
    marqueeIds: readonly string[];
  }): Promise<void>;
  listPayloads(input: { webhookId: string; cursor?: string | null }): Promise<{
    cursor: string | null;
    mightHaveMore: boolean;
    payloads: readonly AirtableWebhookPayload[];
  }>;
  createWebhook(input: { notificationUrl: string }): Promise<{
    id: string;
    expirationTime: number;
    macSecretBase64: string | null;
  }>;
  deleteWebhook(input: { webhookId: string }): Promise<void>;
}

export interface AirtableTransportOptions {
  apiKey: string;
  baseId: string;
  fetcher?: typeof fetch;
  apiOrigin?: string;
  /** Called immediately before each provider HTTP request. */
  beforeRequest?: () => Promise<void>;
}

export class AirtableTransportError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AirtableTransportError";
    this.status = status;
  }
}

/** Apply one base-wide budget to every provider operation, including inbound. */
export function rateLimitedAirtableTransport(
  transport: AirtableTransport,
  limiter: { take(): Promise<void> },
): AirtableTransport {
  return {
    async readBaseSchema() {
      await limiter.take();
      return transport.readBaseSchema();
    },
    async listRecords(input) {
      await limiter.take();
      return transport.listRecords(input);
    },
    async patchRecords(input) {
      await limiter.take();
      return transport.patchRecords(input);
    },
    async deleteRecords(input) {
      await limiter.take();
      return transport.deleteRecords(input);
    },
    async listPayloads(input) {
      await limiter.take();
      return transport.listPayloads(input);
    },
    async createWebhook(input) {
      await limiter.take();
      return transport.createWebhook(input);
    },
    async deleteWebhook(input) {
      await limiter.take();
      return transport.deleteWebhook(input);
    },
  };
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}

function formulaForMarqueeIds(ids: readonly string[]): string {
  return `OR(${ids.map((id) => `{marquee_id} = '${id.replaceAll("'", "\\'")}'`).join(",")})`;
}

interface ListResponse {
  records?: Array<{ id?: string; fields?: Record<string, unknown> }>;
  offset?: string;
  error?: { message?: string };
}

interface SchemaResponse {
  tables?: AirtableTable[];
}

interface PayloadResponse {
  cursor?: string | number;
  mightHaveMore?: boolean;
  payloads?: AirtableWebhookPayload[];
}

interface WebhookResponse {
  id?: string;
  expirationTime?: string | number;
  macSecretBase64?: string;
}

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
  return payload?.error?.message ?? payload?.message ?? `Airtable returned ${response.status}`;
}

/**
 * Real provider adapter. It lives in the mirror job boundary and is never
 * imported by a route. The fake transport is what the hermetic suite injects.
 */
export function createFetchAirtableTransport(options: AirtableTransportOptions): AirtableTransport {
  const fetcher = options.fetcher ?? fetch;
  const origin = (options.apiOrigin ?? "https://api.airtable.com").replace(/\/+$/, "");
  const tableUrl = (tableId: string) =>
    `${origin}/v0/${encodePathPart(options.baseId)}/${encodePathPart(tableId)}`;
  const baseUrl = (path: string) => `${origin}${path}`;
  const request = async (url: string, init: RequestInit): Promise<Response> => {
    await options.beforeRequest?.();
    const response = await fetcher(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) throw new AirtableTransportError(response.status, await readError(response));
    return response;
  };

  return {
    async readBaseSchema() {
      const response = await request(
        baseUrl(`/v0/meta/bases/${encodePathPart(options.baseId)}/tables`),
        { method: "GET" },
      );
      const payload = await response.json() as SchemaResponse;
      return { tables: payload.tables ?? [] };
    },

    async listRecords({ tableId, offset }) {
      const params = new URLSearchParams({ pageSize: "100" });
      if (offset) params.set("offset", offset);
      const response = await request(`${tableUrl(tableId)}?${params.toString()}`, { method: "GET" });
      const payload = await response.json() as ListResponse;
      return {
        records: (payload.records ?? []).flatMap((record) => record.id
          ? [{ id: record.id, fields: record.fields ?? {} }]
          : []),
        offset: payload.offset ?? null,
      };
    },

    async patchRecords({ tableId, records }) {
      await request(tableUrl(tableId), {
        method: "PATCH",
        body: JSON.stringify({
          records,
          performUpsert: { fieldsToMergeOn: ["marquee_id"] },
          typecast: false,
        }),
      });
    },

    async deleteRecords({ tableId, marqueeIds }) {
      if (marqueeIds.length === 0) return;
      let offset: string | undefined;
      do {
        const params = new URLSearchParams({ filterByFormula: formulaForMarqueeIds(marqueeIds), pageSize: "100" });
        if (offset) params.set("offset", offset);
        const listedResponse = await request(`${tableUrl(tableId)}?${params.toString()}`, { method: "GET" });
        const listed = await listedResponse.json() as ListResponse;
        const ids = (listed.records ?? []).map((record) => record.id).filter((id): id is string => Boolean(id));
        if (ids.length > 0) {
          const deleteParams = new URLSearchParams();
          for (const id of ids) deleteParams.append("records[]", id);
          await request(`${tableUrl(tableId)}?${deleteParams.toString()}`, { method: "DELETE" });
        }
        offset = listed.offset;
      } while (offset);
    },

    async listPayloads({ webhookId, cursor }) {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      const query = params.toString();
      const response = await request(
        `${baseUrl(`/v0/bases/${encodePathPart(options.baseId)}/webhooks/${encodePathPart(webhookId)}/payloads`)}${query ? `?${query}` : ""}`,
        { method: "GET" },
      );
      const payload = await response.json() as PayloadResponse;
      return {
        cursor: payload.cursor === undefined ? null : String(payload.cursor),
        mightHaveMore: payload.mightHaveMore === true,
        payloads: payload.payloads ?? [],
      };
    },

    async createWebhook({ notificationUrl }) {
      const response = await request(
        baseUrl(`/v0/bases/${encodePathPart(options.baseId)}/webhooks`),
        { method: "POST", body: JSON.stringify({ notificationUrl }) },
      );
      const payload = await response.json() as WebhookResponse;
      if (!payload.id || !payload.expirationTime) {
        throw new AirtableTransportError(502, "Airtable returned an incomplete webhook registration");
      }
      const expirationTime = typeof payload.expirationTime === "number"
        ? payload.expirationTime
        : Date.parse(payload.expirationTime);
      if (!Number.isFinite(expirationTime)) {
        throw new AirtableTransportError(502, "Airtable returned an invalid webhook expiration");
      }
      return {
        id: payload.id,
        expirationTime,
        macSecretBase64: payload.macSecretBase64 ?? null,
      };
    },

    async deleteWebhook({ webhookId }) {
      await request(
        baseUrl(`/v0/bases/${encodePathPart(options.baseId)}/webhooks/${encodePathPart(webhookId)}`),
        { method: "DELETE" },
      );
    },
  };
}
