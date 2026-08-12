# Code Review: MRQ-104 — CLI parity

Reviewed branch `mrq-104-cli-parity` (PR #61, commit `8d7652d`) against `github/main`.
Note on the supplied diff: the prompt's 8160-line diff was measured from a stale base and
was truncated; it includes already-merged work (PRs #58 and #59 — MRQ-101 and the cold-start
UX). The MRQ-104 change proper is `github/main...8d7652d`: ~530 insertions across 10 files
(cli/, package.json, SKILL.md, PHILOSOPHY.md, tests). This review covers that diff, verified
against the live worktree, the real API schemas, and a full local gate run.

## 1. Verdict

**FAIL (implementation-level)** — the plan is sound and the code is close to done, but the
`bin` entry (acceptance-criteria item 1) is demonstrably broken when installed the way npm
installs bins, and the "9+ of 11 walkthrough steps" acceptance criterion is not met and not
reconciled anywhere. Both are fixable in `in_progress` without replanning.

## 2. Summary

The implementation adds 13 commands (event set, tracks ×3, formats ×3, search, submissions
schedule/publish, agenda place/move/remove) exactly as planned, and the quality is high: every
`--set` allowlist matches the corresponding zod schema field-for-field (verified against
`eventPatch`, `trackInput`, `formatInput`, `scheduleInput`, `placementBody`, `updateBody`),
the If-Match round trip is real and tested including a genuine 409 refusal, SKILL.md
regenerates clean with zero curl blocks, and the full suite is green (119 pass, 24.6s of the
45s budget; `check:api` passes; `generate-skill.mjs --check` clean). The key findings are the
symlink-defeated entry guard behind the new `bin` field, and an AC the ticket carries that the
shipped scope arithmetically cannot satisfy.

## 3. Issues

**[MAJOR] cli/marquee.mjs:395 + package.json:6 — the new `bin` entry silently does nothing when installed**
The entry guard is `import.meta.url === `file://${process.argv[1]}``. npm installs bins as
symlinks (`node_modules/.bin/marquee` → `cli/marquee.mjs`; same for `npm link` / `npm i -g .`
/ npx), and Node resolves modules to their realpath, so `import.meta.url` is the real file
while `process.argv[1]` is the symlink. The comparison fails, `main()` never runs, and the
process exits 0 with no output. Verified empirically in this review: a symlink to the branch's
`cli/marquee.mjs` invoked as `./marquee-link --help` prints nothing and exits 0, while
`node cli/marquee.mjs --help` prints the registry. This defeats scope item 1 verbatim — AC-141's
"`marquee --help` is literally true" is precisely the invocation that breaks. No test catches it
because every test spawns `node cli/marquee.mjs` directly. (The string-concat form also breaks
on paths containing spaces, unlike `generate-skill.mjs:131`, which already does this correctly.)
**Fix:** resolve both sides before comparing, as `generate-skill.mjs` almost does — e.g.
`import { realpathSync } from "node:fs"; import { pathToFileURL } from "node:url";` then
`process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href`.
Ideally add one test that runs the CLI through a symlink so the installed shape stays covered.

**[MAJOR] ticket AC vs. shipped scope — "drives 9+ of the 11 walkthrough-loop steps" is not met and not reconciled**
Honest count against the research's own step table (`sequence/research/cli-parity.md` §2):
the CLI now drives steps 1 (seed), 2 (configure), 9 (accept/schedule), 10 (agenda writes), and
11 (publish) — 5 of 11, or 6 if the dashboard's read is counted generously. Steps 4–8 (form
builder, public submit, portal, evaluation plan, review queue) remain command-less, and the
ticket's own OUT OF SCOPE section deliberately excludes most of them — the review verbs the
research listed under "matter" are neither in the ticket's scope list nor in the plan. So the
AC and the scope contradict each other, the research's "roughly 9 of 11" estimate was
optimistic, and nothing shipped acknowledges the difference: the plan's table quietly maps to
steps 2/9/10/11, and `tests/ac-claims/MRQ-104.json` describes the widened loop without a count.
This is not an implementation defect — building steps 4–8 would violate the ticket — but a
reviewer signing "PASS" would be certifying an AC that is false. **Fix:** reconcile explicitly
rather than silently: record in the Lattice ticket (and the PR description) the honest count and
why the delta is deliberate — the excluded steps are the ticket's own OUT OF SCOPE surfaces plus
review verbs, with the API covering all of them — and amend the AC to what shipped, exactly as
the final AC ("PHILOSOPHY.md §3's CLI bullet is true as written, or amended to what shipped")
already models for the philosophy text. If the operator instead wants the review verbs, that is
a follow-up ticket, not rework here.

**[MINOR] tests/node/cli.AC-138-141-250.test.mjs:246 — the "real 409" is a stub's 409**
The AC reads "agenda move round-trips If-Match correctly against a real 409." The test's stub
enforces version CAS and refuses stale tags with 409, which exercises the CLI side fully, and
the seam risk is low because the CLI treats the ETag as opaque and the real API mints and
checks it with the same `strongEtag` helper on both the GET and the PATCH (covered by the
existing agenda route tests). Still, no test drives the CLI against the actual Worker route.
**Fix:** none required for this verdict; note the interpretation in the PR, or add one
Worker-backed CLI round trip later if gate 12's isolated-agent run (MRQ-44) doesn't already
subsume it.

**[MINOR] cli/registry.mjs — `search` is tagged `skill: "triage"` but taught in the Agenda section**
The `skill` field currently has no consumer (grep finds none in cli/ or tests/), so this is
inert metadata, but the value contradicts where `generate-skill.mjs` actually demonstrates the
command (`## Agenda`, as ID resolution for scheduling). **Fix:** change to `"agenda"` or drop
the field project-wide in a later cleanup; not blocking.

## 4. Positive Observations

- **Every `--set` allowlist was checked against its zod schema and all seven match exactly** —
  `event set` mirrors `eventPatch` (all 8 keys), tracks/formats mirror `trackInput`/`formatInput`
  including `position`, and the agenda/schedule bodies mirror `placementBody`/`updateBody`/
  `scheduleInput` including nullable `track_id`. Typos fail locally naming the legal keys, with a
  test proving the bad key never reaches the API.
- **The `eventIdFrom` fix is the right kind of fix.** Replacing the derived predicate (which
  would have silently broken `event set`) with an explicit `event: true` per registry entry
  removes the latent bug instead of extending it, and the flag audit is complete: every
  event-scoped command carries it; `event seed`, `diagnose`, and `logs` correctly don't.
- **The If-Match design is genuinely good.** Reading the item's ETag off the agenda snapshot so
  the caller never carries a version string, keeping `--if-match` for scripts that hold one,
  parsing the body before spending the agenda read, and the test asserting the refused attempt
  carried the stale tag while the retry read the fresh one — this is the concurrency contract
  taught correctly, not just exercised.
- **The 204-removal synthesis (`{removed, event_id}`) honors AC-139's "exactly one JSON value"**
  where echoing the API's empty body would have printed an ambiguous `null`, and the comment
  explains the constraint rather than the code.
- **The skill test flipped from asserting curl blocks exist to asserting curl cannot appear**
  (`doesNotMatch /\bcurl\b/`) plus per-workflow demonstration checks — the absence of the gap is
  now a regression test, not a one-time claim.
- **The PHILOSOPHY.md amendment is honest.** "The operating loop drivable from a terminal…
  the surfaces built for hands stay at the API, because a command line is a worse way to draw a
  room than a room is" replaces an overstated claim with a true and better-written one.
- All gates verified green in this review: `npm test` 119/119 in 24.6s (45s budget),
  `npm run check:api` pass (no registry drift, as the no-API-change design predicts),
  `node cli/generate-skill.mjs --check` clean.
