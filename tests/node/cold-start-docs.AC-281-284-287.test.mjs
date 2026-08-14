/**
 * The written half of the cold start: the agent's chapter, the fix commands the
 * panel prints, and the promise the docs make about what is built.
 *
 * All three are static facts about the shipping tree, so they cost no runtime.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import { COMMAND_REGISTRY } from "../../cli/registry.mjs";
import { renderSkill } from "../../cli/generate-skill.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path) => readFile(resolve(ROOT, path), "utf8");
const SETUP_CHAPTER = /^## Set up a new instance$([\s\S]*?)^## Seed$/m;

/**
 * The shipped route manifest, read from the definitions themselves.
 *
 * `cli/api-registry.json` is a build artifact generated from a booted Worker
 * and is deliberately untracked, so a test that imported it would pass or fail
 * on whether someone had run a check — which is not a fact about this build.
 * `defineApiRoute` is the single declaration site, so scanning it is both
 * cheaper and closer to the truth.
 */
async function routeManifest() {
  const directory = resolve(ROOT, "src/routes");
  const entries = (await readdir(directory)).filter((name) => /\.tsx?$/.test(name));
  const routes = new Map();
  for (const name of entries) {
    const source = await readFile(resolve(directory, name), "utf8");
    for (const [, method, path, operationId] of source.matchAll(
      /method:\s*"(\w+)",\s*\n\s*path:\s*"([^"]+)",\s*\n\s*operationId:\s*"(\w+)"/g,
    )) {
      routes.set(operationId, { method: method.toUpperCase(), path, file: `src/routes/${name}` });
    }
  }
  return routes;
}

test("AC-281 · every setup verb drives the route its screen drives, and the manifest declares all of them", async () => {
  const setupCommands = COMMAND_REGISTRY.filter((command) => command.skill === "setup");
  assert.deepEqual(
    setupCommands.map((command) => command.path.join(" ")).sort(),
    [
      "evaluation plan",
      "event create",
      "forms create",
      "forms list",
      "organizers invite",
      "organizers list",
      "setup claim-link",
      "setup health",
      "setup instance",
    ],
    "the setup chapter's verb set is fixed; adding one means teaching the chapter too",
  );

  const manifest = await routeManifest();
  const cli = await read("cli/marquee.mjs");
  for (const command of setupCommands) {
    // `setup health` is the one verb with no API operation, for the reason its
    // registry entry gives: `/health` is the deployment's liveness stamp, not
    // something this conference serves. Every other verb must name one.
    assert.ok(
      Array.isArray(command.operations),
      `${command.path.join(" ")} declares no operations array`,
    );
    if (command.path.join(" ") !== "setup health") {
      assert.ok(command.operations.length, `${command.path.join(" ")} names no operation`);
    }
    for (const operationId of command.operations) {
      const route = manifest.get(operationId);
      assert.ok(route, `${operationId} is not an operation the API serves`);
      // The verb reaches that exact path — a registry entry naming an operation
      // its implementation never calls is the drift this catches.
      const literal = route.path.replace(/\{eventId\}/g, "${encodeURIComponent(eventId)}");
      assert.ok(
        cli.includes(literal) || cli.includes(route.path),
        `${command.path.join(" ")} does not drive ${route.method} ${route.path}`,
      );
    }
  }

  // Each verb with a screen drives the screen's route, by the same path string
  // the screen registers. One endpoint per capability, whoever asks.
  const screens = {
    // The setup dashboard keeps InstancePanel as its compatibility wrapper;
    // ServerPanel is the shared component that now owns this request seam.
    "setup instance": ["src/ui/setup/ServerPanel.tsx", "/api/v1/instance/status"],
    "event create": ["src/ui/setup/CreateConferencePage.tsx", "/api/v1/events"],
    "forms create": ["src/ui/forms/FormsPage.tsx", "/api/v1/events/{eventId}/forms"],
    "forms list": ["src/ui/forms/FormsPage.tsx", "/api/v1/events/{eventId}/forms"],
    "evaluation plan": ["src/ui/evaluation/EvaluationPage.tsx", "/api/v1/events/{eventId}/plans"],
    "organizers list": ["src/ui/setup/OrganizersCard.tsx", "/api/v1/org/members"],
    "organizers invite": ["src/ui/setup/OrganizersCard.tsx", "/api/v1/org/invites"],
  };
  for (const [verb, [file, path]] of Object.entries(screens)) {
    const command = setupCommands.find((entry) => entry.path.join(" ") === verb);
    const route = manifest.get(command.operations[0]);
    assert.equal(route.path, path, `${verb} and its screen disagree about the route`);
    assert.ok((await read(file)).includes(path), `${file} does not drive ${path}`);
  }

  // `setup claim-link` is the one verb with no screen, by design: it runs
  // before a person exists to look at one.
  const claimLink = setupCommands.find((entry) => entry.path.join(" ") === "setup claim-link");
  assert.equal(claimLink.unauthenticated, true);
});

test("AC-281 · SKILL.md is the generated file, carries the setup chapter, and never opens the link or publishes the form", async () => {
  const skill = await read("SKILL.md");
  assert.equal(skill, renderSkill(), "SKILL.md must be regenerated from cli/generate-skill.mjs");

  const chapter = SETUP_CHAPTER.exec(skill)?.[1];
  assert.ok(chapter, "the setup chapter is missing from the shipped skill");
  assert.ok(SETUP_CHAPTER.test(renderSkill()), "the chapter must come from renderSkill(), not a hand edit");

  // The claim step hands the link to a human and says so in the imperative.
  assert.match(chapter, /Never open the claim link yourself/);
  assert.match(chapter, /Ownership must land on a person, not on an agent/);
  assert.match(chapter, /Tell the operator to open it in a browser/);

  // No command in the chapter publishes a form, and the chapter says why.
  const commands = [...chapter.matchAll(/```sh\n([\s\S]*?)```/g)].flatMap(([, block]) => block.split("\n"));
  for (const line of commands) {
    assert.doesNotMatch(line, /\bpublish\b/, `a setup command publishes: ${line}`);
    assert.doesNotMatch(line, /forms\s+open\b/, `a setup command opens intake: ${line}`);
  }
  assert.match(chapter, /Stop before intake/);
  assert.match(chapter, /opening intake is the operator's click/);

  // Every command the chapter demonstrates is a real registered verb.
  for (const line of commands.filter((entry) => entry.includes("cli/marquee.mjs"))) {
    const verb = /cli\/marquee\.mjs\s+(\S+)\s+(\S+)/.exec(line);
    assert.ok(
      COMMAND_REGISTRY.some((command) => command.path[0] === verb[1] && command.path[1] === verb[2]),
      `the chapter demonstrates an unregistered command: ${verb?.[0]}`,
    );
  }
});

test("AC-284 · every fix command the Instance panel prints is copy-exact against the README", async () => {
  const statusSource = await read("src/lib/instance-status.ts");
  const readme = await read("README.md");
  const fixes = /INSTANCE_STATUS_FIXES[\s\S]*?\n};/.exec(statusSource)?.[0];
  assert.ok(fixes, "the fix table moved; this assertion has to move with it");
  const commands = [...fixes.matchAll(/"(npx wrangler [^"]+)"/g)].map(([, command]) => command);
  assert.ok(commands.length >= 7, `expected the full fix table, found ${commands.length}`);
  for (const command of commands) {
    assert.ok(readme.includes(command), `the panel prints a command the README does not: ${command}`);
  }
});

test("AC-287 · the docs and the build agree: the claim route exists and no caveat says it does not", async () => {
  // The build half: the claim path is really in the shipped route manifest.
  const manifest = await routeManifest();
  assert.deepEqual(manifest.get("claimInstance"), {
    method: "POST",
    path: "/api/v1/claim",
    file: "src/routes/claim.routes.ts",
  });
  assert.deepEqual(manifest.get("mintInstanceClaimLink"), {
    method: "POST",
    path: "/api/v1/setup/claim-link",
    file: "src/routes/claim.routes.ts",
  });

  // The docs half: no status banner, no "lands with" caveat, anywhere.
  const gettingStarted = await read("docs/GETTING-STARTED.md");
  const readme = await read("README.md");
  assert.doesNotMatch(gettingStarted, /^>\s*\*\*Status\.\*\*/m, "the status banner outlived the build it described");
  assert.doesNotMatch(gettingStarted, /land(s)? with the cold-start build/i);
  assert.doesNotMatch(readme, /land(s)? with the cold-start build/i);
  for (const document of [gettingStarted, readme]) {
    assert.doesNotMatch(document, /as designed in the binding prototype/i);
    assert.doesNotMatch(document, /not (yet )?implemented/i);
  }

  // And the guide still teaches the flow it stopped hedging about.
  assert.match(gettingStarted, /claim link/i);
  assert.match(readme, /claim link/i);
});
