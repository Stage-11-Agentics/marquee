# Code Review: MRQ-44 — Audit: PROTOTYPE badge absent from the product

**Reviewed HEAD:** `167c428` (branch `mrq-44-audit-badge`, 1 commit over base `1dbd294`)
**Review basis:** The prompt's inline diff is almost entirely `.lattice/` bookkeeping from *other* tickets (MRQ-41/42/50/65). I reconstructed the real diff from git: exactly one file, `tests/node/prototype-badge-invariant.test.mjs` (+57 lines). Local and Forgejo branch heads match.

**Verification performed by reviewer (not taken on trust):**
- Ran the guard in the ticket worktree against the freshly built `dist/` (client + worker bundles, built during the audit window): **1/1 pass** — the sweep is genuinely clean.
- Adversarial trip-tests in a disposable detached worktree (removed afterward): planted `prototype-badge` class in `src/` → **fails**; planted uppercase `PROTOTYPE` in `dist/` → **fails**; planted `PROTOTYPE · MOCK DATA` copy in `src/` → **fails**; stripped the badge from `prototypes/pipeline-v1.1/index.html` → positive control **fails** as designed; clean tree with no `dist/` → passes.
- Independently grepped `src/` and root `index.html` for `prototype-badge` / badge copy: no matches.
- Read `scripts/checks/run-test.mjs`: the guard is auto-discovered (recursive `tests/node/*.test.mjs`), so it runs in the default suite with no registration step. Read `scripts/checks/pr-gate.mjs`: steps are sequential and `vite build` runs **before** the suite, so every pr-gate run scans a fresh built bundle — gate 15's "grep must cover the built bundle" is structurally enforced at every future PR, not just this one.

## 1. Verdict

**FAIL (implementation-level)** — The machine guard is excellent and I confirmed it is a live check, not a dead one. But this is an *audit* ticket whose declared deliverable is the audit artifact, and that artifact is missing: the attached self-review scopes itself to the test file only and contains no route enumeration, no statement of which files/artifacts were scanned, and no evidence of the visual pass over product routes that the ticket scope requires verbatim. The fix is to write the evidence, not to change code; the task should return to `in_progress`.

## 2. Summary

MRQ-44 delivers a well-built path/content-invariant guard confining badge markers (`prototype-badge`, "Prototype · mock data", uppercase `PROTOTYPE`) to `prototypes/`, with a positive control requiring the binding prototype to keep its badge. I independently verified gate 15 holds today (source, root shell, and built bundle all clean) and that the guard trips in every planted-failure direction. What's missing is the audit ticket's own evidence trail: the plan's steps 1–3 promise recorded route/artifact coverage and the boot brief demands "a clean audit that states its coverage" — the self-review artifact states neither coverage nor the visual pass.

## 3. Issues

**[MAJOR] .lattice self-review artifact (art_01KZR5JTP4C3B837HJXN06B48E) — Audit evidence absent: no route inventory, no coverage statement, no visual pass**
The ticket scope (verbatim): "grep `src/` and the built bundle, **visual pass over every product route**." The plan's own steps 1–3 commit to enumerating every route from `src/ui/shell/route-table.ts` and the generated manifest, and recording source/`dist/` scan coverage in review/completion evidence. The attached review artifact instead reads "Scope: tests/node/prototype-badge-invariant.test.mjs" — it audits the guard, not the product. Nothing anywhere on the ticket (no comments, no other artifacts) records which routes were rendered or that a visual pass happened at all. The boot brief is explicit that an unstated-coverage clean audit is the failure mode: gate 15 is backed by this ticket's evidence, and right now the evidence is "trust the grep." (I verified the grep result is correct — but the deliverable is the stated audit, and the visual pass may genuinely not have occurred.)
**Fix:** Attach an audit-evidence artifact that (1) enumerates the product routes from the route table/manifest, (2) states exactly what was scanned — `src/`, root `index.html`, and the built `dist/` at a named commit — with the grep result, and (3) records the rendered visual pass over the routes (the seeded local Worker walkthrough used by sibling tickets is the established pattern), or explicitly states the method and its limits if a full visual pass is being waived. Then re-enter review.

**[MINOR] tests/node/prototype-badge-invariant.test.mjs:6 — Root `index.html` (the Vite entry) is not in the scanned inventory**
`productRoots = ["src", "dist"]`, but the app shell is `index.html` at the repo root — the one file that would put a badge on *every* product route. It is covered indirectly via `dist/` when a build exists, and pr-gate always builds first, so the gate is safe; but a plain `npm test` on a fresh clone (`dist/` is gitignored, so absent → `filesUnder` silently returns `[]`) would not catch a badge added to the root shell. The fix costs one array entry.
**Fix:** Include the root `index.html` in the file inventory (e.g., add it explicitly alongside `productRoots`), so the source-level sweep covers the entry shell without requiring a build.

**[MINOR] Branch history — the plan was never committed to the ticket branch**
The boot brief requires "COMMIT AND PUSH the plan as your first commit — push, not just commit." The branch contains exactly one commit, and it contains only the test file; the plan edits to `.lattice/plans/task_01KZJHMBGQVN17NRVHJ2GN0T49.md` exist only as uncommitted state in the main checkout. The plan content itself is fine (and was plan-reviewed), but the durable-chain contract wants it on the branch.
**Fix:** Commit and push the plan file on `mrq-44-audit-badge` when addressing the major finding.

**[TRIVIAL] Plan step 3 — `npm run build` does not exist**
package.json has no `build` script; the production build is `npx vite build` (as pr-gate invokes it). Harmless since a build demonstrably ran (fresh `dist/` present), but the evidence artifact should name the real command.

## 4. Positive Observations

- **The guard is verified live, not assumed.** Every planted failure I tried — badge class in `src/`, uppercase marker in `dist/`, copy-variant text — fails the test, and the clean tree passes both with and without `dist/`. This is the opposite of the "green test over a dead check" shape the run has been burned by five times.
- **The positive control is the standout design decision.** Requiring `prototypes/pipeline-v1.1/index.html` to *retain* `prototype-badge` and "Prototype · mock data" means the test cannot rot into vacuous silence: if marker detection ever breaks (regex drift, path handling), the binding-prototype assertion fails loudly. I confirmed it trips when the badge is stripped there.
- **Invariant keyed on paths and content, never coordinates** — exactly as the plan and boot demanded. No line numbers anywhere; the allowlist is a path prefix; markers are patterns tolerant of `·`/`—`/`-` separators and case in the copy check.
- **Zero-registration integration.** `run-test.mjs` discovers `tests/node/*.test.mjs` recursively, so the guard is in the default hermetic suite from the moment the file exists; and pr-gate's sequential `vite build` → `npm test` ordering means every future PR re-checks the *built bundle*, satisfying gate 15's hardest requirement structurally rather than by ritual.
- **Graceful `dist/` handling** (`ENOENT` → empty list) keeps the suite hermetic on fresh clones while still scanning the bundle whenever one exists — a sensible trade, made safe by the pr-gate ordering above.
- **Scope discipline:** no product code touched, no contract docs edited, no AC claims fabricated — the diff is exactly the one artifact the ticket authorizes.
