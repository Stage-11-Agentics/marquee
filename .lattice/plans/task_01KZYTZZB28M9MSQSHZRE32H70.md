# MRQ-184: EMB-15: the embed builder is missing the formats and field control the criterion names

Rubric item **EMB-15** — `public-widgets`, weight **2**, `partial` in round 4 and round 9
(**1.0 recoverable**). Scenario: **EMB-S3**. It is now the **only** unconverted item in
public-widgets — the area is 15/16 — and the last item in my lane that is neither merged nor
owned by someone else.

## Acceptance criterion — the rubric's `pass_criteria`, verbatim

> The agent finds an embeds/share/publish area, sees widget-type choices covering most of the
> five, configures and saves an embed, and captures a generated snippet or URL; **full credit
> needs multiple output formats (styled HTML, basic HTML, JSON/XML, iCal) and filter/field/branding
> options per SessionBoard** — the snippet actually rendering inside a third-party page is the
> manual half

## Why it fell short — the judge's own reasoning (confidence high)

The judge is emphatic that the builder is real and good, then names exactly three gaps:

> A real embed builder exists at /embed/config [...] FORMAT offers four surfaces (Agenda,
> Sessions, Speakers, Call for speakers), OUTPUT offers three (Styled HTML, JSON feed, iCal
> feed) [...] Every change rewrites the snippet and re-renders a live preview iframe of the
> actual public embed [...] Saving works and persists server-side [...] surviving a full reload
> with a snippet addressed by its own durable slug. **Short of full credit for three named
> gaps: there is no per-field selection (the field set of each surface is fixed — no checkboxes
> anywhere in the builder), the output set omits a basic-HTML and an XML variant, and there is
> no itinerary/personal-schedule embed type.** Two builder defects also apply (stale preview on
> iCal, Get code not restoring the form).

**This is the rare item where the remaining work is enumerated for us.** Nothing here needs
diagnosis; the judge wrote the checklist.

## What to build — the three named gaps

1. **Per-field selection.** Checkboxes over each surface's field set, so an organizer embedding
   a speakers grid can drop, say, company or bio. The criterion asks for "field... options" and
   the builder currently has none. Default everything on, so an existing saved embed's output is
   unchanged.
2. **Basic HTML output**, alongside Styled HTML — unstyled markup a host page can theme itself.
   This is the point of the format existing: Styled HTML carries our accent and type, and a host
   with its own design system wants the other one.
3. **XML output**, alongside the JSON feed. The criterion names "JSON/XML" as one slot; JSON
   alone half-fills it.

The judge also names a fourth, an itinerary/personal-schedule embed type. **Do that one last and
only if the first three are done and green** — the personal schedule is per-visitor state and
embedding it is a larger design question than the other three combined. If you run out of room,
stop and say so on the ticket rather than half-shipping it.

## The two builder defects, which are the honesty half

4. **The live preview goes stale on iCal.** Switching OUTPUT to "iCal feed" leaves the preview
   pane rendering the JSON body from the previous selection while the snippet box correctly
   shows the iCal anchor. The preview and the snippet contradict each other, and the preview is
   the thing the organizer trusts.
5. **"Get code" on a saved embed restores only the snippet, not the configuration.** After
   clicking it the FORMAT tab still reads Agenda, TRACK still "All tracks", ACCENT still default
   teal and the preview still shows the unfiltered agenda — while the code box reads
   `track=trk_infra&accent=%23b3261e`. The builder is now showing one embed and describing
   another. Restore the full configuration into the form, so what is on screen is what the
   snippet encodes.

## Acceptance

- OUTPUT offers styled HTML, basic HTML, JSON, XML and iCal; each produces a snippet or URL that
  resolves, and the preview matches the selected output every time.
- Field selection exists per surface and changes the rendered embed.
- "Get code" on a saved embed leaves the builder showing exactly that embed's configuration.
- Existing saved embeds keep rendering exactly as they do today.
- Regression tests fail on `main` and pass on the branch.

## Constraints

- Your **own linked worktree**, created as your first act, then `pwd` and `git branch --show-current` to prove it. Never the primary checkout (it is the Lattice board's home); never `mrq-auto-eval*`.
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree.
- **No migration without the operator.** If saved-embed configuration needs a new column, stop and say so on this ticket.
- **Do not deploy.** A `.deploy-freeze` marker sits at the primary checkout; the eval coordinator owns the barrier. Merging is wanted; deploying is not, and is not yours.
- **Elements never jump** — reserve space for anything that swaps as OUTPUT or FORMAT changes.
- **Gate serialization is a fleet rule, not an option.** Route EVERY `npm run pr-gate` and EVERY full `npm test` through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`, one-off runs included. Cheap scoped things (tsc, one test file) stay unlocked.
- **Read the `status` field before you believe a red.** `fail` is load-invariant — believe it, it is a real defect. `pass-over-budget` is a warn, not a failure. `timeout` is the only status contention can manufacture: re-run the SAME sha once under the lock before investigating, and compare the parent commit's `elapsedMs` — CI's suite is running ~305s against a 600s ceiling tonight, so a CI timeout may be headroom rather than your diff. Never dismiss failing tests as a "known baseline" without naming the commit that made them pass.
- PR: `gh pr create --repo Stage-11-Agentics/marquee --base main`.
