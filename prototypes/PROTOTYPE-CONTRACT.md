# Marquee — Prototype Contract (shared, all three directions)

Three clickable HTML prototypes are being built tonight, one per direction: **Chase** (`prototypes/chase/`), **Pipeline** (`prototypes/pipeline/`), **Marquee** (`prototypes/marquee/`). Each rests on a different core assumption and must be a *different UX paradigm* — swap the headline between two and you should still tell them apart. This file is the contract all three share; your direction brief adds the specifics.

## Read first (in this order, skim-level except where noted)

1. `PHILOSOPHY.md` — binds every design and copy decision. Read fully. Speed is respect; elements never jump; sane defaults; the organizer's vocabulary.
2. `sequence/PRODUCT-DEFINITION.md` — positioning, moat M1–M5, scope tiers.
3. `sequence/USER_STORIES.md` if it exists, else `sequence/research/user-stories-draft.md` — the walkthrough-loop table in the priority cut is your screen list.
4. `sequence/research/landscape-features.md` **§4 (best-in-class notes) and §5 (vocabulary crib)** — read §4–5 fully; they are design references.
5. `sequence/research/competition-requirements.md` §3 (evaluation reality) — who judges and how.

## The artifact

- `prototypes/<direction>/index.html` — **self-contained** (inline CSS/JS, no CDNs, no build step), works from `file://` and any static server. Hash-based navigation between screens.
- **Every screen of the 11-step walkthrough loop reachable and populated:** landing (demo logins) → event settings → program dashboard → form builder (abstract/session target) → public CFP form (as a speaker would see it) → speaker portal (status, tasks, bio) → evaluation plan + committee → reviewer queue → bulk accept → agenda builder (the five views: list/day/week/track/room — track is a true swimlane) → public agenda + embed dialog.
- **Interactions that define your direction must actually work** (clicks, filters, the direction's signature move). Secondary interactions may be simulated, but never dead: anything not wired shows a small toast "Prototype — not wired (AC-ref)".
- **PROTOTYPE badge:** persistent, unmistakable, on every screen (e.g. corner ribbon "PROTOTYPE — mock data"). Part of the artifact, not removable by navigation.

## Mock data — realistic and at scale (non-negotiable)

Generate procedurally in JS at load:

- **~1,000 submissions** for "AIE NYC 2026" (Oct 12–14, Sheraton New York Times Square). Statuses: ~150 accepted (waves of Aug 15/Sep 1/Sep 15), ~90 in review, rest submitted/waitlisted/rejected/withdrawn. ~40 admin-created **Sessions** (sponsor/invited path — visually distinct from Abstracts).
- **Formats:** Workshop (1–2h), Stage Talk (15–20m), Lightning (5–10m), Online (5–55m). **Tracks** (~8, colored): e.g. AI in Financial Services (mainstage theme), Agents, Evals, Infra, Open Models, RAG/Retrieval, Security, Leadership.
- **Real-shaped ugliness:** long names (diacritics, hyphenations), long titles that truncate, companies from the AIE orbit (banks, labs, startups), a speaker on 3 submissions, a panel with 4 co-speakers, an overdue task list, a double-booked speaker conflict visible in the agenda.
- Lists must render fast at this volume — a laggy prototype refutes our own thesis. Virtualize or paginate if needed, but it must *feel* instant.

## Shared product truths

- **Vocabulary (from the crib):** Abstract · Session · Speaker · Submitter · Evaluation plan · Round · Scorecard · Committee · Portal · Task · Handbook page · Agenda · Break · Event site.
- **The five moat features must be visible somewhere:** abstracts-vs-sessions, real-time task dashboard, speaker tasks, calendar-invite affordance, track swimlane.
- **Craft rules:** elements never jump (reserve space, fixed control widths, "—" over removed rows, tabular numerals); one obvious primary action per screen; every module reachable in one click from your home surface; honest empty/loading states.
- **Voice:** confident, warm, concise. No exclamation-mark enthusiasm. Buttons say what they do ("Accept 37 abstracts", not "Submit").

## Working style

- Target: **a complete clickable first pass in ~2 hours**, then polish. Working-and-complete beats perfect-and-partial; the review tonight compares whole flows.
- Commit nothing; write files only under your `prototypes/<direction>/` folder.
- When done, print a completion line to your terminal: `PROTOTYPE READY: prototypes/<direction>/index.html` plus a 3-bullet summary of your signature moves. The orchestrator reads your screen.
