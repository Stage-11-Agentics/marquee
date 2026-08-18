import { expect, test } from "vitest";

import {
  JSON_RPC_ERRORS,
  LATEST_PROTOCOL_VERSION,
  negotiateProtocolVersion,
  parseEnvelope,
} from "../../../src/mcp/protocol";

test("CONTRACT · MRQ-284 · a single request parses into one member and is not a batch", () => {
  const parsed = parseEnvelope({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  expect(parsed).toEqual({
    batch: false,
    members: [{ kind: "request", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }],
  });
});

test("CONTRACT · MRQ-284 · an array parses as a batch and keeps arrival order", () => {
  const parsed = parseEnvelope([
    { jsonrpc: "2.0", id: "a", method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
  ]);
  expect("members" in parsed && parsed.batch).toBe(true);
  expect("members" in parsed && parsed.members.map((member) => (member.kind === "request" ? member.request.method : "invalid")))
    .toEqual(["ping", "notifications/initialized"]);
});

test("CONTRACT · MRQ-284 · a notification is a request with no id at all, which is not the same as a null id", () => {
  const notification = parseEnvelope({ jsonrpc: "2.0", method: "notifications/initialized" });
  expect("members" in notification && notification.members[0].kind === "request"
    && "id" in notification.members[0].request).toBe(false);
  const nullId = parseEnvelope({ jsonrpc: "2.0", id: null, method: "ping" });
  expect("members" in nullId && nullId.members[0].kind === "request" && nullId.members[0].request.id).toBeNull();
});

test("CONTRACT · MRQ-284 · a malformed envelope is a protocol fault, not a refusal", () => {
  const cases: Array<[string, unknown, number]> = [
    ["a missing version", { id: 1, method: "ping" }, JSON_RPC_ERRORS.invalidRequest],
    ["the wrong version", { jsonrpc: "1.0", id: 1, method: "ping" }, JSON_RPC_ERRORS.invalidRequest],
    ["no method", { jsonrpc: "2.0", id: 1 }, JSON_RPC_ERRORS.invalidRequest],
    ["a non-object member", "hello", JSON_RPC_ERRORS.invalidRequest],
    ["an empty batch", [], JSON_RPC_ERRORS.invalidRequest],
    ["an object id", { jsonrpc: "2.0", id: {}, method: "ping" }, JSON_RPC_ERRORS.invalidRequest],
    ["array params", { jsonrpc: "2.0", id: 1, method: "ping", params: [] }, JSON_RPC_ERRORS.invalidParams],
  ];
  for (const [name, payload, code] of cases) {
    const parsed = parseEnvelope(payload);
    // An empty batch has no member to attach a fault to, so it is the one
    // whole-envelope error; everything else is reported per member.
    const observed = "code" in parsed
      ? parsed.code
      : parsed.members[0].kind === "invalid" ? parsed.members[0].error.code : undefined;
    expect(observed, name).toBe(code);
  }
});

test("CONTRACT · MRQ-284 · one bad member does not cost the batch its good ones, and keeps its own id", () => {
  const parsed = parseEnvelope([
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: "oops" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ]);
  expect("members" in parsed).toBe(true);
  if (!("members" in parsed)) return;
  expect(parsed.members.map((member) => member.kind)).toEqual(["request", "invalid", "request"]);
  // The id it sent comes back, which is the only way a client can tell which of
  // its own messages failed.
  expect(parsed.members[1].kind === "invalid" && parsed.members[1].id).toBe(7);
});

test("CONTRACT · MRQ-284 · a known protocol revision is answered in the caller's own version", () => {
  expect(negotiateProtocolVersion("2024-11-05")).toBe("2024-11-05");
  expect(negotiateProtocolVersion("2025-03-26")).toBe("2025-03-26");
});

test("CONTRACT · MRQ-284 · an unknown revision falls back to the newest we speak rather than failing", () => {
  expect(negotiateProtocolVersion("3000-01-01")).toBe(LATEST_PROTOCOL_VERSION);
  expect(negotiateProtocolVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION);
  expect(negotiateProtocolVersion(7)).toBe(LATEST_PROTOCOL_VERSION);
});
