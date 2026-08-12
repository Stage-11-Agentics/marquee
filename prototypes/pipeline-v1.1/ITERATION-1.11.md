# Pipeline v1.11 — the cold start, from the true step zero

**Date:** 2026-08-12 · **Client rulings:** `prototypes/cold-start/DECISIONS.md` (D1–D8)

v1.6 designed a cold start that began at "Create the conference" — which silently
presumed a deployed instance, an org row, and an authenticated owner. Nothing
designed how a person *becomes* that. v1.11 designs the missing gap, on one
central ruling: **initial setup is run by the operator's own coding agent**
(reading the repo's `SKILL.md`), while administration stays dual first-class —
agent and human web UI. The setup wizard is a conversation; the UI is the
receipt.

## What changed

### The identity bootstrap (new screens, all public-shell)

- **Unclaimed-instance landing** — entering the fresh walk (`#landing?empty=1`)
  now opens on what a fresh deploy honestly shows at its root: nobody owns this
  instance yet; setup is agent-run; the deploy terminal prints a one-time claim
  link because on day zero it is the only proof of ownership that exists.
  Identity deliberately cannot ride on magic-link mail — mail is a setup output
  (the chicken-and-egg that shaped ruling D2).
- **Agent setup replay** (`#setup/agent`) — a simulated terminal conversation,
  phase 1: resources, secrets (Resend deferred honestly), migrations, demo seed
  kept by choice, deploy, and the printed claim link with name/email prefill.
- **Claim screen** (`#claim`) — the one human-only moment. Name + email
  prefilled from the link, editable; the no-password story stated in place;
  recovery = re-run the CLI. Claiming creates the owner (and the org, silently)
  and lands on—
- **Handoff** (`#handoff`) — the token moment: authority flows from the human
  to their agent, visibly. A scoped token shown once, then three doors: **Let
  your agent finish setup** (runs provisioning: conference, tracks, formats,
  rooms, drafted CFP, evaluation plan — then phase-2 transcript), **Set up by
  hand** (the v1.6 checklist flow, intact), **Explore the demo first**.
- The agent **stops before "Open intake"** (ruling D6): publishing to the world
  is a human click, taken with the mail warning in front of it.

### The receipt surfaces

- **Checklist attribution** — completed steps read "done by your agent" or
  "done by you."
- **Instance panel** on the setup dashboard — Mail · Uploads · Spam · Domain,
  each honestly configured-or-not, rows never appearing/disappearing (chips
  change, positions hold). Unconfigured mail carries the exact
  `wrangler secret put RESEND_API_KEY` line and a prototype-labeled "mark
  configured" simulation.
- **Open-intake warning** — publishing a form with mail unconfigured warns
  ("submitters get no confirmation…") and requires explicit acknowledgment.
  Never a hard block (ruling D8): the operator may handle mail elsewhere.

### The demo, side by side (ruling D3)

- The sidebar switcher grows a second, always-reserved row during the walk:
  the demo conference, DEMO-chipped. Clicking **peeks** — the demo swaps in
  whole (real dashboard, real data) under a persistent peek bar; your setup is
  stashed and restored exactly as left. Non-destructive in both directions.
- **Remove demo data** — one action, confirm dialog, touches nothing of yours.
  Narrative-level only: the prototype's meta fork ("Exit fresh install → seeded
  demo") still restores the seeded artifact intact.

### Second cold starts (ruling D7)

- **Invite additional organizer** — new Organizers card in Conference settings
  (all modes, seeded with three organizers in the demo): one-time invite link,
  copyable, mail-independent; "Email the invite" appears live only when mail is
  configured; pending-invite rows with Revoke; Remove with an honest
  consequences dialog; the Owner row cannot remove itself.
- **Next conference via the switcher's ＋** — from the demo, ＋ starts a new
  conference *on the same configured instance*: same checklist, conference-
  scoped, claim skipped, instance rows already green. The existing conference
  stays one click away in the switcher.

### Copy

- The landing's Self-host modal now tells the agent-first story ("Initial
  setup is run by an agent") with the by-hand path named, and cross-links the
  fresh-install walk.

## Contract compliance

Self-contained `file://`, Flight Deck tokens only, PROTOTYPE badge everywhere
(new screens use the standard public shell), elements never jump (reserved
switcher rows, fixed-width status chips and action slots, dash placeholders),
nothing dead (every unwired affordance toasts), honest empty states, and the
demo↔empty fork remains non-destructive.

## Build implications (not built here)

`SKILL.md` setup chapter; `POST /api/v1/events`; claim + invite one-time-link
routes; organizer management; instance-status introspection; demo-data
removal. Listed with the rulings in `prototypes/cold-start/DECISIONS.md`.
