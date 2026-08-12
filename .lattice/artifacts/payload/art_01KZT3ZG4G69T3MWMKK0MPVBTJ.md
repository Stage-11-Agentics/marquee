# Code Review: MRQ-94 — public agenda default scope, JSON link, and escape routes

**Reviewed:** `mrq-94-public-agenda` @ `137da0c` (worktree `Marquee-worktrees/mrq-94-public-agenda`), diffed against `main` @ `ce67ead`.
**Note:** the branch moved during this review — `137da0c "MRQ-94: sync public API registry digest"` landed mid-pass, and it fixes an OpenAPI-digest drift (`cli/api-registry.json`) that would otherwise have failed `check:api`. Good catch by the implementer; that issue is closed and is not listed below.

**Verification performed:** read the four source files and their call sites (`public-agenda.route.tsx`, `public.routes.ts`, `EmbedPage.tsx`, `landing.route.tsx`); ran the focused integration file (8/8 pass, 3.6s) and the full `npm test` (91 pass, 0 fail, `pass-over-budget` at 74.7s — machine contention, not a defect per project `CLAUDE.md`); inspected both committed evidence screenshots.

---

### 1. Verdict

**FAIL (implementation-level)**

The plan's judgment call is right and the server/UI contract it produces is clean. Three things need fixing before this ships, all small: a screenshot-confirmed text-clipping regression in the day tablist the ticket asked for, an undeclared deviation from `SPEC.md` §5.12, and a brand link that now exits the conference site into the operator/product landing page.

### 2. Summary

The core defect is genuinely fixed: `loadPublicAgenda` no longer silently defaults to day one, `filters.day` carries an honest `"all"` sentinel that the UI and the API agree on, `hasFilters` is true only for filters a visitor chose, the reset link measurably changes the page, and the raw JSON link is gone. The embed surface was correctly investigated and correctly left alone (`EmbedPage.tsx:203` filters on track/status only and loads with `allDays: true`, so it never had the no-op defect) — that finding matches the plan.

The key finding is visible in the implementer's own evidence: adding `white-space: nowrap` to a fixed-72px tab clips every day label (`Wed, Oct 14` renders as `Wed, Oct 1`). Secondary findings are scope/premise issues — the shell now drops a button `SPEC.md` requires, and points the conference brand at Marquee's product landing.

### 3. Issues

**[MAJOR] src/ui/public/agenda/PublicAgendaPage.tsx:53 — Every day tab label is clipped**

`.public-days button` gained `white-space: nowrap` while keeping `flex: 0 0 72px; width: 72px`. Previously the label wrapped to two lines inside the 72px box; now it is forced onto one line and overflows the button, which clips it. Both committed screenshots show it: `docs/evidence/mrq-94/agenda-all-days.png` renders `Mon, Oct 12` cut at the border and `Wed, Oct 14` as `Wed, Oct 1`. At 10px mono, `Mon, Oct 12` is ~66px of glyphs plus UA button padding (~12px) — it cannot fit in 72px. This is the exact control the ticket asked to add and get right, on the conference front door, on the walkthrough path.

**Fix:** widen the reserved tab to fit the longest label — `flex: 0 0 96px; width: 96px` clears `Wed, Oct 14` and `All days` at 10px mono — or drop `white-space: nowrap` and keep the previous two-line wrap. Either way the width stays uniform across tabs, so the no-jump constraint still holds. Re-shoot the evidence screenshot afterward; the current one documents the bug.

**[MAJOR] src/ui/public/agenda/PublicAgendaPage.tsx:148-150 — `Organizer demo` removed, contradicting SPEC.md §5.12**

`SPEC.md:505` binds this surface: *"Public shell with `Get embed code` and `Organizer demo`."* The diff deletes the `Organizer demo` button, and `tests/integration/public-site.AC-83-86-240-252-253.test.ts:175` locks the removal in with `expect(defaultBody).not.toContain(">Organizer demo</a>")`. Neither the ticket nor the plan asked for this — the plan's step 2 lists only the JSON link and the brand href. A judge landing on the public agenda now has exactly one labeled action, `Get embed code`, and no labeled route into the demo.

**Fix:** restore the `Organizer demo` button (and drop that assertion), or amend `SPEC.md` §5.12 in this PR and say plainly in the description that the shell contract changed and why.

**[MAJOR] src/ui/public/agenda/PublicAgendaPage.tsx:145 — The brand now leaves the conference for the product landing**

`/` is not a conference landing page. `landing.route.tsx:147` renders Marquee's product page: *"Open-source conference program operations"*, `Enter as organizer`, `Enter as speaker`, `View on GitHub`, and a live pipeline panel with submitted / in-review / accepted counts, *"N abstracts still need review in Agents"*, *"N accepted speakers are overdue"*. The ticket's phrase "the conference landing page (`/`)" was a false premise, and the implementation adopted it literally. The consequences:

- An attendee clicking what is labeled with **the conference's own name** is thrown to the vendor's product page showing operator program-operations counts. That is the same category of leak point 2 of this ticket was about — not advertising operator/developer artifacts to attendees.
- The AC asks that a visitor "reach the conference home in one click." After this change the public site's only conference home is `/agenda`, and nothing on the agenda page links to it.
- `aria-label={`${event.name} — Marquee home`}` names two different destinations in one label: a screen-reader user hears the conference name and is told it is Marquee home.

**Fix:** make the brand the conference home — `href="/agenda?event=<slug>"` on `/s/:slug`, `/p/:slug`, and the embed-config page — and on `/agenda` itself render it as a non-interactive `<span>` (or keep the link with `aria-current="page"`), which satisfies "never a self-link" without leaving the conference. Keep the product exit as its own labeled control (see the previous finding). If the operator does want the brand pointing at `/`, that is their call, but it should be stated in the PR rather than inherited from the ticket's wording.

**[MINOR] Process — branch not pushed, no PR, live-site validation not performed**

`github/mrq-94-public-agenda` holds only the plan commit (`32045f2`, a different SHA than the local `65c1259`); the four implementation commits are local-only and no PR exists against `Stage-11-Agentics/marquee`. The AC also asks for live-deployed-site validation with before/after screenshots; the plan deliberately declines this ("Do not deploy or claim live-site validation"), which is defensible given `DEPLOY.md` (merging does not ship) — but it is a deviation from a written AC.

**Fix:** push, open the PR, and state the deviation explicitly: local-Worker evidence attached, live validation deferred to the post-merge deploy, with the before/after empty-state pair called out.

**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:52, :96 — Mobile day row can scroll inside its reserved height**

The `@media (max-width: 760px)` rule `.public-days button { flex: 1; width: auto; }` was removed and replaced by `overflow-x: auto` on the container. A 3-day event is 4 tabs × 72px + gaps = 300px, which fits a 375px viewport — but at the 96px width the previous finding needs, or on a 4+ day event, the row overflows and scrolls. Two consequences: on platforms without overlay scrollbars a persistent scrollbar eats into the `min-height: 38px` box, and a visitor whose selected day has scrolled out of view sees no active tab (nothing scrolls it into view).

**Fix:** hide the scrollbar (`scrollbar-width: none` plus `::-webkit-scrollbar { display: none }`) and either restore shrink-to-fit at mobile (`flex: 1 1 <width>; min-width: 0`) or add a small inline script to scroll the active tab into view on load.

**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:230 — "Return to conference" points away from the conference**

The genuinely-empty state's button reads *"Return to conference"* and links to `/` — the Marquee product landing. Pre-existing copy, but this ticket is about honesty in exactly this empty state, and `/` is now also where the brand goes, so the page's only two escapes both leave the conference.

**Fix:** point it at the conference home (`/agenda?event=<slug>`) once the brand question above is settled, or relabel it to what it actually does.

**[MINOR] src/lib/public-site.ts:481 — Three spellings of "whole program"**

`filters.allDays || !filters.day || filters.day === "all"` now carries a boolean flag, an absent value, and a string sentinel that all mean the same scope. It is correct and covered, but `allDays` has become redundant with `day: "all"` at the three internal call sites (`:505`, `:518`, `:674`).

**Fix:** optional follow-up — collapse `allDays` into `day: "all"` and delete the flag from `PublicAgendaFilters`.

**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:241, :273 — `← Agenda` drops the event scope**

The detail-page back links are bare `/agenda` with no `event=`. `findLiveEvent` (`public-site.ts:205-211`) with no slug orders by `demo_mode DESC`, so on a multi-event deployment a visitor who deep-linked to event B's session lands on the demo event's agenda. Pre-existing, not introduced here, but it sits directly under this ticket's "a real, always-available way home."

**Fix:** carry the event through — `href={`/agenda?event=${encodeURIComponent(event.slug)}`}`.

### 4. Positive Observations

- **The judgment call is right and is stated in one sentence, as asked.** Whole program by default is the correct front door, and the `day="all"` sentinel is the cleanest way to make the server's scope and the tab's selected state the same value — no second source of truth, no "is it null or is it a date" ambiguity at the UI boundary. Tightening `filters.day` from `string | null` to `string` makes that guarantee a type, not a convention.
- **The embed constraint was actually investigated, not hand-waved.** `EmbedPage`'s `hasFilters` reads only real filters and its loader passes `allDays: true`, so it never had the no-op defect — the plan says so and the new assertion at `tests/.../test.ts:287-291` proves the reset link works rather than asserting the absence of a bug.
- **`PUBLIC_AGENDA_SCRIPT` catching the submitter is a real fix nobody asked for.** Passing the active day button to `requestSubmit` means changing track or typing a search no longer silently drops the day — previously that only appeared to work because the server re-applied the day-one default. Fixing it while removing the default is the difference between a patch and an understanding.
- **Test coverage is behavioral and reads as a contract.** The new tests drive real HTTP requests and assert what a visitor sees — the whole program by default, the active tab, both empty-state copies, the absent JSON link, the API scope — instead of poking internals. They also correctly leave the DB mutations to `beforeEach`'s wipe-and-reseed rather than hand-rolling cleanup.
- **Registry digest caught unprompted.** Changing the route description changes the served OpenAPI document, which `check:api` compares by hash; catching and committing that (`137da0c`) is precisely the kind of gate failure that usually surfaces only in CI.
