/**
 * Cloudflare Turnstile server-side verification for public upload presigns.
 * Every public presign is gated (SPEC §2.1); authenticated speaker/admin/API
 * presigns are gated by principal/scope instead (plan-review resolution 3).
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerification {
  ok: boolean;
  errorCodes?: string[];
}

export async function verifyTurnstile(params: {
  secretKey: string;
  token: string | undefined | null;
  remoteIp?: string;
}): Promise<TurnstileVerification> {
  if (!params.token || params.token.trim() === "") {
    return { ok: false, errorCodes: ["missing-input-response"] };
  }

  const body = new URLSearchParams({ secret: params.secretKey, response: params.token });
  if (params.remoteIp) body.set("remoteip", params.remoteIp);

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, { method: "POST", body });
  } catch {
    return { ok: false, errorCodes: ["siteverify-unreachable"] };
  }
  if (!response.ok) return { ok: false, errorCodes: ["siteverify-http-error"] };

  const payload = (await response.json()) as { success?: boolean; ["error-codes"]?: string[] };
  return { ok: payload.success === true, errorCodes: payload["error-codes"] };
}
