#!/usr/bin/env node
// mine.mjs — turn sbek judgements into a weight-ordered work queue.
//
// The distance from 83% to 100% is not a discovery problem. Every non-pass item
// is already on disk with the judge's own reasoning for why it fell short, and
// the spec carries that item's pass_criteria. Together those are a finished
// ticket: what is wrong, and what "done" means, both written by something that
// is not us.
//
//   node sequence/auto-eval/mine.mjs --kit <kit-dir> --run <run-dir> [--baseline <run-dir>]
//
// Emits JSON on stdout: items ordered by points recoverable, descending.
// Weighting matches src/report.ts — pass 1, partial 0.5, fail/not_found 0,
// cannot_judge excluded from the denominator entirely.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const POINTS = { pass: 1, partial: 0.5, fail: 0, not_found: 0, cannot_judge: null };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const kit = arg("kit", ".");
const runDir = arg("run");
const baselineDir = arg("baseline");
if (!runDir) {
  console.error("usage: mine.mjs --kit <kit-dir> --run <run-dir> [--baseline <run-dir>]");
  process.exit(2);
}

// The specs are YAML and the only parser on hand belongs to the eval kit, which
// is its own checkout with its own node_modules. Resolve from there rather than
// adding a dependency to Marquee for a script that reads someone else's files.
const kitRequire = createRequire(join(resolve(kit), "package.json"));
const { parse: parseYaml } = kitRequire("yaml");

/** id -> {weight, area, areaWeight, criterion, pass_criteria, evidence, scenarios} */
function loadRubric(kitDir) {
  const specsDir = join(kitDir, "specs");
  const rubric = new Map();
  for (const file of readdirSync(specsDir).filter((f) => f.endsWith(".yaml"))) {
    const spec = parseYaml(readFileSync(join(specsDir, file), "utf8"));
    for (const item of spec.rubric ?? []) {
      rubric.set(item.id, {
        weight: item.weight ?? 1,
        area: spec.area,
        areaWeight: spec.area_weight ?? 0,
        type: item.type,
        criterion: item.criterion,
        passCriteria: item.pass_criteria,
        evidence: item.evidence,
        scenarios: item.scenarios ?? [],
      });
    }
  }
  return rubric;
}

function loadVerdicts(dir) {
  const jdir = join(dir, "judgements");
  const verdicts = new Map();
  if (!existsSync(jdir)) return verdicts;
  for (const file of readdirSync(jdir).filter((f) => f.endsWith(".json"))) {
    const doc = JSON.parse(readFileSync(join(jdir, file), "utf8"));
    for (const item of doc.items ?? []) {
      verdicts.set(item.id, {
        verdict: item.verdict,
        reasoning: item.reasoning ?? "",
        confidence: item.confidence,
        area: file.replace(/\.json$/, ""),
      });
    }
    for (const defect of doc.defects ?? []) {
      // defects are area-scoped, not item-scoped; carried separately below
      defect.__area = file.replace(/\.json$/, "");
    }
  }
  return verdicts;
}

function loadDefects(dir) {
  const jdir = join(dir, "judgements");
  const out = [];
  if (!existsSync(jdir)) return out;
  for (const file of readdirSync(jdir).filter((f) => f.endsWith(".json"))) {
    const doc = JSON.parse(readFileSync(join(jdir, file), "utf8"));
    for (const d of doc.defects ?? []) out.push({ ...d, area: file.replace(/\.json$/, "") });
  }
  return out;
}

const rubric = loadRubric(kit);
const current = loadVerdicts(runDir);
const baseline = baselineDir ? loadVerdicts(baselineDir) : new Map();

// --- lane assignment -------------------------------------------------------
// Which queue an item belongs to decides who works it and how long it takes.
//   convert  — partial → pass. The judge named the gap. Cheapest points on the board.
//   absence  — not_found/fail → pass. A real feature build; longest lead time.
//   coverage — cannot_judge. Excluded from the denominator, so it is worth ZERO
//              headline points until judged, and NEGATIVE if it then lands
//              anything but pass. Never let a round reach one of these before
//              the capability exists.
const LANE = {
  partial: "convert",
  not_found: "absence",
  fail: "absence",
  cannot_judge: "coverage",
};

const items = [];
for (const [id, v] of current) {
  if (v.verdict === "pass") continue;
  const meta = rubric.get(id);
  if (!meta) {
    console.error(`warn: ${id} judged but absent from specs/ — skipping`);
    continue;
  }
  const earned = POINTS[v.verdict] ?? 0;
  const prior = baseline.get(id);
  items.push({
    id,
    lane: LANE[v.verdict] ?? "convert",
    area: meta.area,
    weight: meta.weight,
    verdict: v.verdict,
    // What converting this item to pass is worth, in raw rubric weight.
    // cannot_judge items enter the denominator when judged, so their upside is
    // reported but flagged: reaching them without fixing them costs points.
    recoverable: v.verdict === "cannot_judge" ? 0 : meta.weight * (1 - earned),
    coverageWeight: v.verdict === "cannot_judge" ? meta.weight : 0,
    movedFrom: prior && prior.verdict !== v.verdict ? prior.verdict : null,
    regression: prior ? (POINTS[prior.verdict] ?? 0) > earned : false,
    criterion: meta.criterion,
    passCriteria: meta.passCriteria,
    evidence: meta.evidence,
    scenarios: meta.scenarios,
    judgeReasoning: v.reasoning,
    priorReasoning: prior?.reasoning ?? null,
  });
}

items.sort((a, b) => b.recoverable - a.recoverable || a.id.localeCompare(b.id));

// --- headline arithmetic ---------------------------------------------------
let judgedWeight = 0;
let earnedWeight = 0;
let excludedWeight = 0;
for (const [id, v] of current) {
  const meta = rubric.get(id);
  if (!meta) continue;
  const p = POINTS[v.verdict];
  if (p === null) {
    excludedWeight += meta.weight;
    continue;
  }
  judgedWeight += meta.weight;
  earnedWeight += meta.weight * p;
}

const byLane = {};
for (const it of items) {
  byLane[it.lane] ??= { count: 0, recoverable: 0, coverageWeight: 0 };
  byLane[it.lane].count += 1;
  byLane[it.lane].recoverable += it.recoverable;
  byLane[it.lane].coverageWeight += it.coverageWeight;
}

const pct = (n) => Math.round((n / judgedWeight) * 1000) / 10;

console.log(
  JSON.stringify(
    {
      run: runDir,
      baseline: baselineDir ?? null,
      headline: {
        judgedWeight,
        excludedWeight,
        earnedWeight,
        pct: pct(earnedWeight),
        ifConvertLaneCleared: pct(earnedWeight + (byLane.convert?.recoverable ?? 0)),
        ifAllLanesCleared: pct(
          earnedWeight + (byLane.convert?.recoverable ?? 0) + (byLane.absence?.recoverable ?? 0),
        ),
      },
      lanes: byLane,
      regressions: items.filter((i) => i.regression),
      items,
      defects: loadDefects(runDir),
    },
    null,
    2,
  ),
);
