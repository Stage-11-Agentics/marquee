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
    requests: [{ jsonrpc: "2.0", id: 1, method: "tools/list" }],
  });
});

test("CONTRACT · MRQ-284 · an array parses as a batch and keeps arrival order", () => {
  const parsed = parseEnvelope([
    { jsonrpc: "2.0", id: "a", method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
  ]);
  expect("requests" in parsed && parsed.batch).toBe(true);
  expect("requests" in parsed && parsed.requests.map((request) => request.method))
    .toEqual(["ping", "notifications/initialized"]);
});

test("CONTRACT · MRQ-284 · a notification is a request with no id at all, which is not the same as a null id", () => {
  const notification = parseEnvelope({ jsonrpc: "2.0", method: "notifications/initialized" });
  expect("requests" in notification && "id" in notification.requests[0]).toBe(false);
  const nullId = parseEnvelope({ jsonrpc: "2.0", id: null, method: "ping" });
  expect("requests" in nullId && nullId.requests[0].id).toBeNull();
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
    expect("code" in parsed && parsed.code, name).toBe(code);
  }
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
