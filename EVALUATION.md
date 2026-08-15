# Marquee — Evaluation Contract

**Status:** v1.4 contract revision for client prototype review · updated 2026-08-09; not yet signed for orchestration.
**Authority once signed:** this file defines what "done" means for the Marquee build and *how an agent proves each criterion without a human in the loop*. The build fleet writes against it; the terminal auditor — who did not write the spec — runs it.
**Upstream:** `sequence/USER_STORIES.md` (269 live criteria through AC-274 — AC-270–272 reserved, unminted; AC-239 struck) · `sequence/research/seams-feasibility.md` · `PHILOSOPHY.md` · `sequence/research/competition-requirements.md` §3 · `prototypes/PROTOTYPE-CONTRACT.md` + `prototypes/pipeline-v1.1/DIRECTION.md`.

**Build scope: 207 live criteria — read the tier, not the number.** Amendments allocate IDs without implying tier; AC-239 is struck and deliberately has no test. **`sequence/USER_STORIES.md` §"Scope at a glance" is the authority on tier membership**; this file follows it and never re-derives it from ID arithmetic.

| Tier | ACs | Count | Consequence here |
|---|---|---|---|
| **A — the walkthrough loop** | AC-1 – AC-90, **AC-217–AC-218, AC-231, AC-234, AC-240, AC-244–246, AC-264 – AC-269, AC-273–AC-274** | 106 | Binding, no waivers (§1.4, gate 18) |
| **B — ordered differentiators** | AC-91 – AC-169, **AC-225 – AC-230, AC-232, AC-235–238, AC-241–243, AC-247–253** | 100 | Cut from the bottom; a cut must be named (gate 19) |
| **Cut-line criterion on a Tier A story** | **AC-233** | 1 | Speaker Handbook — hosted on US-39, outside Tier A's no-waiver set; cuttable if named |
| **Post-competition** | AC-170 – AC-224 except **AC-217–AC-218** (promoted, Amendment 18 — see §7) | 53 | Not built, not tested, not a defect (§7) |

**The one sentence.** The judges' rubric is a deployed URL driven through the 11-step walkthrough loop by a practitioner who will spend minutes, not an hour. Everything below exists to make that pass provable before a judge ever opens it.

---

## 0. Verification tags

Every AC in scope carries exactly one **primary** tag — the strongest thing its verification requires.

| Tag | Means | Who settles it |
|---|---|---|
| `auto` | Provable by the harness alone, against a fixture or a deployed instance. | A command in §1. |
| `op-assist` | Needs an artifact or account only a human can hand over. | Operator, once, before the gate. |
| `oracle` | A third party is the judge — a real inbox, a real calendar client, an independent agent. | The named smoke in §1.5. |
| `felt` | A judgement no assertion settles. | A scheduled human-use checkpoint (§3). |

**Strength order:** `felt` > `oracle` > `op-assist` > `auto`. An AC with a hard assertion *and* a residual judgement is tagged by the residual and appears in both places — the assertion still runs every build.

**Counts across all 197 in-scope live criteria:** **187 `auto` · 1 `op-assist` · 5 `oracle` · 4 `felt`.** All nineteen live criteria added after AC-233 are `auto`; struck AC-239 is excluded.

Credentials, plan tiers, and third-party accounts gate *suites*, not individual criteria. They are enumerated once in §1.6 rather than smeared across 197 rows. The one `op-assist` tag (AC-109) is the exception on purpose: there the missing thing is *knowledge* — the column names and status vocabulary of a real Sessionize export, which cannot be synthesized. A missing credential against a fully-documented API (Airtable, AC-225–229) is a precondition, not a tag.

---

## 1. The harness

### 1.1 Commands the build ships

| Command | What it does | Budget | Where it runs |
|---|---|---|---|
| `npm test` | Unit + integration. Hermetic: local D1 via `@cloudflare/vitest-pool-workers`/Miniflare, stubbed Resend (writes to the outbox table), stubbed R2, no network, no deployed instance. Runs against a **small deterministic fixture**, not the 1,000-row seed. | **≤30s wall, parallel** (Stage 11 hard rule). A regression past 30s is a defect to fix, not absorb. | Every commit, every PR, pre-push. |
| `npm run e2e` | Playwright. Drives the full 11-step loop against a deployed preview at `$MARQUEE_E2E_URL`, on the seeded database. Two projects: `desktop` (1440×900) and `mobile` (375×812, touch, mobile UA). | ≤6 min wall on 4 workers. | Every PR against its preview; the gate against production. |
| `npm run check:speed` | Measures the §1.3 budgets on deployed infra against the real seed. Emits `speed-report.json` (p50/p95/n per budget). Exits non-zero only on an **AC-sourced** budget breach; the seven client-signed *objective* budgets warn loudly but never fail the run (ruling 2026-08-09). | ≤4 min. | Every PR against its preview; the gate against production. |
| `npm run check:seed` | Asserts seed shape and scale over the public API: counts, status distribution, format/track coverage, agenda density, the deliberate ugliness (a speaker on 3 submissions, a 4-person panel, an overdue task set, a live double-booking), and that **the organizer demo persona's review queue returns ≥20 unreviewed candidates** (walkthrough step 8 has a reachable entry). | ≤30s. | After every seed run; the gate. |
| `npm run check:api` | Validates the OpenAPI document, asserts docs route reachable, asserts **route-manifest parity**: replays a full-loop Playwright session with network recording, collects every non-GET request, and fails if any path is absent from the public schema. **Amendment 6:** also asserts single-source generation — served JSON, rendered docs, and the CLI registry derive from one route registry; operation counts and content hashes must match. **The CLI-registry half of that assertion activates once `cli/` exists** (M-38, Tier B rank 19) and is skipped-with-notice before then; the served-JSON/rendered-docs half is live from Wave 0. Without the activation rule, every PR from the first one fails on a registry that no ticket has built yet — the same defect `trace:ac` scoping fixes. The three non-`/api/v1` calendar and feed URLs named in `SPEC.md` §4.2 are an allowlist, not drift. | ≤2 min. | Every PR; the gate. |
| `npm run check:repo` | Secret scan (`gitleaks` + a Marquee-specific ruleset), PROTOTYPE-badge absence in `src/`, README lint (numbered deploy sequence present, extension points named), `Atin/` and Stage-11-internal path scan, plus a **third-party-content denylist** — `sources/`, `*.pdf`, `competitor-*`, `AGENT-BRIEF-*`, `run-state`, `C11_`, `surface:`, `workspace:`, `/Users/` — because a redistributed brief or a rival entrant's document is neither a secret nor an internal path, and republishing one under Apache-2.0 cannot be un-pushed. Runs over **the full history of the tree being published**, not the tip. | ≤30s. | Pre-push; the gate; against the assembled orphan history (M-56) and again against the pushed remote. |
| `npm run check:readme` | Executes the README's numbered deploy sequence verbatim — commands extracted from its fenced blocks — from a clean checkout in a fresh container against a scratch Workers project, with **no human input at any step**. Asserts exit 0, a 200 on the deployed URL, and non-zero seeded counts. | ≤10 min. | Once per milestone; the gate. |
| `npm run trace:ac` | Scans test names for `AC-nnn` prefixes and produces `ac-coverage.json` — every live in-scope AC with the suites covering it, and a list of ACs with zero mechanical coverage. Fails if struck AC-239 is treated as live or an unknown/recycled ID appears, and — **scoped by mode** — if an `auto`-tagged AC has zero tests. **`--scope=merged` (the default on PRs)** considers only the ACs claimed by already-merged tickets plus the ACs the current PR names; **`--scope=all` (the gate, CP-2 onward)** fails on any uncovered `auto` AC in scope. Unscoped, the rule would block the first PR and every PR after it, since no PR can cover 184 ACs. | ≤10s. | Every PR (`merged`); the gate (`all`). |
| `npm run check:mirror` | Airtable two-way mirror against a **dedicated test base**: outbound latency, inbound webhook apply, allowlist rejection, echo suppression under sustained two-way editing, keepalive cron advancing the webhook expiry. Covers AC-225 – AC-229 and gate 9. Requires a deployed preview (the webhook needs a public URL). | ≤3 min. | Every PR touching the mirror; the gate. |
| `npm run reset:demo` | Restores the seeded demo to a known state (also a button in the product). Idempotent; safe mid-judging. Covers AC-230 and gate 13. | ≤20s. | Between judges; the gate. |

**Naming convention that makes the §2 table auditable rather than aspirational:** every test name begins with the AC IDs it covers —
`test('AC-25 · a crafted request bypassing the client cannot persist an invalid record', …)`.
`trace:ac` is the machinery; without it the table is a promise.

### 1.2 What the two suites may and may not do

- `npm test` **never** touches the network, a deployed Worker, Resend, Airtable, R2, or the 1,000-row seed. Scale is not its job; correctness is. This is the only way the 30s budget survives to Wednesday.
- `npm run e2e` is the only suite permitted to assume a deployed instance. It always runs against a real Worker on the real plan — never `wrangler dev` — because the Workers CPU ceiling and the D1 bound-parameter cap are deploy-time failures that local dev cannot see (traps 2 and 11, seams §8).
- Neither suite may seed itself into a pass. E2E asserts against the *shipped* seed, the one a judge will see.
- **If `npm run e2e` exceeds its 6-minute budget, split it into `e2e:loop` (the 11-step walkthrough, both projects) and `e2e:sweep` (AC-4's BFS crawl, AC-80's 20 view transitions, AC-62's 20 review advances, AC-161's empty-install crawl, AC-232's upload assertions) and run them in parallel. Do not delete assertions.** The budget is aggressive for what this suite carries, and the failure mode under time pressure is that coverage is traded away silently rather than the suite being split — which is the one trade that makes the gate meaningless.

### 1.3 Speed budgets

Speed is a graded feature (R7; three unprompted complaints in a ten-minute video). It is **measured, not asserted** — `check:speed` records real numbers on deployed infra against the ~1,000-row seed and fails on p95.

| Surface | Budget | Source | Method |
|---|---|---|---|
| Program dashboard, full render | p95 ≤ **1000ms** | AC-16 | 10 warm loads |
| Public CFP form, **cold** load → interactive | p95 ≤ **1000ms** | AC-36 | 5 cold loads, fresh context, cache disabled |
| Public agenda, **cold** load → interactive | p95 ≤ **1000ms** | AC-85 | 5 cold loads |
| Review queue: score submitted → next card interactive | **median ≤ 300ms** | AC-62 | ≥20 consecutive advances |
| Global search: keystroke → results painted | p95 ≤ **200ms** | AC-103 | ≥10 queries incl. misspellings |
| Embed reflects a source change | ≤ **60s** | AC-89 | mutate via API, poll from a clean context, record actual |
| Bulk accept, 150 records | completes; longest main-thread task ≤ **100ms** | AC-69 (+ proposed instrument) | Long Tasks API during the operation |
| *Proposed* — submissions list, 1,000 rows, first interactive | p95 ≤ **1000ms** | proposed | 10 warm loads |
| *Proposed* — filter/sort re-render on that list | p95 ≤ **200ms** | proposed; mirrors AC-191's post-competition number | 10 filter applications |
| *Proposed* — agenda view switch (any of five) | p95 ≤ **200ms** | proposed; AC-80 requires scroll + filters survive | all 20 ordered pairs |
| *Proposed* — any admin route transition | p95 ≤ **300ms** | proposed | every edge in the route manifest |
| *Proposed* — speaker portal load | p95 ≤ **1000ms** | proposed | 10 warm loads |
| *Proposed* — chase board, ~150 speakers × task matrix | p95 ≤ **1000ms** | proposed; it is our strongest screen and the heaviest table | 10 warm loads |

**Client ruling 2026-08-09 on the seven *proposed* budgets: signed as OBJECTIVES, not gates.** `check:speed` measures and reports them (prominently, with a ⚠ OBJECTIVE MISSED banner in `speed-report.json` and the gate report) but **never exits non-zero for them**. The **AC-sourced budgets remain binding** — they are acceptance criteria and fail the build as before. Rule from `USER_STORIES.md` still stands for both kinds: **if a number passes while the surface feels slow, the number was wrong — amend the threshold, do not reclassify the criterion.**

### 1.4 Coverage rules

- **Tier A admits no waivers.** The no-waiver set is `AC-1 – AC-90` **plus AC-231, AC-234, AC-240, and AC-244–246**. It is not a numeric range: AC-232 is Tier B, AC-233 is explicitly cuttable, and AC-239 is struck. Any AC in the no-waiver set showing red is a build failure regardless of Tier B completeness. A chain has no most-important link.
- **Tier B is cut from the bottom.** A cut Tier B story's ACs are recorded as *cut* in the gate report with the cut line named. Silently missing ≠ cut.
- `trace:ac --scope=merged` failing (an `auto` AC claimed by a merged ticket or by this PR with zero tests) blocks merge; `trace:ac --scope=all` is the gate's form and runs from CP-2 onward.

### 1.5 The three oracle smokes

| Smoke | Command | What it proves | When |
|---|---|---|---|
| **Mail delivery** | `npm run smoke:mail -- [--to <fresh full address>]... [--domain <catch-all domain>]` | Submits through the public form with the exact supplied address, or a new `smoke-<ULID>@<catch-all-domain>` address when `--to` is omitted; asserts the target event is demo-safe, the always-live confirmation row targets that exact address (so suppression is distinguished from non-arrival), arrival, correct display name, and a working link back to the submission. Repeat `--to` for multiple recipients; never rewrite or reuse a localpart. | Once when the comms path lands; again at the gate. |
| **ICS chain** | `npm run smoke:ics -- --event-id <demo-safe event> --to <fresh gmail address> --to <fresh outlook address> --to <fresh apple address>` | Sends `METHOD:REQUEST`; the operator clicks **Accept** in each client and confirms the event lands with the right time and room. Then a reschedule (`SEQUENCE+1`) must **replace** the entry, and a cancel (`METHOD:CANCEL`) must remove it. Omit `--to` for a fresh catch-all address or repeat exact, freshly provisioned client addresses. This is seams §10.5 — the 15 minutes that separate R3 working from R3 looking like it works. | Once when calendar invites land; again at the gate (Gmail is mandatory; Outlook and Apple are strongly wanted). |
| **Agent-only operation** | `npm run check:skill-agent` | Spawns a clean headless agent given **only** `SKILL.md`, a base URL, and an API token — no repo access, no further instruction — and asserts over the API that it completed seed → triage → accept → schedule. | When `SKILL.md` and the CLI land; again at the gate. |

### 1.6 Preconditions the harness cannot supply itself

These gate suites, not individual ACs. Each is a human action item; unresolved ones are named in §6.

1. **Workers Paid** enabled and verified — the Free plan's 10ms CPU ceiling will not SSR a 1,000-row table, and it fails at deploy, not in dev.
2. **R2 entitlement healthy** — re-probe on deploy day; a lapse 403s every public bucket URL while DNS and TLS look fine.
3. **Resend plan tier confirmed** — Free is 100 sends/day. `smoke:mail` and `smoke:ics` consume real sends against ~800 seeded speakers; the outbox + demo-safe allowlist is built from the first commit regardless.
4. **Airtable demo base on Team or above** — Free caps at 1,000 records/base and the seed target is exactly 1,000, before speakers and evaluations are counted.
5. **Real inboxes** for the ICS chain: one Gmail, one Outlook, one Apple Calendar account.
6. **One real Sessionize export** (any event, sessions + speakers + evaluation results) — the only thing that proves our column fixture matches reality (AC-109).
7. **A Cloudflare API token in CI** for `check:readme`'s scratch deploy.
8. **A model credential** for `check:skill-agent`.
9. **A dedicated Airtable *test* base + PAT** for `check:mirror` — distinct from the demo base of item 4 and separate from it on purpose: the mirror suite writes destructively, and it must never be able to corrupt the base a judge will open. A handful of records suffices, so Free is fine here; the Team+ requirement belongs only to the 1,000-row demo base.

---

## 2. Per-AC verifiability — all 210 live in-scope criteria

The original 178 rows remain grouped by story in build order; the sixteen live context/amendment rows are consolidated at §2.3 with explicit tier labels. Grouping — not ID arithmetic — carries membership. AC-239 is struck and excluded.

Suite refs: `test:` unit/integration · `e2e:` Playwright · `speed:` · `seed:` · `api:` · `repo:` · `readme:` · `oracle:` · `C1`–`C7` = checkpoints in §3.

### Tier A — the walkthrough loop (28 stories · 100 live ACs; AC-233 rides on US-39 but is cut-line, not Tier A)

**US-01 · A judge lands on a working, populated product**

| AC | Tag | How verified |
|---|---|---|
| AC-1 | `felt` | `e2e:` asserts both demo entries present, reachable with no form/signup/gate; residual — does a stranger orient unaided — settled at **C1**. |
| AC-2 | `auto` | `e2e:` clicks each entry in a fresh context; asserts landing screen carries non-zero record counts and no empty-state component is reachable on either demo path. `test:` with `events.demo_mode=0`, `POST /api/v1/auth/demo` returns 403 and **no session cookie is set** — the demo login is a demo-mode-only affordance and a self-hosted instance ships no one-click owner session (audit **A-5**). |
| AC-3 | `auto` | `seed:` counts over the API — ≥800 submissions, ≥150 accepted speakers, agenda density > 0. |
| AC-4 | `auto` | `e2e:` BFS crawler from both entries: every route 2xx, every `href` resolves, no `lorem\|TODO\|placeholder\|coming soon\|Tab \d` copy, no zero-child list container. |

**US-03 · Configure the event**

| AC | Tag | How verified |
|---|---|---|
| AC-5 | `auto` | `e2e:` edit name/dates/timezone/venue/logo, reload, assert persisted. |
| AC-6 | `auto` | `test:` change event timezone, assert agenda-rendered times **and** generated ICS `DTSTART`/`TZID` both shift with zero per-session writes; `e2e:` confirms on screen. |
| AC-7 | `auto` | `e2e:` save; assert confirmation visible and no navigation event fired (same document handle). |

**US-04 · Session formats with default durations**

| AC | Tag | How verified |
|---|---|---|
| AC-8 | `auto` | `test:` create format with name + duration; `seed:` asserts the four AIE formats with their durations. |
| AC-9 | `auto` | `test:` session inherits format duration; per-session override persists and does not mutate the format. |
| AC-10 | `auto` | `e2e:` format selectable on the public form and present as a working list filter. |

**US-05 · Tracks and rooms**

| AC | Tag | How verified |
|---|---|---|
| AC-11 | `auto` | `e2e:` create, rename, reorder; order persists across reload. |
| AC-12 | `auto` | `e2e:` read the resolved track color on all five agenda views and the public program; assert identical per track. |
| AC-13 | `auto` | `e2e:` room capacity rendered in the scheduling surface for that room. |

**US-06 · The program dashboard**

| AC | Tag | How verified |
|---|---|---|
| AC-14 | `auto` | `e2e:` mutate status via API from a second context; assert dashboard counts by status and by format/track update with no reload. |
| AC-15 | `auto` | `e2e:` enumerate every numeric tile; click each; assert the destination carries the filter and its result count equals the tile. |
| AC-16 | `felt` | `speed:` p95 ≤ 1000ms against the seed (hard half); residual — reads as an operator's home, not a report — settled at **C2**. |

**US-07 · Build a submission form**

| AC | Tag | How verified |
|---|---|---|
| AC-17 | `auto` | `e2e:` add, drag-reorder, edit, delete; assert public form field order matches the builder. |
| AC-18 | `auto` | `test:` field-type registry contains all eight; `e2e:` renders and submits one of each on the public form. |
| AC-19 | `auto` | `e2e:` extract (label, type, order, required) from the builder preview and from the public URL; assert deep-equal. |
| AC-20 | `auto` | `test:` duplicate carries fields and settings; assert deep-equal minus id/name. |

**US-08 · Target a form at abstracts or at sessions**

| AC | Tag | How verified |
|---|---|---|
| AC-21 | `auto` | `test:` target set at build time, immutable-after-open rule enforced; `e2e:` visible in the form list. |
| AC-22 | `auto` | `test:` abstract → evaluation pipeline; session → schedulable with no evaluation record and no missing-data marker on the agenda. |
| AC-23 | `auto` | `e2e:` mixed list shows a type marker per row carried by text, not colour alone; both classes present. |

**US-09 · Real, enforced validation**

| AC | Tag | How verified |
|---|---|---|
| AC-24 | `auto` | `test:` each rule configurable per field and round-trips. |
| AC-25 | `auto` | `test:` raw API POSTs bypassing the client for each rule → 4xx and zero rows written; `e2e:` blur fires client-side. `e2e:` inject a 5xx and a 429 on submit; assert the inline failure banner renders above the submit row, **every entered value is preserved**, retry is offered, and the draft-saved statement is present. |
| AC-26 | `felt` | `e2e:` asserts focus moves to the first invalid field (hard half); residual — language a non-technical submitter understands — settled at **C3**. |

**US-10 · Speaker and sponsor limits**

| AC | Tag | How verified |
|---|---|---|
| AC-27 | `auto` | `test:` min/max configurable; assert **shipped default minimum is 1**. |
| AC-28 | `auto` | `test:` max sponsors configurable and enforced. |
| AC-29 | `auto` | `e2e:` limits stated before the first add-person control, and enforced client- and server-side. |

**US-13 · Form lifecycle settings**

| AC | Tag | How verified |
|---|---|---|
| AC-30 | `auto` | `e2e:` welcome copy customizable and rendered before the first field. |
| AC-31 | `auto` | `test:` past-close fixture → GET 200 with closed copy (not an error), POST → 4xx, zero rows. |
| AC-32 | `auto` | `test:` per-form limit is a number, not a constant; 1, 3, and 5 all enforce correctly. |
| AC-33 | `auto` | `test:` four outbox assertions — draft resume link, pre-close reminder (scheduled handler invoked), thank-you on submit, named-admin new-submission notice. |

**US-14 · Public form link, logged-out**

| AC | Tag | How verified |
|---|---|---|
| AC-34 | `auto` | `e2e:` fresh context, no cookies or storage; load and submit successfully. |
| AC-35 | `auto` | `e2e:mobile` completes the form end to end at 375px. |
| AC-36 | `auto` | `speed:` cold load → interactive, p95 ≤ 1000ms. |
| AC-231 | `auto` | **Scope: conferences with `demo_mode = 0`.** A demo conference is exempt from the bot gate entirely — see Amendment 12. `test:` three rejection cases — missing, replayed, invalid token — each 4xx with **zero rows written and no presign issued**; the siteverify client is stubbed here. The gated set is **draft creation, submit, and every presign**; `test:` also asserts that `PATCH …/drafts/:token` autosave requires **no** Turnstile token, is rejected without a valid resume token, and is rate-limited per token — the intended shape, not the literal per-write reading, which would break AC-41. `e2e:` one pass against real Turnstile on the deployed preview, covering both the public write and the upload-presign path. **Binding: Tier A no-waiver set** *(appended 2026-08-08)* |

**US-17 · Submit an abstract in one sitting**

| AC | Tag | How verified |
|---|---|---|
| AC-37 | `auto` | `e2e:` full submission with no pre-existing account. |
| AC-38 | `oracle` | `e2e:` asserts confirmation screen + outbox row + the link resolves to the submission; **in demo mode the confirmation screen also renders a working portal magic link on screen, and following it lands the portal of the speaker just submitted** (the judge's incognito path — loop steps 5 → 6). **Live arrival in a real inbox is proved by `oracle: smoke:mail`** — this is the judge's own path and must not be suppressed by demo-safe mode. |
| AC-39 | `auto` | `e2e:` record present in the admin list immediately after submit, no intermediate step. |

**US-19 · Save a draft and come back**

| AC | Tag | How verified |
|---|---|---|
| AC-40 | `auto` | `e2e:` partial fill → close context → read resume link from the outbox → open in a fresh context → assert values restored. |
| AC-41 | `auto` | `e2e:` last-saved indicator present and advances after an edit. |
| AC-42 | `auto` | `e2e:` draft carries a distinct status label (text, not colour alone) and a distinct container class; also read at **C3**. |

**US-38 · See my status without asking anyone**

| AC | Tag | How verified |
|---|---|---|
| AC-43 | `auto` | `e2e:` status is first in reading order within the portal's main landmark and carries the largest type size among portal headings; per submission. |
| AC-44 | `auto` | `e2e:` pre-decision state renders a concrete next-wave date; assert copy is neither empty nor the bare string "pending". |
| AC-45 | `auto` | `e2e:` admin changes status; speaker's next page load reflects it, with no publish action available or required. |

**US-39 · See exactly what I owe and by when**

| AC | Tag | How verified |
|---|---|---|
| AC-46 | `auto` | `e2e:` each task renders title, description, due date, completion state; order equals due-date order. |
| AC-47 | `auto` | `test:` task-type registry contains acknowledge, upload, complete-a-form; `e2e:` completes one of each. |
| AC-48 | `auto` | `e2e:` speaker completes a task in one context; organizer dashboard reflects it with no admin action. |
| AC-49 | `auto` | `e2e:` overdue rows carry a distinct textual marker and container class, not colour alone. |
| AC-233 | `auto` | `e2e:` a per-event Handbook page authored as static markdown renders inside the speaker portal; assert headings and links survive the render. ⚠️ **Below the Tier B cut line, on a Tier A story** — outside Tier A's no-waiver guarantee. If cut, gate 19 must name it. *(appended 2026-08-08)* |

**US-40 · Edit my own biography and headshot**

| AC | Tag | How verified |
|---|---|---|
| AC-50 | `auto` | `e2e:` edit all five fields from the portal at any status; persist across reload. |
| AC-51 | `auto` | `e2e:` edit propagates to the public speaker gallery and session page with no admin step. |
| AC-52 | `auto` | `e2e:` upload JPEG/PNG/WebP through the R2 presign path; assert an undersized image is rejected at upload time and a crop preview renders before save. |

**US-24 · Create an evaluation plan**

| AC | Tag | How verified |
|---|---|---|
| AC-53 | `auto` | `test:` plan carries name, instructions, scale, submission set. |
| AC-54 | `auto` | `test:` numeric rating + free-text comment; weighted rubric validator rejects criteria summing ≠ 100%. |
| AC-55 | `auto` | `e2e:` assign evaluators to an **open** plan and succeed; `test:` plan-creation steps succeed in ≥3 permuted orders. |

**US-25 · Assign to a committee**

| AC | Tag | How verified |
|---|---|---|
| AC-56 | `auto` | `test:` named committees; committee assigned a filtered set, membership persists. |
| AC-57 | `auto` | `test:` both modes; assert per-submission reviewer counts equal the target under N-per-submission distribution. |
| AC-58 | `auto` | `e2e:` per-evaluator and per-submission progress rendered against target. |

**US-26 · Work a review queue fast**

| AC | Tag | How verified |
|---|---|---|
| AC-59 | `auto` | `e2e:` score advances to the next unreviewed card with no navigation event. |
| AC-60 | `auto` | `e2e:` position/remaining rendered; leave and return resumes at the same index. |
| AC-61 | `auto` | `e2e:` keyboard-only pass — score and advance without the mouse. |
| AC-62 | `auto` | `speed:` median ≤ 300ms over ≥20 consecutive advances against the seed. |

**US-28 · Review blind**

| AC | Tag | How verified |
|---|---|---|
| AC-63 | `auto` | `test:` reviewer token calling the anonymity toggle → 403; setting exists per plan/round for admins. |
| AC-64 | `auto` | `test:` with anonymity on, fetch every reviewer-scoped API route **and every export** as a reviewer; byte-scan the responses for the seeded identity strings (name, company, email, bio fragment, headshot URL); assert zero hits. |
| AC-65 | `auto` | `test:` same fixtures as admin → identity present throughout. |

**US-33 · Accept a batch mid-CFP**

| AC | Tag | How verified |
|---|---|---|
| AC-66 | `auto` | `e2e:` select-all-matching on a filtered list acts on the whole match set, not the visible page. |
| AC-67 | `auto` | `test:` bulk accept sets status, enqueues configured notifications, returns per-record success/failure; assert the summary shape under an injected partial failure. |
| AC-68 | `auto` | `e2e:` after a bulk accept the form is still open and a new submission still succeeds. |
| AC-69 | `auto` | `speed:` bulk-accept 150 records — completes without timeout; longest main-thread task ≤ 100ms (Long Tasks API). |

**US-50 · Push accepted sessions to the agenda**

| AC | Tag | How verified |
|---|---|---|
| AC-70 | `auto` | `e2e:` unscheduled pool contains exactly the accepted-and-unplaced set. |
| AC-71 | `auto` | `test:` non-accepted statuses not schedulable by default; the qualifying-status list is configurable and honoured. |
| AC-72 | `auto` | `test:` title, speakers, format, track carry through byte-identical from submission to session. |

**US-51 · Drag and drop to schedule**

| AC | Tag | How verified |
|---|---|---|
| AC-73 | `auto` | `e2e:` drag pool → slot and slot → pool; both persist. |
| AC-74 | `auto` | `e2e:` drop sets date/start/room; duration defaults from format; resize persists. |
| AC-75 | `felt` | `e2e:` asserts persistence with no save control (hard half); `speed:` records drag-frame p95 as advisory evidence; verdict at **C5**. |

**US-52 · Catch conflicts automatically**

| AC | Tag | How verified |
|---|---|---|
| AC-76 | `auto` | `test:` overlapping same-room pair flagged; non-overlapping pair not flagged. |
| AC-77 | `auto` | `test:` parameterized over **all four** participation roles — speaker, co-speaker, moderator, chairperson — each double-booking flagged. |
| AC-78 | `auto` | `e2e:` conflict marker on the agenda tile; conflicts list reachable in one click. |
| AC-79 | `auto` | `e2e:` conflicting placement still commits and persists; warning present. |

**US-53 · Five views including track**

| AC | Tag | How verified |
|---|---|---|
| AC-80 | `auto` | `e2e:` all 20 ordered view pairs; assert scroll offset and active filters survive each switch. |
| AC-81 | `auto` | `e2e:` lane container count equals track count; each lane has its own bounding box; every session's box sits inside its own track's lane. Colour overlay alone fails. |
| AC-82 | `auto` | `e2e:` edit in each view; assert reflected in the other four with no reload. |

**US-57 · Publish a public agenda**

| AC | Tag | How verified |
|---|---|---|
| AC-83 | `auto` | `e2e:` logged-out agenda renders times, rooms, tracks, speakers. |
| AC-84 | `auto` | `e2e:` session and speaker permalinks resolve and cross-link both ways. |
| AC-85 | `auto` | `e2e:mobile` operable at 375px; `speed:` cold interactive p95 ≤ 1000ms. |
| AC-86 | `auto` | `test:` for every non-published seeded record, anonymous GET of its public URL → 404 with no title leakage in the body. |

**US-58 · Embed the schedule and speaker gallery**

| AC | Tag | How verified |
|---|---|---|
| AC-87 | `auto` | `e2e:` config screen emits a copyable snippet; live preview renders it. |
| AC-88 | `auto` | `e2e:` both embeds render; track and status filters change the rendered set. |
| AC-89 | `auto` | `speed:` mutate via API, poll the embed from a clean context; assert ≤60s, record actual. |
| AC-90 | `auto` | `e2e:` embed at 375px and 1440px with no horizontal overflow; configured colors present in the resolved styles. |
| AC-273 | `auto` | `e2e:` *(Amendment 18)* `sessions` kind renders a flat title/track/time row per published session, no room or speaker detail; track and status filters change the rendered set exactly as the `agenda` kind's; selectable in the embed dialog's format segment. |
| AC-274 | `auto` | `e2e:` *(Amendment 18)* `speakers` kind's Cards/List layout segment changes the rendered markup (grid vs. compact rows); the chosen layout is carried as `layout=list` in the snippet URL (cards is the unparameterized default); both layouts pass AC-90's 375px/1440px responsive assertion. |

**US-16 · Promote the call with a live block** *(Amendment 18 — promoted to live in-scope)*

| AC | Tag | How verified |
|---|---|---|
| AC-217 | `auto` | `e2e:` the `cfp` embed kind renders the event's primary open form's deadline and formats, plus a link to `/f/:slug`; selectable in the same embed dialog as the other three formats. |
| AC-218 | `auto` | `e2e:` set the form's `closes_at` into the past with no other action; re-fetch past the 30s cache TTL and assert the embed renders its closed copy with the submit link removed — the flip is computed from `closes_at` alone, not stamped by a republish. |

### Tier B — ordered differentiators (28 stories, ranked · 100 live ACs)

**This file carries no rank numbers. `BUILDPLAN.md` §5 is the single rank authority**, and gate 19 records the cut line against it. Stories below are listed in build order; two files each asserting a rank drifted by 1–3 positions across the whole band, and the cut line is keyed to rank. US-74, US-75, and US-76 are ranked there too — their criteria live at §2.3 with explicit tier labels. Later insertions shifted positions but **no AC ID moved**.

**US-44 · Chase the stragglers from one screen**

| AC | Tag | How verified |
|---|---|---|
| AC-91 | `auto` | `e2e:` row count equals accepted-speaker count, column count equals assigned task types, every cell carries a state. |
| AC-92 | `auto` | `e2e:` overdue / incomplete / by-type filters change the set; sort by days-overdue is monotonic. |
| AC-93 | `auto` | `e2e:` one action against a filtered set → one outbox row per recipient from the template, and a send logged on each speaker record. |
| AC-94 | `auto` | `e2e:` speaker completes a task in a second context; board updates live with no report run and no prior configuration. |

**US-47 · Calendar invite to the speaker's own calendar**

| AC | Tag | How verified |
|---|---|---|
| AC-95 | `oracle` | `test:` golden-file — `METHOD:REQUEST` in both the VCALENDAR and the MIME `method` parameter, `ATTENDEE` with `RSVP=TRUE`, calendar part present as `multipart/alternative`, RFC 5545 parser round-trip, Add-to-Google and Add-to-Outlook links well-formed. **Verdict from `oracle: smoke:ics`** — Gmail, Outlook, and Apple Calendar must show Accept/Decline, not an attachment. |
| AC-96 | `auto` | `test:` parsed invite carries `VTIMEZONE` matching `TZID`, room/location, title, and a resolving session-page URL. |
| AC-97 | `oracle` | `test:` reschedule emits same `UID` with `SEQUENCE+1`; un-accept emits `METHOD:CANCEL` + `STATUS:CANCELLED`. **"Replaces rather than duplicates" is client behaviour — verdict from `oracle: smoke:ics`.** |

**US-73 · Reset the demo** *(new — amendment 2026-08-08)*

| AC | Tag | How verified |
|---|---|---|
| AC-230 | `auto` | `e2e:` mutate the demo (bulk-accept a wave, un-accept a talk, reschedule a session), run `reset:demo` **and** the in-product button, then re-run `check:seed` — both paths restore the seeded state. Invoke twice consecutively for idempotence. A second context polls the public agenda and the dashboard throughout and must observe only coherent states — never a partial reset (e.g. zero sessions alongside non-zero speakers). |

**US-30 · Two-round funnel**

| AC | Tag | How verified |
|---|---|---|
| AC-98 | `auto` | `test:` two ordered rounds, each with its own scorecard and evaluator set; round order enforced. |
| AC-99 | `auto` | `e2e:` bulk promote from a filtered round-1 list; promoted set appears in round 2, unpromoted does not. |
| AC-100 | `auto` | `e2e:` submission record shows both rounds' scores together. |

**US-67 · Find anything from anywhere**

| AC | Tag | How verified |
|---|---|---|
| AC-101 | `auto` | `e2e:` iterate every admin route in the route manifest; assert the affordance is present and `/` or ⌘K opens it with no navigation event. |
| AC-102 | `auto` | `e2e:` one query returns submissions, speakers, sessions, and forms in a single list, each labelled by type. |
| AC-103 | `auto` | `speed:` keystroke → results painted, p95 ≤ 200ms over ≥10 queries; results update as typed. |
| AC-104 | `auto` | `e2e:` selecting a result lands on the record; a fixture of partial and misspelled seeded names still matches on name and title. |

**US-68 · Every capability over a real API**

| AC | Tag | How verified |
|---|---|---|
| AC-105 | `auto` | `api:` route-manifest parity — every non-GET request captured during a full-loop session must exist in the public OpenAPI document; the UI-only write set must be empty. |
| AC-106 | `auto` | `api:` OpenAPI validates; docs route returns 200 and is linked from the running app's navigation. |
| AC-107 | `auto` | `test:` token issued from the UI authenticates with **no cookie present**; revoking it → 401 on the next call. |
| AC-108 | `auto` | `test:` for ≥3 filter combinations, API result IDs equal the UI-rendered IDs; pagination total and page boundaries agree. |

**US-72 · Genuine two-way Airtable mirror** *(new — amendment 2026-08-08)* — all five run under `mirror:` against a **dedicated test base**, never the demo base; the base and its PAT are an operator-assisted precondition (§1.6 item 9), not a per-AC tag, because the Airtable API is fully known and only the credential is missing.

| AC | Tag | How verified |
|---|---|---|
| AC-225 | `auto` | `mirror:` commit a local change, poll the Airtable Records API for the mirrored row; assert it lands ≤60s and record the actual. |
| AC-226 | `auto` | `mirror:` write an allowlisted field in Airtable → assert applied locally within one webhook cycle. Write a non-allowlisted field → assert the local record is **byte-identical** afterwards and a log line records the ignore. Write `status → accepted` inbound → assert the status and `last_write_source='airtable'` land, **zero outbox rows are enqueued and zero task sets assigned**, and the record renders "changed in Airtable · cascade not run" with the one-click cascade action. Requires a publicly reachable webhook, so this runs against a deployed preview, never locally. |
| AC-227 | `auto` | `mirror:` 20 alternating two-way edits on one record; assert the per-record write count is bounded (no growth), `last_write_source` flips as expected, and the outbox drains to depth 0. |
| AC-228 | `auto` | `e2e:` Settings → Airtable renders a resolving `airtable.com/app…` link, row counts on both sides, last successful sync time, and current outbox depth. |
| AC-229 | `auto` | `mirror:` invoke the keepalive cron against the real test base and assert the webhook's `expirationTime` **advances**; `test:` a clock-injected fixture proves refresh fires before expiry and that a near-expiry state surfaces on the Settings page. ⚠️ The 7-day duration itself is proven by *refresh-advances-expiry*, not by waiting seven days — the window does not contain a real 7-day observation. |

**US-66 · Switch without losing an open CFP** *(fixture fidelity is the story-level risk — one real export settles it)*

| AC | Tag | How verified |
|---|---|---|
| AC-109 | `op-assist` | `e2e:` import against `fixtures/sessionize/{sessions,speakers}.csv` with a column-mapping step and a first-rows preview before any write. **Needs one real Sessionize export from the operator** to prove the fixture's column names and status vocabulary match reality. |
| AC-110 | `auto` | `test:` statuses preserved including **undecided**; bios, headshots, custom fields, and session↔speaker relationships all land. |
| AC-111 | `auto` | `test:` scores and comments import as historical review data; attributed on email match, explicitly marked unattributed otherwise. |
| AC-112 | `auto` | `test:` import an updated export twice — matched records update, new rows insert, zero duplicates. |
| AC-113 | `auto` | `test:` per-row outcomes (created/updated/skipped/failed+reason) reported; undo restores the pre-import state exactly. |

**US-34 · Reject with a template, kindly and at scale**

| AC | Tag | How verified |
|---|---|---|
| AC-114 | `auto` | `test:` merge fields for speaker name and submission title render with real seeded values. |
| AC-115 | `auto` | `e2e:` bulk reject shows a rendered preview of one real recipient's version before sending. |
| AC-116 | `auto` | `e2e:` rejected submitter's portal shows the outcome; outbox carries the email. |
| AC-117 | `auto` | `test:` invoke the bulk action twice — exactly one outbox row per (template, submission); `Idempotency-Key` present on each provider call. The full pre-fix write-site inventory then compares every unchanged registry entity id and resulting hash byte-for-byte, so a central refactor cannot silently rename a grain. |

**US-22 · Manual admin entry**

| AC | Tag | How verified |
|---|---|---|
| AC-118 | `auto` | `e2e:` create a submission in the admin, abstract or session, without the public form. |
| AC-119 | `auto` | `test:` bypass-evaluation session reaches the agenda with no evaluation record. |
| AC-120 | `auto` | `e2e:` admin-created rows carry a textual origin marker in lists. |

**US-36 · Un-accept a talk after a speaker drops**

| AC | Tag | How verified |
|---|---|---|
| AC-121 | `auto` | `test:` accepted → withdrawn and accepted → rejected both permitted at any point, timestamped and attributed. |
| AC-122 | `auto` | `e2e:` session leaves the agenda, the public surfaces, and the embeds; the vacated slot is visible to the scheduler. |
| AC-123 | `auto` | `e2e:` the reversal dialog enumerates portal tasks, scheduled emails, and calendar invites, each with cancel/retain, and honours the choice. |
| AC-124 | `oracle` | `test:` a `METHOD:CANCEL` with the same `UID` and `SEQUENCE+1` is emitted for every previously-sent invite. **"Receives" and removal from the calendar — verdict from `oracle: smoke:ics`.** |

**US-46 · Automate the recurring messages**

| AC | Tag | How verified |
|---|---|---|
| AC-125 | `auto` | `test:` all seven triggers produce their outbox rows from their fixtures. |
| AC-126 | `auto` | `test:` each trigger toggles off (no row emitted) and its template edit round-trips into the rendered body. |
| AC-127 | `auto` | `test:` time-travel fixture + scheduled-handler invocation; the pre-close reminder fires at the configured offset and not before. |

**US-45 · Templated email to a filtered group**

| AC | Tag | How verified |
|---|---|---|
| AC-128 | `auto` | `test:` name, session title, room, and time merge fields all render from real seeded records. |
| AC-129 | `auto` | `e2e:` recipient count shown before send equals the filtered set's size across status/track/format/task-state filters. |
| AC-130 | `auto` | `e2e:` preview renders one real recipient's version before sending. |
| AC-131 | `auto` | `test:` every send logged per recipient and visible on the speaker record. |

**US-11 · Conditional logic**

| AC | Tag | How verified |
|---|---|---|
| AC-132 | `auto` | `test:` show/hide condition on one and on multiple prior answers, both directions. |
| AC-133 | `auto` | `test:` hidden fields absent from the submitted payload and not required server-side; revealing applies the field's validation. |
| AC-134 | `auto` | `e2e:` conditions visible in the builder list without opening a field. |

**US-12 · Route submissions by category**

| AC | Tag | How verified |
|---|---|---|
| AC-135 | `auto` | `test:` rule maps track/format/vendor-flag to an evaluation plan or reviewer pool. |
| AC-136 | `auto` | `test:` routing applies at submission time; `e2e:` the applied rule is named on the submission record. |
| AC-137 | `auto` | `test:` vendor-flagged submission lands in workshop/expo review and not in the mainstage pool. |

**US-69 · Drive the core workflows from a terminal**

| AC | Tag | How verified |
|---|---|---|
| AC-138 | `auto` | `e2e:cli` runs all six named commands against a deployed instance and asserts the resulting state over the API. |
| AC-139 | `auto` | `e2e:cli` every command with `--json`; `JSON.parse(stdout)` succeeds; stdout contains no decorative text (logs go to stderr). |
| AC-140 | `auto` | `e2e:cli` authenticates with an API token and targets two distinct instance URLs. |
| AC-141 | `auto` | `test:` `--help` output enumerates exactly the command registry with one-line descriptions; every subcommand's own help returns 0. |

**US-70 · Ship a skill file that teaches an agent to run a conference**

| AC | Tag | How verified |
|---|---|---|
| AC-142 | `auto` | `repo:` `SKILL.md` present; required workflow headings — seed, triage, chase, agenda, publish — all present. |
| AC-143 | `auto` | `repo:` extract every fenced command and API path; assert each resolves against the CLI registry or the OpenAPI document. |
| AC-144 | `auto` | `repo:` the seven product terms present; a banned-synonym list (proposal, talk submission, CFP entry, panel review) absent. |
| AC-145 | `oracle` | `oracle: check:skill-agent` — a clean agent given only `SKILL.md`, a URL, and a token completes seed → triage → accept → schedule; asserted over the API. |

**US-41 · Upload slides and supporting documents**

| AC | Tag | How verified |
|---|---|---|
| AC-146 | `auto` | `e2e:` PDF/PPTX/KEY accepted; the size limit is stated before the picker opens and is enforced at sign time. |
| AC-147 | `auto` | `e2e:` progress rendered; an aborted PUT is recoverable by retry without re-entering the form. |
| AC-148 | `auto` | `e2e:` organizer's task view reflects the upload with no refresh. |
| AC-232 | `auto` | Four assertions. `test:` presign refuses a disallowed extension **and** a disallowed MIME independently. `test:` upload bytes whose magic number contradicts the declared type → rejected on completion **and** the R2 object is gone (HEAD 404). `test:` exceed the per-IP and the per-submission cap → 429 each. `e2e:` a served upload returns `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` from a host that is **not** the app host. *(appended 2026-08-08)* |

**US-21 · Add a co-speaker**

| AC | Tag | How verified |
|---|---|---|
| AC-149 | `auto` | `e2e:` co-speakers added in-form up to the configured maximum; the max+1 attempt is refused with a stated reason. |
| AC-150 | `auto` | `test:` outbox row names who added them, to what, and carries a working profile-completion link. Live delivery covered by `oracle: smoke:mail`. |
| AC-151 | `auto` | `e2e:` co-speaker supplies bio and headshot via their link without the abstract becoming editable. |

**US-37 · Speaker confirms or declines**

| AC | Tag | How verified |
|---|---|---|
| AC-152 | `auto` | `e2e:` confirm/decline in the portal; the response is visible to the program lead. |
| AC-153 | `auto` | `test:` a person holding two roles on one submission confirms each independently; one response does not settle the other. |
| AC-154 | `auto` | `e2e:` decline notifies the program lead and flags the agenda slot. |

**US-18 · Submit from a phone**

| AC | Tag | How verified |
|---|---|---|
| AC-155 | `auto` | `e2e:mobile` every field type including file upload operable at 375px. |
| AC-156 | `auto` | `e2e:mobile` `scrollWidth ≤ clientWidth` at every step; on-screen keyboard modelled as a 375×340 visual viewport, asserting the focused field's box stays inside it. Real-device confirmation at **C6**, which is the tiebreaker if the two disagree. |
| AC-157 | `auto` | `e2e:` partial mobile fill → resume the draft link in the desktop project → values restored. |

**US-27 · Review on a phone**

| AC | Tag | How verified |
|---|---|---|
| AC-158 | `auto` | `e2e:mobile` read, score, comment, advance — all at 375px. |
| AC-159 | `auto` | `e2e:` the reviewer surface contains no admin navigation, no admin routes reachable from it. |

**US-02 · An operator stands up their own instance**

| AC | Tag | How verified |
|---|---|---|
| AC-160 | `auto` | `readme:` the README's numbered sequence executed verbatim from a clean checkout in a fresh container, **zero human input**, ending in a 200 and non-zero seeded counts. |
| AC-161 | `auto` | `e2e:empty` crawler over an empty install: every route renders an empty-state component containing a next-action link; no crash, no 500, no blank page. |
| AC-162 | `auto` | `repo:` README names registration-platform sync, Airtable mirror, and calendar OAuth as extension points. |

**US-71 · Comparison-mode triage**

| AC | Tag | How verified |
|---|---|---|
| AC-163 | `auto` | `test:` mode selectable per round; scorecard remains the default on a fresh round. |
| AC-164 | `auto` | `e2e:` each comparison presents exactly three submissions; a ranking with a tie is accepted and stored. |
| AC-165 | `auto` | `test:` aggregate order equals win count over recorded comparisons; visible to the review chair. |
| AC-166 | `auto` | `test:` switch a round's mode both ways; scores recorded in the other mode survive intact. |

**US-32 · Optional AI first-pass scoring**

| AC | Tag | How verified |
|---|---|---|
| AC-167 | `auto` | `test:` default flag is off; `e2e:` the surface carries aid-language and none of a banned decision-language list. |
| AC-168 | `auto` | `test:` run the AI pass over 50 submissions with a stubbed model; assert zero status transitions. |
| AC-169 | `auto` | `e2e:` crawler from both demo entries reaches no AI surface without explicitly enabling the flag. |

### 2.3 Amendment criteria — AC-234–AC-269

| AC | Tier | Tag | How verified |
|---|---|---|---|
| AC-234 | A | `auto` | `e2e + test:` submit with 0/1/3 tracks; 0 is rejected, first is primary, any-match routing/filtering/reviewer scope works, and the agenda swimlane uses primary; `check:seed` proves ≥15% multi-track and ≥3 scheduled multi-track Sessions. |
| AC-235 | B | `auto` | `e2e:` decide with feedback; assert the outbox's rendered decision message and speaker portal show byte-equivalent normalized feedback from one decision row. Repeat with no note. **Bulk-accept 3 records → assert 3 `submission_decisions` rows exist and all 3 portals render from them** — the demo's headline action must not use a second render path. |
| AC-236 | B | `auto` | `e2e:` send a one-off templated email from record and review contexts; one rendered outbox row and one record-history entry appear, with demo-safe delivery semantics. |
| AC-237 | B | `auto` | `test + e2e:` speaker edits title/description while open; both update immediately and history stamps actor/time. Close CFP → 403 until organizer re-opens that submission's editing. |
| AC-238 | B | `auto` | `e2e + speed:` board contains every non-draft submission exactly once in its derived lifecycle stage; title/speakers/tracks/time-in-stage render; composed filters remain inside the full-seed objective. |
| AC-239 | — | — | **STRUCK; no test.** `trace:ac` fails if this ID is counted live or reused. Replaced by AC-243. |
| AC-240 | A | `auto` | `e2e:` every scheduled fixture shows day/time/room on list, record, portal, and board; unpublished items show "Not yet public" + publish; Scheduled/Published stage copy is exact. |
| AC-241 | B | `auto` | `test + deployed integration:` endpoint CRUD/test/log; six-event allowlist; queued retry/backoff; HMAC verifies over `id.timestamp.body`; replay idempotency prevents a second effect. Runs only after Tier A is green. |
| AC-242 | B | `auto` | `test + e2e:` issue token with scopes/event restrictions, show secret once, store only hash, prove effective authority is grant∩membership, and revoke → immediate 401. |
| AC-243 | B | `auto` | `e2e + static:` no board card has `draggable` or lifecycle controls; click/Enter/Space opens exact record; consequential record action opens confirmation/cascade; agenda drag still operates. |
| AC-244 | A | `auto` | `e2e:` open full submission from queue; assert all evaluator-visible fields and downloadable-file metadata, seeded identity absent under blind mode, and close returns to identical queue ID/index. |
| AC-245 | A | `auto` | `test + e2e:` Approve, Maybe, and Deny each save with score/criteria null; revisit restores recommendation/actor/time; lifecycle status remains unchanged until a program-lead decision. |
| AC-246 | A | `auto` | `test + route scan:` multi-track intersection controls queue membership; committee manager edits scopes; queue/detail/file/export/evaluation-write all invoke the centralized helper; guessed out-of-scope IDs return 403 with no metadata. |
| AC-247 | B | `auto` | `e2e:` create/apply/rename/update/delete a personal saved view; reload restores query/filter/sort/column order; another user and event cannot read it; built-ins reject rename/delete. |
| AC-248 | B | `auto` | `e2e:` show/hide/reorder every registered column; Title cannot be removed; table changes immediately, persists after reload, and round-trips through a saved view. |
| AC-249 | B | `auto` | `test + e2e:` built-in Drafts queue count equals derived draft rows; each shows last-save/contact/applicable missing fields; open/edit leaves status draft; reviewer/speaker 403 while form-admin/program-staff succeed. |
| AC-250 | B | `auto` | `test + e2e:` a stored template **or** a caller-supplied `{subject, body}` is accepted on `POST /api/v1/events/:id/comms/send` — the single send route, no `/messages/send` alias, asserted by `check:api`'s registry parity — and on `marquee remind`; merge fields render in both forms; exactly-one-of is enforced server-side; an ad-hoc send writes an outbox row and a recipient-record log entry byte-identical in shape to a templated send; demo-safe suppression and the `comms:send` scope behave unchanged. |
| AC-251 | B | `auto` | `e2e + test:` a record's evaluation panel lists its per-round reviewers with coverage counts; assigning and removing a specific reviewer writes `round_assignments`, the affected reviewer's queue updates, and an out-of-track-scope assignment is rejected; `/rounds/:id/assignments` CRUD appears in `check:api` registry parity. *(Amendment 10 fold — rows added 2026-08-09 at intake ratification; verification transcribed from SPEC.)* |
| AC-252 | B | `auto` | `e2e + check:seed:` buildings CRUD (name, address) in Event Settings; every room requires a building; `check:seed` asserts the SPEC §6 building set (**Amendment 14 supersedes the "no second real venue" clause** — the set must now be genuinely separated in space; see AC-259); agenda room headers, room view, public session pages, and ICS `LOCATION` all render "Room · Building". |
| AC-253 | B | `auto` | `e2e:` AV capability tags and free-text notes editable per room in Event Settings; rendered in the agenda room-header tooltip/panel; absent from all public surfaces. |
| AC-255 | B | `auto` | `test + e2e:` `buildings` carries `lat`, `lng`, `access_minutes`, `access_note`; a migration adds `access_note` (0002 shipped the first three). Null coordinates round-trip as null and are never defaulted to a number; a room inherits its building's entrance note with no room-note fallback; `check:seed` asserts no room note carries door/ID/security text. |
| AC-256 | B | `auto` | `e2e + route scan:` create, edit, and remove a building and a room on `/settings/venues` and assert persistence after reload; `/settings` renders zero elements matching the venue-editor selectors and links to Venues; both Save paths call the one shared writer (single call site asserted statically). Regression: `+ Add building` must be live on the venues route — a handler bound only to `/settings` is the defect this AC exists to catch. |
| AC-257 | B | `auto` | `e2e + static:` pins equal pinned buildings, walking lines carry minute labels, attribution is present and visible. Map container height is set before tiles resolve — assert no layout shift (bounding box identical before and after tile load). Force tile failure and assert pins/lines still render and the box is not blank. `check:repo` greps the tree for third-party map CDN hosts and map API keys and fails on either. |
| AC-258 | A | `auto` | `test + e2e:` shared speaker, different pinned buildings, gap < walk + access → one `transit` conflict that warns and never blocks placement. Same building, unpinned building, and online venue each produce none. The conflict appears in the dashboard count, the drawer, and the tiles from the same `getConflicts` call — assert one code path, not a parallel one. |
| AC-259 | A | `auto` | `test + check:seed:` walking time equals `haversine × 1.3 ÷ 80 m/min` floored at 1 against fixture coordinates; the message names walk, access, needed, and available minutes. **Byte-scan: the string "Travel" never appears as a conflict label in any surface, API payload, or copy** while remaining intact in the speaker task set. `check:seed` fails unless the seed has ≥2 buildings far enough apart to yield a real walking time, ≥1 building with non-zero access minutes, and ≥1 live Transit conflict on load. |
| AC-260 | A | `auto` | `e2e:` portal shows room, building, address, and entrance note; the leave-by equals session start minus walk minus access, computed from that speaker's own previous session that day, and falls back to the primary building when they have none. Unscheduled session and unpinned venue each render an honest degraded state naming the absence, with no implied location. |
| AC-261 | B | `auto` | `test + e2e:` all five place merge fields resolve per recipient in the preview and in the rendered outbox body, byte-identical; an insertable field reference exists in the editor; an unknown field is left intact rather than blanked. |
| AC-262 | B | `auto` | `test:` invite contains `LOCATION` with room, building, and street address, ICS-escaped for `,` `;` `\`; `GEO:lat;lng` present for a pinned building and absent for an unpinned one; parse the artifact and assert `METHOD:REQUEST`, `UID`, `SEQUENCE`, and cancellation semantics are unchanged from AC-95 – AC-97. |
| AC-263 | B | `auto` | `e2e:` with fewer than two pinned buildings, assert absence of the room-label building suffix, walk times, Transit conflicts, and the agenda building band, and that the embedded site map is collapsed. In the same state assert address, entrance note, and minutes-to-get-in are still rendered — the fold hides comparison, never instruction. |
| AC-264 | A | `auto` | `test:` reverse an acceptance choosing cancel → assert every **open** task for that submission carries `cancelled_at` and that **zero rows were deleted**. Assert tasks already `done` are byte-identical afterwards — `completed_at` unchanged, `cancelled_at` still null on them, status still `done`. |
| AC-265 | A | `auto` | `test + e2e:` with a cancelled task present, assert it is absent from `GET /me/tasks`' active set and from the portal progress denominator, and rendered under a single stated reason. Assert every chase-board figure excludes it — the four metric buttons, all four filter-chip counts, the task-type filter, severity ordering, and overdue totals — and that the speaker leaves the board when nothing else is owed. **Assert the `task overdue` trigger enqueues zero outbox rows for it**, and that a filtered recipient selector on task state never returns it. Assert a speaker holding a second accepted session keeps their row. |
| AC-266 | A | `auto` | `test:` call the acceptance reconciliation twice in a row → assert the second call changes nothing (no new rows, no timestamps moved). Reverse-then-re-accept → assert `cancelled_at` cleared, `due_at` preserved, and tasks completed before the reversal still `done` with their original `completed_at`. Assert first acceptance, re-acceptance, and acceptance after a template was added all traverse the **same** function — asserted by call-site enumeration, not by behaviour alone. |
| AC-267 | A | `auto` | `e2e:` run the reversal once per branch from the same starting state → assert the resulting states differ (cancelled-and-silent versus open-and-still-chased), and that each, plus a later restoration, writes an `audit_log` row with actor and timestamp surfaced in the record's history. Assert the dialog names the branch before confirmation. |
| AC-268 | A | `auto` | `test + e2e:` construct all three producers — an inbound Airtable status change (no outbox row), an outbox row in each of `queued`/`suppressed`/`failed`, and a decided record with no address — and assert each appears in the built-in **Decided · not notified** view **naming its own reason**. Assert the dashboard attention row carries the count and, at zero, states that every decision has reached its speaker rather than being removed from the DOM. |
| AC-269 | A | `auto` | `test:` notify from the view → assert exactly one **new** outbox row per record against the **unchanged** `submission_decisions` row (decision, `decided_at`, `decided_by_person_id`, and `feedback_md` all byte-identical afterwards), and that notified records leave the view. Assert no-address records are excluded from both the action and its count, and that the button's sentence states how many need an address. |

---

### 2.4 Post-deadline cold-start band — AC-275 – AC-287 *(Amendment 13, 2026-08-12)*

**This band is outside the Wednesday terminal gate.** §2's "210 live in-scope" count and every tier arithmetic above deliberately exclude it: these criteria are minted for the post-deadline build (MRQ-105), and the auditor of the competition build neither tests them nor fails their absence. `trace:ac` mechanics make this safe by construction — rows here are unenforced until the owning ticket's claims manifest lands, at which point coverage is required like any other `auto` row. Stories: US-83 – US-86 (`sequence/USER_STORIES.md` Amendment 19). Binding surfaces: prototype v1.11, `docs/GETTING-STARTED.md`, `prototypes/cold-start/SKILL-SETUP-CHAPTER.md`.

| AC | Tier | Tag | How verified |
|---|---|---|---|
| AC-275 | PD | `auto` | `test:` run the claim-link mint against a DB with zero people → token hash row exists, stdout carries the URL exactly once and no other secret. Run it again → prior token's exchange now renders the inert page, new token exchanges. Assert the printed URL's token never appears in any log line. |
| AC-276 | PD | `auto` | `test + e2e:` exchange a valid claim token with name+email → org row (created if absent), person, org-wide `owner` membership, and `mq_session` cookie all exist; `used_at` is set in the same statement that read the token (single-statement assertion). Replay the same token → inert page, zero new rows. Expired and unknown tokens render byte-identical inert copy naming the CLI re-run. No mail is sent or queued anywhere in the flow. |
| AC-277 | PD | `auto` | `e2e:` with zero `owner` memberships, `GET /` renders the unclaimed landing (agent-run setup + claim-link story) and no event data; every event-scoped API route still auths normally (401/403, never a hint of claim state). After claim, `/` never renders it again. `POST /api/v1/auth/magic-link` responses are byte-unchanged from pre-claim to post-claim for an unknown address. |
| AC-278 | PD | `auto` | `e2e:` complete a claim → the handoff offers a token mint; minting writes a standard `api_tokens` row (named, scoped, hash-only) shown once; declining leaves a fully navigable session and the token screen still reachable at Settings → API tokens. Assert no new token table or kind exists (schema scan). |
| AC-279 | PD | `auto` | `test + e2e:` `POST /api/v1/events` as owner creates the event with generated slug; as reviewer/speaker → 403, zero rows. The switcher lists both events; five event-scoped screens against the new empty event render their AC-161 empty states with zero records from the other event (scoping assertion on every list payload). |
| AC-280 | PD | `auto` | `e2e:` drive `/conferences/new` and the switcher `＋` on a claimed instance → both hit the same endpoint (route spy/registry parity), the checklist renders conference-scoped (no claim step, no instance-level steps), and the prior conference remains selectable with its data intact. |
| AC-281 | PD | `auto` | `test + e2e:` each setup verb drives the same route as its screen (registry↔route parity per verb); `SKILL.md` equals `renderSkill()` byte-for-byte with the setup chapter present; static scan of the chapter text asserts the claim step says a human opens the link and no chapter command publishes a form. |
| AC-282 | PD | `auto` | `test + e2e:` mint an invite → hash row with expiry; recipient exchange → person + org membership + session, token consumed single-statement; replay/revoked/expired → the same inert page as AC-276. Pending invites list and revoke live; assert the exchange path is the claim exchange path (call-site enumeration, not behaviour). |
| AC-283 | PD | `auto` | `test + e2e:` remove an organizer → their session 401s on the next request, their authored decisions/evaluations still render attributed; the last owner's self-remove is rejected server-side; with mail configured the emailed invite writes one outbox row; with mail absent the modal still yields a copyable link and states mail unlocks sending. |
| AC-284 | PD | `auto` | `test + e2e:` instance-status read derives each row from real binding/secret presence (flip one via test env → row flips; no stored flag consulted — asserted statically); panel rows hold fixed positions across states; each unconfigured row's rendered fix command is copy-exact against the README's. |
| AC-285 | PD | `auto` | `e2e:` publish with mail unconfigured → acknowledgment dialog naming the three consequences; acknowledge → form opens and the acknowledgment is recorded with actor+time; cancel → nothing published. With mail configured → no dialog, direct publish. No code path hard-blocks the publish. |
| AC-286 | PD | `auto` | `test:` snapshot non-demo rows → remove demo → assert every `is_demo` row gone, `demo_mode = 0`, non-demo rows byte-identical; run again → no-op. `e2e:` the confirm dialog names what is removed and what is untouched. |
| AC-287 | PD | `auto` | `static:` the shipping PR's tree contains no status-banner marker in `docs/GETTING-STARTED.md` and no "lands with the cold-start build" caveat in `README.md` while the claim route exists in the route manifest — one scan asserting docs and build agree. |

### 2.5 Post-deadline open-evaluation band — AC-288 – AC-293 *(Amendment 14, 2026-08-12)*

**Outside the Wednesday terminal gate, on the same terms as §2.4.** §2's "210 live in-scope" count, every tier arithmetic, the cut line, and the terminal gate are unchanged; these rows are unenforced by `trace:ac` until MRQ-134's claims manifest lands, at which point coverage is required like any other `auto` row. Stories: US-87 (`sequence/USER_STORIES.md` Amendment 20). Binding design: `sequence/agent-evaluator-design.md`.

| AC | Tier | Tag | How verified |
|---|---|---|---|
| AC-288 | PD | `auto` | `test + e2e:` create a seat from the committee surface → one transaction yields the `kind='agent'` person, reviewer membership, track scopes, committee row, and a bound `review:write` token whose secret renders once through the existing shown-once panel (component identity asserted, not a second implementation). Then the bound token `POST`s an evaluation on an assigned submission → the row carries score, `criteria_scores`, and comment, is attributed to the seat's `reviewer_person_id`, and the chair's record read returns it with its rationale text intact. |
| AC-289 | PD | `auto` | `test:` four negatives, each a distinct assertion. (a) Issue bound to a `kind='human'` person → rejected. (b) Flip a live seat's `kind` to `'human'` in the database → the next request with its token fails closed at resolution. (c) An unbound token → 403 on the reviewer record and evaluation-write routes and an empty queue with `scopes: []`. (d) A bound seat without the track scope, and separately without a round assignment → 403 with no metadata distinguishing absent from hidden. Assert every path still enters `authorizeReviewerScope` by call-site enumeration, not by behaviour. |
| AC-290 | PD | `auto` | `test:` a bound token requesting an organizer route the issuing human can reach → 403 (the seat's authority, not the issuer's); issuing a bound token with any grant beyond `review:write` → rejected; the seat holds no `owner`/`program_lead`/`ops` membership. Revoke → next request 401, and the seat's evaluations are byte-identical afterwards, still attributed. |
| AC-291 | PD | `auto` | `test + e2e:` write an agent evaluation, then a human evaluation on the same round and submission → both rows exist, both render, each distinctly attributed; re-submit from each side → only that side's row moves (`updated_at` of the other unchanged). `static:` no cron, queue consumer, scheduled handler, or UI control writes an evaluation — Marquee never invokes a model. |
| AC-292 | PD | `auto` | `test:` compute the chair-facing aggregate over a submission holding one agent and two human evaluations → equals the aggregate over the two human evaluations alone, and the agent's score renders as its own labelled line. The same agent evaluation sets its `round_assignments` row to complete and counts in that round's coverage figures. |
| AC-293 | PD | `auto` | `e2e:` on a freshly reset demo, open *"Taming 40-Minute CI"* as the chair → an agent-attributed score with rationale and a human review render side by side, each badged, and the badged and unbadged rows occupy identical box heights (elements never jump). `static:` the tree does not carry the open-evaluation claim in any user-facing surface unless the seeded agent evaluation exists in the demo fixture — claim and evidence ship together. |


### 2.6 Post-deadline organization-settings band — AC-294 – AC-301 *(Amendment 21, 2026-08-14)*

**Outside the Wednesday terminal gate, on the same terms as §2.4 and §2.5.** §2's "210 live in-scope" count, every tier arithmetic, the cut line, and the terminal gate are unchanged; these rows are unenforced by `trace:ac` until MRQ-207's claims manifest lands, at which point coverage is required like any other `auto` row. Stories: US-88 – US-89 (`sequence/USER_STORIES.md` Amendment 21). Binding design: `sequence/org-settings-design.md`, prototype v1.15. *Amendment numbers this round are shared across the three contract documents so two concurrent folds cannot collide; the jump from 14 is deliberate, and Amendment 22 belongs to MRQ-204.*

| AC | Tier | Tag | How verified |
|---|---|---|---|
| AC-294 | PD | `auto` | `test:` read a fresh organization → every default null. PATCH the full set → re-read returns each value. PATCH one field → assert the others are byte-identical (the bug this catches is the UPDATE that writes every column from a partial body). PATCH a field to null → re-read returns null, not the product default. Refusals asserted per field: an unknown theme id, a timezone the runtime's own tz database rejects, a non-hex accent. A session holding only a conference-scoped seat receives 403 on both read and write, and no organization row moves. |
| AC-295 | PD | `auto` | `test:` resolve the theme with nothing set → Day; with only an organization default → that default; with a personal choice → the choice, and it still wins after the organization default changes; with `?theme=` → the override, and storage is unchanged. Clearing the organization default removes the key rather than writing `day` into it, and a non-theme value is refused. `static:` `index.html`'s pre-paint script reads the same three keys in the same order as `readTheme()` — two implementations of one rule, so the duplication is asserted rather than trusted. |
| AC-296 | PD | `auto` | `test:` mint with `role` + `event_id` → the pending row reports both; exchange → exactly one membership, with that role and that `event_id`, on the organization that minted the invite, and **zero** organization-wide memberships created. A `role` in the exchange body is ignored. `owner` refused at mint; `reviewer` without a conference refused at mint with 422 (not a 500 at the recipient's door); an `event_id` from another organization refused without confirming it exists. |
| AC-297 | PD | `auto` | `test:` mint → the short code is well formed and is NOT stored in the clear, while the row does carry a hash. Present the code lower-cased and space-separated at `/join/…` → the live page, not the spent one; exchange with it → 200; then replay the long token of the same row → 401 with zero rows created (one row, one use). A well-formed code that was never minted → the same inert 401. `unit:` the wordlist is exactly 256 distinct words so a random byte selects without modulo bias; normalization accepts the desk's lossy forms and refuses everything else, including a long token. |
| AC-298 | PD | `auto` | `test:` one assertion per arm, each failing with that arm alone removed. (a) Session: their next request 401s and no unrevoked session remains. (b) Links: an unexpired sign-in link is consumed, while an already-spent one keeps its original `used_at` and an already-expired one is not re-dated. (c) Tokens: exactly the named token is revoked, an unchecked token of theirs still works, and a token minted by someone else is untouched — including when the request names it. Plus: organization-wide and conference-scoped seats both end; a `speaker` seat the same human holds survives; the person row survives; the last-owner refusal is unchanged. |
| AC-299 | PD | `auto` | `test:` seed a person with participations on a published and an unpublished session, one open and one completed task, and an org-level annotation. Preview → names both sessions, flags the published one, and flags sole-speaker correctly on each. Remove → participations at this event gone, the open task carries `cancelled_at`, the completed task is byte-identical (`status`, `completed_at`, `cancelled_at` unchanged). Count before/after: `people`, `submissions`, and `person_events` for that person are identical; the published session is still `is_published = 1`; the co-speaker's participation stands; another organization's rows are untouched. Run twice → the second call changes nothing and resurrects no task. |
| AC-300 | PD | `auto` | `test:` with a live session and unexpired login, task, and co-speaker links, revoke access → the session is revoked and all three links are consumed. In the same assertion, the person's participation, their open task (still open, still uncancelled), and their published session are unchanged — the route ends the login, not the speaker. |
| AC-301 | PD | `auto` | `test + route scan:` `/org` and its three tab paths resolve to the organization surface and all four light the one sidebar row; `/settings/api` still resolves rather than 404ing; Conference settings renders no organizers card and no API-token elements while still linking Webhooks and Venues. `e2e:` switching tabs moves no element's bounding box, and the theme gallery's Select/Selected control holds one width across both states (elements never jump). |
### 2.7 Post-deadline conference-deletion band — AC-302 – AC-307 *(Amendment 22, 2026-08-14)*

**Outside the Wednesday terminal gate, on the same terms as §2.4–§2.5.** The criteria are enforced by the MRQ-204 claims manifest and are not folded into the existing 210 live in-scope count or tier arithmetic. Stories: US-90 – US-91 (`sequence/USER_STORIES.md` Amendment 22). Binding design: `sequence/sidebar-fold-tickets.md` §T2 and `prototypes/pipeline-v1.1/index.html` settings Danger zone / confirmation handler.

| AC | Tier | Tag | How verified |
|---|---|---|---|
| AC-302 | PD | `auto` | `test + e2e:` render the Conference settings Danger zone modal and assert the exact prototype copy. With an empty, wrong-case, extra-character, and missing-character input the red **Delete conference** button remains disabled; with the exact conference name (including surrounding whitespace that is trimmed) it becomes enabled. Assert the API route is organizer-only. |
| AC-303 | PD | `auto` | `test + e2e:` assert the modal and card carry the ruled dies/stays disclosure, including forms/public links, agenda/site, portal access, calendar invites, and organization-level people/notes/tags/outreach. |
| AC-304 | PD | `auto` | `test:` delete a conference with a sibling and assert the response/UI selects the sibling; delete the last conference and assert the fresh-install `/dashboard` landing is selected and the deleted ID is absent from event reads/switching. |
| AC-305 | PD | `auto` | `test:` seed the complete event-owned graph, count every event-scoped table before and after, execute the route in one transaction, and assert the deletion audit row survives with `event.deleted`, actor kind/person, event ID, before snapshot, after marker, and request ID. Force a failed batch and assert the event graph remains; assert no restore/soft-delete path exists. |
| AC-306 | PD | `auto` | `test:` compare byte-stable snapshots of organization `people`, `person_events` notes/tags/stage rows, and surviving person-headshot subjects before/after while asserting every event-scoped row is gone, including both submission kinds, forms/public links, agenda/site material, portal magic links, outbox/invites, embeds, evaluations, tasks/uploads, imports, venues/taxonomy, webhooks, and mirror rows. |
| AC-307 | PD | `auto` | `test + static:` assert `marquee event delete <event-id>` appears in generated `SKILL.md`, dispatches to `DELETE /api/v1/events/:id`, and `remove-demo` imports/calls the same `deleteEventCascade` primitive rather than maintaining a second statement list. |

### 2.8 Post-deadline Airtable-connect band — AC-308 – AC-313 *(Amendment 25, 2026-08-15)*

**Outside the Wednesday terminal gate, on the same terms as §2.4–§2.7.** Not folded into the 210 live in-scope count or tier arithmetic. Story: US-92 (`sequence/USER_STORIES.md` Amendment 25). **AC-228 moves here from §2.3's mirror block** — the Settings → Airtable screen is one thing with one owner, and it is this band's screen.

**Why this band exists at all.** MRQ-217 shipped the outbound mirror with no way to switch it on. Its triggers fire only when `mirror_state` holds a row whose `airtable_table_id` is non-empty, the drain resolves the same field per table, and the only `INSERT INTO mirror_state` in the tree is the reset sentinel, which writes NULL. Every MRQ-217 test passes because it inserts `mirror_state` as a fixture. So the machinery is proven against a configured state the product cannot produce — a working feature with no reachable on switch, and the precise failure `CLAUDE.md` names when it says green tests are not a working product. **AC-310 is the on switch, and until it lands AC-225 is unreachable in any deployment.** Every criterion here is verified against a fake Airtable transport; none requires a live base.

| AC | Tier | Tag | How verified |
|---|---|---|---|
| AC-308 | PD | `auto` | `test:` posting a token and base to the connect endpoint calls Airtable's schema read **before** any write; on a rejected credential nothing is persisted (`mirror_state` and the credential store are byte-identical before and after) and the error names which of token or base failed. On success the base's tables are returned for mapping. |
| AC-309 | PD | `auto` | `test:` the stored token is encrypted at rest — assert the persisted bytes do not contain the plaintext — and no response body, log line, error, or telemetry event on any path echoes it. A read returns only a masked fingerprint and a set-at timestamp. Disconnect deletes the credential, clears `mirror_state.airtable_table_id`, and the next dispatch is a no-op. |
| AC-310 | PD | `auto` | `test:` from a deployment with no configuration, complete the connect flow, then write one mirrored row and assert an outbox row is created and drains to the fake transport — **with no direct `mirror_state` fixture anywhere in the test**. This is the criterion MRQ-217's suite could not state about itself. |
| AC-311 | PD | `auto` | `test + route scan:` the Server panel's connection rows include Airtable with its true state, and System health's `Airtable sync` row carries an `href` to Settings → Airtable once that route exists. Unconfigured, both read as not-connected rather than absent or errored. |
| AC-312 | PD | `auto` | `test + static:` `SKILL.md` and the setup guide document the connect flow, and an agent completes it end to end through the API — connect, verify, map, confirm a change reaching the fake provider — with no screen opened. |
| AC-313 | PD | `auto` | `test:` connect, status, and disconnect are exposed under `mirror:write`; status is readable under a read scope; no scope returns the token. A token lacking `mirror:write` is refused on every write verb. |

---

### 2.9 Post-deadline mail-idempotency band — AC-314 *(Amendment 26, 2026-08-15)*

**Outside the Wednesday terminal gate, on the same terms as §2.4–§2.8.** Not
folded into the 210 live in-scope count or tier arithmetic. The criterion is
appended to US-45/US-68; the implementation seam is the frozen registry in
`src/jobs/mail/idempotency.ts`.

| AC | Tier | Tag | How verified |
|---|---|---|---|
| AC-314 | PD | `auto` | `test:` a manual send repeated with the same `Idempotency-Key` produces one outbox row per recipient, while a new nudge with no key produces another row even when recipient and copy are identical; the draft-resume seam produces distinct keys for distinct request tails; the registry inventory preserves unchanged key bytes and a type-level fixture rejects raw-string `entityId` values. |

---

## 3. Felt checkpoints

Four in-scope ACs are judgements no assertion settles. Each is a scheduled human-use session with an explicit trigger, an explicit method, and a recorded verdict. A checkpoint that has not run is not a pass.

| # | Covers | Trigger | Method | Pass |
|---|---|---|---|---|
| **C1** | AC-1 | Walking skeleton up — landing page and both demo entries live on a deployed preview. | A person who has not seen Marquee opens the URL cold and is timed. Three questions, unprompted: what is this, how do I get in, whose tool is it. | All three answered inside 10s with no help. Re-run at C7. |
| **C2** | AC-16 | Dashboard complete against the full seed. | Operator opens it and names their next action without hunting. A report says what happened; a home says what to do. | Operator affirms and names one next action visible on screen. |
| **C3** | AC-26 (+ reads AC-42, AC-44, AC-49, AC-161 copy) | Public form and speaker portal complete. | Force every validation failure, every empty state, **and every submit failure — 5xx, Turnstile challenge failure, 429, dropped connection**; read the copy aloud. | No sentence contains a field name, a type name, an error code, or "invalid" without a remedy. |
| **C5** | AC-75 | Agenda track view complete **on deployed infra**, not local. | Place ten sessions with a trackpad and with a mouse. | No perceptible lag, no snap-back, no ghost offset. The frame instrument's p95 is evidence, not the verdict. |
| **C6** | Real-device confirmation of AC-35, AC-85, AC-155–AC-159 | Every mobile-affecting surface complete. | One real iPhone and one real Android against the deployed URL: submit the form, resume a draft, clear five reviews, read the public agenda. | Each completes. Disagreement with the headless proxy resolves in the device's favour. |
| **C7** | All four felt ACs + the whole loop | Tuesday, before the public repo push. | A person who did not build it drives the walkthrough script end to end, cold, narrating. | Zero dead ends, zero moments of "wait, where is…", C1–C6 verdicts re-affirmed. |

*(C4 folded into C3 — AC-43's prominence is asserted structurally and read in the same session.)*

---

## 4. The terminal gate

Run in order by the final auditor, who did not write the spec. Every item is pass/fail and every one is recorded in the gate report with its evidence. **A failure stops the gate; it is not noted and passed over.**

| # | Gate | Command / method | Pass condition |
|---|---|---|---|
| 1 | Preconditions live | Manual probe | Workers Paid active · R2 public object returns 200/404, never 403 · Resend domain verified · Airtable demo base on Team+ |
| 2 | Hermetic suite green | `npm test` | Exit 0, **wall clock ≤30s**, zero skips |
| 3 | AC coverage complete | `npm run trace:ac` | Every `auto` AC in scope has ≥1 test; report attached |
| 4 | Seeded demo present | `npm run check:seed` against **production** | ≥800 submissions, ≥150 accepted speakers, populated agenda, the deliberate ugliness present, the organizer demo persona's review queue ≥20 unreviewed |
| 5 | Both demo logins work | Manual, then `e2e` | One click each, no form, no gate, both land populated; and with `demo_mode=0` the route 403s with no cookie (AC-2) |
| 6 | **Full loop, zero dead ends, on the deployed site** | `npm run e2e` against production, desktop + mobile | All 11 steps green; crawler finds no stub, placeholder, or dead link |
| 7 | Speed budgets met on deployed infra | `npm run check:speed` against production | Every **AC-sourced** p95 inside §1.3. Objective misses (the seven client-signed *proposed* budgets) are reported with a ⚠ banner and **do not fail the gate** — the client declassified them on 2026-08-09. `speed-report.json` attached with actuals |
| 8 | API parity holds | `npm run check:api` | No UI-only write endpoint; OpenAPI valid; docs reachable |
| 9 | **Airtable round-trip demonstrated** — **AC-225 – AC-229** | `npm run check:mirror` against the test base, **then** the manual ≤60s demo against the *demo* base: change a submission's status in Airtable → refresh Marquee → it's there; change it in Marquee → it appears in Airtable. | Suite green (AC-225 outbound ≤60s, AC-226 allowlist applied / non-allowlisted ignored, AC-227 no sync loop, AC-229 keepalive advances expiry); both manual directions land; Settings→Airtable shows base link, row counts both sides, last sync, outbox depth (AC-228) |
| 10 | **ICS invite accepted in a real Gmail** | `npm run smoke:ics -- --event-id <demo-safe event> --to <fresh gmail> [--to <fresh outlook>] [--to <fresh apple>]` | Each exact recipient is preserved and exercised independently. Gmail renders Accept/Decline (not an attachment); Accept lands the event at the right time and room; a reschedule **replaces** it; a cancel removes it. Outlook and Apple strongly wanted, Gmail mandatory |
| 11 | Live mail reaches a real inbox | `npm run smoke:mail -- [--to <fresh full address>]...` | Submit from the public form with a real or generated fresh address → the always-live confirmation targets that exact address, arrival is observed, From display name is correct, and the link resolves |
| 12 | Agent-only operation | `npm run check:skill-agent` | A clean agent with only `SKILL.md` completes seed → triage → accept → schedule |
| 13 | **Reset-demo works** — **AC-230** | Mutate the demo, then `npm run reset:demo`, then the in-product button, then re-run gate 4. Run twice consecutively. | Both paths restore the seeded state; idempotent; a concurrent visitor polling throughout never observes a partial reset; second judge inherits nothing from the first |
| 14 | Self-host path executes | `npm run check:readme` | Numbered sequence runs verbatim from a clean checkout with zero human input, ending in a live 200 |
| 15 | **PROTOTYPE badge absent from the product** | `npm run check:repo` + visual sweep | The badge exists only under `prototypes/`; no product route renders it |
| 16 | **No secret material and no third-party content in the public repo** | `npm run check:repo` over the **pushed remote's full history** | The repo is an orphan/squashed initial commit with no ancestry from the working repo (M-56). Zero tokens, keys, or `.dev.vars`; no `Atin/` content; no Stage 11 internals; no `sources/` tree, brief PDF, competitor document, agent brief, `run-state`, `/Users/` path, or c11 workspace/surface ID; curated research docs only; Apache-2.0 present |
| 17 | Felt checkpoints signed | C1, C2, C3, C5, C6, C7 verdicts | All recorded with dates; C7 run after the last functional change |
| 18 | Tier A complete, no waivers | Coverage report | **AC-1 – AC-90 plus AC-231, AC-234, AC-240, and AC-244–246** all green. AC-239 is struck; AC-233 is cuttable — read §"Build scope", not the ID range |
| 19 | Cut line stated | Gate report, against **`BUILDPLAN.md` §5's ranks** (the single rank authority) | Every cut Tier B story named with its rank, its ACs, and the reason. The 🔒 gate-backing tickets (M-45, M-38, M-39, M-56) are outside the cut band and may never appear here — **explicitly including AC-233 (Speaker Handbook) if it was cut**, since it is the one cuttable criterion sitting on a Tier A story and is the easiest to lose silently. Silently missing is a failure; deliberately cut is not |
| 19b | **Known limitations named, not discovered** | Gate report | The report carries a *Known limitations* section, and it names at minimum the **submitter/speaker fusion**: the public form collects one address, so an assistant submitting for their director receives the confirmation, the portal link, the tasks, and the calendar invite. Cite **AC-223 / AC-224** (already specified, post-competition band) and `SPEC.md` §10. Ruled extra credit 2026-08-10. A limitation a judge meets on screen with no prior mention is a failure of this gate even though the behaviour itself is out of scope |

---

## 5. Non-goals — do not fail the build for these

The auditor must not raise any of the following as a defect. They are decisions, not omissions.

**Explicit SKIPs** (`USER_STORIES.md` traceability table, `PRODUCT-DEFINITION.md` §3): R33 payment/ticketing · R39 multi-language · R8 CRM, marketing, CMS · SMS · AI agenda builder · attendee ticketing and attendee app · speaker availability constraints · optimal reviewer assignment.

**Deliberately out of scope for this build:**

- **OAuth calendar write.** Google's sensitive-scope verification is stated at up to 10 days, plus Search Console domain verification, a same-domain privacy policy, and an unlisted demo video; restricted scopes add a 4–12 week CASA assessment. ICS `METHOD:REQUEST` is the shipped path and OAuth is a documented extension point. Ratified 2026-08-08.
- **Airtable as primary datastore.** D1 is the source of truth; Airtable is a genuine two-way mirror (US-72, AC-225 – AC-229), never on a read path. 5 req/s per base and 30-hop serial pagination would lose R7 outright — and it is precisely the mirror's asynchrony that lets AC-225's 60-second budget coexist with R7 rather than fight it. Ratified 2026-08-08. *(Reopening requires a Discord ruling — see §6.)*
- **Malware scanning of uploads.** No AV lands in this window. Uploads are served from a separate origin with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`; documented as an extension point.
- **Multi-round beyond two.** Two ordered rounds and funnel promotion ship; parallel mode, per-round anonymity variation, and round-specific visibility layers are post-competition. The schema is round-aware from the first migration, so a third round is data, not a migration.
- **Multi-event UI.** Modeled in the schema (a person exists at the org level), single-event UI ships.
- **Custom sending domain.** Mail goes from `marquee@stage11.systems`, verified since March. A fresh domain is a deadline trap.
- **D1 read replication and Smart Placement.** Neither helps a sparse demo; read replication takes up to 24h to disable and is a one-way door inside the window.
- **Month agenda view.** The word appeared only in a context reference image, not as a desired capability. List, Day, Week, Track, and Room remain the signed views.
- **A mobile-optimized admin SPA.** The mobile criteria — AC-35, AC-85, AC-155–AC-159, confirmed on real devices at C6 — cover the public form, the public agenda, and the reviewer queue: the three surfaces a speaker, an attendee, or a reviewer actually meets on a phone. The organizer dashboard, form builder, and agenda builder are desktop surfaces; the walkthrough is driven on desktop. A judge who opens the dashboard on a phone meets an unbudgeted surface, and that is a decision, not an omission.
- **Generalized CMS / arbitrary resource pages.** R8 remains an explicit SKIP. The narrow Speaker Handbook and configured agenda/speaker embeds still ship and must not be misclassified as a CMS.

**Not a defect:** a Tier B story below the cut line, provided §4 gate 19 names it.

---

## 6. Open dependencies

Named, not guessed. Each changes something specific in this contract.

| # | Dependency | What it changes | Status |
|---|---|---|---|
| 1 | **Sunday clarification video** — requirements freeze | May add or remove ACs. New criteria append from **AC-251**; nothing here is renumbered or reused. Any new criterion needs a row in §2, a tier assignment in `USER_STORIES.md`, and — if it lands in Tier A's no-waiver set — a line in §1.4, all before the gate. | Open. Video is unlisted, announced only in Discord. |
| 2 | **Discord ruling Q2 — embeddable gallery** (struck in the brief, described in the video) | **Closed, resolved-built (Amendment 18, 2026-08-11).** MRQ-22 merged AC-87–90; MRQ-75 widened the family to four kinds (`agenda\|sessions\|speakers\|cfp`) and moved all of it — original and new — into Tier A's no-waiver set. The video's override of the brief's strikethrough stands; nothing here is cuttable anymore. | **Closed.** |
| 3 | **Discord ruling Q1 — Airtable as literal primary datastore** | If ruled primary, gate 9 changes shape and the §5 entry is void. The mirror is built under either answer. | Open; we build the mirror regardless. |
| 4 | **Resend plan tier** | Free is 100 sends/day. Decides whether gates 10 and 11 must be rationed and whether Pro is bought for the judging window. | Open — a 30-second dashboard check. |
| 5 | **Real Sessionize export** | The only thing that settles AC-109's `op-assist` tag. | Open. |
| 6 | **Airtable demo base plan** | Free caps at 1,000 records/base; the seed is exactly 1,000. Gate 1 fails without Team+. | Open. |
| 7 | **v1.4 Pipeline prototype** (`prototypes/pipeline-v1.1`, legacy directory name) | Becomes the binding visual contract only after client sign-off. §2 now carries the context-closure behaviors; `DESIGN.md` and orchestration wait on this gate. | Candidate complete; client review pending. |

---

## 7. Out of build scope — AC-170 – AC-224 except AC-217–AC-218

**AC-170 – AC-224, except AC-217–AC-218 (promoted to live Tier A by Amendment 18, 2026-08-11), are post-competition and are not built by Wednesday.** This was the *only* contiguous ID range that mapped cleanly to a tier before Amendment 18 opened this one hole in it — everything above AC-224 is in scope and everything in this range other than AC-217–AC-218 is not, so do not read "higher number = later" anywhere else. The remaining post-competition ACs carry permanent IDs and are modeled where the data model makes it cheap (round-aware schema, the complete status enum including waitlisted, the `(person, session, role)` participation triple, org-level people). The auditor does not test them and does not fail the build for their absence.

Two carry enforcement obligations even though their UI is deferred, because retrofitting them is expensive or they leak data:

- **AC-214** — cross-event reviewer access is not inherited; reviewer scope is per event by construction. The one permission bug in this domain that leaks unpublished work. Asserted in `test:` from the first migration.
- **AC-176** — the status enum ships complete (submitted, in review, accepted, waitlisted, rejected, withdrawn) even though the waitlist UI is later.

---

## Amendment log

**Amendment 26 — one named mail-idempotency seam, 2026-08-15, plumbing fold.** Folds `USER_STORIES.md` Amendment 26 and `SPEC.md` §3.8. AC-117's verification now includes the full pre-fix registry byte-identity inventory; **AC-314** is the post-deadline lock for durable manual-nudge retries and fresh new nudges. The live count, tier arithmetic, and terminal gate remain unchanged.

**Amendment 21 — the organization is a record, and an invite carries its seat, 2026-08-14, client-directed.** Folds `USER_STORIES.md` Amendment 21 (US-88 – US-89, AC-294 – AC-301) as new §2.6, a **post-deadline** band on §2.4's terms: outside the Wednesday terminal gate, unenforced by `trace:ac` until MRQ-207's claims manifest lands, and leaving §2's live in-scope count (210), the tier counts, the cut line, and the terminal gate deliberately unchanged. Two rulings underneath it are worth naming because they are refusals as much as additions. **Null is a value here:** every organization default may be unset, and unset is contractually distinct from chosen — collapsing the two would pin every silent organization to whatever the product's default happened to be on the day it changed. **And revocation is asserted per arm, not in aggregate:** AC-298 requires one failing-first assertion for each of session, unexpired link, and named token, because a test that only asserted "their next request 401s" passes cleanly against a build that leaves a live sign-in link in a fired volunteer's inbox — the link has not been presented yet. Invite-only stands; no join-request queue is added. Amendment numbers this round are shared across the three contract documents so two concurrent folds cannot collide, which is why this file's log jumps from 14; **Amendment 22 and AC-302 – AC-307 belong to MRQ-204**. Binding design: `sequence/org-settings-design.md`, prototype v1.15. Built by MRQ-207.
**Amendment 22 — conference deletion, 2026-08-14, merge-captain allocation.** Folds `USER_STORIES.md` Amendment 22 (US-90 – US-91, AC-302 – AC-307) as new §2.7, a post-deadline band enforced by MRQ-204's claims manifest. It leaves the existing 210 live in-scope count, tier arithmetic, and Wednesday terminal gate unchanged. The binding cascade is the T2 contract and the prototype's Danger zone confirmation flow; the seeded demo delegates to the same event-deletion primitive.

**Amendment 14 — the open-evaluation band, 2026-08-12, client-directed.** Folds `USER_STORIES.md` Amendment 20 (US-87, AC-288 – AC-293) as new §2.5, a **post-deadline** band on §2.4's terms: outside the Wednesday terminal gate, unenforced by `trace:ac` until MRQ-134's claims manifest lands, and leaving §2's live in-scope count (210), the tier counts, the cut line, and the terminal gate deliberately unchanged. The ruling behind it is a scope *refusal* as much as an addition: Marquee ships no built-in AI reviewer, because a vendored evaluator bets the committee's judgment on one model and one prompt and ages badly. It ships the seat instead — an agent evaluator is a `kind='agent'` person holding a reviewer membership and track scopes, assigned through the control that already assigns reviewers, and a bearer credential bound to that seat is what finally supplies the reviewer identity `reviewer-scope.ts` has always named as the precondition for service integrations. **AC-293 exists because the claim is dangerous without its evidence:** the eval kit's ABS-14 is scored not-applicable while nothing claims AI review, and becomes a graded, failing item the moment the product says otherwise with no agent evaluation seeded — so claim and evidence are contractually bound to the same change. Binding design: `sequence/agent-evaluator-design.md`. Built by MRQ-134.

**Amendment 13 — the cold-start band, 2026-08-12, client-directed.** Folds `USER_STORIES.md` Amendment 19 (US-83 – US-86, AC-275 – AC-287) as new §2.4 — a **post-deadline** band explicitly outside the Wednesday terminal gate. §2's live in-scope count (210), the tier counts, the cut line, and the terminal gate are all deliberately **unchanged**: the band is enforced by `trace:ac` only once MRQ-105's claims manifest lands, which is the mechanism that lets the contract carry scheduled-but-not-judged work without corrupting the gate arithmetic. Built by MRQ-105 (`BUILDPLAN.md` Amendment 12) on the operator's direction; binding surfaces are prototype v1.11, `docs/GETTING-STARTED.md`, and `prototypes/cold-start/SKILL-SETUP-CHAPTER.md`.

**Amendment 12 — AC-231 scoped to real conferences, 2026-08-11.** AC-231 (Tier A, no-waiver) asserted that draft creation, submit, and every presign fail closed without a valid Turnstile token. That gate now applies only where `demo_mode = 0`; demo conferences skip it. **No AC is struck, no count moves** — AC-231 keeps its Tier A no-waiver seat and its three rejection cases, measured against a real conference.

The reason is evidence, not convenience. A run of the competition's own grading harness (`sbek`, swyx's `killmysaas-evals`) against the deployed demo showed its headless browser agent is served an interactive Turnstile challenge it cannot solve, and the failure is not confined to the widget: no token means no draft, and no draft means every upload and the submission behind it fail too. One unsolvable challenge closes the whole public submission path to any automated reader, and the harness's own judge recorded it as a harness-side limitation while the *consequences* — a submission that never reaches the organizer — were still scored against the build. The judged artifact must be drivable by an automated grader; a bot gate on the demo conference is a gate against our own evaluator.

What still holds on a demo conference: draft creation remains rate-limited per token, presigns still require possession of the draft's own resume token plus the per-IP and per-submission upload caps, and `PATCH …/drafts/:token` autosave is unchanged. What is deliberately given up: bot protection on the demo conference's public form. That is acceptable because the demo holds no real submitter data and is reset on demand (AC-230).

**Amendment 11 — public widgets widened and protected, 2026-08-11, client-directed.** Folds `SPEC.md` Amendment 18 and `USER_STORIES.md` Amendment 18. Four `auto` rows added to §2 Tier A: **AC-217, AC-218** (new `US-16` block, promoted out of post-competition) and **AC-273, AC-274** (appended to the existing `US-58` block) — in-scope live count 206 → 210, build-scope (Tier A + Tier B + cut-line) 203 → 207, Tier A 102 → 106 (27 stories → 28), post-competition 55 → 53. §6 dependency 2 (Discord Q2 — embeddable gallery) closes **resolved-built** rather than staying open against a strikethrough the shipped video already overrides. §7's post-competition range gets its one carve-out (AC-217–AC-218). **Tier rationale, since neither the ticket nor `USER_STORIES.md`'s (unmaintained-per-amendment) "Scope at a glance" table states it explicitly:** all four join Tier A, not Tier B, because the client ruling was "protect and widen" — landing the widened half of the embed family in still-cuttable Tier B would leave exactly the part the ruling was about exposed to the cut it was meant to end. Built by MRQ-75 on top of merged MRQ-22; no new milestone dependency beyond it.

**Amendment 1 — contract-review fold, 2026-08-08.** `USER_STORIES.md` appended AC-225 – AC-233, closing four `SPEC.md` flags that named contract items with no acceptance criterion. Folded here: nine `auto` rows added to §2 (in-scope count 169 → 178, `auto` 159 → 168); `check:mirror` added to the harness; a dedicated Airtable test base added as precondition 9; gate 9 now cites AC-225 – AC-229 and gate 13 cites AC-230; gate 18's no-waiver set widened to include AC-231; gate 19 now names AC-233 explicitly. At that amendment, Tier B ranks 3–23 renumbered 4–25 to seat US-73 at rank 3 and US-72 at rank 7; Amendment 8 later shifted US-72 to final rank 8 — **no AC ID moved**. Two flags this closes were previously invisible defects in this file: gates 9 and 13 asserted behaviour that no AC covered, so a build could have passed §2 whole and still failed the gate.

**Amendment 9 — agent-composed sends, 2026-08-09.** Folded **AC-250** (Tier B, `auto`): one §2.3 row, in-scope live count 193 → 194 and `auto` 183 → 184; Tier B 96 → 97. Built by M-35 (send surface) and M-38 (CLI `remind`). The next criteria append from **AC-251** — AC-250 is taken, and the Sunday freeze delta must not re-collide on it.

**Amendment 8 — context-coverage closure, 2026-08-09.** Folded live AC-234–249 except struck AC-239: 15 `auto` rows, taking in-scope live count 178 → 193 and `auto` 168 → 183. Gate 18 now includes multi-track visibility, scheduled/public legibility, reviewer detail, the simple recommendation path, and centralized track authorization. Saved views, configurable columns, and the Draft queue are mechanically isolated by user/event/role. `trace:ac` treats AC-239 as a tombstone. Month view and generalized CMS are explicit non-goals.

---

*v1.4 contract revision. Amendments follow `USER_STORIES.md` rules: **the next new criteria append from AC-251**, deletions are struck and never recycled. Next input — client review/sign-off of the v1.4 Pipeline prototype; then mint `DESIGN.md` and hand the complete contract to orchestration.*
