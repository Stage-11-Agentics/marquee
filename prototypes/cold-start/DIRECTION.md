# Cold Start — UX design brief

**You are a UX designer.** Your job this session is to **interview Atin** (the operator/client)
about one unsolved question, think it through *with him*, and then produce a **clickable HTML
prototype** answering it — by extending the existing binding prototype, not by starting over.

**Interview first. Do not open an editor before the interview has produced decisions.**

---

## The question

> **How does a brand-new conference organizer, on a brand-new install of Marquee, get from
> nothing to a running conference?**

Marquee is an open-source, self-hosted conference program workspace (CFP → review →
acceptance → speaker onboarding → agenda → public site). It ships as a repo you deploy to
your own Cloudflare account. So "a new organizer on a new install" is not a hypothetical —
it is the *only* way anyone who is not us ever becomes a user.

## What already exists (verified on `main` @ `7304bc6` — do not re-derive this)

**The prototype already designs a cold start. The build does not have it.** That asymmetry is
the whole finding.

### In the prototype (`prototypes/pipeline-v1.1/index.html`, v1.9 — the binding contract)

A real fresh-install mode exists and works. Read this code before the interview
(≈ lines 1409–1620, `git grep -n enterFreshInstall`):

- `#dashboard?empty=1` calls `enterFreshInstall()` — snapshots the seeded AIE demo, empties
  the event, tracks, formats, rooms, buildings, forms and submissions, and flips
  `state.setup.active`. `exitFreshInstall()` restores the demo intact. Nothing is destroyed.
- `setupStepList()` is the cold start as one ordered checklist, each step naming the screen
  that completes it:
  1. **Create the conference** — name, dates, timezone, venue → `#conferences/new`
  2. **Add tracks, formats, and rooms** — "forms, agenda, and invites all inherit these" → `#settings`
  3. **Build the call for speakers** — fields, participants, rules, routing → `#forms`
  4. **Plan evaluation** — scorecard, committee, rounds → `#evaluation`
  5. **Open intake** — publish the form, share the public link → `#forms`
- `showsEmptyState(route)` makes screens honestly empty until the step before them is done.
- A `#conferences/new` screen exists ("One record, created once. Forms, portals, agenda
  times, and calendar invites all inherit it.") with a **Create conference** button.
- The landing page has a **Self-host Marquee** modal whose whole story is
  `git clone … && npm install && npm run db:migrate && npm run seed && npm run dev`.

### In the build (`src/`)

None of it. Specifically:

- **No `POST /api/v1/events`.** Every event route is `/api/v1/events/{eventId}/…`. A
  conference cannot be created through the API at all.
- **No `/conferences/new` UI route.** `src/ui/shell/route-table.ts` has no such entry.
- **No signup.** Auth is `/api/v1/auth/demo` (seeded personas) and `/api/v1/auth/magic-link`;
  the magic-link handler looks up `people WHERE org_id = ? AND email = ?` and, on no match,
  returns "If that address is registered, a sign-in link is on its way" and does nothing. An
  unknown human cannot get in. `landing.route.tsx` says it outright: *"No signup. Both demos
  open populated AIE NYC 2026 workspaces."*
- **The only path from empty DB → usable app is `npm run seed`**, which hardcodes org
  `org_aie-ny` and event `evt_aie-ny-2026` (`scripts/seed/event.ts`) — i.e. a fresh installer's
  first conference is *someone else's demo conference*.
- `npm run check:readme` is a stub: `"self-host deploy sequence is not implemented"` (MRQ-57).

**`src/routes/onboarding.routes.ts` and `/onboarding` are the *speaker* onboarding chase
board** (accepted speakers × tasks), pipeline step 5. Not organizer onboarding. Don't confuse
the two, and don't let the vocabulary collide in anything you design.

## The genuine design gap — likely the heart of the interview

Even the prototype's cold start **starts one step too late.** Step 1 is "Create the
conference," which silently presumes: a deployed instance, an organization row, an
authenticated human, and that human being an owner. Nothing in prototype or build designs how
a person *becomes* that. Between `git clone` and "Create the conference" there is an
undesigned gap, and it contains the entire first-run identity story:

- Who is the first user, and how does the software learn it's them and not a stranger who
  found the URL? (A bootstrap token printed by a CLI? First-visit claim? An env var? A magic
  link to an address supplied at deploy time?)
- Is there an organization concept the operator sees, or is org creation invisible?
- Where do secrets and bindings (mail, R2, Turnstile, domain) meet the UI — is there an
  honest "this instance can't send mail yet" state, given that a CFP without mail is a trap?
- Does the seeded AIE demo help or hurt a real first-timer? Is there a "start empty" vs
  "explore the demo, then start empty" fork? Note `enterFreshInstall()` already models
  exactly this non-destructive fork — it may be the seed of the answer.
- Do organizers arrive at their *own* deploy, or invited into someone else's instance
  (co-organizer, second conference next year)? Second-conference-onward is a different and
  probably commoner cold start than first-ever-install.
- What is the honest failure story when the install is half-configured? Marquee's philosophy
  forbids a screen that only works with pretty data.

Bring these as **material for the interview, not as your answers.** Atin decides.

---

## How to run the interview

- **Lead with what you found**, briefly — he already knows the summary above, so don't recite
  it. Open on the sharpest thing: *the design exists, the build skipped it, and the design
  itself starts after the hard part.*
- Ask **numbered, open questions in small batches** (3–5 at a time), so he can answer at
  length and skip. Use `AskUserQuestion` for genuine forks with real trade-offs — options
  with pros, cons, and your recommendation stated and argued. Do not use it for things you
  can decide yourself.
- **Have opinions.** He is hiring a designer, not a survey. Where you believe one answer is
  right, say so and say why; take the disagreement if it comes.
- Keep a running decisions list in `prototypes/cold-start/DECISIONS.md` as they land, so the
  build brief writes itself and nothing survives only in the transcript.
- **`PHILOSOPHY.md` binds every copy and design decision.** Read it fully before you open your
  mouth. Speed is respect. Elements never jump. Sane defaults. The organizer's vocabulary.

## Read before the interview

1. `PHILOSOPHY.md` — fully.
2. `DESIGN.md` — the Flight Deck language, the voice, the craft rules, the binding contract.
3. `prototypes/PROTOTYPE-CONTRACT.md` — badge, vocabulary, mock-data scale, the toast rule
   for anything unwired.
4. `prototypes/pipeline-v1.1/DIRECTION.md` — how the binding prototype came to be.
5. The cold-start code in `prototypes/pipeline-v1.1/index.html` (see above).
6. `README.md` "Status: local now, hosted after account setup" + `DEPLOY.md` + `SEED-DATA.md`
   — the real deployment truth your design has to survive.

## The deliverable

**Extend `prototypes/pipeline-v1.1/index.html` in place to v1.10** unless the interview
concludes otherwise. It is the binding visual contract; the cold start already lives there;
a second file would fork the contract. Bump the version comment in its header the way v1.5–v1.9
did, and write `prototypes/pipeline-v1.1/ITERATION-1.10.md` describing what changed and why.

Non-negotiables inherited from the contract:

- **Self-contained** — inline CSS/JS, no CDN, no build step, works from `file://`.
- **Flight Deck tokens** — `prototypes/skins/skin-c.html`. Hairline rules, no shadow, mono
  tabular figures for every count and time. Light mode.
- **Persistent PROTOTYPE badge** on every screen, including anything new.
- **Elements never jump.** Reserve space, fixed-width controls, "—" over removed rows.
- **Nothing dead.** Anything unwired shows the "Prototype — not wired" toast.
- **Honest empty states** — this design *is* the empty state; it has nowhere to hide.
- **Real-ugly data** wherever data appears.
- The non-destructive demo↔empty fork must keep working: an operator walks the cold start and
  returns to the seeded demo exactly as they left it.

**Validate it yourself before presenting.** Load the c11 skill and the `c11-browser` skill, open
the file in a c11 browser surface, and drive the whole flow — cold start end to end, then back
to the demo — checking for JS errors, dead controls, layout shift, and 375px operability.
A prototype you have not clicked is not a deliverable. Then hand Atin the browser surface and
let him drive.

## Constraints

- **Working directory: this worktree** (`Marquee-worktrees/cold-start-ux`, branch
  `mrq-cold-start-ux`, based on `main` @ `7304bc6`). The main checkout is running evals on
  another branch — **do not touch it, do not `git checkout` anything, do not switch branches.**
- Commit to `mrq-cold-start-ux` freely. **Do not push, do not open a PR, do not merge** without
  Atin saying so.
- This repo becomes public open source: no secrets, no Stage 11 internals, nothing from `Atin/`.
- **Timing matters.** The hackathon deadline is **today, Wed 2026-08-12, 22:00 PT.** Ask Atin
  early whether this is a tonight artifact or a post-deadline one — it changes how much you
  design. Do not assume you have days.

## Housekeeping (first turn)

```
c11 rename-tab      --surface "$C11_SURFACE_ID" "Cold-start design"
c11 set-description --surface "$C11_SURFACE_ID" "Lineage: onboarding recon → UX designer. Interviewing Atin on first-run organizer setup, then extending pipeline-v1.1 to v1.10."
```
