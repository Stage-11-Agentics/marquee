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
  const defaultSort = options.defaultSort ?? sortKeys[0];
  // Neither `.default()` nor `.catch()` re-parses the value it supplies, and
  // this one now feeds both the missing-key and the invalid-value path — so a
  // typo'd `defaultSort` would reach the sort registry as a live column name.
  // Failing at module load names the call site; failing at request time does not.
  if (!sortKeys.includes(defaultSort)) {
    throw new Error(`defaultSort ${JSON.stringify(defaultSort)} is not one of: ${sortKeys.join(", ")}`);
  }
  const base = z.object({
    // A list URL is pasted, hand-edited, and outlived by the options it names,
    // so the three navigational parameters below degrade to their defaults
    // instead of failing the whole read: `.default()` only covers a *missing*
    // value, and an unrecognised one used to throw a 400 that emptied the
    // table behind a generic error. Softening stops at navigation — every
    // endpoint-specific filter stays strict, because a filter the server
    // silently ignores would answer a question nobody asked.
    //
    // `.catch()` is opaque to the OpenAPI generator, which refuses any schema
    // whose outermost node it cannot read — an omitted `type` here does not
    // degrade the document, it throws while the document is built and takes
    // every route down with it. So each softened field restates its shape
    // explicitly, and the generated document stays exactly what it was.
    page: z.coerce
      .number()
      .int()
      .min(1)
      .default(LIST_DEFAULTS.page)
      .catch(LIST_DEFAULTS.page)
      .openapi({ type: "integer", minimum: 1, default: LIST_DEFAULTS.page, example: 1 }),
    per_page: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIST_DEFAULTS.maxPerPage)
      .default(LIST_DEFAULTS.perPage)
      .catch(LIST_DEFAULTS.perPage)
      .openapi({
        type: "integer",
        minimum: 1,
        maximum: LIST_DEFAULTS.maxPerPage,
        default: LIST_DEFAULTS.perPage,
        example: 50,
      }),
    // `q` is deliberately left strict. Softening it would mean answering a
    // search with the unfiltered list — a different set of records than the one
    // asked for, and a lie the caller cannot see. Endpoints that redeclare `q`
    // in their own filter shape override this field anyway.
    q: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .openapi({ description: "Normalized free-text search" }),
    sort: z
      .enum(sortKeys)
      .default(defaultSort)
      .catch(defaultSort)
      .openapi({
        type: "string",
        enum: [...sortKeys],
        default: defaultSort,
        description: "Endpoint-owned sort whitelist",
      }),
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
