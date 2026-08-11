/**
 * Build identity, stamped at build time.
 *
 * Nothing else in the product can answer "which version is this?", which makes
 * every bug report ambiguous. The two constants below are replaced by Vite's
 * `define` during `vite build` (see `vite.config.ts`); in a dev server, a test
 * run, or a bare `node` import they are simply absent, and the fallbacks say so
 * honestly rather than inventing a version.
 */

declare const __MARQUEE_BUILD_SHA__: string | undefined;
declare const __MARQUEE_BUILT_AT__: string | undefined;

export interface BuildInfo {
  /** Short git SHA of the build, or `unknown` outside a stamped build. */
  sha: string;
  /** ISO-8601 build timestamp, or `unknown` outside a stamped build. */
  built_at: string;
}

const UNKNOWN = "unknown";

function stamped(value: string | undefined): string {
  return typeof value === "string" && value.length > 0 ? value : UNKNOWN;
}

export const BUILD_INFO: BuildInfo = {
  sha: stamped(typeof __MARQUEE_BUILD_SHA__ === "string" ? __MARQUEE_BUILD_SHA__ : undefined),
  built_at: stamped(typeof __MARQUEE_BUILT_AT__ === "string" ? __MARQUEE_BUILT_AT__ : undefined),
};

/** `unknown` reads as "this build was not stamped", not as a version. */
export function isStampedBuild(info: BuildInfo = BUILD_INFO): boolean {
  return info.sha !== UNKNOWN;
}
