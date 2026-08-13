/**
 * check:deploy — is the live Worker running what `main` says it should?
 *
 * There is no auto-deploy. Merging does not ship, CI green does not ship, and
 * nothing anywhere signals the gap: the live site fell behind `main` three times
 * in one evening, twice serving a screen the fleet had already fixed. The only
 * defence is asking the two sources directly and comparing them.
 *
 * Two facts, two different places:
 *
 *   1. `GET <url>/health` returns `{ build }` — the sha baked into the bundle at
 *      build time. It describes the artifact running at Cloudflare's edge, which
 *      is the only thing a judge or a grader ever sees.
 *   2. `main`'s head — read from the local `github/main` ref after a fetch, or
 *      from `git ls-remote` when this runs outside a checkout.
 *
 * Equality is the easy case. The useful judgement is the *unequal* one, because
 * "behind" is not one condition:
 *
 *   - behind on board, docs, or submission-pack commits only — the deployed
 *     product is identical, and blocking a run on that wastes the window.
 *   - behind on anything under `src/`, `migrations/`, or the build config — the
 *     live site is a different product from the one `main` describes, and any
 *     score taken against it measures work that is already finished.
 *   - not an ancestor of `main` at all — someone deployed a branch. Loudest case;
 *     the drift is unbounded and no diff describes it.
 *
 * Exit codes are the contract for callers that gate on this: 0 fresh, cosmetic-only
 * drift, or a declared freeze; 1 stale on product code; 2 could not determine.
 *
 * ## The freeze
 *
 * There is one situation where `stale` is the intended state and acting on it does
 * damage: an eval run grades the *live* site over ~100 minutes, so the build is
 * pinned behind `main` on purpose. A merge during that window makes this command
 * read `stale`, and an agent who follows DEPLOY.md correctly — sees red, ships the
 * drift — destroys the measurement while doing everything right.
 *
 * That makes an alarm that is correct almost always and catastrophically wrong in
 * the window nobody flagged, which is worse than no alarm, because it has earned
 * trust it does not deserve there. Two defences, in order of reliability:
 *
 *   1. A freeze marker (`.deploy-freeze` at the repo root, or `MARQUEE_DEPLOY_FREEZE`)
 *      turns the verdict into `frozen`, exit 0, naming who declared it and why.
 *   2. Failing that, the `stale` verdict says so itself. The second defence matters
 *      more, because it works when someone forgot the first — which is exactly the
 *      circumstance where the trap springs.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

import { REPOSITORY_ROOT, emit, parseArguments } from "./lib/command.mjs";

const DEFAULT_URL = "https://marquee.stage11.dev";
const DEFAULT_REMOTE = "github";
const DEFAULT_BRANCH = "main";
const REPOSITORY_URL = "https://github.com/Stage-11-Agentics/marquee.git";

/**
 * Paths whose contents reach the deployed Worker. A commit touching none of
 * these cannot change what a browser sees, however important it is otherwise.
 */
const PRODUCT_PATHS = [
  "src/",
  "migrations/",
  "public/",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "wrangler.jsonc",
  "wrangler.toml",
];

/**
 * The primary checkout, found from any linked worktree without being told.
 *
 * `--git-common-dir` resolves to the primary worktree's `.git`, so its parent is
 * the primary checkout. This matters because deploys happen from a *fresh linked
 * worktree* — the recipe below says so — and a marker written once in the primary
 * checkout would otherwise be invisible at exactly the moment it is needed.
 */
function primaryCheckout() {
  const commonDirectory = git(["rev-parse", "--git-common-dir"], { allowFailure: true });
  if (!commonDirectory) return undefined;
  return dirname(resolve(REPOSITORY_ROOT, commonDirectory.trim()));
}

/**
 * A declared deploy freeze, if one is in force.
 *
 * Deliberately a plain file at a fixed path rather than anything cleverer: it has
 * to be readable by an agent in any worktree, on a build that predates the freeze,
 * with no service to ask and no state to sync.
 */
function readFreeze(environment = process.env) {
  const inline = environment.MARQUEE_DEPLOY_FREEZE;
  if (typeof inline === "string" && inline.trim().length > 0) {
    return { reason: inline.trim(), source: "MARQUEE_DEPLOY_FREEZE" };
  }
  for (const root of [REPOSITORY_ROOT, environment.MARQUEE_PRIMARY_CHECKOUT, primaryCheckout()].filter(Boolean)) {
    try {
      const text = readFileSync(resolve(root, ".deploy-freeze"), "utf8").trim();
      if (text.length > 0) return { reason: text, source: resolve(root, ".deploy-freeze") };
    } catch {
      // No marker here; try the next root.
    }
  }
  return undefined;
}

function git(arguments_, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", arguments_, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (allowFailure) return undefined;
    throw error;
  }
}

async function readLiveBuild(url) {
  const endpoint = `${url.replace(/\/$/, "")}/health`;
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${endpoint} answered HTTP ${response.status}`);
  }
  const body = await response.json();
  if (typeof body.build !== "string" || body.build.length === 0) {
    throw new Error(`${endpoint} returned no build sha`);
  }
  return { build: body.build, builtAt: body.built_at };
}

/**
 * `main`'s head. Prefers the local ref so the answer matches the tree the caller
 * is reasoning about, and falls back to the remote when there is no checkout —
 * which is the situation on any host that only ever runs the eval.
 */
function readMainHead({ remote, branch, fetchFirst, override }) {
  if (typeof override === "string") return { sha: override, source: "--main override" };
  if (fetchFirst) git(["fetch", remote, branch, "--quiet"], { allowFailure: true });

  const local = git(["rev-parse", `${remote}/${branch}`], { allowFailure: true });
  if (local) return { sha: local, source: `${remote}/${branch}` };

  const remoteLine = git(["ls-remote", REPOSITORY_URL, `refs/heads/${branch}`], {
    allowFailure: true,
  });
  if (remoteLine) return { sha: remoteLine.split(/\s+/)[0], source: "ls-remote" };

  throw new Error(
    `cannot resolve ${branch}: no ${remote}/${branch} ref and ls-remote failed (auth?)`,
  );
}

function classify({ liveBuild, mainSha }) {
  if (mainSha.startsWith(liveBuild)) {
    return { status: "fresh", behind: [], productCommits: [] };
  }

  // `git log live..main` needs the live commit to exist locally and to be an
  // ancestor. When it is not, the deploy came from somewhere other than main.
  const isAncestor =
    git(["merge-base", "--is-ancestor", liveBuild, mainSha], { allowFailure: true }) !==
    undefined;
  if (!isAncestor) {
    return { status: "off-main", behind: [], productCommits: [] };
  }

  const behind = git(["log", "--format=%h %s", `${liveBuild}..${mainSha}`])
    .split("\n")
    .filter(Boolean);

  const changedFiles = git([
    "diff",
    "--name-only",
    `${liveBuild}..${mainSha}`,
  ]).split("\n").filter(Boolean);

  const productFiles = changedFiles.filter((file) =>
    PRODUCT_PATHS.some((prefix) =>
      prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix,
    ),
  );

  return {
    status: productFiles.length > 0 ? "stale" : "cosmetic",
    behind,
    productFiles,
    newRequiredSecrets: newRequiredSecrets({ liveBuild, mainSha }),
  };
}

/**
 * Names added to `wrangler.jsonc`'s `secrets.required` since the live build.
 *
 * Adding one is free at merge time and refuses the *next* `wrangler deploy`
 * outright — "merging does not ship" in a second costume, where the person who
 * pays is not the person who chose. Reading it off the same diff costs nothing
 * and moves the discovery from the deploy to the pre-flight.
 */
function newRequiredSecrets({ liveBuild, mainSha }) {
  const diff = git(["diff", `${liveBuild}..${mainSha}`, "--", "wrangler.jsonc"], {
    allowFailure: true,
  });
  if (!diff) return [];
  return [
    ...new Set(
      diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .flatMap((line) => line.match(/"([A-Z][A-Z0-9_]{2,})"/g) ?? [])
        .map((quoted) => quoted.slice(1, -1)),
    ),
  ];
}

function freezeDeclared(result) {
  return Boolean(result && result.freeze && result.freeze.reason);
}

async function main() {
  const parsed = parseArguments();
  const url = typeof parsed.url === "string" ? parsed.url : DEFAULT_URL;
  const remote = typeof parsed.remote === "string" ? parsed.remote : DEFAULT_REMOTE;
  const branch = typeof parsed.branch === "string" ? parsed.branch : DEFAULT_BRANCH;

  let result;
  try {
    // `--live <sha>` answers "if I deployed this, would the gate pass?" without
    // deploying it, and is how the cosmetic/off-main branches get exercised.
    const [live, head] = await Promise.all([
      typeof parsed.live === "string"
        ? Promise.resolve({ build: parsed.live, builtAt: "(--live override)" })
        : readLiveBuild(url),
      Promise.resolve(
        readMainHead({
          remote,
          branch,
          fetchFirst: parsed.fetch !== false,
          override: typeof parsed.main === "string" ? parsed.main : undefined,
        }),
      ),
    ]);

    const verdict = classify({ liveBuild: live.build, mainSha: head.sha });
    const freeze = readFreeze();
    result = {
      command: "check:deploy",
      status: verdict.status,
      url,
      live: { build: live.build, builtAt: live.builtAt },
      main: { sha: head.sha.slice(0, 12), source: head.source },
      behindBy: verdict.behind.length,
      behind: verdict.behind,
      productFiles: verdict.productFiles ?? [],
      newRequiredSecrets: verdict.newRequiredSecrets ?? [],
      ...(freeze ? { freeze } : {}),
      verdict: {
        fresh: "the live Worker is main's head",
        cosmetic: "behind main, but only on files that never reach the Worker — deployed product is current",
        stale:
          "behind main on product code — the live site is not what main describes." +
          " BEFORE DEPLOYING, check whether an eval run is grading the live site:" +
          " during one, the build is pinned behind main on purpose and shipping the" +
          " drift destroys the measurement. Stale is not by itself an instruction to deploy.",
        "off-main": "the live build is not an ancestor of main — a branch was deployed",
      }[verdict.status],
    };
    if (result.newRequiredSecrets.length > 0) {
      result.verdict +=
        ` — and wrangler.jsonc gained required secret(s) ${result.newRequiredSecrets.join(", ")};` +
        " `npx wrangler secret list` before deploying or the deploy refuses outright";
    }
  } catch (error) {
    emit({
      command: "check:deploy",
      status: "unknown",
      url,
      error: error instanceof Error ? error.message : String(error),
      verdict: "could not determine freshness — treat as stale until proven otherwise",
    });
    process.exitCode = 2;
    return;
  }

  if (freezeDeclared(result) && result.status !== "fresh") {
    result.drift = result.status;               // keep what it would have said
    result.status = "frozen";
    result.verdict =
      `deploy freeze in force — ${result.freeze.reason}. The live build is pinned` +
      ` behind main deliberately (it would otherwise read "${result.drift}").` +
      ` DO NOT DEPLOY until whoever declared the freeze lifts it.`;
  }

  emit(result);
  if (result.status === "stale" || result.status === "off-main") process.exitCode = 1;
}

await main();
