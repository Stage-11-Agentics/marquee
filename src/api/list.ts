/**
 * The one list contract (Amendment 7): `page/per_page/q/sort/<filters>` in,
 * `{data, page, per_page, total, total_pages}` out. Filter shapes are typed
 * per endpoint — never arbitrary SQL names/values — and the same parsed
 * filter object feeds UI list reads and the filter arm of bulk selectors
 * (the structural basis of AC-108's UI/API ID equality).
 */
import { z } from "@hono/zod-openapi";

export const LIST_DEFAULTS = { page: 1, perPage: 50, maxPerPage: 100 } as const;

/**
 * Compose the common list query with endpoint-specific flat filters and an
 * endpoint-owned sort whitelist. Query params arrive as strings, so numeric
 * fields coerce; the emitted OpenAPI params stay typed.
 */
export function createListQuerySchema<Filters extends z.ZodRawShape>(
  filters: Filters,
  sortKeys: readonly [string, ...string[]],
  options: { defaultSort?: string } = {},
) {
  const base = z.object({
    page: z.coerce
      .number()
      .int()
      .min(1)
      .default(LIST_DEFAULTS.page)
      .openapi({ example: 1 }),
    per_page: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIST_DEFAULTS.maxPerPage)
      .default(LIST_DEFAULTS.perPage)
      .openapi({ example: 50 }),
    q: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .openapi({ description: "Normalized free-text search" }),
    sort: z
      .enum(sortKeys)
      .default(options.defaultSort ?? sortKeys[0])
      .openapi({ description: "Endpoint-owned sort whitelist" }),
  });
  return base.extend(filters);
}

export function createListResponseSchema<Item extends z.ZodType>(item: Item, itemName: string) {
  return z
    .object({
      data: z.array(item),
      page: z.number().int().min(1),
      per_page: z.number().int().min(1).max(LIST_DEFAULTS.maxPerPage),
      total: z.number().int().min(0),
      total_pages: z.number().int().min(0),
    })
    .openapi(`${itemName}List`);
}

export interface ListEnvelope<T> {
  data: T[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}
