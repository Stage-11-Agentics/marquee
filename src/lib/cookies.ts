import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE_NAME = "mq_session";

const SESSION_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  path: "/",
  sameSite: "Lax" as const,
  secure: true,
});

/**
 * Session cookies are `Secure` unless the run explicitly opts out with
 * `INSECURE_LOCAL_COOKIES=1`.
 *
 * Safari and WKWebView drop a Secure cookie on an http:// origin — they do not
 * grant localhost the trustworthy-origin exception that curl and Chrome do. So
 * under the plain-HTTP local recipe the demo login returns 200 and every
 * subsequent request 401s, in the browser only. curl and the CLI never see it.
 *
 * This has to be an explicit flag rather than anything sniffed from the
 * request. `wrangler dev` rewrites the inbound request to the `custom_domain`
 * route declared in wrangler.jsonc — URL, Host *and* Origin all arrive as
 * `https://marquee.stage11.dev`, even on a loopback http listener. The Worker
 * has no observable signal that it is running locally.
 *
 * The flag is supplied by the documented dev command (`--var
 * INSECURE_LOCAL_COOKIES:1`), so it lives in the operator's terminal rather
 * than in committed config. wrangler.jsonc pins the deployed default to "0".
 */
function sessionCookieOptions(context: Context): typeof SESSION_COOKIE_OPTIONS {
  const env = context.env as { INSECURE_LOCAL_COOKIES?: string } | undefined;
  return { ...SESSION_COOKIE_OPTIONS, secure: env?.INSECURE_LOCAL_COOKIES !== "1" };
}

export function setSessionCookie(
  context: Context,
  value: string,
  maxAgeSeconds?: number,
): void {
  setCookie(context, SESSION_COOKIE_NAME, value, {
    ...sessionCookieOptions(context),
    ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
  });
}

export function clearSessionCookie(context: Context): void {
  deleteCookie(context, SESSION_COOKIE_NAME, sessionCookieOptions(context));
}
