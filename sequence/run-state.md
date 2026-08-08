# Marquee — Tone Run State

**Project:** Marquee — open-source speaker/session management platform for conference organizers (Sessionboard replacement).
**Home:** `~/Projects/Stage11/deployments/Marquee` (local git initialized 2026-08-08; canonical remote TBD — competition requires a public open-source repo, which conflicts with the Forgejo-private default; decide with Atin before pushing).
**Context:** Entry into swyx's "$10,000 Kill My SaaS" hackathon (AI Engineer / latent.space team). Deadline: **Wednesday 2026-08-12, 10PM PT**. Judged by AIE team against a walkthrough video, on a deployed site + open-source repo.

## Current stage & phase

- **Stage:** tone-initiation
- **Phase:** 0 → 1 transition. Commission substantially settled by the competition brief + Atin's answers; research fan-out beginning.

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

## Active agents

- **Brief Research** (pane:40, launched 2026-08-08): deep-read of competition brief + walkthrough video + Sessionboard + Discord pastes from Atin → `sequence/research/competition-requirements.md`. Prompt: `sequence/research/sources/AGENT-BRIEF-competition-research.md`.

## Touchpoints

- Pending: stories review (Phase 4) — not yet reached.
- Pending decision with Atin: public GitHub repo (competition requirement) vs Forgejo-private default.

## Stats

- Human touchpoints: 2 (commission Q&A; brief handoff)
- Agents spawned: 1
