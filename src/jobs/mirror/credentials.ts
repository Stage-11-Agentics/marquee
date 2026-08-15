import type { D1Database } from "@cloudflare/workers-types";

import type { MirrorCredentialRow } from "../../db/schema";
import { sha256Hex } from "../../lib/auth/random-token";

const CIPHER_VERSION = "v1";
const IV_BYTES = 12;
const AES_KEY_BYTES = 32;

export interface MirrorCredentialSecretEnvironment {
  MIRROR_CREDENTIAL_SECRET?: string;
}

export interface DecryptedMirrorCredential {
  baseId: string;
  id: string;
  lastError: string | null;
  lastVerifiedAt: number | null;
  orgId: string;
  setAt: number;
  setByPersonId: string;
  token: string;
  tokenFingerprint: string;
  webhookSecret: string | null;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(digest).slice(0, AES_KEY_BYTES),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a provider secret with a deployment-only Worker secret. */
export async function encryptMirrorSecret(value: string, secret: string): Promise<string> {
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    new TextEncoder().encode(value),
  );
  return `${CIPHER_VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptMirrorSecret(ciphertext: string, secret: string): Promise<string | null> {
  const [version, encodedIv, encodedCiphertext] = ciphertext.split(".");
  if (version !== CIPHER_VERSION || !encodedIv || !encodedCiphertext) return null;
  const iv = base64UrlToBytes(encodedIv);
  const encrypted = base64UrlToBytes(encodedCiphertext);
  if (!iv || !encrypted || iv.byteLength !== IV_BYTES || encrypted.byteLength < 17) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      await encryptionKey(secret),
      encrypted as unknown as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

export function redactMirrorError(error: unknown, secrets: readonly string[] = []): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret.length > 0) message = message.replaceAll(secret, "[redacted]");
  }
  return message.slice(0, 500);
}

export async function readMirrorCredential(
  db: D1Database,
  environment: MirrorCredentialSecretEnvironment,
  orgId?: string,
): Promise<DecryptedMirrorCredential | null> {
  const secret = nonEmpty(environment.MIRROR_CREDENTIAL_SECRET);
  if (!secret) return null;
  const row = orgId
    ? await db.prepare("SELECT * FROM mirror_credentials WHERE org_id = ? LIMIT 1").bind(orgId).first<MirrorCredentialRow>()
    : await db.prepare("SELECT * FROM mirror_credentials ORDER BY set_at DESC, id DESC LIMIT 1").first<MirrorCredentialRow>();
  if (!row) return null;
  const token = await decryptMirrorSecret(row.token_ciphertext, secret);
  if (!token) return null;
  const webhookSecret = row.webhook_secret_ciphertext
    ? await decryptMirrorSecret(row.webhook_secret_ciphertext, secret)
    : null;
  return {
    baseId: row.base_id,
    id: row.id,
    lastError: row.last_error,
    lastVerifiedAt: row.last_verified_at,
    orgId: row.org_id,
    setAt: row.set_at,
    setByPersonId: row.set_by_person_id,
    token,
    tokenFingerprint: row.token_fingerprint,
    webhookSecret,
  };
}

export async function tokenFingerprint(token: string): Promise<string> {
  return sha256Hex(token);
}
