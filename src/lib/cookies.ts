import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE_NAME = "mq_session";

const SESSION_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  path: "/",
  sameSite: "Lax" as const,
  secure: true,
});

export function setSessionCookie(
  context: Context,
  value: string,
  maxAgeSeconds?: number,
): void {
  setCookie(context, SESSION_COOKIE_NAME, value, {
    ...SESSION_COOKIE_OPTIONS,
    ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
  });
}

export function clearSessionCookie(context: Context): void {
  deleteCookie(context, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS);
}
