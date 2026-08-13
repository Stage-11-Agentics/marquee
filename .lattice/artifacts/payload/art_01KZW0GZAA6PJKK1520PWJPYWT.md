# Plan Review: MRQ-155 — V2-6: publication is a status the organizer can set, and unset

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The submitted "plan" is a verbatim copy of the task description: same five paragraphs, no
implementation steps, no files named, no test plan, no API shape, no decision about where the
control lives. Beyond the missing plan, the brief's own premise is stale against `main` — a
per-session publish endpoint and a record-page publish control already exist — and the real work
(the `is_published = 0` transition) has three concrete hazards the plan must name: publish writes
**two** tables that unpublish has to reverse symmetrically, a hard `check:api` registry-parity gate
fires the moment a new operation is added, and the eval item this ticket exists to close (CNT-12)
requires the control to be *visible on an unpublished session*, which the current `can_publish`
predicate would hide.

## 3. Issues

**[CRITICAL] Whole plan — There is no plan, only a restated ticket**
The Plan section reproduces the Task Description word for word (HUMAN PROBLEM / GOOD LOOKS LIKE /
CLOSES / VERIFY). Nothing in it identifies a file, an endpoint path, a request/response shape, a
UI state, or a test. Every checklist category below — completeness, feasibility, AC coverage — has
nothing to evaluate against. A delegator picking this up cold gets exactly what the ticket already
gave them.
**Recommendation:** Return to `in_planning` and produce a plan that names, at minimum: (a) the new
route and its `operationId` in `src/routes/submission-record.routes.ts` (alongside
`publishSubmission`, line 885, registered in the `apiRoutes` export at line 919); (b) the
`actions.can_unpublish` addition at line 556 and its mirror in the `RecordData` interface at
`src/ui/submissions/SubmissionRecordPage.tsx:38`; (c) the control's placement and copy; (d) the
regeneration step for `cli/api-registry.json`; (e) the tests. Roughly ten lines of real plan.

**[CRITICAL] "GOOD LOOKS LIKE" — The premise is stale: per-session publish already ships**
The brief reads as if publishing were batch-only. It is not. `POST
/api/v1/events/{eventId}/submissions/{submissionId}/publish` exists
(`src/routes/submission-record.routes.ts:885–917`), `actions.can_publish` is already computed
(line 556), and the record page already renders a "Public site" card with a **Publish Session**
button behind `window.confirm` (`SubmissionRecordPage.tsx:162`). Conversely, the "batch flow" whose
"confirmation gravity" the plan says to match **does not exist in the codebase** — `POST
/agenda/publish` is listed in `SPEC.md:387` but no such route is implemented (no publish path in
`src/routes/agenda.routes.ts`). An implementer following the plan literally could rebuild publish,
or stall looking for a batch flow to imitate.
**Recommendation:** State the actual delta: **one new endpoint (unpublish), one new action flag,
one new button, one audit action.** Explicitly rule the batch flow out of scope, and define
confirmation gravity as the existing `window.confirm` pattern with consequence-naming copy — e.g.
"Remove this Session from the public site? Attendees will no longer see it on the agenda."

**[CRITICAL] API — Publish writes two tables; unpublish must reverse both**
`publishSubmission` sets `agenda_items.is_published = 1` **and** `submissions.is_published = 1` in
one batch (lines 911–912). The read paths disagree about which flag they trust: `/site` gates on
`ai.is_published = 1` only (`src/lib/public-site.ts:316`), the derived stage predicate keys off the
agenda flag only (`src/routes/submissions.queries.ts:128–129`), the record projection reports
`submissions.is_published` (line 523), and the ICS feed requires **both**
(`src/routes/calendar.route.ts:41`). Clearing only the agenda row would pass the ticket's VERIFY
step while leaving the record claiming it is published and the calendar feed in a mixed state.
**Recommendation:** Plan the unpublish handler as the exact mirror of publish — a `db.batch` of two
UPDATEs plus `audit(..., "unpublished", ...)` — and assert both flags in the test.

**[CRITICAL] Alignment — As scoped, the control may not close CNT-12**
CNT-12's pass criteria (`.eval-kit-agent/specs/04-content-management.yaml:284`) and scenario CNT-S3
step 11 require the judge to screenshot "the status control **on both sessions**": approve one,
leave the other unapproved. Today `can_publish` is `slot !== null && !slot.is_published && status
=== 'accepted'`, and the whole "Public site" card is conditionally rendered behind it
(`SubmissionRecordPage.tsx:162`). The scenario's two sessions are created by the eval agent in
earlier areas, not seeded — an unscheduled one shows **no control at all**, which is precisely the
absence the last run's judge recorded ("searched for and did not find a content-approval status").
Adding an unpublish button to a card that only appears when publishing is already possible does not
by itself fix that.
**Recommendation:** Make the panel **always render** for a session record, with the control disabled
and a reason when it cannot act ("Schedule this Session before it can go public") — the same
"disables, never disappears" rule Amendment 18 already applies to the embed dialog
(`SPEC.md:509`). Define `can_unpublish = slot !== null && slot.is_published` with **no status gate**
(the cancelled-speaker case is exactly a non-`accepted` record that must still be pullable).

**[MAJOR] Feasibility — A new endpoint trips the `check:api` registry gate**
`check:api` compares served OpenAPI operations against `cli/api-registry.json` and also against its
stored `documentSha256` (`scripts/checks/check-api.mjs:162–185`); `cli/` exists, so this half is
live, not skipped. Adding one operation fails the gate on both counts until the registry is
regenerated. `SKILL.md` has a matching staleness check (`cli/generate-skill.mjs:118`).
**Recommendation:** Add an explicit plan step: `npx vite build` → `node
cli/generate-api-registry.mjs` → `node cli/generate-skill.mjs`, then `npm run pr-gate`. Commit the
regenerated `cli/api-registry.json` (and `SKILL.md` if it changes) with the code.

**[MAJOR] Completeness — No tests named**
The plan proposes no test at all, in a repo whose convention is AC-keyed suites
(`tests/integration/api/submission-record-board.AC-118-120-238-240-243-251.test.ts`,
`tests/integration/public-site.AC-83-86-240-252-253.test.ts`,
`tests/integration/cascade-reversal.AC-121-123.test.ts`). A one-line manual VERIFY is not a
regression guard, and nothing today ever writes `is_published = 0` — this is a genuinely new
transition.
**Recommendation:** Name the cases: unpublish a published session → 200, both flags 0, audit row
written; the `/site` agenda query no longer returns it; publish again → it returns; unpublish an
unscheduled or never-published record → 409 with a readable message; `can_unpublish` true for a
published-then-withdrawn record. Extend an existing suite rather than minting a new AC ID (per the
"AC IDs are minted only at consolidation" rule).

**[MAJOR] UI — The new call must carry its route template**
`apiFetch` takes a `route` template used for API traffic parity (`SubmissionRecordPage.tsx:94–102`;
constants at lines 12–18). A hand-built fetch or a missing `route:` argument silently breaks that
accounting.
**Recommendation:** Add an `UNPUBLISH_ROUTE` constant next to `PUBLISH_ROUTE` and route the call
through the existing `act()` helper, exactly as publish does.

**[MAJOR] Risk — "No public-side work" is true for `/site`, not for `/embed/:slug`**
Embeds are KV-cached with a 30s logical TTL, and `purgePublicEmbedCache`
(`src/lib/public-site.ts:778`) carries the doc comment "Call this from the agenda publish
mutation" — yet **no production route calls it** (only tests do). An unpublished session therefore
keeps appearing in embeds for up to 30s. Within AC-89's 60s budget, so not a gate failure, but a
judge screenshotting an embed right after unpublishing will see the session still there.
**Recommendation:** Decide explicitly in the plan: either call `purgePublicEmbedCache(context.env.CACHE,
{ eventId })` from both publish and unpublish (two lines, closes a documented gap), or state the
≤30s lag as accepted and keep the VERIFY step on `/site`.

**[MAJOR] Risk — Concurrent edits to the same record page**
V2-4 (`MRQ-154`, in progress) adds a headshot control and an "Open portal as this speaker" header
action to the same `SubmissionRecordPage.tsx` and the same record projection. The brief flags this
hazard for V2-1/MRQ-148 but calls V2-6 "independent" — independent of the agenda grid, not of the
record page.
**Recommendation:** Add a sequencing line: coordinate with the V2-4 delegator or start after its PR
is cut. Keep this ticket's diff confined to the slot/publish panel, the `actions` object, and the
new route.

**[MINOR] API — Audit action naming and history legibility**
`audit_log.action` has no CHECK constraint (`migrations/0001_init.sql:701–712`), so `"unpublished"`
needs no migration — worth stating, since a reader may assume otherwise. The record's history panel
renders audit entries directly, so the string chosen is operator-visible.
**Recommendation:** Use `"unpublished"` to pair with the existing `"published"`, and include
`{ agenda_item_id, is_published: false }` in `after_json` to mirror the publish call at line 914.

**[MINOR] UI — The toggle must not resize the panel**
"Publish Session" and "Unpublish Session" are different widths; swapping them in place will move
everything beside them. This violates the standing craft rule (elements never jump) that the record
page already honors elsewhere (`FileAnswer`'s fixed crop, `SubmissionRecordPage.tsx:53–66`).
**Recommendation:** Reserve a fixed width for the action button and a min-height for the status
line, so publishing and unpublishing leave the layout still.

## 4. Positive Observations

- The scope is genuinely small and correctly bounded: one transition, one control, no migration, no
  public-side rendering work. That judgment is right — `/site` really does gate on the flag
  (`public-site.ts:316`), so the read path needs nothing.
- The VERIFY line is concrete and end-to-end (unpublish → gone from `/site` on reload → publish back
  → returns), which is exactly the shape a real-artifact smoke check should take.
- The ticket correctly identifies *why* this is worth doing at all: a `cannot_judge` costs nothing
  today but caps the achievable score, which is a sharper argument than "add a feature."
- The reference to the reversal path as the audit precedent is the right instinct — the existing
  `audit(...)` helper (line 177) is the pattern to copy, and it takes a free-form action string.
