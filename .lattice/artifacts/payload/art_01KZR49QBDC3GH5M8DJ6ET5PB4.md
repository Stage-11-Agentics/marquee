# Code Review: MRQ-41 — Empty-state pass and craft sweep

**Reviewed HEAD:** `f8095d1` (branch `mrq-41-craft`, 4 commits over base `beadf6c`)
**Review basis:** The prompt's inline diff was truncated by Lattice (5,000 of 52,921 lines shown, nearly all `.lattice/` artifact noise from other tickets). I reconstructed the actual code diff from git (`beadf6c..mrq-41-craft`, excluding `.lattice/`): 33 files, ~158 insertions — all within the ticket's declared scope. I read the full diff, verified imports/types/CSS selectors against the worktree, and re-ran the gates myself in the worktree.

**Gates re-run by reviewer (all pass):**
- `node --test tests/node/empty-state.AC-161.test.mjs` — 3/3 pass
- `npm run check:design` — pass, no findings
- `npm test` — pass, hermetic, 20.2 s (within the 30 s budget)
- `npm run pr-gate -- --ticket MRQ-41` — pass (types, build, design, suite, AC trace: live=212, uncovered=0, errors=0)

## 1. Verdict

**FAIL (implementation-level)** — The plan is sound and the sweep is broadly well-executed, but the public agenda's new fresh-install empty state is unreachable dead code, and the empty state that *does* render on a fresh install offers a no-op action (a link that reloads the identical view). That is a dead-end on a public route — precisely what this ticket exists to eliminate. The fix is small; the task should return to `in_progress`.

## 2. Summary

MRQ-41 delivers a disciplined empty-state and craft sweep across admin, public, portal, embed, and fallback surfaces: a shared `EmptyState` with a reserved action slot, clear-filter vs. fresh-install branching, `—`/text placeholders, reserved geometry to prevent layout jumps, tabular numerals, and one-primary-action discipline. Contract constraints were respected (no `tokens.css` edits, no contract-doc edits, AC-161 ownership correctly left with MRQ-40). The one real defect: in `PublicAgendaPage`, `hasFilters` is always true because `data.filters.day` always defaults to a concrete date, so the fresh-install branch can never render and the filtered branch's "Show full agenda" action reloads the same empty state on a fresh install.

## 3. Issues

**[MAJOR] src/ui/public/agenda/PublicAgendaPage.tsx:174 — Fresh-install empty state is unreachable; the rendered action is a no-op loop**
`hasFilters = Boolean(data.filters.track || data.filters.q || (data.filters.day && data.filters.day !== "all"))` — but `data.filters.day` is never `null` or `"all"` on this route. `loadPublicAgenda` (src/lib/public-site.ts:447) sets `selectedDay = filters.allDays ? null : filters.day ?? event.startsOn`, and the `/agenda` route (src/routes/public-agenda.route.tsx:57) never passes `allDays` and has no `day=all` handling; the day tabs only emit concrete dates. So `filters.day` is always a real date and `hasFilters` is always `true`. Consequences on a fresh install with zero published sessions: (1) the new "No published sessions yet / Return to conference" branch is dead code; (2) the visitor instead sees "No published sessions match · Clear a filter…" with a primary "Show full agenda" link to `/agenda?event=<slug>` — which re-resolves to the same default day and re-renders the identical empty state. The action changes nothing: a dead end on a public route, contradicting both AC-161's intent (empty state naming a *working* next action) and the project's zero-dead-ends rule. Note that linking to `?day=all` is *not* a fix as the code stands — `selectedDay = "all"` would filter every session out (line 448–450 matches `session.date === selectedDay`).
**Fix:** Exclude the default day from the filter test — e.g. compute `hasFilters` from `track`/`q` only (day tabs are navigation, not a "filter" the user set), or have the route map `query.day === "all"` → `allDays: true` and link "Show full agenda" to `/agenda?event=…&day=all`. Either way, verify with a rendered walkthrough that a fresh install shows the "No published sessions yet → Return to conference" branch and that the filtered branch's action actually changes the view.

**[MINOR] src/ui/embeds/EmbedPage.tsx:297,302 — Empty-state links navigate inside the host page's iframe**
Embeds are designed to be iframed on third-party sites (the config page produces an iframe snippet). The new anchors ("Show all speakers", "Open the conference agenda") have no `target`, so clicking them navigates the *iframe* — the fresh-install case loads the entire public agenda page inside a ~170 px-tall embed frame on someone else's site. Also, the fresh-case `/agenda` link omits the `?event=` query and relies on the single-live-event fallback, while the filtered-case link in the same expression correctly carries `data.slug`.
**Fix:** Add `target="_top"` (or `_blank` with `rel="noreferrer"`) to the embed empty-state anchors, and pass `?event=${data.event.slug}` on the `/agenda` link for consistency.

**[MINOR] tests/node/empty-state.AC-161.test.mjs:782 — "Positive control" doesn't guard the real check**
The third test asserts that a hand-written string without `action=` fails a regex — but the main test uses `source.includes(marker)` against a hardcoded surface list, which cannot pass vacuously in the way the control implies (it would fail loudly on a missing file or marker). The control tests the regex, not the mechanism; it adds confidence theater rather than coverage. This is within the plan's acknowledged "cheap contract check" framing, so it's non-blocking — but worth either deleting or replacing with a control that exercises the actual marker check (e.g. asserting a deliberately wrong marker fails for a real surface).

**[MINOR] src/ui/comms/CommsScreen.tsx:317,378 — Inconsistent zero-count presentation between the two section counters**
The templates counter renders `{templates.length || "—"} available` (em dash at zero, per the house `—`-over-empty rule) while the outbox counter renders `{messages.length} message{…}` ("0 messages"). Both are fine in isolation; on one screen they're inconsistent.
**Fix:** Pick one convention for zero counts on this screen (the `—` form matches the ticket's own craft language).

## 4. Positive Observations

- **The shared `EmptyState` action slot is the right primitive.** Adding an always-rendered `.empty-state-action` div with `min-height: 30px` (src/ui/shell/components.tsx:607, src/styles/components.css:14) means action-less and action-bearing empty states occupy identical geometry — the house "elements never jump" rule enforced structurally, not per-callsite. The focused test asserts the reservation exists.
- **AC ownership seam handled exactly as planned.** `tests/ac-claims/MRQ-41.json` declares `owns: []`, `exercises: ["AC-161"]` with an explicit note deferring to MRQ-40 (verified: MRQ-40 owns AC-161) — no duplicate-owner drift, and the trace gate confirms merged coverage.
- **Filter-driven vs. fresh-install branching is done properly on the admin surfaces.** ProgramBoard (`hasFilters` from a clean `EMPTY_FILTERS` of all-empty strings), Onboarding, and Submissions all distinguish "clear filters" from "add the first record," each with a working action — the pattern the public agenda was meant to follow.
- **One-primary-action discipline was applied with actual judgment**, not mechanically: FormsPage demotes the catalog empty state's button because the page header already carries the primary "+ New form"; ApiTokensPage does the same (header keeps `button primary`, verified at line 197); DashboardPage conditionally demotes "Work the pipeline →" when the empty state carries the primary. This is the rare sweep that removed primaries where needed rather than only adding them.
- **Title truncation → 2-line clamp with reserved min-height** (`.program-board-card-title`, `.table-title`, `.portal-talk h3`) preserves distinguishing text for long/diacritic titles without variable row heights — both craft rules honored at once.
- **The comms outage-vs-empty distinction from plan-review cycle 1 is implemented faithfully:** per-panel copy switches on `templatesLoading`/`messagesLoading`/`error` so a failed read never masquerades as a fresh install, and the error banner's Retry (`reloadKey` bump) correctly re-arms the loading flags before refetching. The `#comms-compose-heading` anchor target exists.
- **Scope hygiene is clean:** no `src/styles/tokens.css` edits, no contract-document edits, no API/seam changes, all CSS additions in owning modules; the venues Rooms card even gained a sensible guard (`+ Add room` disabled with zero buildings, with copy explaining the ordering).
