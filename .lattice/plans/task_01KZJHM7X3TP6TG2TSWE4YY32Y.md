# MRQ-6: Design system, admin shell, and the check harness

BUILDPLAN: M-05a + M-06 — Wave 0 (§3) · MERGED at mint under amended lever 2 (same wave, identical dependency set {M-01}, 2 h + 4 h = 6 h ≤ 10 h). Two clean halves with **zero file overlap**; the merge concentrates two flagged shared-file ownerships (`tokens.css`, `package.json`/`ci.yml`) in one serialized ticket instead of two.

**M-05a — Design system + admin shell** (2 h, no AC claimed; files `src/styles/tokens.css`, `src/ui/shell/*`)
Scope (verbatim): Tokens + component CSS lifted verbatim from the v1.1 prototype; sidebar (home, seven pipeline stages, modules, footer), topbar with search affordance, toast host, drawer/modal hosts, route table.
Binding contract: `DESIGN.md` is law — the Flight Deck design language, tokens in `prototypes/skins/skin-c.html`, geometry from the binding prototype at `prototypes/pipeline-v1.1/index.html` (legacy directory name; the file is at v1.6). The build reproduces the prototype one-to-one. House UI rule: **elements never jump** — reserved space for swapped text, fixed-width toggles, `—` over removed rows, tabular numerals.

**M-06 — Harness skeleton** (4 h ⛔ serialized on `package.json`; files `package.json`, `vitest.config.ts`, `playwright.config.ts`, `scripts/checks/*`, `.github/workflows/ci.yml`)
Scope (verbatim): **All thirteen** `EVALUATION.md` commands registered up front (stubs where empty) — the ten §1.1 rows `test`, `e2e`, `check:speed`, `check:seed`, `check:api`, `check:repo`, `check:readme`, `trace:ac`, **`check:mirror`**, `reset:demo`, plus the three §1.5 smokes `smoke:mail`, `smoke:ics`, `check:skill-agent`. `package.json` is M-06-owned and its edits serialize through the orchestrator, so M-25/M-26 cannot self-register `check:mirror` later — without it here, gate 9 and AC-225–229 name a command that exists in the contract and in no `package.json`. `trace:ac` ships both `--scope=merged` (PR default) and `--scope=all` (gate). Vitest + `@cloudflare/vitest-pool-workers`, Playwright desktop+mobile projects, `trace:ac` scanner, `check:repo` (gitleaks + badge + `Atin/` + history scan), CI. **`npm test` budget ≤30 s from the first commit.**
Naming convention this enforces (EVALUATION §1.1): every test name begins with the AC IDs it covers — `test('AC-25 · a crafted request bypassing the client cannot persist an invalid record', …)`. `trace:ac` is the machinery; without it the coverage table is a promise.
Hard rule (§1.2): `npm test` never touches the network, a deployed Worker, Resend, Airtable, R2, or the 1,000-row seed.

ACs (union): — (no AC directly claimed; backs gates 2, 3, 15 and every `auto` AC's machinery; every admin screen inherits the shell)
Hours: 6 (2 + 4)
Workflow: inline-full (max of the constituents' modes; M-05a alone was fast-track)
Shared files: `src/styles/tokens.css` — OWNED here (§7), **design tokens only**; per-module styles live in the module. `package.json` (scripts) — OWNED here: the full thirteen-command table registered at once, `check:mirror` included, stubs included; dependency additions are the only other edits and they queue through the orchestrator. `.github/workflows/ci.yml` — OWNED here, single author.
Deps: M-01
Plan: filled in by delegator's plan phase
