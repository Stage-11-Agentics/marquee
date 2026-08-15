export interface AirtableRecord {
  fields: Record<string, unknown>;
}

export interface AirtableTransport {
  patchRecords(input: {
    tableId: string;
    records: readonly AirtableRecord[];
  }): Promise<void>;
  deleteRecords(input: {
    tableId: string;
    marqueeIds: readonly string[];
  }): Promise<void>;
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
  };
}
