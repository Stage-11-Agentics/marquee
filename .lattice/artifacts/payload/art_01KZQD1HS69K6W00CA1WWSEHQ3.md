# Plan Review: MRQ-20 (M-19a — Agenda: data, pool, placement, day/list/week/room views)

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. Two major cautions below should be honored during implementation (they are scope-boundary clarifications, not gaps requiring re-planning).

## 2. Summary

Reviewed the MRQ-20 implementation plan against the task description, BUILDPLAN §4 (M-19a/M-19b rows), SPEC.md (agenda_items schema, schedulability, Amendment 11), EVALUATION.md AC methods, and the live codebase. The plan is well-grounded: every infrastructure claim it makes checks out — the `_manifest.ts` glob auto-registration (`src/routes/_manifest.ts:19`), the `agenda:write` grant (already in `src/api/grants.ts`), `event_settings` (migrations/0001_init.sql:714), `agenda_items`/`buildings`/`rooms` with `building_id`/`av_capabilities`/`notes` all pre-existing in migration 0001, the `/agenda-builder` entry already stubbed in `route-table.ts:27`, and the `pr-gate`/`trace:ac`/`check:design` scripts. The key concerns are boundary clarity with M-19b (Track swimlane and conflicts are *not* this ticket) and stating explicitly how the `e2e:`-method ACs get their evidence.

## 3. Issues

**[MAJOR] Agenda UI §2–3 — Track tab treatment vs. AC-80's 20 view pairs is left ambiguous**
The BUILDPLAN scopes M-19a as "day/list/week/room views"; the true Track swimlane (`src/ui/agenda/track-board.tsx`) is M-19b, which depends on this ticket. Yet M-19a owns AC-80, whose EVALUATION method is "all 20 ordered view pairs; assert scroll offset and active filters survive each switch" — which requires all five tabs to exist and be switchable. The plan says "five view tabs" and mentions "grid/list/swimlanes" without stating what the Track tab renders in M-19a. If the implementer builds a real swimlane, they duplicate M-19b; if they omit the tab, AC-80 cannot be satisfied.
**Recommendation:** Add one sentence: the Track tab ships in M-19a as a simple, functional grouped-by-track view (enough to hold scroll/filter state for AC-80's transitions), deliberately leaving the true swimlane, lane boxes, and `track-board.tsx` to M-19b. Do not create `track-board.tsx` or `src/lib/conflicts.ts` in this ticket.

**[MAJOR] Agenda UI §5 — Conflicts panel and travel warnings creep into M-19b's scope**
"Surface the deliberately seeded double-bookings and any query-derived travel warnings on tiles and in an accessible conflicts panel" describes M-19b's contract: conflict computation over rooms and participation roles, tile flags, and the conflicts drawer are AC-75–AC-79/AC-81, owned by M-19b with its own file surface. The plan itself correctly refuses to claim those ACs, but then proposes building the surface anyway — unowned work inside a 7-hour ticket, likely to be rebuilt or collided-with by M-19b.
**Recommendation:** Trim to the warn-never-block *placement behavior* only (drops always persist even into an occupied slot — needed so M-19a is honest without blocking). Defer tile conflict flags, the conflicts panel/drawer, and travel-warning computation to M-19b. Keeping the `[⚠ N conflicts]` head action as a count-only placeholder is acceptable; a full panel is not.

**[MINOR] AC evidence §1 — `e2e:`-method ACs are evidenced only by helper-level tests**
AC-70, AC-73, AC-74, AC-80, and AC-82 all carry `e2e:` methods in EVALUATION §evidence, but the verification section proposes only AC-tagged Vitest coverage "against the exported query/API/UI helpers" and never runs `npm run e2e` or adds Playwright specs. If the project's convention defers e2e authoring to the walkthrough/sweep suite ticket, that's fine — but the plan should say so rather than silently substituting unit tests for e2e methods.
**Recommendation:** State explicitly where AC-70/73/74/80/82's e2e evidence lands (this ticket's Playwright specs, or deferred to the e2e suite with helper tests as interim evidence), so `trace:ac` lineage and the completion comment are honest about method coverage.

**[MINOR] API and query layer §1 — `src/api/agenda.ts` is outside the declared file surface**
The ticket's file surface is `src/routes/agenda.routes.ts`, `agenda.queries.ts`, `src/ui/agenda/*`. Adding `src/api/agenda.ts` follows the existing convention (`src/api/submissions.ts` exists) and is almost certainly right, but it widens the declared surface on a ticket whose shared-files claim is "none — module-local."
**Recommendation:** Keep it — the convention match is worth more than surface literalism — but name the addition in the completion comment so the Orchestrator's shared-file bookkeeping stays accurate.

## 4. Positive Observations

- **Every codebase claim in the plan verifies.** The glob-based route registration, `defineApiRoute`, event-scoped joins, `If-Match` CAS, the pre-existing `agenda:write` grant, `event_settings` key-value storage, and the already-stubbed `/agenda-builder` route-table entry all exist exactly as the plan describes. This is a plan written against the real repo, not an imagined one.
- **The F-17 dependency insight is preserved.** The plan keeps the pool status-derived (default `accepted`, exclusion by existing agenda item), which is precisely what lets M-19a proceed without M-16 — the schedule win the task description exists to protect.
- **Boundary discipline is mostly explicit.** MRQ-62's venue-geography ownership is called out twice (read-only consumption, no seeding), Month view is correctly excluded, the program board stays read-only, and AC-75/MRQ-19b conflict ACs are explicitly not claimed in `ac-claims`.
- **The Amendment 11 fold is handled with the right asymmetry:** "Room · Building" headers plus the AV/notes panel on the organizer agenda only, with an explicit assertion that no AV/notes metadata leaks to public surfaces — matching AC-253's "absent from all public surfaces" clause.
- **The MRQ-62 AC-252/253 assignment tension is pre-flagged** with a concrete resolution rule (follow this ticket's boot scope, flag the split in the completion comment) rather than left to surprise the implementer.
- **The verification gauntlet is complete and ordered** (targeted tests → full suite → three TS surfaces → build → `check:design` → `trace:ac` → `pr-gate` → live-runtime probe → self-review at exact HEAD), with a recorded green baseline before edits.
