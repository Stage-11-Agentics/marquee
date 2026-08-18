/**
 * Which tools a caller is shown.
 *
 * Two tiers, one endpoint. No `Authorization` header is the public tier —
 * exactly the doors a signed-out browser walks through. A bearer token widens
 * the set to what that token's grants, its seat, and its conference restriction
 * already allow over REST, and never by one tool more.
 *
 * The decision is not made here. It is read out of the route registry — a
 * tool's tier IS its route's `policy.auth` — and evaluated with the same
 * `tokenHasGrant` / `roleForEvent` / `membershipAllowsGrant` functions the API
 * router's own `authorize()` calls. A second copy of an authorization rule is
 * the copy that goes wrong, and there is no second copy.
 *
 * `tools/list` is a hint; `tools/call` is the truth. A tool listed here still
 * passes the full pipeline when it is called, so the worst a generous listing
 * can do is show a caller a door that then refuses them by name. The reverse —
 * hiding a tool a token may in fact use — is the failure worth avoiding, which
 * is why an event-scoped tool is listed when the principal satisfies it on ANY
 * conference it can reach rather than on all of them.
 *
 * That asymmetry is also the honest answer for the routes whose policy is
 * `authenticated`: they take any resolved credential through the pipeline and
 * check the seat inside the handler, where the requirement is written in code
 * rather than declared. Those are listed for anyone signed in, and refused at
 * call time in the handler's own words. Reading such a requirement back out of
 * a handler to pre-filter the listing would mean writing that rule down a
 * second time here, and a second copy of an authorization rule is the copy that
 * drifts. A tool shown and then refused costs a caller one call; a rule that
 * disagrees with itself costs a conference its trust in the answer.
 */
import type { ApiRouteEntry } from "../api/route";
import type { Principal } from "../api/runtime";
import type { MembershipRow } from "../db/schema";
import {
  membershipAllowsGrant,
  roleForEvent,
  tokenHasGrant,
} from "../lib/auth/scope-resolution";
import type { McpTool } from "./tools";

/** Registry lookup by operationId, built once per assembled API app. */
export function indexRoutesByOperationId(
  entries: readonly ApiRouteEntry[],
): ReadonlyMap<string, ApiRouteEntry> {
  return new Map(entries.map((entry) => [entry.operationId, entry]));
}

/**
 * Every conference this principal could plausibly act on. Not an authorization
 * answer — the input to one. A token pinned to a single conference reduces to
 * that one, which is what makes "restricted to one conference" visible in the
 * listing rather than only at call time.
 */
function reachableEventIds(principal: Principal): readonly string[] {
  if (principal.kind === "anonymous") return [];
  const fromMemberships = (memberships: readonly MembershipRow[]) =>
    memberships.map((membership) => membership.event_id).filter((id): id is string => id !== null);
  if (principal.kind === "session") return [...new Set(fromMemberships(principal.memberships))];
  if (principal.eventId !== null) return [principal.eventId];
  const declared = principal.eventIds.length > 0
    ? principal.eventIds
    : principal.organizationEventIds ?? fromMemberships(principal.memberships);
  return [...new Set(declared)];
}

function satisfiesOnSomeEvent(principal: Principal, grants: readonly string[]): boolean {
  if (principal.kind === "anonymous") return false;
  const events = reachableEventIds(principal);
  if (events.length === 0) return false;
  return events.some((eventId) =>
    grants.every((grant) => {
      if (principal.kind === "token") return tokenHasGrant(principal, grant as never, eventId);
      const role = roleForEvent(principal.memberships, eventId);
      return role !== null && membershipAllowsGrant(role, grant as never);
    }));
}

/**
 * True when this principal should be shown this tool. `public` is everyone,
 * `authenticated` is anyone who resolved, `grants` is the real question.
 */
export function toolIsVisible(
  tool: McpTool,
  route: ApiRouteEntry,
  principal: Principal,
): boolean {
  const auth = route.policy.auth;
  if (auth.kind === "public") return true;
  if (principal.kind === "anonymous") return false;
  if (auth.kind === "authenticated") return true;
  return satisfiesOnSomeEvent(principal, auth.grants);
}

/** True when this tool needs no credential at all — the public tier. */
export function toolIsPublic(route: ApiRouteEntry): boolean {
  return route.policy.auth.kind === "public";
}
