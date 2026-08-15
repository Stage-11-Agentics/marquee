import type { D1Database, Queue } from "@cloudflare/workers-types";

import { readMirrorCredential } from "./credentials";
import type { AirtableTransport } from "./transport";

/** The only configuration that can turn outbound Airtable traffic on. */
export interface MirrorEnvironment {
  DB: D1Database;
  MEDIA_PUBLIC_ORIGIN?: string;
  MIRROR_QUEUE?: Queue<unknown>;
  /** Hermetic provider seam; production uses the fetch adapter in this boundary. */
  MIRROR_TRANSPORT?: AirtableTransport;
  MIRROR_CREDENTIAL_SECRET?: string;
  MIRROR_WEBHOOK_URL?: string;
  UPLOAD_TOKEN_SECRET?: string;
}

export interface MirrorConfig {
  apiKey: string;
  baseId: string;
  mediaPublicOrigin: string;
  uploadTokenSecret: string;
}

/**
 * Missing configuration is an intentional off state. Callers must treat null
 * as a successful no-op, not as an exception that should be retried forever.
 */
export async function mirrorConfig(env: MirrorEnvironment): Promise<MirrorConfig | null> {
  const credential = await readMirrorCredential(env.DB, env, undefined);
  if (!credential || !credential.token.trim() || !credential.baseId.trim()) return null;
  return {
    apiKey: credential.token,
    baseId: credential.baseId,
    mediaPublicOrigin: env.MEDIA_PUBLIC_ORIGIN?.trim() ?? "",
    uploadTokenSecret: env.UPLOAD_TOKEN_SECRET?.trim() ?? "",
  };
}

export async function mirrorEnabled(env: MirrorEnvironment): Promise<boolean> {
  return (await mirrorConfig(env)) !== null;
}
