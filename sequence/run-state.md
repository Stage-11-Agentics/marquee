# Marquee — Tone Run State

**Project:** Marquee — open-source speaker/session management platform for conference organizers (Sessionboard replacement).
**Home:** `~/Projects/Stage11/deployments/Marquee` (local git initialized 2026-08-08; canonical remote TBD — competition requires a public open-source repo, which conflicts with the Forgejo-private default; decide with Atin before pushing).
**Context:** Entry into swyx's "$10,000 Kill My SaaS" hackathon (AI Engineer / latent.space team). Deadline: **Wednesday 2026-08-12, 10PM PT**. Judged by AIE team against a walkthrough video, on a deployed site + open-source repo.

## Current stage & phase

- **Stage:** tone-initiation
- **Phase:** 2 — Phase 1 saturated (all four dossiers landed 2026-08-08). `sequence/PRODUCT-DEFINITION.md` written and presented to Atin as the Phase-2 touchpoint: positioning, moat (M1–M5), scope tiers, architecture bets, 7 decisions. Awaiting his review → then Phase 3 (PHILOSOPHY.md + USER_STORIES.md with AC IDs).

## Commission facts (from Atin, 2026-08-08)

- Target to replace: **Sessionboard.com** (speaker/session management for event organizers, >$40k/yr).
- **Organizer-first**, but the product touches all seats (organizer, speaker, reviewer, attendee-facing outputs).
- **Open source** platform, generalizable to many conferences — but it will be used by a **real conference** (the AIE team's).
- End goal beyond the competition: a completely fully functional working product.
- Sequence agreed: understand problem area (user stories, stakeholders, existing-product features) → core product offering → build plan + HTML prototypes → build.

## Competition brief digest (source: `sequence/research/sources/competition-brief.md`)

Six active features (CFP forms w/ conditional logic; speaker portal; automated comms + calendar invites; evaluation/scoring w/ optional AI review; drag-and-drop schedule builder w/ conflict detection + list/day/week/track/room views; onboarding-status dashboard). Three struck: Accelevents integration, wiki/resource pages, embeddable gallery. Walkthrough video = de facto spec; more videos Sat + Sun, then **requirements freeze**. Stack: free choice; mild bonus Cloudflare, bonus Airtable persistence. $500 token reimbursement for valid submissions. Winner: $10k + latent.space writeup.

## Decisions log

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
- 2026-08-08: **Surfaces note:** Atin closed the Brief Research (was surface:130) and Landscape Features (was surface:132) tabs post-completion. Their dossiers are committed; dossier maintenance against the Sat/Sun videos needs a fresh agent when the videos land. Discord pastes now come to the orchestrator (surface:128).

## Active agents (all pane:40, all Opus)

- **Brief Research** (surface:130): competition-requirements authority → `sequence/research/competition-requirements.md`. **First pass complete 2026-08-08** (R1–R50). Stays alive for Discord pastes + Sat/Sun videos. Prompt: `sequence/research/sources/AGENT-BRIEF-competition-research.md`.
- **Landscape Features** (surface:132): **First pass complete** — feature matrix keyed to R-numbers, deep profiles (Sessionize corrected: $499/event, has collision detection + undocumented "calendar placeholders"), D1–D15 differentiator ranking, pretalx threat read (5 structural misses), vocabulary crib, L1–L4 new open questions.
- **Stakeholder Stories** (surface:133): **First pass + follow-up complete** — 15 seats, 67 stories (US-66 Sessionize mid-CFP migration, US-67 quick-search added), 45-story MVP. Sessionize API is accepted-only by default → importer eats Export spreadsheets, idempotent.
- **Seams Feasibility** (surface:134): **First pass complete** — Airtable/Cloudflare/email/ICS/auth with hard numbers, 16 deadline traps, 33–54h seams estimate. Q1 bet: D1 source of truth + genuine two-way Airtable mirror (never read Airtable on a request path). Q9 confirmed: ICS METHOD:REQUEST; OAuth infeasible by deadline.

## Key findings so far (from Brief Research first pass)

- Speed is a graded feature (swyx complains 3x unprompted); AI review is explicitly de-prioritized ("I don't care about the AI workflow thing", 09:23) — a trap for other entrants.
- Real deployment target: **AIE NYC 2026** (Oct 12–14, ~150 speakers, 1k–3k submissions, 5–15% acceptance). AIE runs on **Sessionize** today, not Sessionboard. Competitive frame: "Sessionize's scope, self-hosted, owned, faster, plus post-acceptance workflow."
- Judge is likely AIE's program/ops person. Evaluation = driving the deployed site through the walkthrough loop; seeded demo data essential; 647 entrants registered.
- Core data model: Abstracts (apply to speak) vs Sessions (guaranteed, e.g. sponsors) — video-only, easy to get wrong.

## Human action items (from Seams first pass, 2026-08-08)

1. Verify/enable **Workers Paid** ($5/mo) on the Cloudflare account (Free's 10ms CPU cap breaks SSR; fails at deploy, not in dev).
2. **Create an R2 bucket and fetch a public object now** — Stage 11's R2 entitlement has silently lapsed account-wide before (403s every public URL; dashboard-only fix).
3. Check **Resend plan tier** (30s in dashboard) — Free's 100/day cap decides how urgent the outbox/demo-safe mode is.
4. If a bespoke sending domain (e.g. a marquee.* domain) is wanted: register + verify **Saturday or not at all**. Default: send as `marquee@stage11.systems` (verified since March).
5. Airtable demo base needs **Team plan or above** (Free caps at 1,000 records/base; seed target is ~1,000).

## Touchpoints

- **OPEN (urgent, relayed to Atin 2026-08-08):** Discord relay needed — both clarification videos (Sat + Sun) are unlisted, announced only in Discord; requirements freeze after Sunday's. Also Q1 (Airtable primary vs mirror) and Q2 (embed gallery: struck in brief vs described in video) need rulings.
- Pending: stories review (Phase 4) — after fan-out consolidation.
- Pending decision with Atin: public GitHub repo (competition requirement) vs Forgejo-private default.

## Stats

- Human touchpoints: 2 (commission Q&A; brief handoff)
- Agents spawned: 4
