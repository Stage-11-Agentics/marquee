# Cold start — interview decisions

Client rulings from the 2026-08-12 cold-start UX interview (Atin + UX designer).
Deliverable: extend `prototypes/pipeline-v1.1/index.html` to **v1.11** (v1.10 is
taken by the public-widgets widening) + `ITERATION-1.11.md`.

## D1 — Timing: full story, and build it (Atin)

Not a deadline-crippled artifact. Design the complete first-run story at full
quality. "We have time. Let's get this built."

## D2 — Identity bootstrap: CLI-printed claim link (Atin)

The deploy sequence prints a one-time claim URL. Visiting it creates the owner
account (name + email typed in, unverified — mail does not exist yet), creates
the org invisibly, sets a session, and lands on setup.

Why: breaks the magic-link/mail chicken-and-egg (identity cannot ride on the
app's own auth when mail is a setup output); proof-of-deploy is
proof-of-ownership; re-running the CLI is the permanent recovery path;
agent-native — an agent driving the deploy captures the URL programmatically.
Grafana/Discourse/Ghost pattern. No password, ever: magic link once mail works;
before that, recovery = re-run the CLI.

## D3 — Demo's role: side-by-side, explorable, removable (Atin)

After claiming, two doors: **Start your conference** (primary) and **Explore
the demo first** (secondary). The demo lives alongside the real conference —
always labeled DEMO, never mingled, removable in one action. Nobody's first
conference is someone else's demo.

## D4 — Initial setup is run by the operator's own agent (Atin)

**"Initial setup is run by an agent"** — said clearly, in the product's own
copy. The assumed installer is technical and already has a coding agent in the
deploy terminal. The agent is the operator's own (Claude Code or equivalent)
reading the repo's `SKILL.md` — **not** an in-app chat surface (which would
need model keys before the instance is configured: a new chicken-and-egg).

The setup wizard is a conversation; the UI is the receipt. `SKILL.md` already
ships and assumes `MARQUEE_URL` + `MARQUEE_TOKEN` exist — setup becomes its
missing first chapter.

**Boundary (Atin):** setup is agent-first; ongoing **administration is dual
first-class** — agent and human web UI, neither privileged. Every agent setup
step drives the same CLI/API a human could drive; the checklist survives as
the by-hand fallback and the verification surface.

## D5 — The claim stays human; then the token handoff (agreed)

The agent hands the human the claim URL (may prefill `?name=&email=`); a
person clicks it and ownership lands on a person. The claim screen's second
act: **issue your setup agent its scoped token** (named, shown once). Authority
flows human → agent, visibly. Then the agent continues setup via API while the
dashboard checklist ticks, each step attributed "done · by your setup agent."

## D6 — The agent's chapter stops before "Open intake" (agreed)

Deploy → claim handoff → token → conference → tracks/formats/rooms → CFP form
→ evaluation plan. **Opening intake is a human click**: it is the
publish-to-the-world moment and carries the no-mail trap warning.

## D7 — Second cold starts: both in v1.11 (Atin)

- **Invite additional organizer** (Atin's naming): owner mints a copyable
  one-time invite link in settings (same pattern as the claim link; never
  depends on mail — once mail is configured the UI merely offers to send it).
  Recipient opens it, confirms name + email, has a session.
  **Plus an organizer-management surface**: list organizers, roles, remove.
- **Next year's conference via the event switcher `＋`** → same
  `#conferences/new` → checklist, scoped to the new conference, skipping
  everything instance-level. Nearly free in the prototype; in the build,
  `POST /api/v1/events` must exist for the agent path anyway, so the UI form
  is a thin layer over the same endpoint.

## D8 — Instance health: honest panel, warn-don't-block (designer, delegated)

Atin delegated ("don't worry too much"). Ruling: instance-level concerns get
their own **Instance panel** on the setup dashboard, separate from the
conference checklist — Mail · Uploads · Spam protection · Domain, each
honestly `configured` / `not configured` with the exact fix command. At **Open
intake** with mail unconfigured: **warn and require explicit acknowledgment**
("Open anyway — submitters will receive no confirmation emails"), never a
hard block — the operator may handle mail elsewhere. Org row stays invisible
at claim; surfaced later in settings (unchallenged).

---

# The designed flow (screen by screen)

1. **Agent setup replay** (fresh-install entry): a simulated terminal — the
   operator's Claude Code conversation: bindings created, secrets prompted
   (Resend deferred → mail honestly unconfigured), migrations, seed choice
   ("demo alongside? yes"), deploy, **claim URL printed**. Door: open the
   claim link.
2. **Claim screen** (`#claim`): name + email prefilled from the link,
   editable. No-password story stated. "Claim this instance."
3. **Handoff screen**: token issued for the agent (named, scoped, shown
   once) + three doors: **Let your agent continue** (primary) · Set up by
   hand · Explore the demo first.
4. **Agent continues** → setup dashboard with checklist steps 1–4 ticked,
   attributed "by your setup agent," Instance panel showing Mail
   unconfigured, **Open intake** left for the human (warn-and-acknowledge
   modal).
5. **By hand** → existing `#conferences/new` → checklist flow (v1.6
   machinery, kept).
6. **Settings → Organizers**: owner row, Invite additional organizer
   (copyable link modal), remove with confirm.
7. **Event switcher**: demo alongside real conference, DEMO-chipped,
   "Remove demo data" one action; `＋` creates next conference with a
   conference-scoped checklist.

Non-negotiables inherited: Flight Deck tokens, PROTOTYPE badge, elements
never jump, nothing dead (toast), honest empty states, non-destructive
demo↔empty fork, self-contained file://.

# Build implications (for the eventual tickets — not prototype scope)

- `SKILL.md` gains the setup chapter (deploy → claim → token → conference →
  stop before intake), matching the replay beats.
- `POST /api/v1/events`, claim/invite one-time link routes, organizer
  management routes, instance-status introspection (mail/R2/Turnstile
  configured?), demo-data removal.
