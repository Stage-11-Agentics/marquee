# Plan Review: MRQ-184 — EMB-15 embed builder gaps

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The submitted "plan" is a verbatim, byte-for-byte copy of the task description — every heading,
quote, and constraint reproduced unchanged, with no planner-added content of any kind. The task
description is unusually good (the judge enumerated the work), which may make copying it feel
sufficient, but a plan must still make the implementation decisions the description deliberately
leaves open: which files change, how per-field selection is encoded and persisted without a
migration, where the two new output formats are rendered, what the root cause of the two builder
defects is, and what the regression tests look like. None of that exists here. The task should
return to `in_planning`.

## 3. Issues

**[CRITICAL] Whole plan — The plan is a copy of the task description, not a plan**
Lines 95–175 of the plan are identical to the task description (lines 14–92). A restated goal
is not an approach: nothing in the document is falsifiable at review time, so this review can
only validate the task author's work, not the implementer's intent. Every checklist category
below fails vacuously — no files, no design decisions, no sequencing beyond what the task
already imposed, no test plan.
**Recommendation:** Rewrite the plan as the implementer's document. It can and should quote the
acceptance list, but the body must be: files to touch, per-gap design decisions, defect root
causes (from reading the code, not the judge's screenshots), test list, and commit/PR sequencing.
The concrete decisions the plan must make are itemized in the issues below.

**[MAJOR] What to build §1 (per-field selection) — No persistence design, and the no-migration constraint is undischarged**
The task says "No migration without the operator. If saved-embed configuration needs a new
column, stop and say so." The plan neither claims a migration is needed nor shows why it isn't.
In fact the codebase already answers this: `EmbedRow` has a `config: JsonText` column
(`src/db/schema.ts:704`), so field selection can live as a key inside the existing JSON config
with no schema change — but the plan has to say that, plus the backward-compatibility rule
(absent key ⇒ all fields on, so existing saved embeds render unchanged, which is its own
acceptance bullet). It must also decide how fields are encoded in the snippet URL for unsaved
configurations, and enumerate the field set per surface (agenda, sessions, speakers, cfp — the
four `EMBED_KINDS`).
**Recommendation:** State explicitly: fields stored in the `config` JSON (no migration; discharge
the constraint in writing), absent-key defaults to all-on, the query-param encoding for the
snippet, and the per-surface field lists with which file defines them.

**[MAJOR] What to build §§2–3 (basic HTML, XML) — No statement of where output formats are produced or what the new ones emit**
`EMBED_OUTPUT_FORMATS` is currently `["html","json","ical"]` in `src/db/schema.ts`, and the
render/API surfaces are `src/routes/embed.route.tsx`, `src/routes/embeds.routes.ts`, and the
builder UI `src/ui/embeds/EmbedPage.tsx`. Adding two formats touches a typed const, the server
render path, the snippet generator, and the preview — the plan names none of them. It also
doesn't define what "basic HTML" means concretely (semantic markup with no styles at all? class
hooks but no CSS? does accent/branding config become a no-op for it?) or what the XML document
shape is (element-per-session mirror of the JSON feed? RSS-flavored?). These are exactly the
decisions a reviewer needs to see before code exists, because they're also what the regression
tests must assert.
**Recommendation:** Name the files, extend the format union explicitly, and write one short
paragraph per new format defining its output contract — including how filter/field/branding
options interact with each (e.g. accent is ignored in basic HTML and XML by design).

**[MAJOR] Acceptance / testing — No test plan for a task whose acceptance requires "tests fail on `main` and pass on the branch"**
The acceptance list demands red-on-main regression tests, and the two builder defects (stale
iCal preview, "Get code" not restoring the form) are precisely the kind of UI-state bugs that
evaporate without a pinned test. The plan doesn't say what tests will be written, at what level
(route-level assertions on the five outputs are cheap; the preview-sync and form-restore defects
need component/UI-level coverage), or in which files. It also doesn't say how the "preview
matches the selected output every time" bullet will be verified for iCal, whose body isn't HTML.
**Recommendation:** List the test files and the specific red-on-main cases: one per new output
format resolving, one for field selection changing rendered output, one reproducing the stale
iCal preview, one reproducing "Get code" non-restore, and one asserting a legacy config JSON
(no fields key) renders identically to today.

**[MINOR] Builder defects §§4–5 — No root-cause hypothesis**
The judge described the symptoms; the plan repeats them. Fixing "preview goes stale on iCal"
requires knowing whether the preview iframe simply doesn't re-source for non-HTML outputs or
whether iCal was never given a preview representation (in which case the fix is a designed
placeholder pane, not a refresh — and the "elements never jump" constraint governs what that
pane reserves). Similarly, whether "Get code" is a missing state-hydration call or a routing
issue changes the size of the fix. A planner who has read `EmbedPage.tsx` should say which.
**Recommendation:** Add one sentence per defect naming the suspected mechanism in
`src/ui/embeds/EmbedPage.tsx` and the intended fix shape (including what the iCal preview pane
shows, since a raw `.ics` body in an iframe is not a rendering).

**[MINOR] Fourth gap (itinerary embed) — Stretch-goal decision deferred rather than made**
The task allows deferring the itinerary/personal-schedule embed type, but a plan should convert
"do it last, only if green" into a concrete decision: in or out of this PR, and if attempted,
what minimal design (the task itself flags per-visitor state as a larger question). As written,
the ambiguity survives into implementation, which is where it's most expensive.
**Recommendation:** Declare it out of scope for this PR in the plan, with a ticket comment on
completion as the task instructs — or scope a minimal version explicitly. Either is fine;
silence is not.

## 4. Positive Observations

- The underlying task material is excellent and the plan preserves it faithfully: verbatim
  pass-criteria, the judge's enumerated gaps, an ordered stretch-goal rule, and honest framing
  of the two defects as "the honesty half."
- The acceptance list is genuinely testable — five bullets, each mechanically checkable,
  including the often-forgotten backward-compatibility bullet for existing saved embeds.
- All fleet constraints (worktree discipline, no-stash, gate-lock serialization, deploy freeze,
  status-field literacy) are carried intact, so the implementer boot prompt loses nothing.

The failure here is purely that no planning was added on top of that material. The fix is fast:
the codebase already makes the hard parts easy (JSON `config` column means no migration; ~900
lines across three embed files is a small surface), and a half-page of real decisions layered
onto this same document would pass.
