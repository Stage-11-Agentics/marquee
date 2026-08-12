# Plan Review: MRQ-93

## 1. Verdict

**FAIL (plan-level)**

The core of the plan (steps 1, 2, 4) is right and should survive revision unchanged.
Three things need to be settled before implementation: a whole plan step aimed at a
task that cannot exist in the running product, an unaddressed stale-draft clobber
between the two editors the plan creates, and an undefined save-vs-confirm
interaction that silently discards a speaker's edit. All three are cheap to fix on
paper and expensive to fix in review.

## 2. Summary

Reviewed the delegator plan for MRQ-93 against `src/ui/portal/PortalPage.tsx`,
`src/routes/portal.routes.ts`, `scripts/seed/event.ts`, `scripts/seed/ugliness.ts`,
`src/jobs/cascade/decisions.ts`, and the gate scripts under `scripts/checks/`. The
decision to specialize `acknowledge` at the presentation layer rather than mint a
new task kind is the correct call for the deadline, and the plan is disciplined
about reusing the existing `PATCH /api/v1/me/submissions/:id/talk` route and the
`talk_editable` gate. The key concern is step 3: `Finalize bio & photos` is seeded
as a *template* but is never assigned as a *task* by any code path in the
repository, so that step builds unreachable UI — and it would half-satisfy the
ticket's "show the subject" requirement in exactly the way the ticket forbids.

## 3. Issues

**[CRITICAL] Implementation step 3 — the bio/photo task does not exist in the running product**

`Finalize bio & photos` (`scripts/seed/event.ts:354`) is seeded with
`auto_assign = 0`. The only code in the repository that creates a `speaker_tasks`
row is `src/jobs/cascade/decisions.ts:363`, and its candidate query filters
`WHERE tt.auto_assign = 1` (`decisions.ts:334`). `scripts/seed/ugliness.ts` seeds
task rows for exactly three templates — `hotelTravel`, `presentationUpload`
(lines 90–93), and `finalizeDescription` (line 125) — and no others. There is no
route, job, or organizer action that assigns a template on demand
(`grep "INSERT INTO speaker_tasks" src/` returns one hit).

So: no speaker, on the live site or anywhere else, has a "Finalize bio & photos"
task. Step 3 proposes extracting reusable fields and an upload lifecycle out of
`ProfileEditor` — the most tangled component in the file, with `URL.createObjectURL`
cleanup, an `Image()` dimension probe, and a two-phase R2 upload — to serve a task
surface nobody can open. It cannot be validated on the live site as the ticket's
acceptance requires, it produces nothing for the walkthrough video, and it churns a
500-line hot file the day before the deadline.

Compounding it: the plan already concedes it cannot *show* the headshot, because
`src/lib/r2/serve.ts:37` forces `Content-Disposition: attachment` on every
attachment response and no portal surface renders a stored headshot (the only
`<img>` in the portal is the local crop preview at `PortalPage.tsx:385`). "Make the
current headshot state explicit" is a sentence about an image, which is the same
category of defect the ticket is about. The ticket anticipated this case and gave
an explicit instruction: *"if it does not [generalize cleanly], say so and leave a
note rather than half-doing it."*

**Recommendation:** Drop step 3. In the PR, state the two findings that make it not
generalize — (a) the template is never assigned, so the surface is unreachable;
(b) attachments are served as downloads, so the headshot cannot be displayed
without a new inline-image path — and file a follow-up ticket covering both. If the
delegator instead wants to keep it, the plan must first say how a `finalizeBio`
task comes to exist (seed change? `auto_assign = 1`?), because that is a data
change with its own blast radius on the demo dataset, and it is not in the plan.

---

**[MAJOR] Implementation step 2 — two editors over one record, two independent drafts, stale-write clobber**

`TalkCard` seeds its drafts once: `useState(submission.title)` /
`useState(submission.description ?? "")` (`PortalPage.tsx:390-391`). Preact runs a
`useState` initializer only on mount, and `TalkCard` is keyed by `submission.id`, so
it does not remount when `refresh()` returns new data. Today that is harmless
because `TalkCard` is the only writer. The plan makes it not the only writer.

Failure scenario: speaker opens "Finalize talk description", fixes a typo in the
abstract, saves. The task's editor persists and `refresh()` repaints the read views
correctly — `TalkCard`'s `<h3>` and `<p>` read straight from props. But
`TalkCard`'s *draft state* still holds the pre-edit text. The speaker scrolls down,
clicks "Edit talk" to look at it, clicks "Save talk" — and the route writes the
stale title and abstract back over the fix, with an audit entry attributing the
regression to the speaker. This runs in the opposite direction too. "Factor out
what both need" does not fix it; a shared component with the same
`useState(props.x)` shape gives you two instances each holding an independent stale
draft.

**Recommendation:** State the state-ownership rule in the plan. Either lift the
draft to a single owner, or have the shared editor resync from props whenever it is
not actively being edited (`useEffect` on `[submission.title, submission.description]`
guarded by the editing flag), or remount on a value that changes at save. Add a
test that saves through one surface and asserts the other's draft reflects the new
text.

---

**[MAJOR] Implementation step 2 — save and confirm are two actions with no defined relationship**

The task will carry an editor (writes to `PATCH .../talk`) and a confirm control
(writes to `POST /api/v1/me/tasks/:id/complete` with `acknowledged`). These are
separate requests to separate routes, and the plan never says how they interact. A
speaker who edits the abstract and then clicks the confirm button — the obvious
gesture, since confirming is what the task asks for — silently loses the edit and
marks as confirmed a text that is not the one on screen. That is the same class of
defect as the ticket itself: the control does not mean what it says.

**Recommendation:** Decide it in the plan. The cleanest is a single action —
"Save and confirm" — that PATCHes the talk when the draft is dirty and then
completes the task, so the button's copy is true by construction. If two controls
are kept, the confirm must be blocked or warned while the draft is dirty. Cover it
with a test.

---

**[MINOR] Implementation step 1 — `template_id` is not currently in the portal API response**

The task view returned by `listTasks` (`src/routes/portal.routes.ts:769-789`) omits
`template_id`, even though the SELECT reads it (`portal.routes.ts:744`) and
`TaskProjection` types it (`portal.routes.ts:156`). "Add the task template identity
to the portal task view" is therefore a server change plus a client type change, and
the plan does not name it as one. Two supporting facts, both good news: the response
is typed `tasks: z.array(z.any())` in `portalResponseSchema`, so the OpenAPI
contract check will not move; and `seedId` (`src/lib/ids.ts:22`) is a plain
slugifier, so the constant is the readable literal `tpl_finalize-talk-description`
and the client does not need to import anything from `scripts/seed/`.

The durability caveat is worth one sentence in the PR: `task_templates` has no slug
or key column (`migrations/0001_init.sql:578`), so keying on a seed-derived id means
the specialization fires only for the seeded AIE event and never for a template an
organizer creates. That is an acceptable trade for the deadline; it should be stated
rather than discovered later.

**Recommendation:** Name the two files the change touches, name the module the
constant lives in, and record the demo-only scope in one line.

---

**[MINOR] Implementation step 4 — "reserve a stable block height" is the wrong mechanism, and there is a simpler design**

Reserving a fixed height around a variable-length prose abstract either clips it or
leaves a large empty gap; either way it fights the content. The rule is that
elements must not jump, not that the block must be a fixed size.

**Recommendation:** Drop the edit-mode toggle inside the task entirely. Render the
title input and abstract textarea directly in the expanded task, `readonly`/disabled
with the closed reason when `talk_editable` is false. Nothing toggles, so nothing
jumps; it removes a state, removes a button, is less code than the reserved-height
approach, and matches "editing is the point of finalize" more literally than a
toggle does. `TalkCard` keeps its existing toggle, unchanged.

---

**[MINOR] Verification — the proposed tests cannot verify most of the acceptance criteria, and two ACs are not live-verifiable at all**

"Source-level UI contract coverage" in this repo means regex assertions against the
raw text of `PortalPage.tsx` (`tests/node/task-cancellation.AC-264-267.test.mjs:13,37-39`);
there is no DOM-rendering harness for portal components, and `tests/integration` is
API-level. So "the actual title and abstract render inside the task", "elements never
jump", and "other acknowledge tasks are visually unchanged" get no behavioral
coverage — the entire behavioral case rests on one manual live-site pass.

Two acceptance criteria additionally cannot be checked on the live site, and the
plan should say so plainly rather than hedge with "if the deployed seeded state
provides it":

- **Closed read-only.** `CFP_CLOSES` is 2026-09-13 (`scripts/seed/event.ts:69`) and
  today is 2026-08-11, so `talk_editable` is true for every seeded submission. The
  closed state is test-only.
- **Other acknowledge tasks unchanged.** Per the critical issue above, `announce`
  and `invite` are also `auto_assign = 0` with no seeded rows — there is no bare
  acknowledge task on the live site to compare against. Test-only as well.

**Recommendation:** Add an API-level integration test that the portal snapshot
exposes `template_id`, plus a `talk_editable = false` case driven through the
existing fixture. State in the PR which ACs are covered by test versus live pass,
so the evidence gap is recorded rather than implied.

---

**[MINOR] Verification — new tests must satisfy the AC-title contract, and the ticket has no claims manifest**

`scripts/checks/trace-ac-core.mjs:46-47` requires every `test()`/`it()` title to
match `^(AC-N[, +AC-N]*|CONTRACT)\s·\s`; anything else emits `invalid-title-prefix`,
which sets `status: "fail"` and exits non-zero, failing the `merged AC trace` step
of `pr-gate.mjs:19`. Separately, `tests/ac-claims/MRQ-93.json` does not exist; a
missing manifest is only a warning today, but all 56 recent tickets carry one.

**Recommendation:** Prefix new test titles with `CONTRACT · ` (or the AC they
exercise) and add `tests/ac-claims/MRQ-93.json` in the shape of `MRQ-74.json` —
almost certainly `owns: []` with an `exercises` list, since this ticket fixes a
presentation defect rather than minting a requirement.

---

**[MINOR] Verification — live-site validation mutates the dataset the walkthrough is filmed against**

"Edit/save a harmless speaker-owned value" writes to `marquee.stage11.dev`, whose
seeded talk copy is what the graded walkthrough video shows. A stray "test edit" in
a published abstract is a visible defect the day before the deadline.

**Recommendation:** State that the original title and abstract are restored after
the screenshot, and name the restore mechanism (re-edit, or the demo reset path).

---

**[MINOR] Risk — `PortalPage.tsx` is under concurrent edit**

`src/ui/portal/PortalPage.tsx` is currently dirty in the shared checkout and shifted
by two lines mid-review, i.e. another agent is editing it right now. The plan
proposes two component extractions from that same file.

**Recommendation:** Branch from current `github/main` in a worktree, keep the
extraction as small as the reuse requires, and re-check for conflicts immediately
before opening the PR. Dropping step 3 (critical issue above) removes roughly half
the conflict surface on its own.

## 4. Positive Observations

- **The decision is right and is justified in one sentence, as asked.**
  Presentation-level specialization avoids the schema `CHECK` constraint on
  `speaker_tasks.kind` (`migrations/0001_init.sql:605`), the route zod enums, and a
  seed migration — real cost, correctly avoided, with the deadline correctly
  weighed.
- **Reuse discipline is explicit and correct.** Naming the existing route, the
  existing `talk_editable` gate, and the existing refresh callback — and stating
  "do not add a task-specific route or weaken the existing attachment checks" as a
  standing constraint — is exactly the instruction that keeps an implementer from
  forking a second write path under time pressure.
- **The generic path is protected deliberately.** Step 4's "keep the generic
  acknowledge renderer and all other task kinds unchanged" is called out as its own
  step rather than assumed, which is what keeps the ticket's
  don't-strand-the-general-case requirement from quietly evaporating.
- **Non-goals are stated and are the right ones.** "No new task kind, migration,
  alternate write route, generic acknowledgement redesign" is a sharp fence around
  a ticket that could easily have grown into a task-kind refactor.
- **The plan already flags one genuine constraint honestly** — that the media path
  serves uploads as downloads. That observation is correct and is precisely the
  evidence that should have led step 3 to the "leave a note" branch the ticket
  offered; the finding was made, but not acted on.
