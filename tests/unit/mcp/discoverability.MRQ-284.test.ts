/**
 * A door nobody can find is not a door. These assert the four places an agent
 * or its operator actually looks — the Agents page, the generated front door,
 * the installable skill, and the route map — all name `/mcp`, and that the
 * first-read example says the things that keep it honest.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";

import { AgentsPage } from "../../../src/ui/agents/AgentsPage";
import {
  AGENT_FIRST_READ_BRIEF,
  mcpClientConfig,
  mcpUrl,
} from "../../../src/ui/agents/agents-copy";
import { SUBMISSION_SORTS } from "../../../src/ui/submissions/list-request";

const ORIGIN = "https://conference.example.org";
const root = resolve(import.meta.dirname, "../../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const markup = renderToString(h(AgentsPage, { navigate: () => {}, origin: ORIGIN }));

test("CONTRACT · MRQ-284 · the connect block names this instance, never the one that built it", () => {
  expect(mcpUrl(ORIGIN)).toBe("https://conference.example.org/mcp");
  const config = mcpClientConfig(ORIGIN);
  expect(JSON.parse(config)).toMatchObject({
    mcpServers: { marquee: { type: "http", url: `${ORIGIN}/mcp` } },
  });
  // The token goes in a header. That is the one thing people get wrong, so the
  // block carries it rather than describing it.
  expect(config).toContain("Authorization");
  expect(config).not.toContain("marquee.stage11.dev");
  expect(markup).toContain("https://conference.example.org/mcp");
});

test("CONTRACT · MRQ-284 · the Agents page teaches the tiers rather than only advertising the endpoint", () => {
  expect(markup).toContain("Connect over MCP");
  expect(markup).toContain("public tier");
  expect(markup).toContain("never on a conference it is not scoped to");
});

test("CONTRACT · MRQ-284 · the first-read example says what an agent may do and what it may not", () => {
  expect(markup).toContain("Let an outside agent do the AI first read");
  // The four moves an organizer has to make, in order.
  expect(markup).toContain("Agent evaluator seat");
  expect(markup).toContain("never averaged into the human number");
  expect(markup).toContain("Agent read high → low");
  expect(markup).toContain("chair can override");
  // And the brief itself forbids the thing an eager agent reaches for.
  expect(AGENT_FIRST_READ_BRIEF).toContain("review_queue");
  expect(AGENT_FIRST_READ_BRIEF).toContain("record_evaluation");
  expect(AGENT_FIRST_READ_BRIEF).toContain("abstain");
  expect(AGENT_FIRST_READ_BRIEF).toContain("Do not decide anything");
  expect(AGENT_FIRST_READ_BRIEF).toContain("apply_decisions");
});

test("CONTRACT · MRQ-284 · ordering the pile by the agent read is an option a chair can actually pick", () => {
  expect(SUBMISSION_SORTS).toContain("agent_score");
  expect(read("src/ui/submissions/SubmissionsPage.tsx")).toContain('["agent_score", "Agent read high → low"]');
  // The endpoint owns the whitelist, so the sort has to exist there too or the
  // control offers a value the server degrades away.
  expect(read("src/routes/submissions.queries.ts")).toContain("agent_score: { column: \"agent_score\"");
});

test("CONTRACT · MRQ-284 · the generated front door and the installable skill both name the endpoint", () => {
  for (const path of ["src/agent-front-door/llms.txt", "src/agent-front-door/llms-full.txt", "SKILL.md", "docs/ROUTES.md"]) {
    expect(read(path), path).toContain("/mcp");
  }
  // And the skill carries a config a person can paste, not just a sentence.
  expect(read("SKILL.md")).toContain("\"mcpServers\"");
});
