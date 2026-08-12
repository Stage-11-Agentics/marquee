# Code Review: MRQ-94 — public agenda default scope, JSON link, escape routes

Reviewed at `mrq-94-public-agenda` @ `c1d8014` (branch point `9e1636c`), read against the
worktree source rather than the prompt's diff — the branch has five commits beyond what the
prompt showed.

## 1. Verdict

**FAIL (implementation-level)**

The plan's judgment call is right and the three named defects are genuinely fixed. Two things
block: the whole-program default introduced a new honesty problem the ticket was written to
prevent (a multi-day list with no day marker), and the deliverable acceptance criteria — an open
PR, and live-site before/after evidence — are not met. The branch's implementation is not even
pushed.

## 2. Summary

The change makes `/agenda` show the whole published program by default, adds a real `All days`
tab wired to the same `day=all` representation the server returns, removes the raw JSON link,
points the public brand at `/`, and gives the detail pages and embed config an event-scoped
`← Agenda` link. Suite is green (91 pass, 23s of a 45s budget), all three typechecks pass,
`check:api` and `check:design` pass, and the tree is clean. The key finding is that the agenda
row renders only `session.time` and `session.roomLabel` — with all days now shown by default,
the front door presents Oct 12's 09:00/10:00 sessions immediately followed by Oct 13's 13:00
sessions as one continuous timeline, with nothing on screen saying the day changed. The
delegator's own evidence screenshot shows this.

## 3. Issues

**[MAJOR] src/ui/public/agenda/PublicAgendaPage.tsx:234 — The all-days list never shows which day a session is on**

The default scope is now the whole program, but the row's `<time>` block renders only
`{session.time}` and `{session.roomLabel}`. Sessions are ordered `ORDER BY ai.starts_at ASC`
(`src/lib/public-site.ts:395`), so days run contiguously with no separator and times restart:
in `docs/evidence/mrq-94/agenda-all-days.png` the visitor sees `09:00, 09:00, 10:00, 10:00,
13:00 ×5, 14:00` — the first four are Mon Oct 12 and the 13:00 block is Tue Oct 13, and nothing
distinguishes them. Read as one day, that program is simply wrong. The date is present in the
data (`session.day`, `session.date`) and every other surface shows it — the embed agenda kind
renders `{session.day}` right beside the time (`src/ui/embeds/EmbedPage.tsx:231`), as do both
detail pages. The old code got away with omitting it only because the list was always
single-day; this change removed that guarantee without restoring the label. This is the same
class of defect as the ticket's complaint — the UI not telling the visitor what scope they are
looking at.

**Fix:** When the scope is all days, group the list by day (a `public-agenda-daybreak` row
carrying `session.day`, reusing existing `public-*` tokens) or, minimally, render
`{session.day}` inside the `<time>` block as the embed already does. Keep the reserved
`min-height` so the list does not reflow, and add a test asserting a two-day fixture renders
both day labels under `day=all`.

**[MAJOR] — No PR exists, and the implementation is not pushed**

`gh pr list --repo Stage-11-Agentics/marquee --search MRQ-94 --state all` returns `[]`.
`github/mrq-94-public-agenda` is at `32045f2` — a *diverged* plan-only commit that is not an
ancestor of local `c1d8014`; the six implementation commits exist only in the worktree. The
acceptance criteria require "PR open against `Stage-11-Agentics/marquee` `main`", and the plan's
step 6 committed to it.

**Fix:** Rebase onto current `main`, force-push the branch (the remote head is a diverged plan
commit, so a plain push will be rejected), and open the PR. The PR body still owes the required
one-sentence justification of the whole-program default and the recorded EmbedPage finding.

**[MAJOR] — Live-site validation and the before/after empty-state evidence are missing**

Acceptance: "Validated on the **live deployed site** with screenshots in the PR — including the
before/after of the empty-state case that started this ticket." The plan explicitly overrode
this ("Do not deploy or claim live-site validation"), and the two committed screenshots are
local, 1280px-tall viewport captures — not full-page — with no "before" shot of the operator's
`no published sessions match / clear a filter` state. Declining to deploy is defensible under
`DEPLOY.md` (merging does not ship, and a delegator deploying mid-fleet is worse), but the AC is
unmet and the substitute evidence is thinner than the ticket asked for.

**Fix:** Capture the before/after pair against the pre-change build and the branch build
locally, full-page, and state plainly in the PR that live-site validation is deferred to the
post-merge deploy — as an explicit, owned gap rather than a silent one. Note that the all-days
screenshot is cropped above the day boundary, which is why the issue above went unnoticed.

**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:113-142 — Pressing Enter in the search box silently discards the selected day**

The script preserves the day by passing the active day button as the `requestSubmit` submitter.
Implicit form submission does not go through that path: pressing Enter in `input[name="q"]`
clicks the form's *first* submit button in tree order, which is now the `All days` tab. A
visitor on `?day=2026-10-13` who types a query and hits Enter lands on the whole program. The
debounced auto-submit usually wins the race, which is exactly what makes this the kind of bug
that survives manual testing.

**Fix:** Move the day out of the submitter entirely — keep a hidden `input[name="day"]` holding
the current scope and give the tabs `type="submit"` with no `name`, updating the hidden input on
click; or attach a `submit` listener that injects the current day whenever `event.submitter` is
not a day button. Either makes every submission path agree.

**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:119-128 — The hidden `day` fallback accumulates duplicate inputs**

When no tab is active (any `day` value outside the event's days, e.g. `?day=2026-99-99`), each
`submit()` call appends a *new* hidden `day` input without removing the previous one. Two
debounce fires before the first navigation commits produce `day=X&day=X`. Harmless today —
Hono's `query.day` takes the first — but it is an unbounded append on a live DOM.

**Fix:** Reuse a single node: `form.querySelector('input[type=hidden][name=day]') ??
createElement(...)`, and set its value rather than appending.

**[MINOR] tests/integration/public-site.AC-83-86-240-252-253.test.ts:157-160 — Tests assert on the inline script's source text**

Four assertions match exact substrings of `PUBLIC_AGENDA_SCRIPT` — `form.requestSubmit(activeDay
instanceof HTMLButtonElement ? activeDay : undefined)`, `scrollIntoView({ block: 'nearest',
inline: 'nearest' })`, `new URLSearchParams(window.location.search).get('day')`. These verify
that a specific string was written, not that day preservation works; they break on any
whitespace-level refactor while still passing if the behavior is inverted. They also happen to
pin the exact code path that has the Enter-key hole above — green, and wrong.

**Fix:** Drop the source-text assertions. The behavior they gesture at (day survives a
track/search change) is a request-level test: `GET /agenda?event=…&day=2026-10-13&track=…` and
assert the concrete day stays active and the filtered rows are right — which the file already
does at line 172. If the client script needs coverage, that belongs in the e2e suite.

**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:132-133 — `scrollIntoView` on load can scroll the page**

`block: 'nearest'` is not scoped to the horizontal scroll container; if the tablist is not fully
visible vertically (small viewport, deep link), this scrolls the document past the `<h1>` on
first paint and competes with browser scroll restoration. The intent is purely horizontal.

**Fix:** Scroll the container directly — `daysEl.scrollLeft = activeDay.offsetLeft -
daysEl.offsetLeft` — or guard on `daysEl.scrollWidth > daysEl.clientWidth`.

**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:158,163 — The brand and "Organizer demo" now point to the same place**

Repointing the brand to `/` satisfies the ticket as written, but `/` is Marquee's product
landing (`src/routes/landing.route.tsx:283` — "Open-source conference program operations",
"Enter as organizer"), not a conference landing page. The shell now offers two controls to the
same URL, one labelled with the conference name and one labelled "Organizer demo", plus a third
on the unfiltered empty state labelled "Return to conference" (pre-existing, `:244`). The
`aria-label` reads `"{event.name} — Marquee home"`, which is two different destinations in one
string.

**Fix:** Ticket-compliant as-is, so this is a judgment call to surface in the PR rather than a
blocker. Cleanest is to drop the now-redundant "Organizer demo" button from the public shell and
let the brand be the way home, with `aria-label={`${event.name} — home`}`.

**[NIT] src/ui/public/agenda/PublicAgendaPage.tsx:118,132 — `activeDay` is declared twice**

Once inside `submit()` and once at module scope for the scroll call. Not an error, but the
shadowing makes the script read as if the outer binding is what `submit()` uses.

## 4. Positive Observations

- **The judgment call is the right one and is carried through both layers.** `selectedDay`
  (`src/lib/public-site.ts:481`) and the returned `filters.day` (`:489`) now use one
  representation — `"all"` — so the tab's active state is derived from the same value the server
  filtered on. That is precisely the "UI state and server state agree" the ticket demanded, and
  it is what makes `hasFilters` (`PublicAgendaPage.tsx:191`) honest: a defaulted value can no
  longer masquerade as a filter.
- **`filters.day` narrowed from `string | null` to `string`.** Making the type non-nullable
  forces every reader to handle the sentinel — the compiler now enforces the contract rather
  than a convention. All three typechecks pass.
- **The empty-state distinction is preserved and tested.** The new test asserts both directions:
  a filtered miss offers a reset that genuinely changes the result, and an unpublished program
  says "No published sessions yet" and does *not* contain the "clear a filter" copy. Asserting
  the *absence* of the wrong copy is the assertion that would have caught the original bug.
- **The `← Agenda` links were made event-scoped**, not just present. A bare `/agenda` would have
  dropped the visitor onto whatever `findLiveEvent` picks; `?event=<slug>` keeps a deep-linked
  visitor inside the conference they arrived at. Same fix applied consistently to the session,
  speaker, and embed-config surfaces.
- **The EmbedPage finding was actually investigated, not waved at.** The conclusion is correct —
  the embed filters only track/status, so its reset target genuinely changes the result and it
  does not share the no-op defect — and the delegator still fixed the adjacent `/agenda` links
  there and added a regression test for the reset href.
- **The no-jump rule is respected.** `.active` changes only `border-color`/`background`/`color`
  at a fixed `flex: 0 0 96px`, and the overflow-x container absorbs a long day list instead of
  squeezing the track and search controls.
- **Budget discipline is real:** 91 tests in 23s against a 45s budget, and the branch leaves the
  tree clean.
