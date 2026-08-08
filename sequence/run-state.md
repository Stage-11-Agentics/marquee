# Marquee — Tone Run State

**Project:** Marquee — open-source speaker/session management platform for conference organizers (Sessionboard replacement).
**Home:** `~/Projects/Stage11/deployments/Marquee` (local git initialized 2026-08-08; canonical remote TBD — competition requires a public open-source repo, which conflicts with the Forgejo-private default; decide with Atin before pushing).
**Context:** Entry into swyx's "$10,000 Kill My SaaS" hackathon (AI Engineer / latent.space team). Deadline: **Wednesday 2026-08-12, 10PM PT**. Judged by AIE team against a walkthrough video, on a deployed site + open-source repo.

## Current stage & phase

- **Stage:** tone-initiation
- **Phase:** 1 — research fan-out in flight (4 agents). Commission (Phase 0) settled by the competition brief + Atin's answers.

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

## Active agents (all pane:40, all Opus)

- **Brief Research** (surface:130): competition-requirements authority → `sequence/research/competition-requirements.md`. **First pass complete 2026-08-08** (R1–R50). Stays alive for Discord pastes + Sat/Sun videos. Prompt: `sequence/research/sources/AGENT-BRIEF-competition-research.md`.
- **Landscape Features** (surface:132): Sessionize/Sessionboard/pretalx deep + survey → `sequence/research/landscape-features.md`. Prompt: `sequence/research/briefs/AGENT-BRIEF-landscape-features.md`.
- **Stakeholder Stories** (surface:133): stakeholder map + 40–70 draft stories → `sequence/research/stakeholders.md`, `user-stories-draft.md`. Prompt: `sequence/research/briefs/AGENT-BRIEF-stakeholders-stories.md`.
- **Seams Feasibility** (surface:134): Airtable/Cloudflare/email/ICS/auth semantics + deadline traps → `sequence/research/seams-feasibility.md`. Prompt: `sequence/research/briefs/AGENT-BRIEF-seams-feasibility.md`.

## Key findings so far (from Brief Research first pass)

- Speed is a graded feature (swyx complains 3x unprompted); AI review is explicitly de-prioritized ("I don't care about the AI workflow thing", 09:23) — a trap for other entrants.
- Real deployment target: **AIE NYC 2026** (Oct 12–14, ~150 speakers, 1k–3k submissions, 5–15% acceptance). AIE runs on **Sessionize** today, not Sessionboard. Competitive frame: "Sessionize's scope, self-hosted, owned, faster, plus post-acceptance workflow."
- Judge is likely AIE's program/ops person. Evaluation = driving the deployed site through the walkthrough loop; seeded demo data essential; 647 entrants registered.
- Core data model: Abstracts (apply to speak) vs Sessions (guaranteed, e.g. sponsors) — video-only, easy to get wrong.

## Touchpoints

- **OPEN (urgent, relayed to Atin 2026-08-08):** Discord relay needed — both clarification videos (Sat + Sun) are unlisted, announced only in Discord; requirements freeze after Sunday's. Also Q1 (Airtable primary vs mirror) and Q2 (embed gallery: struck in brief vs described in video) need rulings.
- Pending: stories review (Phase 4) — after fan-out consolidation.
- Pending decision with Atin: public GitHub repo (competition requirement) vs Forgejo-private default.

## Stats

- Human touchpoints: 2 (commission Q&A; brief handoff)
- Agents spawned: 4
