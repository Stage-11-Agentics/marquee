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

## Workspace panes (c11 refs)

- main_view_area: pane:39 (Orchestrator surface:128)
- control_surface: pane:55 (Lattice Board browser surface:193; dashboard port **56248**)
- delegate_view_area_1: pane:56 · delegate_view_area_2: pane:57 (soft cap 15 surfaces/pane; route to lightest)
- operator review browsers: pane:54

## Tickets in scope

56 tickets MRQ-1..MRQ-56 covering all 72 BUILDPLAN items (commit 8f64ee1); authoritative map: `.lattice/orchestration/ticket-map.md`; validation plan: `validation-plan.md`.

## Active dispatch

| Ticket | Surface | Mode | Note |
|---|---|---|---|
| MRQ-1 (M-01) | surface:196 pane:56 | inline-full | **`review`**; deploy deferred to MRQ-57, local validation is the merge bar. Context at 75% — watch for compaction. |
| MRQ-2 (M-02) | surface:200 pane:56 | **implementing** (inline-full) | worktree `Marquee-worktrees/mrq-2-schema`, branch stacked on `mrq-1-platform-skeleton`; PR body must name the anchor |
| MRQ-6 (M-05a+06) | surface:201 pane:57 | **planned**, holding | rulings sent; awaiting worktree |
| MRQ-8 (M-07) | surface:202 pane:57 | **planned**, holding | re-estimated 7h; CAS primitive; awaiting worktree |
| MRQ-14 (M-13) | surface:203 pane:56 | planning-only press-ahead | uploads/presign; unblocked by MRQ-1 reaching review. Guardrail-adjacent (AC-231) → held for orchestrator eyes at merge |
| ~~MRQ-55 (S-2)~~ | closed | **done** | **MERGED** PR #2 (3ef7c647). Code done; `needs_human` stands for the client-rendering oracle. |
| ~~MRQ-56 (S-3)~~ | closed | **done** | **MERGED** PR #1 (4f429473). Verdict below. |

**S-3 verdict (relay into MRQ-8/M-07's boot prompt):** one JSON ID array + `json_each(?)` — a single write query at both 150 and 1,000 rows, 6 ms median — beats ≤90-binding chunking (12 queries, 8.5 ms). Helper dedupes, no-ops on empty, stringifies once, runs once. Local D1 accepts 100 bindings, rejects 101.

**Held despite zero deps:** MRQ-41/42 (craft/closure — late-band by design), MRQ-43/46 (audits — run near their checkpoints), MRQ-54 (S-1 — its band opens at CP-1 and it needs the operator's Airtable base).

## ⚠ RESOURCE ESCALATION — harness quota (raised 2026-08-09 02:50)

Measured via glideslope, not estimated. **Codex weekly: 79% consumed, resets Sat Aug 15 — three days AFTER the Wed Aug 12 22:00 PT deadline.** Burn was ~6 points per 30 min at N=5 high-effort, i.e. roughly **90 minutes of runway** for ~50 remaining tickets. Claude Bravo (this session): 76% weekly, resets Thu Aug 13 — also after the deadline. Kimi: 100% spent, but resets **Mon Aug 10 18:20**, before the deadline. **Claude Alpha: ~untouched 20x Max**, but reaching it is a web `/login` only the operator can perform.

Orchestrator mitigations already applied (no operator input needed): resumed delegators downgraded from sub-agent-full to **inline-full** (no sub-agent tabs); no new spawns while at cap; planners hold at `planned` instead of idling in-session.

**Decision needed from the operator** — see the summary in the session for options (throttle vs. Alpha login vs. wait for Kimi Monday evening vs. mixed).

## Operator gates (standing)

1. ~~`wrangler login`~~ — **DEFERRED by operator 2026-08-09 02:25 ("put demo credentials in, I'll deal with that tomorrow"). Carved out as MRQ-57**; MRQ-1 ships locally-validated with placeholder resource IDs. Everything the operator must do is enumerated in MRQ-57's description. The deployed URL a judge opens comes from MRQ-57, so it cannot slip past Tuesday.
2. **S-2 oracle (MRQ-55, `needs_human`, code already merged):** open `benevolent.futures@gmail.com` and judge the `[S-2 spike]` triplet — 1/3 should show **Accept/Decline**; 2/3 should **replace** the 15:00 entry with 16:00 (not duplicate); 3/3 should **remove** it. Then supply an Outlook address and an Apple-backed address; re-run is `node send.mjs <address>` from `spikes/s2-ics-clients/`. Sent 06:21 UTC, all three delivered per Resend.
3. Airtable Team + two bases (blocks S-1/MRQ-54, then M-25/M-26); Resend tier check; real Sessionize export (M-30); model credential (M-47).

## Decision log (append-only)

- 2026-08-09 [moderate] Board staged without dispatch — operator directive ("lay it out, don't launch").
- 2026-08-09 [moderate] Private Forgejo repo `atin/marquee` created + master pushed (signed decision 4); remote name `forgejo`.
- 2026-08-09 [moderate] Lattice init: stage11 preset, project MRQ.
- 2026-08-09 [moderate] v1.6 judgment call (a) ratified: Buildings/Rooms settings cards span full row (legibility over grid-2 symmetry).
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
| Codex delegator HALTs on the line-1 cwd guard with a correct-looking path | A scratchpad path under `/private/tmp` did not match what the spawned shell reported; the guard is exact-match so any resolution difference is fatal | Put sandbox/worktree paths under the project's own tree (`Marquee-worktrees/<slug>`), never `/tmp`. Every guard now prints `actual: $(pwd)` on failure so the next halt is self-diagnosing (2026-08-09, MRQ-2 planner, cost: one relaunch). |
| A launched codex agent shows a full context read but never claims its ticket, sitting at what looks like an idle prompt | Codex's **directory-trust dialog** ("Do you trust the contents of this directory?") blocks the argv prompt entirely on any newly-created cwd; `--yolo` does not bypass it. Git worktrees of an already-trusted repo do not trigger it — fresh sandbox dirs always do | After EVERY `launch-agent` into a new directory, `read-screen` once and `send-key enter` if the trust dialog is up. Budget ~10s before the check (2026-08-09, MRQ-2/6/8 planners, all three parked). |
| `git rebase` in the root checkout fails "cannot rebase: You have unstaged changes" during a tick | The root checkout's `.lattice/` **is the live board** — delegators write events continuously, so unstaged changes reappear microseconds after any `git add` | Always `git pull --rebase --autostash forgejo master`. Never `stash` by hand, never `reset --hard` this checkout (2026-08-09, twice in one tick). |
| A codex pane looks idle but is working | The line under the transcript is codex's placeholder input hint ("› Write tests for @filename"), not a returned prompt | Judge liveness by the `• Working (Ns)` line and a moving context/cost counter, never by the hint line. |
