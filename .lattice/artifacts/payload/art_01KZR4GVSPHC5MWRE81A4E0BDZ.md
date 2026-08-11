# Plan Review: MRQ-44 — PROTOTYPE badge audit (A-2, gate 15)

### 1. Verdict

**FAIL (plan-level)** — the plan is strong on the grep/guard half of the audit, but it omits the **visual pass over every product route**, which is a verbatim scope item and the most direct evidence for the gate-15 pass condition ("no product route renders it"). One factual command error also needs correcting. Both are quick revisions; the task should return to `in_planning` for a small amendment, not a rethink.

### 2. Summary

Reviewed the five-step plan for the MRQ-44 badge-absence audit against the task description and the live repo. Every file the plan references exists (`src/ui/shell/route-table.ts`, `src/routes/_manifest.ts`, `tests/node/comms.AC-250.test.mjs`, and `prototypes/pipeline-v1.1/index.html` carries both `prototype-badge` at line 76 and `Prototype · mock data` at line 820), and the marker-based scan approach is sound — the current `dist/` contains zero badge markers while containing incidental `.prototype` JS strings, confirming the plan's choice of specific markers over the bare word. The key concern: the plan enumerates routes but never renders any of them, so the "visual pass" half of the verbatim scope has no corresponding step.

### 3. Issues

**[MAJOR] Steps 1–3 — Visual pass over product routes is missing**
The task scope (verbatim) is "grep `src/` and the built bundle, **visual pass over every product route**." Step 1 enumerates the routes from `route-table.ts` and `_manifest.ts`, and steps 2–3 grep source and `dist/`, but no step launches the app and visually inspects the enumerated routes. Grep-only coverage can miss a badge rendered through dynamic class construction, a copied style under a different class name, or copy variants — exactly the "renders it" failure mode the gate names. The route enumeration in step 1 is the checklist for this pass; the plan builds the checklist and then never walks it.
**Recommendation:** Add an explicit step between steps 3 and 4: start the app (dev server or preview of the production build), visit every route enumerated in step 1, and record per-route evidence (screenshots or DOM assertions that no `prototype-badge` element / badge copy is present) in the audit artifact. Driving it with browser automation (c11 embedded browser) keeps it a repeatable gate rather than a human favor.

**[MINOR] Step 3 — `npm run build` does not exist**
`package.json` has no `build` script (scripts are `test`, `pr-gate`, `check:*`, etc.). The production build in this repo is `vite build` — `scripts/checks/pr-gate.mjs:15` invokes `node_modules/.bin/vite build` directly. The failure would be loud and trivially recovered from, but the plan's central step names a command that will not run.
**Recommendation:** Change step 3 to `npx vite build` (or invoke `node_modules/.bin/vite build`, matching pr-gate). Note the build outputs both `dist/client/` and `dist/marquee/` (worker bundle) — the scan should cover both, which "every text asset under `dist/`" already does.

**[MINOR] Step 4 — Guard test exceeds the ticket's declared "audit artifact only" scope; state the justification**
The task says "Shared files: none — audit artifact only," yet step 4 adds a permanent test file (`tests/node/prototype-badge-invariant.test.mjs`). This matches repo precedent — prior audit tickets left drift-proof guards behind (recent commits: "Make the public-write inventory guard drift-proof," "a guard asserts the invariant, not the coordinates," and `tests/node/public-write-inventory.test.mjs` exists) — and a new file cannot collide with anyone's shared-files declaration, so it is very likely sanctioned. But the plan should say so rather than leave the reviewer to reconcile it.
**Recommendation:** Add one sentence to the plan noting the guard follows the established audit-track pattern of leaving a drift-proof invariant test, and that it introduces no shared-file overlap. No behavioral change needed.

### 4. Positive Observations

- **Marker choice is exactly right.** Scanning for `prototype-badge` and the badge copy, not the bare word "prototype," is load-bearing: the built bundles contain incidental `.prototype` JS strings that a naive grep would flag as false positives. The plan gets this correct without being told.
- **The positive assertion on the binding prototype** (the badge must *remain* in `prototypes/pipeline-v1.1/index.html`) turns the audit from "absence of a string" into a two-sided invariant that would catch an over-eager deletion sweep. Both markers verified present at `index.html:76` and `index.html:820`.
- **The guard's conditional `dist/` scan composes correctly with pr-gate.** `dist/` is gitignored, so the default suite stays hermetic when no build exists — and pr-gate runs `vite build` (check 4) *before* the fast suite (check 6), so every pr-gate run exercises the dist scan against fresh output. That ordering makes the "badge survives the build" failure mode structurally caught, not incidentally.
- **Content/path invariants over line-number coordinates** (explicit non-goal) follows the project's own recent ruling and keeps the guard drift-proof.
- **Clean auditor discipline:** findings routed to owning tickets rather than fixed in-line preserves the "auditor who did not write the code" separation the BUILDPLAN demands.
