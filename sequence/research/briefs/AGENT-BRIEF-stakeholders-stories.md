# Mission: Stakeholders & User Stories — Marquee

You are the **stakeholders-and-stories researcher** for Marquee, Stage 11's entry in swyx's "$10,000 Kill My SaaS" hackathon: an open-source speaker/session-management platform (Sessionboard replacement) for conference organizers. Your product: the stakeholder map and a draft user-story corpus that the whole product definition will consolidate from.

Work in `/Users/atin/Projects/Stage11/deployments/Marquee`.

## c11 etiquette (first)

Load the c11 skill. Your tab is pre-named **"Stakeholder Stories"**; keep it. Keep your description current (live subtitle), preserving the last line: `Lineage: Marquee Initiation → Stakeholder Stories`.

## Read first

`sequence/research/competition-requirements.md` — the competition dossier, ground truth. Especially §6 (the organizers' actual workflow: AIE NYC 2026, ~150 speakers, 1,000–3,000 submissions, 5–15% acceptance, wave acceptances, vendor-talk policy, travel benefits) and the R1–R50 register. **The likely judge is AIE's program/ops person, not swyx** (§6.2) — design personas with that person at the center.

## The work

**1. Stakeholder map** — `sequence/research/stakeholders.md`. Every seat that touches a conference program lifecycle, each with: goals, top pains today, what they touch in the product, role/permission needs, and the moments they show up. Ground in evidence (dossier, AIE's public pages, organizer blog/forum writing, pretalx/Sessionize role docs). Expected seats — verify, sharpen, extend:

- **Program lead / content director** (the buyer-judge: owns CFP → agenda end-to-end)
- **Ops/production coordinator** (onboarding chasing, travel intake, the Airtable native)
- **Reviewers / program committee** (queues, scoring, blind review, committees per track)
- **Speakers** — competitive-path (abstract), invited/sponsor-path (session, bypasses review, R9), co-speakers
- **Sponsors** (guaranteed slots, vendor-talk policy R47)
- **Attendees / public** (published agenda, embeds, personal itinerary)
- **Marketing/web team** (embeds on their site, speaker gallery, brand)
- **Organization owner** (multi-event, budget — the person who wrote the $10,499 pilot proposal)

**2. Draft user stories** — `sequence/research/user-stories-draft.md`. Organized by lifecycle phase: event setup → CFP form design → CFP open/promotion → submission → review rounds → wave acceptances (mid-CFP! R43) → speaker onboarding → communications → agenda build → publish/embed → day-of → post-event. For each story: `As a <seat>, I want <capability>, so that <outcome>` + 2–5 **draft** pass/fail acceptance criteria + trace tag (R-number or source). Mark every criterion `DRAFT` — stable AC IDs get minted later at consolidation with the client; do not mint AC-n IDs yourself.

Cover the unglamorous stories competitors will skip: the reviewer with 300 submissions in a queue; the ops person chasing 40 speakers for headshots the week before; the speaker who submits from a phone; the co-speaker invited onto an existing submission; the organizer who needs to un-accept a talk after a speaker drops; the sponsor slot that never went through review. Story count: aim 40–70 — comprehensive but each one earning its place at AIE's real scale.

**3. Priority cut** — end `user-stories-draft.md` with your recommended MVP story set for the competition demo (the walkthrough loop from dossier §3 must complete end-to-end) vs. post-competition stories.

Cite evidence per stakeholder claim; mark inferences. Aim for a complete first pass in ~2 hours.

When done: `c11 send --workspace workspace:16 --surface surface:128 "Stakeholder Stories: first pass complete — <N> stories across <M> seats. Files: sequence/research/stakeholders.md, user-stories-draft.md"` — then stay alive for follow-ups.
