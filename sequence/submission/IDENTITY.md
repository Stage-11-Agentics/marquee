# Marquee — identity and descriptions

Ready-to-paste name, one-liner, and descriptions at three lengths. Facts verified
against the deployed site on 2026-08-12 (build `1f53732201aa`).

## Name

**Marquee**

## One-liner (≤15 words)

> Open-source conference program operations: CFP, review, acceptance, speaker
> onboarding, agenda, publish — one loop.

Alternate, if the field is tight (≤10 words):

> The conference program workspace you own, end to end.

## 50 words

> Marquee runs a conference program end to end: CFP forms with conditional
> logic, scoped multi-round review, acceptance waves that notify speakers and
> issue calendar invites, a live onboarding chase board, drag-and-drop agenda
> with conflict detection, and a public program. Apache-2.0, self-hosted on
> Cloudflare. The demo holds 1,001 submissions. The UI is a client of its own
> 195-operation API.

*(Word-counted at 58 including the URL-free tail — if the field enforces 50
hard, cut the last sentence.)*

## 150 words

> Marquee is an open-source conference program workspace built to run AI
> Engineer NYC 2026. It carries the whole lifecycle with no dead ends: custom
> CFP forms with conditional logic and track routing, a self-service speaker
> portal, templated communications with real calendar invites (ICS request,
> update, and cancel), multi-round evaluation with committees, blind review,
> and track-scoped reviewer seats, acceptance waves whose status change *is*
> the notification, a real-time board of every speaker's outstanding onboarding
> tasks, and a drag-and-drop agenda with list, day, week, track, and room views
> plus room, speaker, and building-transit conflict detection.
>
> It is Apache-2.0 and self-hosted on Cloudflare (Workers, D1, R2, Queues).
> The admin UI is a plain client of a 195-operation REST API with a live
> OpenAPI 3.1 document, a 48-command CLI, and an agent skill file — so your
> team, your scripts, and your agents all operate the same surface.
>
> Try it: https://marquee.stage11.dev — three one-click seats, no signup.

## 300 words

> Marquee is an open-source conference program workspace: everything between
> "we should open a CFP" and "the program is live on our site," in one loop,
> on infrastructure you own.
>
> The front half matches what conference teams already use. Custom CFP forms
> with nine field types, conditional logic, and track-based routing; saved
> drafts with resume links; a public form that works logged out. Evaluation
> plans with multiple rounds — each round with its own scorecard — committees,
> reviewer pools, blind review, comparison mode, and reviewer seats scoped to
> tracks, enforced at the API. Decisions run in waves while the CFP stays open:
> accept a wave and the emails queue, the portals update, and calendar invites
> go out — real ICS with updates and cancellation, not a link dump.
>
> The back half is the part nobody ships. A real-time onboarding board shows
> every speaker crossed with every outstanding task — bio, headshot, slides,
> travel — with nudge-in-place, so the chase work has a dashboard instead of a
> spreadsheet. The dashboard also counts the uncomfortable number: how many
> decided submissions have not yet been told. Reversal is designed, not
> discovered: un-accepting a talk enumerates everything it touches — tasks,
> queued mail, calendar invites — and lets you cancel or retain each.
>
> Marquee is Apache-2.0, runs on Cloudflare (Workers, D1, R2, KV, Queues), and
> never phones home — the log builder has no field for a speaker's email
> address. The admin UI is a plain client of a 195-operation REST API with a
> live OpenAPI 3.1 document, a 48-command dependency-free CLI, and a generated
> agent skill file: humans, scripts, and agents operate the same surface, and
> none of them is privileged.
>
> The demo is a populated instance of AI Engineer New York 2026 with 1,001
> submissions: https://marquee.stage11.dev — pick any of three one-click seats.

## Fact sources (for whoever pastes)

| Claim | Check |
|---|---|
| 195 operations / OpenAPI 3.1 | `curl -s https://marquee.stage11.dev/api/openapi.json` — 154 paths, 195 operations |
| 1,001 submissions | seeded count; the live CFP accrues a few test submissions on top |
| 48-command CLI | `node cli/marquee.mjs --help` in the repo |
| Apache-2.0 | `LICENSE` at the repo root |
| Calendar invite lifecycle | `src/jobs/calendar/ics.ts`, `src/jobs/calendar/invites.ts` |
| Three one-click seats | https://marquee.stage11.dev/signin |
