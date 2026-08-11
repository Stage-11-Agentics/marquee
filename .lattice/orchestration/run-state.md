# Marquee — Orchestration Run State

**DISPATCHED 2026-08-09 02:15 EDT (D+0).** ⚠ **CP-1 revised to D+18h** (MRQ-8 plan-review: M-07 is 7h, not 4h — chain M-01 3 + M-02 4 + M-07 7 + M-08 4). Superseded: CP-1 = D+15h → **2026-08-09 ~17:15 EDT** (chain corrected at intake: M-01→M-02→M-07→M-08 = 15h). CP-2 = D+36h → **2026-08-10 ~14:15 EDT**. Deadline Wed 2026-08-12 22:00 PT.

## Configuration

- **Autonomy:** Moderate (decide-and-log routine; surface architectural/scope/irreversible)
- **N concurrent delegators:** 5 (operator-set 2026-08-09; was 6) · **Harness:** codex (`codex --yolo`, high effort) per operator directive; orchestrator/validators on claude
- **PR merge policy:** auto-merge on verified green + fresh this-cycle PASS review; guardrail-adjacent tickets (A-1..A-7 audit track, M-25/26 mirror, auth/M-03) held for orchestrator eyes
- **Git remote (verified):** `forgejo` → ssh://forgejo.stage11.ai:2222/atin/marquee.git (private)
- **Terminal pre-merge status:** `pr_open` (verified in .lattice/config.json stage11 preset)
- **Ticket fidelity:** verbose · **Workflow modes:** fast-track ≤2h mechanical / inline-full default / sub-agent-full for M-02, M-25, M-26, ≥7h tickets
- **Master Validator:** on · **Result Validator:** on · **auto-close surfaces:** on
- **Contract:** SPEC/EVALUATION/BUILDPLAN through Amendment 11; USER_STORIES AC-1–253 (next mint AC-254); binding prototype v1.6; DESIGN.md Flight Deck

## Workspace panes (c11 refs) — REBOUND 2026-08-10 18:35

**c11 restarted between sessions and every ref from Aug 9 is dead.** Current: workspace **workspace:9** "Marquee", pane **pane:16**, Orchestrator **surface:60**. Delegators are tabs of pane:16. Re-run `c11 identify --json` at the start of any resumed session before trusting a ref — the first two launches this evening landed in workspace:3 ("acetate stems") because the old `workspace:16 / pane:56` refs silently resolved elsewhere.


## Tickets in scope

56 tickets MRQ-1..MRQ-56 covering all 72 BUILDPLAN items (commit 8f64ee1); authoritative map: `.lattice/orchestration/ticket-map.md`; validation plan: `validation-plan.md`.

## Active dispatch — SWITCHED TO CLAUDE 2026-08-10 20:55 (operator ruling)

**Operator ruling, recorded on the four live tickets by the Adversary: the build fleet moves Kimi → Claude — Kimi's output was not meeting the bar.** MRQ-4 completed on Claude after the handover and merged as PR #6 (c64a9ba), and its delegator found a real defect in the inherited Kimi code (a seed filter keyed on an unreliable `type` field was seeding "Workshop Afternoon Break" as an accepted abstract and yielding 72 speakers instead of 75). That validates the switch: the inherited work needs judging, not preserving.

| Ticket | Surface | Model | Note |
|---|---|---|---|
| MRQ-8 (M-07) | surface:118 | **opus** | API core — everything inherits its contracts, so it gets the strongest model. Carries the N-7 activation rule. |
| MRQ-3 (M-03) | surface:119 | sonnet | Auth/demo entry. Guardrail: demo login must 403 outside `demo_mode`. Hand review. |
| MRQ-14 (M-13) | surface:120 | sonnet | Uploads. Guardrail: AC-231 presign fails closed. Hand review. |

**Model split rationale:** Bravo is at 84% weekly and resets *after* the deadline, so Opus goes only to the ticket whose contracts every later ticket inherits; Sonnet carries the other two. MRQ-4 proved the Sonnet-implements / stronger-model-reviews pattern works here.

All three inherited uncommitted Kimi work and were briefed with `.lattice/orchestration/boot/HANDOVER.md`: commit the inherited WIP first so it reads as a diff, judge it rather than trust it, rebase onto current master, and push immediately.

### Superseded — resumed on Kimi 2026-08-10 18:35 (autonomous)

| Ticket | Surface | Harness | Note |
|---|---|---|---|
| MRQ-8 (M-07) | surface:101 | kimi | API core, critical chain. Resumed against its committed plan — revalidate, do not re-plan. |
| MRQ-14 (M-13) | surface:102 | kimi | Uploads. Guardrail-adjacent (AC-231) → **never auto-merge**. |
| MRQ-3 (M-03) | surface:103 | kimi | Auth/demo entry. Guardrail-adjacent (demo login must 403 outside demo_mode) → orchestrator eyes at merge. |
| MRQ-4 (M-04a) | surface:104 | kimi | Seed spine, fast-track. MRQ-5 extends it. |


**S-3 verdict (relay into MRQ-8/M-07's boot prompt):** one JSON ID array + `json_each(?)` — a single write query at both 150 and 1,000 rows, 6 ms median — beats ≤90-binding chunking (12 queries, 8.5 ms). Helper dedupes, no-ops on empty, stringifies once, runs once. Local D1 accepts 100 bindings, rejects 101.

**Held despite zero deps:** MRQ-41/42 (craft/closure — late-band by design), MRQ-43/46 (audits — run near their checkpoints), MRQ-54 (S-1 — its band opens at CP-1 and it needs the operator's Airtable base).

## ⚠ RESOURCE ESCALATION — harness quota (raised 2026-08-09 02:50)

Measured via glideslope, not estimated. **Codex weekly: 79% consumed, resets Sat Aug 15 — three days AFTER the Wed Aug 12 22:00 PT deadline.** Burn was ~6 points per 30 min at N=5 high-effort, i.e. roughly **90 minutes of runway** for ~50 remaining tickets. Claude Bravo (this session): 76% weekly, resets Thu Aug 13 — also after the deadline. Kimi: 100% spent, but resets **Mon Aug 10 18:20**, before the deadline. **Claude Alpha: ~untouched 20x Max**, but reaching it is a web `/login` only the operator can perform.

**03:14 update — burn is faster than first measured.** Readings: 27% left at 02:15, 22% at 02:45, **16% at 03:14**. Two implementing codex agents cost ~20 points/hour, so the runway is **~45 minutes**, not the 2.7 hours estimated when two agents were idle-holding. Additional mitigation applied: delegators are now directed to **skip the headless `lattice code-review`** (it spawns a second full codex session per ticket, roughly doubling review cost) and use the own-reviewer fallback, with the Orchestrator independently scanning every diff pre-merge as the compensating control. MRQ-6 additionally told to prioritize the pr-gate + fast test suite and open a partial PR rather than risk landing nothing.

Orchestrator mitigations already applied (no operator input needed): resumed delegators downgraded from sub-agent-full to **inline-full** (no sub-agent tabs); no new spawns while at cap; planners hold at `planned` instead of idling in-session.

**04:05 — CODEX IS EXHAUSTED (96% used, 4% left; resets Sat Aug 15, after the deadline).** It rose 89% → 96% with the fleet fully parked; both idle sessions were read and confirmed genuinely idle, so this is lagging accounting for the two heavy merges (2,394-line schema; 30-file harness), not live burn. **Codex is off the table for the rest of this run.**

The option set has therefore narrowed to two real choices, both requiring the operator:
1. **Alpha login** (`/login` in Claude Code, account `atin@authentic.tech`) — a fresh, untouched Max 20x week. Immediate, and the only option that restarts the wave tonight.
2. **Wait for Kimi's reset, Mon Aug 10 18:20** (~38 h) — a fresh 15x coding week, still ahead of the Wed 22:00 PT deadline, but costs a full day of build time.

Bravo (78% used) is deliberately excluded: it is the pool this orchestrator session itself runs on, so spending it on delegators risks losing orchestration entirely.

**Parked-state integrity confirmed:** both remaining tickets' plans are on disk and committed (e9b29c2) — MRQ-8 at 288 lines, MRQ-14 at 118, each carrying its Plan-Review Cycle 1 Resolutions and the orchestrator rulings. The idle codex sessions were closed after that verification; **no re-planning is needed on any harness**, whichever is chosen.

## ⏳ CAPACITY WALL — Bravo, measured 21:02

Bravo sat at **84–85% across four readings between 20:57 and 21:04**, and it does not reset until **Thu Aug 13 05:00 EDT — after the deadline**. Runway is therefore **roughly 1–2 hours at three agents**, stated as a range on purpose: the weekly figure is reported in whole percent, so a single 5-minute delta cannot distinguish 6 points/hour from 12. (The first estimate here said "~75 minutes" from exactly such a delta — the same over-precision that produced the withdrawn Kimi 10% figure. Measure over a longer baseline before quoting a number.) The finer-grained 5-hour window moved 6% → 8% in ~4 minutes, implying ~3 hours there, so **the weekly is the binding cap, not the session**. Codex is exhausted, Kimi is retired by operator ruling. **Alpha (untouched Max 20x) is the only remaining build capacity in the Constellation.**

**Deliberate call: N was NOT filled to 5.** With a hard wall this close, three tickets finished and merged are worth more than five tickets left half-done — a partial branch at the wall is unmergeable and its work is only recoverable by a future session re-reading it. All three delegators were instead told to cut scope to *mergeable*, run the gate as soon as the core path works, and keep pushing. The one thing explicitly not cuttable: the guardrail proofs (demo login 403s outside `demo_mode`; presign fails closed).

All three inherited-WIP commits are **pushed and verified** against their remote branches, so the wall can only cost in-flight polish, never landed work.

## Contract drift caught at this tick (20:50)

- **Local master had diverged from the remote with three unpushed commits** — the fleet-switch record, the `event` → `conference` rename (9e8b425), and the venue-map commit (13d37eb). Contract and copy changes that exist on one machine are invisible to every worktree; rebased and pushed (38baff5). **This is the second time an unpushed contract commit was found this run.**
- **`MRQ-58` minted:** 222a7fe makes building geography binding for travel-conflict detection, but `buildings` ships without `lat`/`lng`/`access_minutes`. MRQ-2's migration is merged and immutable, so this is a second migration (`0002_*`), which is the correct outcome rather than a defect in M-02.
- **MRQ-5 handoff recorded on its ticket:** `memberships` are unseeded (including the speaker membership SPEC §3.2 grants) and adversarial B-3 (organizer reviewer scopes + round-1 assignments) is required — without both, walkthrough **step 8 dead-ends**.
- **Fleet-wide gap:** the four Kimi sessions produced ~1,900 lines and **zero test files** while `trace:ac` blocks merge on uncovered `auto` ACs. HANDOVER now makes MRQ-4's shipped pattern mandatory — an AC-tagged test plus `tests/ac-claims/<TICKET>.json`.

## Adversarial pass CLOSED (1507bff, pushed as part of 6ae2581)

Full disposition: **8/8 BLOCKING · 22/22 FIX · 8/8 NOTE.** F-13 ruled by the operator (no reset cron — manual only). **The commit existed locally and had never been pushed; found and pushed during this tick** — a contract fix sitting unpushed on one machine is invisible to every delegator worktree.

**N-7 is the live one and it was routed into MRQ-8's resume prompt.** `check:api` asserted single-source parity across served JSON, rendered docs, **and the CLI registry** — but the CLI is M-38 (Tier B rank 19), so as written every PR from Wave 0 onward would fail on a registry no ticket has built. The rule is now: CLI-registry half **activates once `cli/` exists, skipped-with-notice before then**; the served-JSON/rendered-docs half is live from Wave 0. Same shape as `trace:ac` scoping. MRQ-8 owns the route registry and OpenAPI assembly, so **MRQ-8 implements that activation rule** — `check:api` is still a stub today, so nothing is failing yet, but it would have bitten the moment MRQ-8 made it real.

Also folded: AC-233's stale no-waiver sentence; SPEC §4.2's three non-`/api/v1` calendar/feed URLs named as a `check:api` **allowlist, not drift** (also routed to MRQ-8); the e2e split-do-not-delete rule; desktop-only admin SPA as an explicit non-goal; Airtable row-count refresh owner + "as of last_sync_at". No AC renumbered, added, or struck — next mint remains AC-254.

**All four worktrees are on pre-1507bff commits.** Every resume boot file now opens with the same first actions: commit the intact uncommitted work, rebase onto `forgejo/master`, push immediately.

## 🛑 KIMI CANNOT FINISH THIS BUILD — arithmetic, 2026-08-10 18:47

The 5-hour session went **0% → 99% in ~25 minutes** with four delegators. That is the duty cycle: ~25 minutes of four-wide work, then ~4.5 hours idle waiting for the roll — about **8% utilization**.

| | |
|---|---|
| Agent-hours per Kimi window | ~1.7 |
| Windows before the deadline (Thu Aug 13 01:00 EDT) | ~10.8 |
| **Total Kimi agent-hours available** | **~18** |
| BUILDPLAN work remaining | **~180** |
| **Coverage** | **~10%** |

**REVISED 19:50 after measuring the actual output — the 10% figure was too pessimistic and is withdrawn.** Inspecting the four worktrees shows that ~25 minutes of four-wide Kimi produced real implementation, not warm-up:

- **MRQ-8**: eleven modules under `src/api/` (bulk, concurrency, errors, grants, ids, list, manifest, pagination, rate-limit, route, runtime) plus a route manifest — the API core's skeleton.
- **MRQ-3**: ~694 lines of auth library (magic-links, sessions, middleware, scope-resolution, random-token) plus auth and admin-ops routes.
- **MRQ-4**: seed generator started (`_source`, `_sql`, `event`) plus an id helper.
- **MRQ-14**: ~223 lines of R2 library.

That is roughly **a third of each ticket's core in one window** — call it ~1.4 ticket-equivalents per window. Across ~11 windows that is **~15 tickets of 52 remaining, so ~30% coverage, not 10%.**

The error was mine: BUILDPLAN's "agent-hours" are effort estimates, and I wrongly treated them as wall-clock that Kimi had to match. Agents produce far more per wall-clock minute than the estimate implies.

**The conclusion survives the correction, with less drama:** Kimi alone still finishes only about a third of what remains, so **Alpha is still the difference between a complete walkthrough loop and a partial one** — but this is a shortfall to close, not a cliff.

**Alpha (`/login`, `atin@authentic.tech`, untouched Max 20x) is now the only path to a finished build by Wednesday.** This is no longer an optimization — it is the difference between shipping the walkthrough loop and shipping a foundation with a hole in it.

**Worktree state at the cap — DO NOT PRUNE THESE:** all four delegators were cut off with uncommitted work on disk (mrq-8-api 4 files, mrq-14-uploads 3, mrq-3-auth 3, mrq-4-seed 2) and zero commits of their own. Files persist on disk and are safe; a WIP commit was deliberately NOT made on their behalf, to avoid corrupting an in-flight agent's git state. Any resumed agent goes back into the **same worktree** and continues; nothing is re-planned and nothing is re-done.

## Kimi window mechanics (learned 2026-08-10 18:40)

Kimi enforces **two** windows and the tight one is the 5-hour session, not the weekly. Twenty minutes of four delegators spent **56% of the 5 h session but only 11% of the weekly**. So the run's rhythm is: work a session window, stall, wait for the roll (this one rolls 22:20 EDT), resume. Roughly 10 such windows exist before the deadline.

Consequence, and the reason a directive went out immediately: a session cap stops an agent **where it stands**, so an unpushed branch is the only genuinely losable artifact. All four delegators are now instructed to commit at natural boundaries and push as soon as they have one commit worth keeping, rather than at ticket completion. Pushing early is free; being cut off unpushed is not.

Reducing concurrency does NOT stretch a window — the cap is tokens, not agents — so N stays at 4–5 and we get more done per window by running wide.

## Master health (assembled-tree validation, 03:33)

`npm ci && npm run pr-gate -- --ticket MRQ-1` run against **merged master 89241a5**: **PASS in 6.8 s.** This is the check no individual PR performs — each ticket validated its own branch, not the merged result. The gate independently reports **197 live in-scope ACs**, matching the count arithmetic corrected in `EVALUATION.md` at intake. `.gitignore` correctly excludes every artifact the gate emits (`ac-coverage.json`, `speed-report.json`, `artifacts/checks/`, `playwright-report/`, `test-results/`), so no build output can leak into the public repo.

Housekeeping done at the same time: all five merged worktrees removed, their local branches deleted, and their **remote branches deleted on Forgejo** (all HTTP 204) — the repo now has exactly one branch, `master`.

## Schedule reality (computed 2026-08-09 05:10)

BUILDPLAN totals ~209 agent-hours of feature work; roughly 25 h are banked (M-01, M-02, M-05a+M-06, both spikes), leaving **~180 agent-hours** across 52 tickets. At five parallel delegators that is **~36 h of wall-clock critical path**, before review overhead.

- Deadline is Wed Aug 12 22:00 PT = **Thu Aug 13 01:00 EDT**.
- Resuming **now** (Alpha) → ~92 h available for ~36 h of critical path. Comfortable.
- Resuming at **Kimi's Monday 18:20 reset** → ~55 h available for the same ~36 h. Feasible but tight, with no room for a bad day.

**The Alpha login is worth roughly 37 hours of slack.** That is the whole argument for doing it on waking rather than letting Monday arrive.

## Loop cadence change (05:10)

Hourly parked ticks would have cost ~37 wake-ups against **Bravo's remaining 22%** — the same pool this orchestrator runs on — to learn nothing. The dispatch loop is therefore **stopped**, and the Monday resume is armed as a one-shot cron (job `c927e30c`, fires Mon Aug 10 18:27 EDT) carrying the full resume-on-Kimi instructions. An operator message wakes this session immediately regardless, so nothing is lost on the Alpha path. **Caveat: the cron is session-only** — if this Claude session ends, re-arm it or resume manually.

## Operator gates (standing)

1. ~~`wrangler login`~~ — **DEFERRED by operator 2026-08-09 02:25 ("put demo credentials in, I'll deal with that tomorrow"). Carved out as MRQ-57**; MRQ-1 ships locally-validated with placeholder resource IDs. Everything the operator must do is enumerated in MRQ-57's description. The deployed URL a judge opens comes from MRQ-57, so it cannot slip past Tuesday.
2. **S-2 oracle (MRQ-55, `needs_human`, code already merged):** open `benevolent.futures@gmail.com` and judge the `[S-2 spike]` triplet — 1/3 should show **Accept/Decline**; 2/3 should **replace** the 15:00 entry with 16:00 (not duplicate); 3/3 should **remove** it. Then supply an Outlook address and an Apple-backed address; re-run is `node send.mjs <address>` from `spikes/s2-ics-clients/`. Sent 06:21 UTC, all three delivered per Resend.
3. Airtable Team + two bases (blocks S-1/MRQ-54, then M-25/M-26); Resend tier check; real Sessionize export (M-30); model credential (M-47).

## Decision log (append-only)

- 2026-08-09 [moderate] Board staged without dispatch — operator directive ("lay it out, don't launch").
- 2026-08-09 [moderate] Private Forgejo repo `atin/marquee` created + master pushed (signed decision 4); remote name `forgejo`.
- 2026-08-09 [moderate] Lattice init: stage11 preset, project MRQ.
- 2026-08-09 [moderate] v1.6 judgment call (a) ratified: Buildings/Rooms settings cards span full row (legibility over grid-2 symmetry).
- 2026-08-10 18:35 [AUTONOMOUS — pre-authorized] **Fleet resumed on Kimi.** Its weekly window reset clean (0% used, next reset Mon Aug 17) and no harness ruling had arrived, so the operator's own standing authorization applied: waiting past a free reset costs more than acting with ~54 h to the deadline. Resumed MRQ-8 and MRQ-14 from their committed plans, then filled to four with MRQ-3 (auth) and MRQ-4 (seed spine) — the only newly-unblocked tickets worth the slots. Codex remains at 100% and unusable; Bravo untouched for delegation by design.
- 2026-08-10 18:33 [moderate] Ref rebinding after the c11 restart (see Workspace panes). Two agents were launched into another project's workspace before this was caught; both were closed before doing work and relaunched correctly. COMMON.md's reporting address corrected to workspace:9 surface:60 and the contract made harness-neutral.
- 2026-08-09 05:10 [moderate] Codex at **100%**. Dispatch loop stopped and replaced with a one-shot cron for Kimi's Monday reset (c927e30c) — hourly parked ticks would have spent Bravo's remaining quota to observe a static board. Schedule math computed and logged: Alpha tonight buys ~37 h more slack than waiting for Monday.
- 2026-08-09 04:05 [moderate] Codex confirmed exhausted (96%). Verified both parked plans committed with their resolutions, then closed surfaces 202/203 — idle codex sessions on a dead quota serve nothing and invite an accidental resume. Decision set narrowed to Alpha login or Kimi's Monday reset.
- 2026-08-09 03:33 [moderate] Parked-tick housekeeping (zero model spend): verified no stranded work in any worktree, confirmed every merged artifact is present in master, pruned five worktrees + five local + five remote branches, and ran the pr-gate against merged master — PASS. Codex 89% at this reading; **fleet remains parked, no ruling yet**. Decision NOT to spawn Claude delegators on Bravo: Bravo (78%) is the same pool this orchestrator session runs on, so spending it on delegators risks losing orchestration itself. Alpha (fresh 20x, operator login) or Kimi (resets Mon 18:20) remain the real options.
- 2026-08-09 03:20 [moderate] **MRQ-2 and MRQ-6 both merged** (PR #5 616f55e6, PR #4 09aa26ad) — the quota triage worked: both high-value tickets landed before the floor. Master now carries the skeleton, the complete D1 schema, the design tokens/admin shell, and the full check harness. `npm run pr-gate -- --ticket MRQ-N` verified present and folded into COMMON as mandatory. **CP-1's deliverables are effectively met except M-07/M-08.**
- 2026-08-09 03:14 [moderate] **Quota triage:** headless code-review suspended fleet-wide (own-reviewer + orchestrator diff scan instead); MRQ-6 given an explicit land-partial priority order (pr-gate + fast suite first). MRQ-8/MRQ-14 stay parked at `planned` — no new codex spend until the operator rules. Remaining Codex is being spent deliberately on the schema (critical chain) and the harness (every later ticket depends on it).
- 2026-08-09 03:02 [moderate] **SPEC Amendment 12 written** (f80d383) ratifying MRQ-2's flagged delta: `attachments.sha256` NULLABLE, `r2_etag` added, `draft_file`/`submission_file` relations indexed. Living-artifacts norm — the implementation was right and the contract was stale, so the contract moved. No AC minted (serves AC-52/146-148/231/232); next mint remains AC-254. Delegator told to stop carrying it as a deviation.
- 2026-08-09 02:56 [moderate] **MRQ-1 merged** (PR #3, squash 44a3fab) — the skeleton is now master and MRQ-6 was resumed on a clean branch off it. MRQ-2 remains stacked on the pre-merge branch and must rebase with `--onto` before its PR.
- 2026-08-09 02:55 [moderate] MRQ-14 plan-review consequences dispatched: **schema deltas relayed to MRQ-2 mid-implementation** (sha256 nullable, r2_etag, draft_file/submission_file) so they land in the single init migration rather than forcing a second one; six real-bucket-only assertions + the M-01 seams folded into MRQ-57's description. MRQ-14 adds the code-side seams (S3 env declarations, cron dispatch, media host, Worker-first routing) in its own PR — MRQ-1 was NOT reopened.
- 2026-08-09 02:50 [moderate] **Quota escalation raised** (flag + operator summary). Codex 79% weekly with no pre-deadline reset. Mitigations applied unilaterally: resumed tickets run inline-full not sub-agent-full; no spawning above cap.
- 2026-08-09 02:49 [moderate] MRQ-8 rulings: CAS-over-transactions ACCEPTED (D1 has no interactive transactions; CAS becomes a named API-core primitive); **M-07 re-estimated 4h -> 7h, scope NOT cut** (agent-native API is a moat feature and every later ticket inherits its contracts); CP-1 accordingly D+15 -> **D+18**.
- 2026-08-09 02:48 [moderate] MRQ-6 rulings: AC-69 speed row SPLIT into 7 failing AC-sourced budgets + 7 warn-only client-signed objectives (no new AC minted — implementation detail of existing rows); local pr-gate command adopted because private Forgejo has no CI runner, to be folded into the delegator contract once MRQ-6's plan lands.
- 2026-08-09 02:47 [moderate] MRQ-2 rulings: plural API-token event grants stay inside the existing scopes JSON (no 47th table, SPEC §3.2 unamended); resumed to implementation on a worktree cut off MRQ-1's **in-review** branch (press-ahead stacking) rather than waiting for merge, since M-02 is the critical chain.
- 2026-08-09 02:41 [moderate] Press-ahead audit on MRQ-1 → `review`: MRQ-14 (M-13 uploads) was the only newly-unblocked ticket; spawned planning-only. Fleet at N=5 (1 impl + 4 planners).
- 2026-08-09 02:36 [moderate] Press-ahead: MRQ-8 (M-07, CP-1 chain) spawned planning-only with the S-3 verdict inlined; 4 of 5 slots active.
- 2026-08-09 02:34 [moderate] MRQ-55 (S-2) merged, PR #2 squash 3ef7c647. Review named 2344974 vs head e67476e — resolved as rebase-only: identical tree hash b5d6c73, so review evidence valid. Secret scan clean (key read from env, recipient parameterized, no personal address in the diff). `needs_human` left standing — the client-rendering half is an operator oracle, not agent-verifiable.
- 2026-08-09 02:30 [moderate] MRQ-56 (S-3) merged, PR #1 squash 4f429473 — first PR of the run; auto-merge criteria verified (head≠base, fresh self-review PASS naming HEAD, .merged==true re-GET, diff confined to spikes/).
- 2026-08-09 02:27 [moderate] Press-ahead: MRQ-6 spawned planning-only into the freed slot (deps only on MRQ-1).
- 2026-08-09 02:26 [operator] **Cloudflare deploy deferred to tomorrow** — placeholder credentials, local `wrangler dev` validation, deploy carved out as **MRQ-57** (depends MRQ-1, MRQ-2). MRQ-1's merge no longer gated on deploy.
- 2026-08-09 02:15 [moderate] **Dispatch executed.** First wave: MRQ-1, MRQ-2 (planning-only), MRQ-55, MRQ-56 — 4 of 5 slots; 5th held for press-ahead when MRQ-1 advances. Codex `--yolo` high effort, all suppressed, reporting to surface:128.
- 2026-08-09 [moderate] Mint ambiguities ratified: Amendment 10/11 fold (EVALUATION §2.3 rows added for AC-251–253), CP-1 chain 13h→15h (BUILDPLAN §2/§10 corrected), trace:ac single owners (AC-155–157→MRQ-37, AC-146–148→MRQ-24), M-51 numbering skip noted. Commit bed8486.
- 2026-08-09 [operator] **Fleet launch authorized** — dispatch begins the moment the Mint agent's board passes verification. Orchestrator = surface:128; all build work on codex.
- 2026-08-09 [moderate, operator-delegated] Venue seeding ruled: Sheraton-coherent trio (Sheraton main · Workshop Annex · Online) replaces "real 2025 four" in SPEC Amendment 11; §6 gains the buildings→rooms map. §6 rooms were already Sheraton-native, so this was the only consistent option.
- 2026-08-09 [operator] N concurrent delegators 6 → 5.
- 2026-08-09 [moderate] Ticket consolidation ruled after operator challenged count. True BUILDPLAN board = 72 items (58 feature incl. splits, 11 audits, 3 spikes; earlier "56" was an undercount of the amended plan). Orchestrator's 34–40 target was arithmetically unreachable under its own ≤10h merge cap (~209–258 feature-hours / 10h + 14 unmergeable = floor ~40 at perfect packing). Final rule: 10h cap kept; lever added — same-wave identical-dep pairs may merge across module surfaces; M-04a/b stay split (B-5 protects CP-1 chain); audit track stays standalone (independence is the design). Target high-40s. Mint proceeding without further ack round.

## Run-time footguns

| Symptom | Cause | Mitigation |
|---|---|---|
| Agents launch "successfully" into the wrong project's workspace | c11 restarts renumber surfaces/panes/workspaces; a stale `--workspace/--pane` does not error, it resolves somewhere else | **Re-run `c11 identify --json` and `c11 tree --all` at the start of every resumed session**, before any launch or send. Also re-point the delegator contract's reporting address (2026-08-10; two agents landed in "acetate stems"). |
| A Kimi agent shows the boot prompt on screen but never acts, context stuck near 0% | Kimi's **"Trust this folder?"** dialog swallows the argv prompt entirely — accepting it does NOT replay the prompt | After `launch-agent --type kimi`: `send-key enter` to accept trust, THEN resend the prompt with `c11 send ... "$(cat <boot file>)"` and a second `send-key enter`. Verify by watching context climb past ~10%. |
| Codex delegator HALTs on the line-1 cwd guard with a correct-looking path | A scratchpad path under `/private/tmp` did not match what the spawned shell reported; the guard is exact-match so any resolution difference is fatal | Put sandbox/worktree paths under the project's own tree (`Marquee-worktrees/<slug>`), never `/tmp`. Every guard now prints `actual: $(pwd)` on failure so the next halt is self-diagnosing (2026-08-09, MRQ-2 planner, cost: one relaunch). |
| A launched codex agent shows a full context read but never claims its ticket, sitting at what looks like an idle prompt | Codex's **directory-trust dialog** ("Do you trust the contents of this directory?") blocks the argv prompt entirely on any newly-created cwd; `--yolo` does not bypass it. Git worktrees of an already-trusted repo do not trigger it — fresh sandbox dirs always do | After EVERY `launch-agent` into a new directory, `read-screen` once and `send-key enter` if the trust dialog is up. Budget ~10s before the check (2026-08-09, MRQ-2/6/8 planners, all three parked). |
| `git rebase` in the root checkout fails "cannot rebase: You have unstaged changes" during a tick | The root checkout's `.lattice/` **is the live board** — delegators write events continuously, so unstaged changes reappear microseconds after any `git add` | Always `git pull --rebase --autostash forgejo master`. Never `stash` by hand, never `reset --hard` this checkout (2026-08-09, twice in one tick). |
| A `c11 send` message arrives mangled, and stray command output appears in the orchestrator's shell | Backticks inside a **double-quoted** bash string are command substitution — the message text runs as a command and its output replaces the span | Quote every `c11 send` payload with single quotes, or drop backticks entirely. Re-send a correction if it already went out (2026-08-09, MRQ-6 resume message). |
| A codex pane looks idle but is working | The line under the transcript is codex's placeholder input hint ("› Write tests for @filename"), not a returned prompt | Judge liveness by the `• Working (Ns)` line and a moving context/cost counter, never by the hint line. |
