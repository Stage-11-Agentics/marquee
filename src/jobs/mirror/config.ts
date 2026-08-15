import type { D1Database, Queue } from "@cloudflare/workers-types";

/** The only configuration that can turn outbound Airtable traffic on. */
export interface MirrorEnvironment {
  AIRTABLE_API_KEY?: string;
  /** Public, non-secret Airtable base id. `AIRTABLE_BASE` is kept as a local-dev alias. */
  AIRTABLE_BASE_ID?: string;
  AIRTABLE_BASE?: string;
  DB: D1Database;
  MEDIA_PUBLIC_ORIGIN?: string;
  MIRROR_QUEUE?: Queue<unknown>;
  UPLOAD_TOKEN_SECRET?: string;
}

export interface MirrorConfig {
  apiKey: string;
  baseId: string;
  mediaPublicOrigin: string;
  uploadTokenSecret: string;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Missing configuration is an intentional off state. Callers must treat null
 * as a successful no-op, not as an exception that should be retried forever.
 */
export function mirrorConfig(env: MirrorEnvironment): MirrorConfig | null {
  const apiKey = nonEmpty(env.AIRTABLE_API_KEY);
  const baseId = nonEmpty(env.AIRTABLE_BASE_ID) ?? nonEmpty(env.AIRTABLE_BASE);
  if (!apiKey || !baseId) return null;
  return {
    apiKey,
    baseId,
    mediaPublicOrigin: nonEmpty(env.MEDIA_PUBLIC_ORIGIN) ?? "",
    uploadTokenSecret: nonEmpty(env.UPLOAD_TOKEN_SECRET) ?? "",
  };
}

export function mirrorEnabled(env: MirrorEnvironment): boolean {
  return mirrorConfig(env) !== null;
}
