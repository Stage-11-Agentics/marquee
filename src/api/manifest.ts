/**
 * Pure manifest builder (R2). `src/routes/_manifest.ts` is only the eager
 * `import.meta.glob` plus this function; unit tests inject fixture module
 * records directly, so fixtures prove discovery/order/diagnostics without
 * being discoverable or shipped in the production glob.
 */
import { API_ROUTES_EXPORT, type ApiRouteEntry } from "./route";

export class ManifestError extends Error {
  readonly modulePath: string;

  constructor(modulePath: string, message: string) {
    super(`${modulePath}: ${message}`);
    this.name = "ManifestError";
    this.modulePath = modulePath;
  }
}

/** A discovered route plus the module file that declared it — diagnostics name the file to fix. */
export interface ManifestEntry {
  modulePath: string;
  entry: ApiRouteEntry;
}

function isApiRouteEntry(value: unknown): value is ApiRouteEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.method === "string" &&
    typeof candidate.path === "string" &&
    candidate.path.startsWith("/") &&
    typeof candidate.operationId === "string" &&
    candidate.operationId.length > 0 &&
    typeof candidate.route === "object" &&
    candidate.route !== null &&
    typeof candidate.handler === "function" &&
    typeof candidate.policy === "object" &&
    candidate.policy !== null
  );
}

/** `/api/v1/events/{eventId}` — the canonical form used in signatures. */
export function normalizePath(path: string): string {
  if (!path.startsWith("/")) throw new Error(`path must start with '/': ${path}`);
  if (path.length > 1 && path.endsWith("/")) {
    throw new Error(`path must not have a trailing slash: ${path}`);
  }
  if (path.includes(":")) {
    throw new Error(
      `path must use OpenAPI '{param}' syntax, not Hono ':param' syntax: ${path}`,
    );
  }
  return path;
}

/** Canonical operation signature: `METHOD normalized-path operationId`. */
export function operationSignature(entry: ApiRouteEntry): string {
  return `${entry.method.toUpperCase()} ${normalizePath(entry.path)} ${entry.operationId}`;
}

/**
 * Normalize glob results into a deterministic route table. Fails loudly —
 * naming the module file, on both sides of a collision — for malformed
 * exports, missing handlers, duplicate `method + path`, or duplicate
 * `operationId`.
 */
export function buildManifestEntries(
  modules: Record<string, unknown>,
): ManifestEntry[] {
  const discovered: ManifestEntry[] = [];
  for (const modulePath of Object.keys(modules).sort()) {
    const moduleValue = modules[modulePath];
    if (typeof moduleValue !== "object" || moduleValue === null) {
      throw new ManifestError(modulePath, "module did not resolve to an object");
    }
    const exported = (moduleValue as Record<string, unknown>)[API_ROUTES_EXPORT];
    if (!Array.isArray(exported)) {
      throw new ManifestError(
        modulePath,
        `missing or non-array '${API_ROUTES_EXPORT}' export (use defineApiRoute)`,
      );
    }
    if (exported.length === 0) {
      throw new ManifestError(modulePath, `'${API_ROUTES_EXPORT}' is empty`);
    }
    for (const value of exported) {
      if (!isApiRouteEntry(value)) {
        throw new ManifestError(
          modulePath,
          "malformed route entry: requires method, path, operationId, route, handler, policy",
        );
      }
      // Reject Hono-style paths at discovery so a bad path can never reach the
      // document: `normalizePath` throws, and the module is named in the error.
      try {
        normalizePath(value.path);
      } catch (cause) {
        throw new ManifestError(modulePath, (cause as Error).message);
      }
      discovered.push({ modulePath, entry: value });
    }
  }

  const byRoute = new Map<string, ManifestEntry>();
  const byOperationId = new Map<string, ManifestEntry>();
  for (const found of discovered) {
    const routeKey = `${found.entry.method.toUpperCase()} ${normalizePath(found.entry.path)}`;
    const routeOwner = byRoute.get(routeKey);
    if (routeOwner) {
      throw new ManifestError(
        found.modulePath,
        `duplicate route ${routeKey} (also declared by ${routeOwner.modulePath})`,
      );
    }
    byRoute.set(routeKey, found);
    const operationOwner = byOperationId.get(found.entry.operationId);
    if (operationOwner) {
      throw new ManifestError(
        found.modulePath,
        `duplicate operationId '${found.entry.operationId}' (also declared by ${operationOwner.modulePath})`,
      );
    }
    byOperationId.set(found.entry.operationId, found);
  }

  return discovered.sort((left, right) =>
    operationSignature(left.entry).localeCompare(operationSignature(right.entry)),
  );
}

/** The route table itself, in the same deterministic order. */
export function buildManifest(modules: Record<string, unknown>): ApiRouteEntry[] {
  return buildManifestEntries(modules).map((found) => found.entry);
}

/** Sorted canonical signature set — the parity source for check:api and the emitted registry. */
export function operationSignatures(entries: readonly ApiRouteEntry[]): string[] {
  return entries.map(operationSignature).sort();
}
