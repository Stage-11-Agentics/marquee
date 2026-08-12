import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import { COMMAND_REGISTRY } from "../../cli/registry.mjs";
import { renderSkill } from "../../cli/generate-skill.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("AC-142 + AC-143 + AC-144 · the shipped skill is generated, concrete, product-vocabulary safe, and public", async () => {
  const skill = await readFile(resolve(ROOT, "SKILL.md"), "utf8");
  assert.equal(skill, renderSkill(), "SKILL.md must be regenerated from the command registry");
  for (const heading of ["Seed", "Configure", "Triage", "Chase", "Agenda", "Publish"]) {
    assert.match(skill, new RegExp(`^## ${heading}$`, "m"));
  }
  for (const term of ["Abstract", "Session", "Evaluation plan", "Committee", "Portal", "Task", "Agenda"]) {
    assert.match(skill, new RegExp(`\\b${term}\\b`));
  }
  for (const command of COMMAND_REGISTRY) {
    assert.match(skill, new RegExp(escapeRegex(`node cli/marquee.mjs ${command.usage.replace(/^marquee /, "")}`)));
  }
  // AC-143 allows a workflow to name a CLI command *or* a raw API call. Every
  // workflow now has a command, so the skill teaches one surface rather than
  // two — an agent that has to drop to curl mid-loop has found a gap, and the
  // absence of curl is what proves there is not one.
  assert.doesNotMatch(skill, /\bcurl\b/, "every workflow in the skill is a CLI command, not a raw request");
  for (const workflow of [
    "submissions schedule",
    "submissions publish",
    "agenda place",
    "agenda move",
    "search",
    "event set",
  ]) {
    assert.match(skill, new RegExp(escapeRegex(`node cli/marquee.mjs ${workflow} `)), `${workflow} is demonstrated, not just listed`);
  }
  assert.doesNotMatch(skill, /proposal|talk submission|CFP entry|panel review/i);
  for (const forbidden of [
    ["Stage", "11"].join(" "),
    ["Lat", "tice"].join(""),
    ["marquee", "stage" + "11", "dev"].join("."),
    ["session", "cookie"].join(" "),
    ["cookie", "auth"].join(" "),
  ]) assert.doesNotMatch(skill, new RegExp(escapeRegex(forbidden), "i"));
});
