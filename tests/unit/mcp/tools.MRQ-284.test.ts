import { expect, test } from "vitest";

import { MCP_TOOLS, MCP_TOOLS_BY_NAME } from "../../../src/mcp/tools";

test("CONTRACT · MRQ-284 · the catalogue is curated, not generated — one tool per door worth naming", () => {
  // The ceiling is the point: a tool per OpenAPI operation would be ~285 doors
  // and no guidance, which is a worse agent surface than the OpenAPI document
  // it was generated from.
  expect(MCP_TOOLS.length).toBeGreaterThanOrEqual(20);
  expect(MCP_TOOLS.length).toBeLessThanOrEqual(25);
  expect(MCP_TOOLS_BY_NAME.size).toBe(MCP_TOOLS.length);
});

test("CONTRACT · MRQ-284 · every tool is named like a sentence a person would say", () => {
  for (const tool of MCP_TOOLS) {
    expect(tool.name, tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(tool.title.length, tool.name).toBeGreaterThan(0);
  }
});

test("CONTRACT · MRQ-284 · every description is written for a model that has never seen Marquee", () => {
  for (const tool of MCP_TOOLS) {
    // Long enough to state a precondition and what a refusal means. A one-line
    // description is the failure mode that makes an MCP server unusable.
    expect(tool.description.length, tool.name).toBeGreaterThan(160);
  }
});

test("CONTRACT · MRQ-284 · every write tool announces itself as one and says how it is undone", () => {
  for (const tool of MCP_TOOLS.filter((candidate) => candidate.write === true)) {
    expect(tool.description, tool.name).toContain("WRITE");
    expect(tool.description.toLowerCase(), tool.name).toContain("undo");
  }
  // And nothing that only reads claims to write.
  for (const tool of MCP_TOOLS.filter((candidate) => candidate.write !== true)) {
    expect(tool.description, tool.name).not.toContain("WRITE");
  }
});

test("CONTRACT · MRQ-284 · every argument a tool maps is an argument it declares", () => {
  for (const tool of MCP_TOOLS) {
    const declared = new Set(Object.keys(tool.inputSchema.properties));
    const mapped = [
      ...Object.values(tool.pathParams ?? {}),
      ...(tool.query ?? []),
      ...(tool.body?.fields ?? []),
      ...Object.keys(tool.body?.rename ?? {}),
      ...(tool.body?.selectorFields ?? []),
      ...Object.values(tool.headers ?? {}),
    ];
    for (const name of mapped) {
      expect(declared.has(name), `${tool.name} maps undeclared argument ${name}`).toBe(true);
    }
    for (const name of tool.inputSchema.required ?? []) {
      expect(declared.has(name), `${tool.name} requires undeclared argument ${name}`).toBe(true);
    }
    expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
  }
});

test("CONTRACT · MRQ-284 · the two-phase decision contract is stated on both halves", () => {
  const plan = MCP_TOOLS_BY_NAME.get("decision_plan");
  const apply = MCP_TOOLS_BY_NAME.get("apply_decisions");
  expect(plan?.description).toContain("apply_decisions");
  expect(plan?.write).not.toBe(true);
  expect(apply?.inputSchema.required).toContain("plan_fingerprint");
  expect(apply?.inputSchema.required).toContain("if_match");
  expect(apply?.headers).toMatchObject({ "if-match": "if_match" });
});

test("CONTRACT · MRQ-284 · counting before sending is stated where an agent would look for it", () => {
  expect(MCP_TOOLS_BY_NAME.get("send_reminder")?.description).toContain("comms_audience");
});

test("CONTRACT · MRQ-284 · abstaining and evaluating are the same door with the flag set for you", () => {
  const record = MCP_TOOLS_BY_NAME.get("record_evaluation");
  const abstain = MCP_TOOLS_BY_NAME.get("abstain");
  expect(record?.operationId).toBe(abstain?.operationId);
  expect(record?.body?.fixed).toEqual({ abstained: 0 });
  expect(abstain?.body?.fixed).toEqual({ abstained: 1 });
});
