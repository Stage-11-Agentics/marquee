/**
 * GENERATED ROUTE MANIFEST — never hand-edited.
 *
 * Registration is by glob (§7 rule institutionalized by M-07): this module is
 * only the eager `import.meta.glob` over JSON API route modules plus the pure
 * `buildManifest`. It contains no import list, route names, or per-feature
 * edits. Vite expands the glob at build time; adding or removing a conforming
 * `*.routes.ts` module changes the manifest automatically.
 *
 * Convention (R2): JSON API modules are plural `src/routes/<feature>.routes.ts`
 * (no JSX, `apiRoutes` export); SSR/page modules are singular `*.route.tsx`
 * and are never API-manifest inputs. Node tooling must never import this file
 * (`import.meta.glob` is Vite-only) — it consumes `dist/api-registry.json`
 * emitted by the build instead (R3).
 */
import { buildManifest } from "../api/manifest";

export const apiManifest = buildManifest(
  import.meta.glob("./**/*.routes.ts", { eager: true }),
);
