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

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Generate a valid ULID for durable operation and runtime row identities. */
export function newUlid(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("ULID timestamps must be non-negative safe integers");
  }

  let timestamp = now;
  let encodedTimestamp = "";
  for (let index = 0; index < 10; index += 1) {
    encodedTimestamp = ULID_ALPHABET[timestamp % 32]! + encodedTimestamp;
    timestamp = Math.floor(timestamp / 32);
  }

  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  const encodedRandom = [...random]
    .map((byte) => ULID_ALPHABET[byte & 31]!)
    .join("");
  return `${encodedTimestamp}${encodedRandom}`;
}
