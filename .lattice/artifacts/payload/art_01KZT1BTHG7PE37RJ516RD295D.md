# Plan Review: MRQ-94

## 1. Verdict

**PASS**

The plan is complete, feasible, and aligned. Implementation can proceed, subject to
the two major issues below being resolved *inside* the PR (both are a decision plus a
note, not a re-plan): the public API's default behaviour change must be stated
explicitly rather than left contradicting the plan's own non-goal, and the declined
live-site validation must be surfaced as an unmet acceptance criterion with an
operator-visible follow-up rather than a footnote.

## 2. Summary

Reviewed the MRQ-94 plan against the three reported defects and the current code in
`src/lib/public-site.ts`, `src/routes/public-agenda.route.tsx`,
`src/ui/public/agenda/PublicAgendaPage.tsx`, `src/ui/embeds/EmbedPage.tsx`,
`src/routes/public.routes.ts`, `src/routes/landing.route.tsx`, and the existing
public-site and empty-state tests. The plan makes the right judgment call
(whole-program default), correctly identifies the shared `day=all` representation as
the way to keep server and UI state in agreement, and — verified independently — is
right that the embed does **not** share the no-op defect. The key concern is that the
same loader backs `/api/v1/public/agenda`, so the fix silently changes a documented
public API's default response, which the plan's non-goals appear to forbid.

## 3. Issues

**[MAJOR] Approach step 1 vs. Scope and non-goals — the fix changes the public API's default response, which the plan says it will not alter**

`loadPublicAgenda` is called from exactly two places: the SSR route
(`src/routes/public-agenda.route.tsx:64`) and the public API
(`src/routes/public.routes.ts:44`). Changing `selectedDay` (`src/lib/public-site.ts:481`)
so an omitted day means "whole program" changes `GET /api/v1/public/agenda?event=<slug>`
from returning day-one sessions with `filters.day: "2026-10-12"` to returning every
published session with `filters.day: "all"`. That is a behavioural break in a documented
public surface and directly contradicts the non-goal "Do not remove or alter
`/api/v1/public/agenda`". Nothing in the plan acknowledges it.

The break is contained — the response schema is `z.any()` (`public.routes.ts:26`), and
the embed path is unaffected because `loadPublicEmbed` already passes `allDays: true`
(`public-site.ts:674`), as do `loadPublicSession` and `loadPublicSpeaker` (`:505`, `:518`) —
but "contained" is not "unremarked."

**Recommendation:** Take the change deliberately and say so. Rewrite the non-goal to
"do not remove or restructure the endpoint," add an explicit sentence that the API's
no-`day` default moves from day one to the whole program for the same honesty reason,
and add one API-level assertion to the test set: `GET /api/v1/public/agenda` with no
`day` returns sessions from every day and `filters.day === "all"`. If instead the API
default should stay day-one, that divergence has to be deliberate and tested too — but
recommend against it; two different defaults on one loader is how this defect got here.

**[MAJOR] Approach step 5 — an explicit acceptance criterion is declined, not met**

Acceptance requires: *"Validated on the live deployed site with screenshots in the PR —
including the before/after of the empty-state case that started this ticket."* The plan
states: *"Do not deploy or claim live-site validation."* The reasoning is sound —
`DEPLOY.md` is explicit that merging does not ship, and deploying an unreviewed branch to
production is an operator action, not a delegator's — but the consequence is that this
ticket's acceptance cannot be closed by this PR, and the defect the operator actually hit
(`/agenda` on `marquee.stage11.dev`) will remain live until someone deploys.

**Recommendation:** Make the gap loud rather than incidental. In the PR body, list the
live-validation criterion as **not met** with the one-sentence reason, and pair it with a
concrete post-merge instruction (the exact deploy command from `DEPLOY.md` and the exact
URLs to re-check: `/agenda` with no query, `/agenda?day=all`, a filtered empty state).
Record the same as an open item on the Lattice task so it is not closed on a green PR
alone. Local before/after screenshots against a Worker seeded to reproduce the empty
day-one case are a good substitute for the *before/after* half and should still be
captured.

**[MINOR] Approach step 2 — `/` is the Marquee product landing, not a conference landing page; the brand would duplicate an adjacent button**

The task description calls `/` "the conference landing page." It is not:
`src/routes/landing.route.tsx:167-180` renders the Marquee product hero
("Fantastic conferences, effortlessly.", "Enter as organizer", "View on GitHub"). The
public shell already links to it — `<a class="public-button" href="/">Organizer demo</a>`
(`PublicAgendaPage.tsx:147`). Pointing the brand there gives the header two controls with
one destination, and sends an attendee who clicked the conference name to a
product-marketing page. It does satisfy the literal criteria (never a self-link, home in
one click), and there is precedent — the public CFP brand already links to `/`
(`src/ui/public/form/PublicForm.tsx:472`) — so this is a taste call worth surfacing, not
a blocker.

**Recommendation:** Keep `/` if that is the operator's intent, but include a screenshot
of `/` in the PR so the operator can confirm that is the "conference home" they meant, and
say in one line that the shell now has two routes to the same page. Also update the brand's
`aria-label={`${event.name} agenda`}` (`PublicAgendaPage.tsx:142`) — leaving it announces
"AIE NYC 2026 agenda" for a link that goes to the Marquee landing.

**[MINOR] Approach step 4 — a source-scanning test pins the literal string "Show full agenda"**

`tests/node/empty-state.AC-161.test.mjs:23` asserts that
`src/ui/public/agenda/PublicAgendaPage.tsx` contains the literal `"Show full agenda"`.
The plan keeps the button, so this passes — but the acceptance criterion permits the
"or the button is absent" branch, which would turn this test red for a reason unrelated to
the change. Worth knowing before, not during, the run.

**Recommendation:** Note the constraint in the plan. If the button is ever removed,
`empty-state.AC-161` must be updated in the same commit with the replacement next-action
marker, not deleted.

**[MINOR] Approach step 1 — `?day=all` is currently broken, not merely unreachable, and deserves its own named regression**

The task describes `day=all` as unreachable. It is worse: the SSR route passes
`day: query.day` straight through and never sets `allDays`
(`public-agenda.route.tsx:62-69`), so `?day=all` today yields `selectedDay === "all"`,
filters every session out, and — because `hasFilters` deliberately excludes `"all"`
(`PublicAgendaPage.tsx:175`) — renders **"No published sessions yet"**, i.e. a second,
different lie. The plan's contract fixes this, but the regression list should name it.

**Recommendation:** Add an explicit assertion that `/agenda?event=<slug>&day=all`
returns 200 with sessions from every day and the "All days" tab marked
`aria-selected="true"` — distinct from the no-query default case, since they reach the
same state by different paths.

**[MINOR] Constraints / R7 — the default now renders every day; no size check is planned**

Day filtering happens in JS after all rows are already loaded (`public-site.ts:481-484`),
so the D1 cost is unchanged — but the SSR markup for the default `/agenda` grows from one
day to the whole program, N× the rows and payload on the conference's front door. Speed is
a graded feature and the plan says nothing about measuring it.

**Recommendation:** Record the rendered `/agenda` HTML size and server render time for
the demo event before and after in the PR. If the full program is large enough to matter,
say so explicitly rather than discovering it on the walkthrough.

**[MINOR] Approach step 2 / Scope — "reserved width" needs a concrete answer at ≤460px**

`.public-days button { width: 72px }` is fixed, so selection changes already cannot
reflow — the no-jump rule is satisfied for the *selected-state* case the constraint names.
The real risk is different: at ≤760px the buttons become `flex: 1` and at ≤460px the
tablist takes a full row (`PublicAgendaPage.tsx:96-97`, `106`), so adding an N+1th tab
shrinks every tab. With a three-day event plus "All days" and labels rendered as
`day.label.replace(" · ", " ")`, truncation is plausible on a 375px viewport — a width the
suite explicitly tests for (`public-site.AC-83-86-240-252-253.test.ts`, AC-85).

**Recommendation:** State the label and overflow behaviour in the plan (e.g. "ALL" or
"All days" with ellipsis, and the tablist scrolling rather than compressing below a
minimum tab width), and check the 375px rendering in the screenshot set.

## 4. Positive Observations

- **The judgment call is right and is actually made.** The task asked for a decision with
  a one-sentence justification; the plan opens with it, picks the whole-program default,
  and — crucially — commits to one shared representation (`day=all`) for server scope and
  UI selection. That single decision is what makes "the UI state and the server state
  agree" achievable instead of aspirational, and it reuses the sentinel `hasFilters`
  already understands rather than inventing a parallel concept.
- **The embed finding is correct, and was checked rather than assumed.** `EmbedPage`'s
  `hasFilters` covers only `track`/`status` (`EmbedPage.tsx:203`), its reset link drops
  both, and its agenda data comes through `loadPublicEmbed` → `loadPublicAgenda` with
  `allDays: true` (`public-site.ts:674`) — so it genuinely does not inherit the day-one
  no-op. The plan reaches exactly that conclusion and still commits to recording it in the
  PR, which is what the constraint asked for.
- **The empty-state distinction is held precisely.** Step 3 separates "a real filter
  missed" from "nothing is published" and refuses to let a defaulted value manufacture the
  first — that is the actual root cause of the operator's complaint, not just its symptom.
- **Non-goals are tight and correctly drawn** around the endpoint, the embed config, and
  production state, which is what keeps a three-defect ticket to one PR.
- **Honest about validation limits.** Declining to claim live-site validation it will not
  perform is the right instinct, and better than the alternative failure mode. Issue 2 is
  about making that gap loud, not about the judgment behind it.

---

*Line-number drift in the task description, for the implementer: `hasFilters` is
`PublicAgendaPage.tsx:175` (not 226 — that is the empty state), the `selectedDay` default
is `public-site.ts:481` (not 486), the JSON link is `:190`, the day tablist `:194-200`,
and `EmbedPage`'s `hasFilters` is `:203`.*
