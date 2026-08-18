import { expect, test } from "vitest";

import type { ApiRouteEntry } from "../../../src/api/route";
import type { Principal } from "../../../src/api/runtime";
import type { MembershipRow } from "../../../src/db/schema";
import { toolIsVisible } from "../../../src/mcp/tier";
import { MCP_TOOLS_BY_NAME, type McpTool } from "../../../src/mcp/tools";

const EVENT = "evt_one";
const OTHER_EVENT = "evt_two";

function route(auth: ApiRouteEntry["policy"]["auth"]): ApiRouteEntry {
  return {
    method: "get",
    path: "/api/v1/events/{eventId}/dashboard",
    operationId: "fixture",
    route: {} as ApiRouteEntry["route"],
    handler: (() => new Response()) as ApiRouteEntry["handler"],
    policy: { auth, rateLimit: { bucket: "read" }, concurrency: "none" },
  };
}

function membership(eventId: string | null, role: MembershipRow["role"]): MembershipRow {
  return {
    id: `mem_${eventId ?? "org"}_${role}`,
    org_id: "org_1",
    event_id: eventId,
    person_id: "per_1",
    role,
    confirmation_status: "pending",
    confirmed_at: null,
    invited_at: null,
    created_at: 0,
    updated_at: 0,
  } as MembershipRow;
}

function token(overrides: Partial<Extract<Principal, { kind: "token" }>>): Principal {
  return {
    kind: "token",
    tokenId: "tok_1",
    orgId: "org_1",
    eventId: null,
    permissions: [],
    grants: [],
    eventIds: [],
    actingPersonId: "per_1",
    memberships: [],
    ...overrides,
  };
}

const anyTool = MCP_TOOLS_BY_NAME.get("pipeline_summary") as McpTool;

test("CONTRACT · MRQ-284 · a public route is visible to a caller carrying nothing", () => {
  expect(toolIsVisible(anyTool, route({ kind: "public" }), { kind: "anonymous" })).toBe(true);
});

test("CONTRACT · MRQ-284 · anonymous sees nothing that needs a credential", () => {
  expect(toolIsVisible(anyTool, route({ kind: "authenticated" }), { kind: "anonymous" })).toBe(false);
  expect(toolIsVisible(anyTool, route({ kind: "grants", grants: ["program:read"] }), { kind: "anonymous" })).toBe(false);
});

test("CONTRACT · MRQ-284 · a token is shown a grant-gated tool only where its seat actually allows it", () => {
  const reviewer = token({
    grants: ["review:write"],
    eventIds: [EVENT],
    memberships: [membership(EVENT, "reviewer")],
    organizationEventIds: [EVENT, OTHER_EVENT],
  });
  expect(toolIsVisible(anyTool, route({ kind: "grants", grants: ["review:write"] }), reviewer)).toBe(true);
  // The grant is in the token's scopes but a reviewer seat does not carry it.
  expect(toolIsVisible(anyTool, route({ kind: "grants", grants: ["program:write"] }), reviewer)).toBe(false);
});

test("CONTRACT · MRQ-284 · a token pinned to one conference is judged on that conference alone", () => {
  const pinned = token({
    eventId: OTHER_EVENT,
    grants: ["review:write"],
    memberships: [membership(EVENT, "reviewer")],
  });
  // Its only reachable conference is the one it is pinned to, where it has no seat.
  expect(toolIsVisible(anyTool, route({ kind: "grants", grants: ["review:write"] }), pinned)).toBe(false);
});

test("CONTRACT · MRQ-284 · a session is judged by the role it holds, per conference", () => {
  const reviewer: Principal = {
    kind: "session",
    sessionId: "sess_1",
    personId: "per_1",
    orgId: "org_1",
    memberships: [membership(EVENT, "reviewer")],
  };
  expect(toolIsVisible(anyTool, route({ kind: "grants", grants: ["review:write"] }), reviewer)).toBe(true);
  expect(toolIsVisible(anyTool, route({ kind: "grants", grants: ["agenda:write"] }), reviewer)).toBe(false);
  expect(toolIsVisible(anyTool, route({ kind: "authenticated" }), reviewer)).toBe(true);
});

test("CONTRACT · MRQ-284 · a credential that reaches no conference at all is shown no event-scoped tool", () => {
  expect(toolIsVisible(anyTool, route({ kind: "grants", grants: ["program:read"] }), token({ grants: ["program:read"] })))
    .toBe(false);
});
