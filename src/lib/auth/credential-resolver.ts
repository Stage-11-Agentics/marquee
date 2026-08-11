import type { Context } from "hono";
import { getCookie } from "hono/cookie";

import { ApiError } from "../../api/errors";
import type { ApiEnv, CredentialResolver, Principal } from "../../api/runtime";
import { SESSION_COOKIE_NAME } from "../cookies";
import { resolveAuth } from "./auth-middleware";

/**
 * Adapter between MRQ-3's D1-backed credential lookup and MRQ-8's API
 * pipeline. The legacy middleware intentionally treats invalid credentials as
 * absent because public Hono routes decide whether auth is required; the API
 * must distinguish that case so a supplied but expired/tampered credential
 * cannot silently become anonymous.
 */
export function createCredentialResolver(): CredentialResolver {
  return {
    async resolve(context: Context<ApiEnv>): Promise<Principal> {
      const attempted = hasCredential(context);
      const principal = await resolveAuth(context);
      if (principal) return principal;
      if (attempted) throw ApiError.unauthenticated();
      return { kind: "anonymous" };
    },
  };
}

function hasCredential(context: Context<ApiEnv>): boolean {
  if (context.req.header("authorization") !== undefined) return true;
  const cookieHeader = context.req.header("cookie");
  if (!cookieHeader) return false;
  const cookies = getCookie(context);
  return Object.prototype.hasOwnProperty.call(cookies, SESSION_COOKIE_NAME);
}
