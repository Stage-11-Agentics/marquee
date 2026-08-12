# Code Review: MRQ-94 — public agenda default scope, JSON link, and way home

Reviewed at `mrq-94-public-agenda` @ `c942c64` (worktree
`Marquee-worktrees/mrq-94-public-agenda`), against base `9e1636c`.

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the judgment call (whole program by default) is the right one.
Three of the ticket's four behavioural asks land cleanly and are tested. One user-visible
defect remains on the exact surface being repaired: **the selected day is silently
discarded the moment the visitor touches the track select or the search box**, because
the day tabs are submit buttons and the auto-submit script submits the form with no
submitter. One focused fix plus a regression test clears it.

## 2. Summary

The change flips `loadPublicAgenda` from a hidden day-one default to a whole-program
default, represents that scope as the explicit `day=all` value the UI can render as a
selected tab, adds the "All days" tab, deletes the `Agenda data ↗` JSON link, and points
the public brand at `/` instead of `/agenda`. Server state and UI state now genuinely
agree, `hasFilters` is true only for filters the visitor chose, and "Show full agenda"
measurably changes the page. `npm test` is green (all files pass; the runner reports
`pass-over-budget` at 123s against the 45s objective, which under this fleet's contention
is a machine reading, not a defect — the runner says so itself). The key finding is the
lost day selection on auto-submit, described below.

## 3. Issues

**[MAJOR] src/ui/public/agenda/PublicAgendaPage.tsx:113-125 (and 193-201) — a selected day is silently discarded whenever the track select or search box auto-submits**

The day tabs are `<button type="submit" name="day" value="…">`. A submit button's
name/value is serialized **only when it is the submitter**. `PUBLIC_AGENDA_SCRIPT` calls
`form.requestSubmit()` with no argument on `select` change and on debounced search input,
so those submissions carry no `day` at all. The server then takes the omitted-day branch
(`public-site.ts:481`) and returns the whole program with `filters.day === "all"`.

Failure scenario: visitor opens `/agenda`, clicks **Tue, Oct 13** (page correctly filters
to day two), then types "agents" in the search box. The page comes back with every day's
sessions and the active tab jumps back to **All days**. Same for choosing a track. The
one control the ticket asked to make honest is the one that gets thrown away.

This mechanism pre-dates the change (previously the drop silently reverted to day one),
but it sits inside the ticket's own mandate — "the day control visibly reflects whatever
scope is being shown" — and the new always-visible All-days tab makes the reset something
the visitor watches happen. There is also no test covering "day survives a track/search
change", which is why it slipped.

**Fix:** carry the day through non-day submits. The smallest correct change is to render
a hidden input *after* the tablist inside the same form:

```tsx
</div>
<input type="hidden" name="day" value={data.filters.day} />
```

With JS-driven auto-submit only the hidden value is serialized (day preserved); when a tab
button *is* the submitter, the button precedes the hidden input in DOM order, so
`day=<clicked>&day=<previous>` arrives with the clicked value first and Hono's
`context.req.query()` takes the first occurrence. That ordering dependency is subtle —
assert it in the test (`/agenda?event=…&q=x` after `day=<concrete>` keeps the concrete day;
clicking a different tab still switches). If you would rather not depend on first-wins
duplicate handling, have `PUBLIC_AGENDA_SCRIPT` build the next URL from
`new URLSearchParams(location.search)` and navigate, which keeps `day` explicit and leaves
the no-JS submit path untouched.

**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:142-149 — the brand and "Organizer demo" now point at the same place, and the brand's accessible name misdescribes it**

`/` is `LandingPage` (`src/routes/landing.route.tsx:283`) — the Marquee product page:
"Open-source conference program operations", "Enter as organizer", "View on GitHub". It is
not a conference landing page; it is the organizer demo, which is exactly where the
adjacent `<a class="public-button" href="/">Organizer demo</a>` already goes. The header
now has two controls, one labelled with the conference name and `aria-label="AI Engineer
New York 2026 home"`, both landing on the product's demo page. The ticket named `/`, so
the letter of the AC is met and the brand is no longer a self-link — but a screen-reader
user is told "conference home" and gets the vendor's demo pitch.

**Fix:** decide what home means for an attendee. If `/` stays the destination, relabel
(`aria-label={`${event.name} — Marquee home`}` or similar) and drop the now-redundant
"Organizer demo" button from the public shell. If the conference deserves its own front
door, that is a follow-up ticket worth filing rather than widening this one.

**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:53 + 95-97 — the "no jump" reservation only holds on desktop**

`flex: 0 0 72px` correctly stops the desktop tablist reflowing. At `≤700px` the override is
`.public-days button { flex: 1; width: auto; }`, so the added tab shrinks every button. On
a 375px viewport a three-day event gives ~82px per button (fine), but a five-day event
gives ~54px and "All days" wraps to two lines — the row grows and everything below moves,
which is the reflow the constraint exists to prevent. Buttons have no `white-space` rule.
Evidence includes only desktop captures, so this is unverified either way.

**Fix:** add `white-space: nowrap` and a floor (`min-width: 62px`) to `.public-days button`,
and let `.public-days` scroll horizontally (`overflow-x: auto`) past that. Capture a 375px
screenshot with a multi-day event.

**[MINOR] src/lib/public-site.ts:82, 492 — `filters.day` is typed `string | null` but can no longer be null, and the public API's response shape changed**

`day: selectedDay ?? "all"` makes the `null` arm of `PublicAgendaData["filters"]["day"]`
unreachable, so every consumer still has to defend against a value that cannot occur. It
also changes `/api/v1/public/agenda`: the `filters.day` field, previously a date or `null`,
is now a date or the sentinel `"all"`, and an unparameterised call returns the whole
program rather than day one. That is the better default, but it is a contract change on a
documented public endpoint (`src/routes/public.routes.ts:31-53`) that nothing announces.
`filters.allDays` is now a second spelling of the same scope, which is worth a note too.

**Fix:** narrow the type to `string` (or a named `PublicDayScope = "all" | string`), and
say the API default changed in the PR body and the route's `description`.

**[MINOR] Acceptance items still outstanding**

- `github/mrq-94-public-agenda` is at `32045f2` (the plan commit); the implementation
  commit `c942c64` is unpushed and **no PR exists** (`gh pr list --head
  mrq-94-public-agenda` → empty). AC requires an open PR against `main`.
- AC asks for validation on the **live deployed site**, including the before/after of the
  empty state. The plan deliberately substitutes local Worker validation and defers the
  deploy — a reasonable call given `DEPLOY.md` ("merging does not ship") and the fleet in
  flight, but it is a deviation the PR must state explicitly, and only two "after"
  screenshots are committed (no "before"). The operator decides whether local evidence
  plus a post-merge deploy note is enough here.

## 4. Positive Observations

- **The root-cause fix is in the right place.** Making the whole-program scope an explicit
  `"all"` value that both the server and the tablist read is what turns three symptoms
  (lying empty state, no-op button, unreachable all-days) into one representation change.
  `hasFilters` needed no edit as a result — it was already written against `!== "all"`,
  and the fix simply made that branch true. That is a good sign the model is right.
- **Both empty states stay honest**, and the test proves the distinction rather than
  asserting it: it drives a real no-match query for one and unpublishes the program for
  the other, then asserts the "clear a filter" copy is *absent* from the second.
- **Tests verify rendered behaviour through the Worker** — status codes, real HTML,
  and the API payload alongside the page, including `not.toContain('href="/api/v1/public/agenda')`
  so the JSON link cannot quietly return. The `← Agenda` and brand-href assertions were
  added to both the session and speaker pages, not just one.
- **Restraint on the embed.** `EmbedPage`'s `hasFilters` covers only track/status, both of
  which the visitor actually sets, so the reset link there always changes the result. The
  branch verified this with a test (`track=missing-track` → "Show full agenda" present and
  pointing at the unfiltered embed) instead of changing code that was not broken, and the
  finding is recorded in the plan as the ticket asked.
- The endpoint itself was left alone, and the `Get embed code` integrator path is intact —
  the removal was surgical.
