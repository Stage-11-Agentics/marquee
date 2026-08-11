import { execFileSync } from "node:child_process";

import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

/**
 * Build identity, resolved once per build and inlined by `define`.
 *
 * A build that cannot name itself makes every bug report ambiguous, so the SHA
 * is stamped into the bundle rather than looked up at runtime (a Worker has no
 * git). Outside a git checkout — a source tarball, a container build — the
 * fallback is the honest string `unknown`, never a fabricated version.
 *
 * The stamp is deliberately kept out of the OpenAPI document: the document's
 * digest is a parity gate, and a timestamp inside it would break that gate on
 * every rebuild.
 */
function buildSha(): string {
  const fromEnvironment = process.env.MARQUEE_BUILD_SHA ?? process.env.GITHUB_SHA;
  if (fromEnvironment) return fromEnvironment.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  define: {
    __MARQUEE_BUILD_SHA__: JSON.stringify(buildSha()),
    __MARQUEE_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  plugins: [cloudflare()],
  resolve: {
    alias: [
      { find: "react/jsx-dev-runtime", replacement: "preact/jsx-dev-runtime" },
      { find: "react/jsx-runtime", replacement: "preact/jsx-runtime" },
      { find: "react-dom", replacement: "preact/compat" },
      { find: "react", replacement: "preact/compat" },
    ],
  },
});
