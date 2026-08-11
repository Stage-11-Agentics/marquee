# Plan Review: MRQ-62

### 1. Verdict

**FAIL (plan-level)**

### 2. Summary

I reviewed the plan against the operator's venue ruling (comment `ev_01KZQART4MRVQVJXCEF28TVEJ9`), SPEC Amendment 14, BUILDPLAN M-57, EVALUATION.md's AC-252–AC-259 definitions, the boot brief, the current seed (`scripts/seed/event.ts`), the check harness (`trace-ac.mjs`/`trace-ac-core.mjs`, `check-repo.mjs`/`repo-policy.mjs`, the `check:seed` stub), and the live task board. The core of the plan is strong and verified-correct: the Marriott Marquis choice satisfies the ruling's constraints (I independently computed the haversine — ~592 m ⇒ `floor(592 × 1.3 ÷ 80)` = 9 minutes, inside the ruled 8–12 window, and the coordinate matches 1535 Broadway), the live-conflict `check:seed` requirement is honored, and the non-goals are clean. It fails on three plan-level gaps: AC-257's `check:repo` static clause is never implemented anywhere in the plan, the AC-252/AC-253 ownership claims are not scoped against surfaces that don't exist yet (arming a false `trace:ac` green), and the plan treats in-flight MRQ-10 as "future" work when it is `in_progress` on the very `/settings` surface this plan also builds. All three are cheap to fix in a plan revision and expensive to discover at code review.

### 3. Issues

```
**[MAJOR] Slices 4/5 — AC-257's check:repo clause is not implemented by any plan step**
EVALUATION.md AC-257 (owned by this ticket per the plan's own claims file) ends with a
static requirement: "`check:repo` greps the tree for third-party map CDN hosts and map
API keys and fails on either." `scripts/checks/repo-policy.mjs` currently contains no
map-host or API-key deny patterns — the guardrail does not exist. The plan's only nod is
"design/repo checks as applicable" in slice 5, which *runs* check:repo but never *extends*
it. The failure mode is silent: check:repo passes trivially, an `AC-257 · …`-titled test
satisfies trace:ac, pr-gate goes green, and the AC ships partially unmet with nothing in
the harness able to notice.
**Recommendation:** Add an explicit step to slice 4 or 5: extend `repo-policy.mjs` with
deny patterns for known map CDN/library hosts (e.g. unpkg/cdnjs leaflet, mapbox, maps
.googleapis, api key query-param shapes) with an allowance for the sanctioned OSM raster
host, plus a test that the policy fires on a fixture violation.
```

```
**[MAJOR] Slice 5 — AC-252/AC-253 ownership is unscoped against surfaces that do not exist, over-reporting trace:ac coverage**
The operator ruling legitimately moves AC-252/AC-253 ownership to MRQ-62 (and trace-ac-core
only rejects duplicate *owners*, so MRQ-4's `exercises: ["AC-252"]` does not conflict).
But most of AC-252's text — "agenda room headers, room view, public session pages, and ICS
`LOCATION` all render 'Room · Building'" — and AC-253's "rendered in the agenda room-header
tooltip/panel; absent from all public surfaces" name surfaces owned by backlog tickets
(agenda MRQ-20/21, public site MRQ-22, ICS MRQ-25). In merged scope, trace:ac enforces
every *owned* AC and is satisfied by any test titled `AC-252 · …`; the moment
`tests/ac-claims/MRQ-62.json` owns these ACs with a test covering only the venues-CRUD and
check:seed clauses, `npm run trace:ac` reports them covered while the majority of their
clauses are unverifiable by anyone. This is the same over-claim class the MRQ-61 plan
review flagged, and this plan repeats it.
**Recommendation:** In slice 5, enumerate which clauses of AC-252/AC-253 the MRQ-62 tests
actually exercise now (venues CRUD, §6 building-set assertion in check:seed, "Room ·
Building" in surfaces that exist) and state in the plan and the PR description that the
agenda/public/ICS render clauses are deferred to M-58/M-59 tickets. Keep ownership (the
ruling assigns it) but make the claim file and test titles honest about partial coverage.
```

```
**[MAJOR] Slice 4 / Risk — MRQ-10 is in_progress on the same /settings surface; the plan calls it "future" and has no coordination story**
MRQ-10 ("Event settings: details, formats, tracks, rooms, buildings") is `in_progress`
right now, and per the ruling it ships details/formats/tracks on `/settings` with the link
through to `/settings/venues`. On master, no settings screen exists at all (`src/ui/` has
no settings module; `route-table.ts:31` is the only trace) — so "strip venue editors from
/settings" is vacuous against master, and the plan's second slice-4 bullet ("Render
/settings as a settings summary with building/room counts and a link") builds a screen
MRQ-10 is concurrently building on its own branch. The plan's only mention is "future
details, formats, and tracks work from MRQ-10," which mischaracterizes an active
collision as a future one. Both branches will also touch `route-table.ts`. Whoever merges
second inherits a conflict on exactly the screen AC-256's "/settings renders zero
venue-editor selectors" assertion targets.
**Recommendation:** Add a coordination paragraph: check MRQ-10's branch state before
building `/settings`; keep MRQ-62's `/settings` footprint minimal (counts + link only, or
skip it if MRQ-10's summary lands first and rebase the AC-256 selector assertion onto it);
name the expected merge order or the rebase obligation explicitly so the Orchestrator can
sequence the two PRs.
```

```
**[MINOR] Slice 3 — per-route policy, rate-limit bucket, and response schemas undeclared**
`defineApiRoute` requires a full auth policy, a rate-limit bucket, and a complete Zod
responses map per route (the MRQ-61 review established this is real authoring work, not a
mechanical step). The plan names two endpoints (event-scoped GET, atomic save) and their
validations but never states the auth kind, which bucket (`read`/`write`) each uses, or
the error-envelope shapes for the validation failures it enumerates. Only two routes, so
this is minor — but it's the part of slice 3 most likely to stall or get improvised.
**Recommendation:** One line per endpoint in the plan: auth policy, rate bucket, success
schema, and the error codes the validation rules map to.
```

```
**[MINOR] Slice 3 — deletion semantics for in-use rooms/buildings unaddressed**
The atomic save "applies deletions/upserts in one D1 batch" and validates room-building
references, but says nothing about deleting a room that seeded agenda sessions reference
(or a building with rooms). Depending on the FK behavior in 0001, the batch either fails
opaquely or orphans session placements — an edge the venues UI's "remove" affordance will
hit on the first demo drive, since every seeded room is scheduled.
**Recommendation:** State the rule (block deletion of in-use rooms with a spoken error, or
cascade — blocking is the honest choice for an operator tool) and add it to the writer's
validation tests.
```

```
**[MINOR] Slice 1 — seed reshaping has downstream test/contract ripple the plan doesn't mention**
Renaming the annex building/room identifiers and inserting a deliberate insufficient-gap
placement touches data that existing merged tests and the seeded-ugliness contract
(PROTOTYPE-CONTRACT.md: the two live double-bookings, workshop-room parallelism) already
depend on. The plan runs the full suite, which will catch hard breaks, but doesn't
acknowledge that the Transit candidate must be added *without* disturbing the asserted
ugliness set — a quiet way to trade one seeded guarantee for another.
**Recommendation:** Add a check to slice 2's live seed proof that the pre-existing
deliberate-ugliness invariants still hold alongside the new Transit conflict.
```

### 4. Positive Observations

- **The binding venue decision is verified, not asserted.** The ruling delegates the venue
  choice within constraints (real, verifiable, ~8–12 min walk, plausible overflow), and the
  plan's Marriott Marquis pick satisfies every one — I recomputed the walk independently and
  got the plan's 9 minutes from the plan's own coordinates, which match 1535 Broadway. The
  plan even applies the ruling's *spirit* by renaming the "Annex" identifiers so the public
  seed doesn't mislabel a real hotel.
- **The live-conflict requirement is taken at full strength.** Slice 2 builds exactly what
  the ruling demands — `check:seed` observing an actual Transit conflict via the real
  detector against real seed rows, plus the explicit "non-zero column is not enough"
  assertions (two distinct pinned buildings, Online null round-trip). This is the ticket's
  whole reason to exist and the plan nails it.
- **Ownership discipline on AC-259 is correct**: exercised, not owned, matching the
  `owns`/`exercises` split that `trace-ac-core.mjs` actually enforces, and leaving
  ownership free for M-58.
- **Prototype divergence handled per instruction** — v1.7 stays untouched and the 2025
  building-set contradiction is flagged to the Orchestrator rather than silently patched,
  exactly as the boot brief demands.
- **Conventions are respected throughout**: `*.routes.ts` for the manifest glob, additive
  0003 migration against immutable 0002, `/api/v1/events/...` per Amendment 13, conference
  vocabulary in UI copy, branch/PR/pr-gate sequence matching the boot brief verbatim.
- **Non-goals are sharp** — no prototype edits, no AC minting, no map SDK/CDN/key, and the
  M-58/M-59 seam is named rather than partially implemented.
