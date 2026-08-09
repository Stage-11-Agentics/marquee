# Marquee — Evaluation Contract

**Status:** v1.4 contract revision for client prototype review · updated 2026-08-09; not yet signed for orchestration.
**Authority once signed:** this file defines what "done" means for the Marquee build and *how an agent proves each criterion without a human in the loop*. The build fleet writes against it; the terminal auditor — who did not write the spec — runs it.
**Upstream:** `sequence/USER_STORIES.md` (249 live criteria through AC-250; AC-239 struck) · `sequence/research/seams-feasibility.md` · `PHILOSOPHY.md` · `sequence/research/competition-requirements.md` §3 · `prototypes/PROTOTYPE-CONTRACT.md` + `prototypes/pipeline-v1.1/DIRECTION.md`.

**Build scope: 194 live criteria — read the tier, not the number.** Amendments allocate IDs without implying tier; AC-239 is struck and deliberately has no test. **`sequence/USER_STORIES.md` §"Scope at a glance" is the authority on tier membership**; this file follows it and never re-derives it from ID arithmetic.

| Tier | ACs | Count | Consequence here |
|---|---|---|---|
| **A — the walkthrough loop** | AC-1 – AC-90, **AC-231, AC-234, AC-240, AC-244–246** | 96 | Binding, no waivers (§1.4, gate 18) |
| **B — ordered differentiators** | AC-91 – AC-169, **AC-225 – AC-230, AC-232, AC-235–238, AC-241–243, AC-247–250** | 97 | Cut from the bottom; a cut must be named (gate 19) |
| **Cut-line criterion on a Tier A story** | **AC-233** | 1 | Speaker Handbook — hosted on US-39, outside Tier A's no-waiver set; cuttable if named |
| **Post-competition** | AC-170 – AC-224 | 55 | Not built, not tested, not a defect (§7) |

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

**Counts across all 194 in-scope live criteria:** **184 `auto` · 1 `op-assist` · 5 `oracle` · 4 `felt`.** All sixteen live criteria added after AC-233 are `auto`; struck AC-239 is excluded.

Credentials, plan tiers, and third-party accounts gate *suites*, not individual criteria. They are enumerated once in §1.6 rather than smeared across 194 rows. The one `op-assist` tag (AC-109) is the exception on purpose: there the missing thing is *knowledge* — the column names and status vocabulary of a real Sessionize export, which cannot be synthesized. A missing credential against a fully-documented API (Airtable, AC-225–229) is a precondition, not a tag.

---

## 1. The harness

### 1.1 Commands the build ships

| Command | What it does | Budget | Where it runs |
|---|---|---|---|
| `npm test` | Unit + integration. Hermetic: local D1 via `@cloudflare/vitest-pool-workers`/Miniflare, stubbed Resend (writes to the outbox table), stubbed R2, no network, no deployed instance. Runs against a **small deterministic fixture**, not the 1,000-row seed. | **≤30s wall, parallel** (Stage 11 hard rule). A regression past 30s is a defect to fix, not absorb. | Every commit, every PR, pre-push. |
| `npm run e2e` | Playwright. Drives the full 11-step loop against a deployed preview at `$MARQUEE_E2E_URL`, on the seeded database. Two projects: `desktop` (1440×900) and `mobile` (375×812, touch, mobile UA). | ≤6 min wall on 4 workers. | Every PR against its preview; the gate against production. |
| `npm run check:speed` | Measures the §1.3 budgets on deployed infra against the real seed. Emits `speed-report.json` (p50/p95/n per budget). Exits non-zero only on an **AC-sourced** budget breach; the seven client-signed *objective* budgets warn loudly but never fail the run (ruling 2026-08-09). | ≤4 min. | Every PR against its preview; the gate against production. |
| `npm run check:seed` | Asserts seed shape and scale over the public API: counts, status distribution, format/track coverage, agenda density, the deliberate ugliness (a speaker on 3 submissions, a 4-person panel, an overdue task set, a live double-booking), and that **the organizer demo persona's review queue returns ≥20 unreviewed candidates** (walkthrough step 8 has a reachable entry). | ≤30s. | After every seed run; the gate. |
| `npm run check:api` | Validates the OpenAPI document, asserts docs route reachable, asserts **route-manifest parity**: replays a full-loop Playwright session with network recording, collects every non-GET request, and fails if any path is absent from the public schema. **Amendment 6:** also asserts single-source generation — served JSON, rendered docs, and the CLI registry derive from one route registry; operation counts and content hashes must match. | ≤2 min. | Every PR; the gate. |
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
| **Mail delivery** | `npm run smoke:mail -- --to <real address>` | Submits through the public form with a real address; asserts arrival, correct from-name, working link back to the submission, and that **demo-safe mode did not suppress mail to an address a live submitter typed**. | Once when the comms path lands; again at the gate. |
| **ICS chain** | `npm run smoke:ics -- --to <gmail> --to <outlook> --to <apple>` | Sends `METHOD:REQUEST`; the operator clicks **Accept** in each client and confirms the event lands with the right time and room. Then a reschedule (`SEQUENCE+1`) must **replace** the entry, and a cancel (`METHOD:CANCEL`) must remove it. This is seams §10.5 — the 15 minutes that separate R3 working from R3 looking like it works. | Once when calendar invites land; again at the gate (Gmail is mandatory; Outlook and Apple are strongly wanted). |
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

## 2. Per-AC verifiability — all 194 live in-scope criteria

The original 178 rows remain grouped by story in build order; the sixteen live context/amendment rows are consolidated at §2.3 with explicit tier labels. Grouping — not ID arithmetic — carries membership. AC-239 is struck and excluded.

Suite refs: `test:` unit/integration · `e2e:` Playwright · `speed:` · `seed:` · `api:` · `repo:` · `readme:` · `oracle:` · `C1`–`C7` = checkpoints in §3.

### Tier A — the walkthrough loop (27 stories · 96 live ACs; AC-233 rides on US-39 but is cut-line, not Tier A)

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
| AC-231 | `auto` | `test:` three rejection cases — missing, replayed, invalid token — each 4xx with **zero rows written and no presign issued**; the siteverify client is stubbed here. The gated set is **draft creation, submit, and every presign**; `test:` also asserts that `PATCH …/drafts/:token` autosave requires **no** Turnstile token, is rejected without a valid resume token, and is rate-limited per token — the intended shape, not the literal per-write reading, which would break AC-41. `e2e:` one pass against real Turnstile on the deployed preview, covering both the public write and the upload-presign path. **Binding: Tier A no-waiver set** *(appended 2026-08-08)* |

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

### Tier B — ordered differentiators (28 stories, ranked · 97 live ACs)

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
| AC-117 | `auto` | `test:` invoke the bulk action twice — exactly one outbox row per (template, submission); `Idempotency-Key` present on each provider call. |

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

### 2.3 Amendment criteria — AC-234–AC-250

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
| 10 | **ICS invite accepted in a real Gmail** | `npm run smoke:ics -- --to <gmail>` | Gmail renders Accept/Decline (not an attachment); Accept lands the event at the right time and room; a reschedule **replaces** it; a cancel removes it. Outlook and Apple strongly wanted, Gmail mandatory |
| 11 | Live mail reaches a real inbox | `npm run smoke:mail -- --to <address>` | Submit from the public form with a real address → confirmation arrives, from the right name, link resolves |
| 12 | Agent-only operation | `npm run check:skill-agent` | A clean agent with only `SKILL.md` completes seed → triage → accept → schedule |
| 13 | **Reset-demo works** — **AC-230** | Mutate the demo, then `npm run reset:demo`, then the in-product button, then re-run gate 4. Run twice consecutively. | Both paths restore the seeded state; idempotent; a concurrent visitor polling throughout never observes a partial reset; second judge inherits nothing from the first |
| 14 | Self-host path executes | `npm run check:readme` | Numbered sequence runs verbatim from a clean checkout with zero human input, ending in a live 200 |
| 15 | **PROTOTYPE badge absent from the product** | `npm run check:repo` + visual sweep | The badge exists only under `prototypes/`; no product route renders it |
| 16 | **No secret material and no third-party content in the public repo** | `npm run check:repo` over the **pushed remote's full history** | The repo is an orphan/squashed initial commit with no ancestry from the working repo (M-56). Zero tokens, keys, or `.dev.vars`; no `Atin/` content; no Stage 11 internals; no `sources/` tree, brief PDF, competitor document, agent brief, `run-state`, `/Users/` path, or c11 workspace/surface ID; curated research docs only; Apache-2.0 present |
| 17 | Felt checkpoints signed | C1, C2, C3, C5, C6, C7 verdicts | All recorded with dates; C7 run after the last functional change |
| 18 | Tier A complete, no waivers | Coverage report | **AC-1 – AC-90 plus AC-231, AC-234, AC-240, and AC-244–246** all green. AC-239 is struck; AC-233 is cuttable — read §"Build scope", not the ID range |
| 19 | Cut line stated | Gate report, against **`BUILDPLAN.md` §5's ranks** (the single rank authority) | Every cut Tier B story named with its rank, its ACs, and the reason. The 🔒 gate-backing tickets (M-45, M-38, M-39, M-56) are outside the cut band and may never appear here — **explicitly including AC-233 (Speaker Handbook) if it was cut**, since it is the one cuttable criterion sitting on a Tier A story and is the easiest to lose silently. Silently missing is a failure; deliberately cut is not |

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
- **Generalized CMS / arbitrary resource pages.** R8 remains an explicit SKIP. The narrow Speaker Handbook and configured agenda/speaker embeds still ship and must not be misclassified as a CMS.

**Not a defect:** a Tier B story below the cut line, provided §4 gate 19 names it.

---

## 6. Open dependencies

Named, not guessed. Each changes something specific in this contract.

| # | Dependency | What it changes | Status |
|---|---|---|---|
| 1 | **Sunday clarification video** — requirements freeze | May add or remove ACs. New criteria append from **AC-251**; nothing here is renumbered or reused. Any new criterion needs a row in §2, a tier assignment in `USER_STORIES.md`, and — if it lands in Tier A's no-waiver set — a line in §1.4, all before the gate. | Open. Video is unlisted, announced only in Discord. |
| 2 | **Discord ruling Q2 — embeddable gallery** (struck in the brief, described in the video) | If struck: **AC-87 – AC-90 move to §5 non-goals** and gate 6's embed steps drop. Currently building them; the video overrides the strikethrough. | Open. |
| 3 | **Discord ruling Q1 — Airtable as literal primary datastore** | If ruled primary, gate 9 changes shape and the §5 entry is void. The mirror is built under either answer. | Open; we build the mirror regardless. |
| 4 | **Resend plan tier** | Free is 100 sends/day. Decides whether gates 10 and 11 must be rationed and whether Pro is bought for the judging window. | Open — a 30-second dashboard check. |
| 5 | **Real Sessionize export** | The only thing that settles AC-109's `op-assist` tag. | Open. |
| 6 | **Airtable demo base plan** | Free caps at 1,000 records/base; the seed is exactly 1,000. Gate 1 fails without Team+. | Open. |
| 7 | **v1.4 Pipeline prototype** (`prototypes/pipeline-v1.1`, legacy directory name) | Becomes the binding visual contract only after client sign-off. §2 now carries the context-closure behaviors; `DESIGN.md` and orchestration wait on this gate. | Candidate complete; client review pending. |

---

## 7. Out of build scope — AC-170 – AC-224

**AC-170 – AC-224 are post-competition and are not built by Wednesday.** This is the *only* contiguous ID range that maps cleanly to a tier — everything above AC-224 is in scope, so do not read "higher number = later" anywhere else. They carry permanent IDs and are modeled where the data model makes it cheap (round-aware schema, the complete status enum including waitlisted, the `(person, session, role)` participation triple, org-level people). The auditor does not test them and does not fail the build for their absence.

Two carry enforcement obligations even though their UI is deferred, because retrofitting them is expensive or they leak data:

- **AC-214** — cross-event reviewer access is not inherited; reviewer scope is per event by construction. The one permission bug in this domain that leaks unpublished work. Asserted in `test:` from the first migration.
- **AC-176** — the status enum ships complete (submitted, in review, accepted, waitlisted, rejected, withdrawn) even though the waitlist UI is later.

---

## Amendment log

**Amendment 1 — contract-review fold, 2026-08-08.** `USER_STORIES.md` appended AC-225 – AC-233, closing four `SPEC.md` flags that named contract items with no acceptance criterion. Folded here: nine `auto` rows added to §2 (in-scope count 169 → 178, `auto` 159 → 168); `check:mirror` added to the harness; a dedicated Airtable test base added as precondition 9; gate 9 now cites AC-225 – AC-229 and gate 13 cites AC-230; gate 18's no-waiver set widened to include AC-231; gate 19 now names AC-233 explicitly. At that amendment, Tier B ranks 3–23 renumbered 4–25 to seat US-73 at rank 3 and US-72 at rank 7; Amendment 8 later shifted US-72 to final rank 8 — **no AC ID moved**. Two flags this closes were previously invisible defects in this file: gates 9 and 13 asserted behaviour that no AC covered, so a build could have passed §2 whole and still failed the gate.

**Amendment 9 — agent-composed sends, 2026-08-09.** Folded **AC-250** (Tier B, `auto`): one §2.3 row, in-scope live count 193 → 194 and `auto` 183 → 184; Tier B 96 → 97. Built by M-35 (send surface) and M-38 (CLI `remind`). The next criteria append from **AC-251** — AC-250 is taken, and the Sunday freeze delta must not re-collide on it.

**Amendment 8 — context-coverage closure, 2026-08-09.** Folded live AC-234–249 except struck AC-239: 15 `auto` rows, taking in-scope live count 178 → 193 and `auto` 168 → 183. Gate 18 now includes multi-track visibility, scheduled/public legibility, reviewer detail, the simple recommendation path, and centralized track authorization. Saved views, configurable columns, and the Draft queue are mechanically isolated by user/event/role. `trace:ac` treats AC-239 as a tombstone. Month view and generalized CMS are explicit non-goals.

---

*v1.4 contract revision. Amendments follow `USER_STORIES.md` rules: **the next new criteria append from AC-251**, deletions are struck and never recycled. Next input — client review/sign-off of the v1.4 Pipeline prototype; then mint `DESIGN.md` and hand the complete contract to orchestration.*
