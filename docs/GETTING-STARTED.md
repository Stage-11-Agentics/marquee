# Getting started

You are about to run a conference on infrastructure you own. This guide takes
you from an empty Cloudflare account to an open call for speakers — including
the parts most tools skip: how the software learns who its owner is, what
happens when half of it isn't configured yet, and how the second organizer
gets in.

> **Status.** This guide documents Marquee's first-run experience as designed
> in the binding prototype (pipeline v1.11; rulings in
> `prototypes/cold-start/DECISIONS.md`). The local demo checkout in the
> README runs today; the claim, handoff, and organizer-invite flows land with
> the cold-start build. Until then, this is the contract those changes are
> built to.

Read the short version first:

- **Initial setup is run by an agent.** You tell your coding agent to set up
  Marquee; `SKILL.md` carries the steps. You never have to do it this way —
  every step is a documented command — but the assumed installer is technical
  and has an agent in the terminal already.
- **Ownership lands on a person.** The deploy prints a one-time claim link.
  A human opens it and becomes the owner. There is no signup page, because an
  unclaimed instance on a public URL must not have one.
- **There is no password, ever.** Sign-in links arrive by email once mail is
  configured. Before then — and any time you are locked out — re-running the
  CLI prints a fresh claim link. The deploy terminal is the recovery path.
- **The instance tells you the truth about itself.** Mail, uploads, spam
  protection, domain: each reads `configured` or `not configured`, with the
  exact command that fixes it. Nothing pretends.
- **Opening intake is always your click.** The agent sets everything up and
  stops. Publishing a call for speakers to the world is a human decision,
  taken with the consequences on screen.

## What you need

| | Required | Why |
| --- | --- | --- |
| Cloudflare account | Workers Paid ($5/mo) | The free tier's CPU cap breaks server rendering — it fails at deploy, not in dev |
| A domain | Yes | The Worker and its media origin need real hostnames |
| Node.js 22.18+ | Yes | Build and deploy tooling |
| A coding agent | Recommended | Runs the setup conversation; anything that reads `SKILL.md` works |
| Resend API key | Later is fine | Outbound mail. You can defer it — Marquee will tell you exactly what that costs |

Time, with an agent: about fifteen minutes plus DNS. By hand: an hour.

## 1 · Deploy

Clone the repository and tell your agent to set Marquee up:

```sh
git clone https://github.com/stage11/marquee.git
cd marquee
# "Set up Marquee for our conference. Keep the demo data so I can look around."
```

`SKILL.md`'s setup chapter walks the agent through the whole sequence: create
the Cloudflare resources (one D1 database, one R2 bucket, one KV namespace,
four queues), store the secrets, apply migrations, optionally seed the demo
conference, and deploy. The agent will ask you the questions that are yours to
answer — which domain, whether to keep the demo, whether you have a Resend key
yet. Answer "not yet" to any of them and it proceeds honestly rather than
stalling.

Two choices worth making deliberately:

- **Keep the demo conference.** Say yes. A populated instance is the best
  manual you will ever get, it is clearly labeled, it never mixes with your
  data, and removing it later is one action.
- **Defer mail if you must, not by accident.** Everything composable still
  queues honestly in the outbox, but submitters get no confirmations and
  speakers get no invites until the key exists.

**No agent?** The same sequence, by hand, is in the README under *Deploy to
Cloudflare*. It is the contract the agent follows, not a second-class path.

At the end, the deploy prints one line that matters more than the rest:

```
The instance is unclaimed. Open this one-time claim link in your browser:
https://your-domain.example/claim/mq_claim_…
```

## 2 · Claim your instance

Open the claim link. You will be asked for exactly two things — your name and
your email — and the email is deliberately unverified, because this instance
cannot send mail yet and claiming must not depend on it.

One click makes you the owner. The organization record is created silently
behind it; you will meet it later in settings if you ever need to.

Why a link, and not a signup form: a fresh Worker is on a public URL from its
first second. The only proof of ownership that exists on day zero is the
ability to run the deploy against your own Cloudflare account — so that is
what the claim link encodes. A used link is inert. A lost link is replaced by
re-running the CLI. A stranger who finds your URL finds a page that says
"nobody owns this instance yet" and nothing else.

## 3 · Hand your agent its keys

The moment you claim, Marquee offers to mint a scoped API token for your
agent — `program:write · agenda:write · comms:send · speaker:write` — shown
once, revocable any time in **Settings → API tokens**.

This is the point of the whole design: authority flows from you to your
agent, visibly. The agent drives the same API every screen is built on, so
nothing it does is invisible to you.

Then choose a door:

- **Let your agent finish setup.** It creates the conference record, tracks,
  formats, rooms, a drafted call for speakers, and the evaluation plan — then
  stops, on purpose, before anything goes public.
- **Set up by hand.** The same five steps through the screens. Slower, not
  lesser.
- **Explore the demo first.** Look around a real, populated conference, then
  come back. Your setup waits exactly where you left it.

## 4 · Set up the conference

However you do it, setup is five steps, and the dashboard shows them as a
checklist that fills in — each completed step attributed to whoever did it,
you or your agent:

| Step | What it decides | Inherited by |
| --- | --- | --- |
| Create the conference | Name, dates, timezone, venue | Forms, portals, agenda times, calendar invites |
| Add tracks, formats, and rooms | Your program's shape; formats carry their durations | Forms, the agenda grid, invites |
| Build the call for speakers | Fields, participants, rules, routing | The public form and everything downstream of it |
| Plan evaluation | Scorecard, committee, rounds — Approve · Maybe · Deny is the whole simple path | The review queue |
| Open intake | Nothing. It publishes what the other four decided | The world |

Sane defaults are set everywhere: one speaker minimum, format durations
prefilled, drafts counting toward submission limits. The common case is the
pre-filled case; change what you need and move on.

## 5 · Read the instance panel before you open anything

Below the checklist sits the **Instance** panel — the machine under the
conference:

```
Mail · Resend        not configured    No confirmations, no decision mail,
                                       no sign-in links until this exists
Uploads · R2         configured        headshots and slides upload
Spam · Turnstile     configured        the public form is protected
Domain               configured        TLS active
```

Each unconfigured row carries its fix. For mail it is one secret:

```sh
npx wrangler secret put RESEND_API_KEY
```

or tell your agent "configure mail" — same step, same result.

If you open intake while mail is unconfigured, Marquee stops you once and
says exactly what will happen: the form goes live, submitters get no
confirmation, accepted speakers get no decision mail and no calendar invites,
and every send queues honestly in the outbox until mail exists. You can
acknowledge and proceed — you may be handling mail elsewhere — but you will
never find out from an angry speaker.

## 6 · Open intake

When the checklist reads four of five, the last step is yours: publish the
call for speakers. The public link is on the form; share it wherever your
speakers are. From this moment the pipeline on your dashboard fills itself —
Submitted · In Review · Waved · Accepted · Onboarding · Scheduled ·
Published — and every count opens the work behind it.

What comes after intake is the rest of the product, and it is the reason
Marquee exists: review and accept in waves, let the system chase bios and
headshots and travel so no human has to, build the agenda against real
conflict detection, publish. Accepting a wave of talks queues the emails,
updates the portals, and offers the calendar invites — one action, cascading
correctly.

## Bring in your co-organizers

Your co-organizer cannot sign themselves up, and that is deliberate. In
**Conference settings → Organizers**, mint an invite: a one-time link you hand
over on any channel you already share. They open it, confirm their name and
email, and they are in — before mail is configured, if need be. Once mail
works, Marquee can send the invite for you; the link stays single-use either
way.

The same panel lists everyone with access, shows pending invites (revocable
until used), and removes an organizer in one action — their reviews and
decisions stay on the record; their access ends now.

## The demo, and getting rid of it

The seeded demo conference stays in your switcher, labeled `DEMO`, until you
remove it. Explore it freely — it is a full conference at real scale, and
edits to it touch nothing of yours. When it has served its purpose:
**Remove demo data**, one confirmation, gone.

## Next year

The `＋` next to the conference switcher creates the next conference on the
same instance — same five-step checklist, scoped entirely to the new
conference. Your instance rows are already green, your organizers already
have access, and last year stays one click away. This is the cold start most
organizers will actually live: not a new install, a new year.

## When something is wrong

Every error surface shows a short reference code. It greps straight to the
structured log line behind it:

```sh
node cli/marquee.mjs diagnose --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --bundle
node cli/marquee.mjs logs --tail --request-id 8f2a4c
```

The support handshake is one paste, not a screen-sharing session. What gets
logged — and the much longer list of what structurally cannot be — is in
[`docs/OBSERVABILITY.md`](OBSERVABILITY.md). The short version: Marquee sends
nothing to anyone, and a speaker's email address cannot be logged because the
log builder has no field for it.

## One more thing about interfaces

Everything above described screens and an agent doing the same work. That is
the product's standing rule, not a launch feature: the UI is built on the
API, the API is served from the same route definitions that generate
`/api/docs`, and the `marquee` CLI and `SKILL.md` ship in this repository.
Run your conference from the dashboard, from a terminal, from your agent, or
from all three on the same afternoon. No surface is privileged, and none of
them is a demo.
