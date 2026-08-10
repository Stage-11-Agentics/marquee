# Marquee — Tone Run State

**Project:** Marquee — open-source speaker/session management platform for conference organizers (Sessionboard replacement).
**Home:** `~/Projects/Stage11/deployments/Marquee` (local git initialized 2026-08-08; canonical remote TBD — competition requires a public open-source repo, which conflicts with the Forgejo-private default; decide with Atin before pushing).
**Context:** Entry into swyx's "$10,000 Kill My SaaS" hackathon (AI Engineer / latent.space team). Deadline: **Wednesday 2026-08-12, 10PM PT**. Judged by AIE team against a walkthrough video, on a deployed site + open-source repo.

## Current stage & phase

- **Stage:** tone-prototype v1.4 client review gate / tone-architect contract reconciled (2026-08-09).
- **State:** Pipeline v1.4 is complete in place (legacy path `prototypes/pipeline-v1.1/index.html`): multiple independent forms; complete CFP participant/profile/file/conditional fields; open/closed/at-limit/resumed states; real acknowledge/form/file portal tasks; decision feedback and one-off mail; reviewer full detail plus score-optional Approve/Maybe/Deny and explicit track scopes; saved personal views; configurable columns; and a role-gated Drafts needing attention queue. Program board remains read-only with record-owned actions. `USER_STORIES.md`, `SPEC.md`, `EVALUATION.md`, and `BUILDPLAN.md` now agree through 248 live criteria / AC-249 (AC-239 struck).
- **THE GATE:** Atin drives v1.4 → love/iterate/sign. Then: mint `DESIGN.md` from the signed prototype → adversarial contract pass → lattice-orchestrator kickoff with a **Codex build fleet**. Do not dispatch before that gate.
- **Externals still open:** Discord relay (Sat video, Sun freeze video, Q1/Q2 posts); account checks (Workers Paid, R2 entitlement, Resend tier, Airtable Team ×2 bases); gate materials (Gmail/Outlook/Apple inboxes, real Sessionize export, CF API token, model credential).

## Commission facts (from Atin, 2026-08-08)

- Target to replace: **Sessionboard.com** (speaker/session management for event organizers, >$40k/yr).
- **Organizer-first**, but the product touches all seats (organizer, speaker, reviewer, attendee-facing outputs).
- **Open source** platform, generalizable to many conferences — but it will be used by a **real conference** (the AIE team's).
- End goal beyond the competition: a completely fully functional working product.
- Sequence agreed: understand problem area (user stories, stakeholders, existing-product features) → core product offering → build plan + HTML prototypes → build.

## Competition brief digest (source: `sequence/research/sources/competition-brief.md`)

Six active features (CFP forms w/ conditional logic; speaker portal; automated comms + calendar invites; evaluation/scoring w/ optional AI review; drag-and-drop schedule builder w/ conflict detection + list/day/week/track/room views; onboarding-status dashboard). Three struck: Accelevents integration, wiki/resource pages, embeddable gallery. Walkthrough video = de facto spec; more videos Sat + Sun, then **requirements freeze**. Stack: free choice; mild bonus Cloudflare, bonus Airtable persistence. $500 token reimbursement for valid submissions. Winner: $10k + latent.space writeup.

## Decisions log

- 2026-08-10: **Build fleet switches Kimi → Claude.** Kimi's output is not meeting the bar; remaining tickets move to Claude. Handover state recorded as a comment on each live ticket (MRQ-3, MRQ-4, MRQ-8, MRQ-14): exact untracked file inventory with line counts, the contract findings each branch must re-verify against, and the `1507bff` rebase requirement. **Two facts a successor needs:** (1) **none of the four delegators committed anything** — ~1,900 lines exist only as untracked working-tree state, with no PR and no history; (2) **zero test files across all four**, while `trace:ac` blocks merge on uncovered `auto` ACs. Also latent: MRQ-8 and MRQ-14 both edit `package.json` + `package-lock.json`, which `BUILDPLAN.md` §7 reserves to M-06 through the orchestrator. (Atin, recorded by Adversary)
- 2026-08-10: **Adversarial pass fully closed — 8/8 BLOCKING · 22/22 FIX · 8/8 NOTE.** The NOTE band was re-verified against current files and N-2 – N-7 applied (N-1/N-8 were already folded into B-1/B-6). Load-bearing one was **N-7**: `check:api` asserted CLI-registry parity on every PR from Wave 0 while the CLI is rank 19 — it now skips that half with a printed notice until `cli/` exists (M-38), which unblocks the live delegators' PRs. Also: AC-233's stale no-waiver sentence corrected, the three non-`/api/v1` calendar/feed URLs named as an allowlist, an e2e split-do-not-delete rule added, desktop-only admin SPA recorded as a non-goal, and Airtable row counts given a refresh owner + "as of last sync" labelling. (Adversary)
- 2026-08-09: **Skin picked: Flight Deck** (skin-c). Skins agent reskinning the prototype in place -> v1.5; holds exclusive file lock on prototypes/pipeline-v1.1/index.html until it reports done. DESIGN.md minted. (Atin via Skins agent)
- 2026-08-09: **F-13 ruling: NO unattended reset cron.** Reset stays manual (button + `npm run reset:demo`, AC-230); during the judging window the team resets morning/evening by hand. A judge watching state vanish mid-read is a worse failure than inheriting a predecessor's edits. (Mabel, decide-and-log)
- 2026-08-09: **F-10 ruling: acknowledged divergence** — SPEC §5.5's on-screen portal magic link is built per spec though absent from the v1.4 prototype; tagged so the fidelity audit passes it. (Mabel, decide-and-log)
- 2026-08-09: **Adversarial cycle complete**: 8/8 BLOCKING + 21/22 FIX applied (e35b32a, 6aed313); arithmetic reconciled (194 in-scope live, next mint AC-251). (Editor)
- 2026-08-09: **Context-coverage closure approved** — add full form/portal/reviewer demonstrations plus saved views, configurable columns, and Draft queue; make all pre-build contract repairs. AC-245–249 minted; downstream contract reconciled. (Atin)
- 2026-08-09: **No Month view and no generalized CMS** — Month was only a reference-image label; generalized CMS was optional/R8-skipped. Narrow Handbook and embeds remain. (Atin)
- 2026-08-09: **Speed budgets signed as OBJECTIVES** — the seven proposed §1.3 numbers report + warn, never fail CI; AC-sourced budgets remain binding. (Atin)
- 2026-08-09: **Board ruling (client): NO drag** — AC-239 struck, AC-243 ratified; consequential actions live on the detail screen. (Atin)
- 2026-08-09: **F-2 CLOSED — seed A′ confirmed** (real Feb-2025 sessions + CODE-2025 roster → ~150 accepted, zero fabricated accepted people). (Atin)
- 2026-08-09: **API comparison folded** (Amendments 6–7): four pre-kickoff API gaps + pinned semantics + webhooks behind Tier A (AC-241) + scoped tokens (AC-242); reviewer full-detail AC-244 minted from client feedback; v1.4 in flight. (Mabel)
- 2026-08-08: **Board interaction refined (canonical AC-238/AC-243; AC-239 struck)** — no board drag or card actions; filters are expanded and composable, cards open exact records, and lifecycle buttons live on record pages. Agenda drag remains. Earlier notes that called these AC-241/242 were an ID-allocation defect and are superseded. (Atin + Codex)
- 2026-08-08: **Pipeline v1.3 completed** — program board, scheduled/public slot legibility, publish affordances, clarifying pipeline labels, and ≥15% multi-track seed coverage are implemented and Playwright-verified at full mock scale. (codex)
- 2026-08-08: **Pipeline v1.2 completed** — all 24 specified screens/states represented, no stub-toast affordances, five finished agenda views, live Event Settings collections, Sessionize import, comms/outbox, reversal cascade, Airtable/API surfaces, multi-track AC-234, and portal talk editing AC-237. Playwright gate passed; client drive remains the love gate. (codex)
- 2026-08-08: Project named Marquee, homed at `deployments/Marquee`. (Atin)
- 2026-08-08: Anchor competitive research on Sessionboard as the reference product. (Atin)
- 2026-08-08: Timeline compresses the Tone arc to ~4 days end-to-end; depth stays proportional to stakes but phases run fast and overlapping. (logged, Mabel)
- 2026-08-08: **Philosophy signed** (PRODUCT-DEFINITION decision 1): one-thing = "fantastic conferences, effortlessly"; respect-the-operator principles; plus **agent-native by design** — real API, `marquee` CLI, shipped skill file; agents are first-class operators. `PHILOSOPHY.md` minted. (Atin)
- 2026-08-08: Clone target reconfirmed explicitly: **Sessionboard's Program module** per the brief; Sessionize is competitive context (judges' daily tool), not the target. (Atin + brief)
- 2026-08-08: **Rounds (decision 2 part):** minimal 2-round funnel UI committed high in Tier B; round-aware schema from first migration. (Atin, interview)
- 2026-08-08: **Stack (decision 3):** Cloudflare Workers + D1 source of truth + R2/Queues/Turnstile, genuine two-way Airtable mirror off the request path, Resend, ICS METHOD:REQUEST, roll-our-own magic-link auth. Committed without waiting for the Q1 Discord ruling (we'd build the mirror under either answer). (Atin, interview)
- 2026-08-08: **Repo/license (decision 4):** develop private on Forgejo; public GitHub `marquee` repo pushed near submission (~Tuesday); **Apache-2.0**. Research/strategy docs curated before the public push. (Atin, interview)
- 2026-08-08: **Domain (decision 6):** stage11 infrastructure only — app at `marquee.stage11.dev`, outbound mail from `marquee@stage11.systems`. No fresh domain; deadline-trap 5 closed, action item 4 dropped. (Atin, interview)
- 2026-08-08: **Strategic intent:** one-off competition play (hosted-for-fee possible later, not designed for now). Optimize purely for the judges' Wednesday experience. (Atin, interview)
- 2026-08-08: **Demo seeding:** faithful AIE replica, grounded in the real 2025 NYC event's public program (Seed Source agent capturing); ~1,000 fabricated submissions shaped like the real distribution. (Atin, interview)
- 2026-08-08: **Comparison-mode triage: in scope**, Tier B (simple win-count aggregation). (Atin, interview)
- 2026-08-08: **Name confirmed: Marquee** — collisions with npm/GitHub explicitly don't matter; this is a competition entry. (Atin, interview)
- 2026-08-08: **No entrant video required** — submission = form + repo + deployed site; the walkthrough videos are the organizers' test script. (brief, confirmed to Atin)
- 2026-08-08: **Timeline set by Atin:** HTML prototypes done TONIGHT → build kicked off overnight (tone-architect contract compressed into late tonight, then lattice-orchestrator) → QA tomorrow (Sun), Sunday video may add requirements → polish Mon/Tue → public push ~Tue → submit Wed.
- 2026-08-08 (night): **Build fleet runs on Codex agents** — Atin directive: implementation work in the orchestrated build uses codex workers (as the prototypes did). Research/drafting agents may remain Opus. (Atin)
- 2026-08-08 (night): **Contract flags F-1/F-5/F-6/F-3 resolved by AC appendix** — AC-225..233 dispatched to the stories agent (mirror US-72, reset-demo US-73, Turnstile/upload-safety on US-14/US-41, handbook AC-233 below cut line). **F-2 (seed A′) and F-4 (v1.1 toast affordances) await Atin's v1.1 review**, bundled with the seven proposed speed budgets. (Mabel, full-ahead)
- 2026-08-08: **Surfaces note:** Atin closed the Brief Research (was surface:130) and Landscape Features (was surface:132) tabs post-completion. Their dossiers are committed; dossier maintenance against the Sat/Sun videos needs a fresh agent when the videos land. Discord pastes now come to the orchestrator (surface:128).

## Historical research agents (completed; none currently active)

- **Brief Research** (surface:130): competition-requirements authority → `sequence/research/competition-requirements.md`. **First pass complete 2026-08-08** (R1–R50). Stays alive for Discord pastes + Sat/Sun videos. Prompt: `sequence/research/sources/AGENT-BRIEF-competition-research.md`.
- **Landscape Features** (surface:132): **First pass complete** — feature matrix keyed to R-numbers, deep profiles (Sessionize corrected: $499/event, has collision detection + undocumented "calendar placeholders"), D1–D15 differentiator ranking, pretalx threat read (5 structural misses), vocabulary crib, L1–L4 new open questions.
- **Stakeholder Stories** (surface:133): **First pass + follow-up complete** — 15 seats, 67 stories (US-66 Sessionize mid-CFP migration, US-67 quick-search added), 45-story MVP. Sessionize API is accepted-only by default → importer eats Export spreadsheets, idempotent.
- **Seed Source** (this surface): **Complete** → `sequence/research/seed-source-2025.md` + machine-readable `sequence/research/sources/aie-summit-2025-program.json`. Chose **AI Engineer Summit NYC, Feb 19–22 2025** as the seed source (AIE's own site calls it "the flagship AI Engineer Summit held in NYC"; it's the ~150-speaker "AIE New York" budget line; its 2025 theme was already finance-forward — Jane Street/BlackRock/Bloomberg/Morgan Stanley — matching NYC 2026's "Where AI Engineering Meets Wall Street"; and it is the **only** AIE NYC event with a published session-level grid). Full 76-item grid recovered from the page's embedded JSON: 60 real speaker-bearing sessions, 75 speakers, 58 companies, 8 rooms across 4 buildings, exact timing grid. CODE Summit Nov 2025 captured as secondary (89-name roster, category taxonomy, 4-day shape). Recommends 1,000 submissions / 60 accepted = **6.0%**, inside AIE's published 5–15%.
- **Seams Feasibility** (surface:134): **First pass complete** — Airtable/Cloudflare/email/ICS/auth with hard numbers, 16 deadline traps, 33–54h seams estimate. Q1 bet: D1 source of truth + genuine two-way Airtable mirror (never read Airtable on a request path). Q9 confirmed: ICS METHOD:REQUEST; OAuth infeasible by deadline.

## Key findings so far (from Brief Research first pass)

- Speed is a graded feature (swyx complains 3x unprompted); AI review is explicitly de-prioritized ("I don't care about the AI workflow thing", 09:23) — a trap for other entrants.
- Real deployment target: **AIE NYC 2026** (Oct 12–14, ~150 speakers, 1k–3k submissions, 5–15% acceptance). AIE runs on **Sessionize** today, not Sessionboard. Competitive frame: "Sessionize's scope, self-hosted, owned, faster, plus post-acceptance workflow."
- Judge is likely AIE's program/ops person. Evaluation = driving the deployed site through the walkthrough loop; seeded demo data essential; 647 entrants registered.
- Core data model: Abstracts (apply to speak) vs Sessions (guaranteed, e.g. sponsors) — video-only, easy to get wrong.

## Retro notes (for run-retro, not action items)

- Monitor false positive ×2 (2026-08-09): a completion-phrase monitor on a builder's screen matched the orchestrator's *own instruction text* echoed in the terminal; the `grep -v "print exactly"` exclusion then ALSO failed because terminal line-wrapping split the exclusion phrase onto a different line than the match. Real fix: **never watch a terminal for a phrase the orchestrator itself sent** — watch the artifact (file markers) or a side-channel (c11 send, metadata key) instead. Generalize into the c11 orchestration reference at retro.

## Human action items (updated from EVALUATION.md §1.6, 2026-08-08 night)

New (for the oracle smokes and gate — needed before Tuesday):
- Real inboxes for the ICS chain: one Gmail, one Outlook, one Apple Calendar.
- One real Sessionize export file (any event) to validate the importer fixture (AC-109).
- A Cloudflare API token for CI (`check:readme` scratch deploy) + a model credential for `check:skill-agent`.

## Earlier action items (from Seams first pass, 2026-08-08)

1. Verify/enable **Workers Paid** ($5/mo) on the Cloudflare account (Free's 10ms CPU cap breaks SSR; fails at deploy, not in dev).
2. **Create an R2 bucket and fetch a public object now** — Stage 11's R2 entitlement has silently lapsed account-wide before (403s every public URL; dashboard-only fix).
3. Check **Resend plan tier** (30s in dashboard) — Free's 100/day cap decides how urgent the outbox/demo-safe mode is.
4. If a bespoke sending domain (e.g. a marquee.* domain) is wanted: register + verify **Saturday or not at all**. Default: send as `marquee@stage11.systems` (verified since March).
5. Airtable needs **Team plan or above** and now **two bases**: the demo base (seed mirror, judge-visible) and a dedicated `check:mirror` test base (the suite writes destructively — EVALUATION precondition 9). ⚠️ Seed Source confirms the target is **exactly 1,000 submissions** — dead on the Free cap, before speakers/sessions/evaluations are counted. Treat the plan upgrade as required, not optional.

## Touchpoints

- **OPEN (urgent, relayed to Atin 2026-08-08):** Discord relay needed — both clarification videos (Sat + Sun) are unlisted, announced only in Discord; requirements freeze after Sunday's. Also Q1 (Airtable primary vs mirror) and Q2 (embed gallery: struck in brief vs described in video) need rulings.
- Pending: stories review (Phase 4) — after fan-out consolidation.
- Pending decision with Atin: public GitHub repo (competition requirement) vs Forgejo-private default.

## Stats

- Human touchpoints: 2 (commission Q&A; brief handoff)
- Agents spawned: 4
