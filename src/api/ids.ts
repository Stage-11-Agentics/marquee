/** ULID boundary validation (Crockford base32, 26 chars, first char 0-7). */
import { z } from "@hono/zod-openapi";

export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}

export const ulidSchema = z
  .string()
  .regex(ULID_PATTERN, "expected a ULID")
  .openapi({ example: "01J8ZQ7X2M4N6P8R0T2V4Y6A8C" });
