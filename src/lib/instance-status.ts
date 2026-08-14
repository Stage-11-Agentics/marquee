import { readResendIdentity, type ResendIdentityEnvironment } from "./mail/config";

/**
 * What is actually wired up on this deployment, and what honestly is not.
 *
 * Every row is DERIVED — from a binding being present and a secret being
 * non-empty, and for the domain row from the URL the request arrived on. No
 * row consults a stored flag, and this module deliberately touches no
 * database at all, because a stored "mail is configured" boolean is exactly
 * the thing that goes stale the day someone rotates a secret and starts
 * lying to the operator (ruling D8, AC-284).
 *
 * Row order and identity are fixed. An unconfigured row never disappears and
 * a configured one never appears — only the status changes, so nothing on the
 * panel moves under the reader.
 */

export type InstanceStatusKey = "mail" | "uploads" | "spam" | "domain";

export interface InstanceStatusRow {
  key: InstanceStatusKey;
  label: string;
  configured: boolean;
  /** What is true right now, in the operator's terms — never a code or a field name. */
  note: string;
  /** The exact commands that configure it, copy-identical to the README's deploy sequence. */
  fix: readonly string[];
  /** Present only on the mail row; null means the deployment did not provide it. */
  sender?: string | null;
  /** Present only on the mail row; null means no account label was configured. */
  account?: string | null;
}

/** The subset of the Worker environment this read is allowed to look at. */
export interface InstanceStatusEnvironment {
  RESEND_API_KEY?: string;
  RESEND_ACCOUNT_NAME?: string;
  MEDIA?: unknown;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  MEDIA_PUBLIC_ORIGIN?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

/** The published always-pass pair. It protects nothing, so it is not protection. */
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1", "0.0.0.0"]);

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export const INSTANCE_STATUS_FIXES: Record<InstanceStatusKey, readonly string[]> = {
  mail: ["npx wrangler secret put RESEND_API_KEY"],
  uploads: [
    "npx wrangler r2 bucket create marquee-media",
    "npx wrangler secret put R2_ACCESS_KEY_ID",
    "npx wrangler secret put R2_SECRET_ACCESS_KEY",
  ],
  spam: [
    "npx wrangler secret put TURNSTILE_SITE_KEY",
    "npx wrangler secret put TURNSTILE_SECRET_KEY",
  ],
  domain: ["npx wrangler deploy"],
};

export function mailConfigured(environment: InstanceStatusEnvironment): boolean {
  return present(environment.RESEND_API_KEY);
}

export function uploadsConfigured(environment: InstanceStatusEnvironment): boolean {
  return (
    environment.MEDIA !== undefined &&
    environment.MEDIA !== null &&
    present(environment.R2_ACCOUNT_ID) &&
    present(environment.R2_BUCKET_NAME) &&
    present(environment.R2_ACCESS_KEY_ID) &&
    present(environment.R2_SECRET_ACCESS_KEY) &&
    present(environment.MEDIA_PUBLIC_ORIGIN)
  );
}

export function spamConfigured(environment: InstanceStatusEnvironment): boolean {
  if (!present(environment.TURNSTILE_SITE_KEY) || !present(environment.TURNSTILE_SECRET_KEY)) {
    return false;
  }
  return !(
    environment.TURNSTILE_SITE_KEY === TURNSTILE_TEST_SITE_KEY &&
    environment.TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET_KEY
  );
}

export function domainConfigured(requestUrl: string): boolean {
  try {
    const url = new URL(requestUrl);
    return url.protocol === "https:" && !LOOPBACK_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

export function instanceHostname(requestUrl: string): string {
  try {
    return new URL(requestUrl).host;
  } catch {
    return "";
  }
}

/**
 * The panel, in its one fixed order. Rows read the same whether the answer is
 * yes or no; only `configured` and `note` differ.
 */
export function readInstanceStatus(
  environment: InstanceStatusEnvironment,
  requestUrl: string,
): InstanceStatusRow[] {
  const mail = mailConfigured(environment);
  const resend = readResendIdentity(environment satisfies ResendIdentityEnvironment);
  const uploads = uploadsConfigured(environment);
  const spam = spamConfigured(environment);
  const domain = domainConfigured(requestUrl);
  const host = instanceHostname(requestUrl);
  return [
    {
      key: "mail",
      label: "Email sending",
      configured: mail,
      note: mail
        ? "Sender verified · confirmations, decisions, and invites deliver"
        : "No confirmations, no decision mail, no sign-in links until this exists",
      fix: INSTANCE_STATUS_FIXES.mail,
      sender: resend.sender,
      account: resend.account,
    },
    {
      key: "uploads",
      label: "File uploads",
      configured: uploads,
      note: uploads
        ? "Headshots and slides · stored in the marquee-media bucket"
        : "Headshots and slides cannot be uploaded until the bucket and its signing keys exist",
      fix: INSTANCE_STATUS_FIXES.uploads,
    },
    {
      key: "spam",
      label: "Spam protection",
      configured: spam,
      note: spam
        ? "Site key set · the public call for speakers is protected"
        : "The public call for speakers has no bot protection on this deployment",
      fix: INSTANCE_STATUS_FIXES.spam,
    },
    {
      key: "domain",
      label: "Web address",
      configured: domain,
      note: domain
        ? `${host} · secure connection active`
        : "Serving from a local or plain-HTTP origin, so nothing public can reach it",
      fix: INSTANCE_STATUS_FIXES.domain,
    },
  ];
}
