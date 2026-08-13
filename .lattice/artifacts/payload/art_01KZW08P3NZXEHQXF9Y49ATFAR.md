# Plan Review: MRQ-152 — V2-3: a newly created committee is ready to distribute

### 1. Verdict

**FAIL (plan-level)**

### 2. Summary

The submitted plan is a verbatim copy of the task description — the same seven paragraphs (Source, HUMAN PROBLEM, GOOD LOOKS LIKE, CLOSES, VERIFY), with a title line added. It contains no implementation design: no files, no route or component named, no SQL, no state-flow, no test plan, no risk list. I verified the ticket's premises against `github/main` and they are accurate and actionable — the defect is real and the fix is small — but a restated ticket is not a plan, and this one has at least three genuine design decisions (attach scope, focus-linking across two render surfaces, second-committee capture) that an implementer would otherwise resolve by guess.

Note on baseline: the primary checkout's local `main` is **131 commits behind `github/main`** and does not contain MRQ-110 (`cd907d32`, per-round reviewer pools), which is the code this ticket edits. Everything below is against `github/main`. Confirm the worktree branches from `github/main`, not from the stale local `main`.

### 3. Issues

**[CRITICAL] Whole plan — the plan is the ticket, restated**
Lines 25–35 of the plan reproduce the task description exactly. The review checklist asks whether the plan identifies files to create or modify, whether the approach is technically sound, and whether each acceptance criterion has a corresponding step. None of those questions can be answered, because no approach is stated. This matters more than usual here because the change touches a write path (`createCommittee`) whose blast radius extends to every round in the event — an implementer improvising the scoping predicate can silently reassign pools the chair set deliberately.
**Recommendation:** Rewrite as an implementation plan naming, at minimum:
- `src/routes/evaluation.routes.ts` — `createCommittee` handler (~line 758–780 on `github/main`): after the successful `INSERT INTO committees`, run the attach update in the same batch.
- `src/ui/evaluation/EvaluationPage.tsx` — `renderRound` (the reviewer-pool `<select>`, ~line 552) and `renderCommitteeRound` (the gate copy, ~line 574).
- Tests: which file, which assertions (see the test issue below).
State explicitly that **no migration is needed** — `evaluation_rounds.committee_id` already exists (`migrations/0001_init.sql`, `src/db/schema.ts:511`). Without that line, an implementer may add a redundant migration.

**[MAJOR] "GOOD LOOKS LIKE" §1 — the attach mechanism and its scope are undefined**
"Creating a committee attaches it as the pool of every round that has none" leaves the scoping predicate unspecified. Rounds hang off plans, not events (`evaluation_rounds.plan_id`), and an event can hold more than one plan — `src/routes/evaluation.routes.ts:551` selects plans `WHERE event_id = ? ORDER BY updated_at DESC, id`, i.e. plural by construction. "Every round that has none" could mean every round of the newest plan or every round of every plan in the event.
**Recommendation:** Pin the predicate in the plan. Recommended: all plans of the event, so the behavior does not depend on which plan happens to be newest —
```sql
UPDATE evaluation_rounds SET committee_id = ?, updated_at = ?
WHERE committee_id IS NULL
  AND plan_id IN (SELECT id FROM evaluation_plans WHERE event_id = ?)
```
run in the same `DB.batch()` as the committee insert so a partial failure cannot leave a committee with a half-attached set of rounds. Note that `WHERE committee_id IS NULL` is exactly what satisfies "a round's EXPLICIT pool is never overwritten" — say so, so the guarantee is traceable to one clause rather than left to review to infer.

**[MAJOR] "GOOD LOOKS LIKE" §2 — the focus-link requirement has no design, and it spans two components**
"the gate message names the exact control and links focus to it" is the half of this ticket that is *not* satisfied by the auto-attach, and the plan says nothing about how. The difficulty is structural and is the actual reported defect: the gate copy lives in `renderCommitteeRound` (`EvaluationPage.tsx:574`, "Choose a reviewer pool on this round card before distributing assignments") while the control lives in `renderRound` (`:552`, a `<select>` carrying only `aria-label={`Round ${index + 1} reviewer pool`}` and **no `id`**). They render in different sections of the page — which is precisely why the current sentence points at a control the operator cannot see. The existing inline button is labelled "Manage committee" and opens the committee dialog, i.e. it does not go to the pool control at all.
**Recommendation:** Specify: give the select a deterministic `id` (e.g. `id={`round-${round.id}-pool`}`), name the round in the copy ("Round 2 has no reviewer pool — choose one below"), and replace or supplement the "Manage committee" button with one that focuses and scrolls to that id (`document.getElementById(...)?.focus()` plus `scrollIntoView`). State the fallback when the element is not mounted. Confirm this is keyboard- and screen-reader-sound, since the `aria-label` is the only accessible name today.

**[MAJOR] "VERIFY" — no test plan, and an existing test sits in the blast radius**
The VERIFY paragraph is a manual browser script. Nothing maps it onto the suite, and this repo gates on `npm run pr-gate`. Worse, `tests/integration/api/evaluation.test.ts:119` creates a **second** committee ("Independent committee") inside an event that already has a configured plan and rounds — exactly the shape the new behavior mutates. Whether that test still passes depends on whether the seeded fixture leaves any round pool-less, which the plan never examines.
**Recommendation:** Add to the plan: (a) an integration test asserting that `POST /events/{id}/committees` attaches to pool-less rounds and leaves explicitly-set rounds untouched; (b) a test that a second committee creation does not disturb rounds the first one claimed; (c) an explicit step to run the existing `evaluation.test.ts` and reconcile any fixture assumptions before writing new code. Map each to the AC it closes (ABS-06, w2 partial). Note the 45s suite / 120s gate budgets.

**[MAJOR] "VERIFY" — "Re-running is idempotent" is ambiguous about *what* is re-run**
Distribution is already idempotent (`INSERT OR IGNORE` at `evaluation.routes.ts:1174`, plus the dialog's own copy). If the sentence means the *attach* is idempotent, that is a different claim, and the interesting case is not re-running the same creation — it is creating a second committee, where "idempotent" is the wrong word for what happens (see below).
**Recommendation:** Split the claim in the plan: state that distribution idempotence is pre-existing and merely re-verified, and state separately and precisely what re-running committee creation does.

**[MINOR] "GOOD LOOKS LIKE" §1 — a second committee silently claims rounds the chair left blank**
Read literally, every committee creation grabs every pool-less round. A chair who has configured Round 1 with "Mainstage pool" and deliberately left Round 2 undecided will find Round 2 silently assigned the moment they create "Workshop pool". The ticket's own rationale ("the overwhelmingly common one-committee conference") argues for the behavior but does not cover this case. The literal reading is what the operator approved, so this is a flag, not a redirection.
**Recommendation:** Keep the approved behavior, but have the plan say out loud that it applies to every creation and not only the first, and pair it with a visible confirmation (the existing `setNotice` at `EvaluationPage.tsx:361` already fires on creation — change it to name what was attached, e.g. "Committee created · set as the pool for 2 rounds"). Silent mutation of a chair's configuration is the failure mode worth spending one sentence of copy on. If the operator would rather scope the attach to the first committee only, that decision belongs in the plan, before implementation.

**[MINOR] Plan — the already-solved parts are not identified, inviting redundant work**
Two things the ticket implies are already handled on `github/main` and the plan does not acknowledge: the UI refetches after creation (`createCommittee` calls `await load()`, `EvaluationPage.tsx:361`), so the round cards and the pool `<select>` options will reflect the attach without new plumbing; and the Distribute button is already gated on the *selected* round's pool (`:657`, `disabled={!plan.rounds.some(r => r.id === ... && Boolean(r.committee_id))}`), so it flips to enabled from the data change alone with no UI edit.
**Recommendation:** State both as "already true, verify only." It keeps an implementer from rebuilding the refresh path or loosening the Distribute gate.

### 4. Positive Observations

- The **ticket** behind this plan is unusually good, and the plan inherits its strengths: the human problem is stated as an observed dead end with the exact on-screen strings, GOOD LOOKS LIKE carries the non-obvious invariant ("a round's EXPLICIT pool is never overwritten") that is the whole safety of the change, and VERIFY is a runnable end-to-end script rather than a vague "confirm it works."
- Every premise checks out against the code. The gate copy at `EvaluationPage.tsx:574`, the "No pool selected" option at `:552`, the server-side `select a reviewer pool for this round` at `evaluation.routes.ts:1136`, and the round-scoped Distribute gate at `:657` are all exactly where the ticket implies. Reviews are cheaper when the report is this accurate.
- Scope is well judged: the ~30 min estimate is right for a one-statement server change plus a focus link, and the ticket resists the obvious scope creep of reworking per-round pool configuration wholesale.
- The change needs no migration and no API contract change, which keeps it genuinely low-risk once the scoping predicate is pinned down.
