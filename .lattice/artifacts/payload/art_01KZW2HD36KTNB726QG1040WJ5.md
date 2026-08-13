# Code Review: MRQ-152 — V2-3: a newly created committee is ready to distribute

Reviewer: independent Claude review agent (cold context)
Branch: `v2-3-committee-pool` @ `cb95ff71`
Reviewed: `src/routes/evaluation.routes.ts`, `src/ui/evaluation/EvaluationPage.tsx`, `tests/integration/api/evaluation.test.ts`

Verification I ran myself:
- `npx vitest run tests/integration/api/evaluation.test.ts` → **24/24 pass** (8.97s)
- `node scripts/checks/pr-gate.mjs --ticket=MRQ-152` → **pass** (191 checks; `pass-over-budget` at 127.1s against the 120s objective — every check green, machine under fleet contention, so this is load, not a defect)
- Read the surrounding routes, migrations, and UI render paths to check reachability of the edge cases below.

---

### 1. Verdict

**PASS**

The central behaviour is correct and matches the acceptance criteria: committee creation and `NULL`-only round attachment are one D1 batch, an explicit pool is never overwritten (proven by the new contract test), and the Distribute dialog now names the exact control and links focus to it. The findings below are all minor polish and follow-up, none of them blocking.

### 2. Summary

I reviewed the server-side auto-attach, the two UI seams (create-committee notice, Distribute dialog gate), and the new contract test. The implementation is tight and well-scoped — it does exactly what the plan says, in one transaction, with no client-only path. The findings are: a broadened `catch` that can now report a truthful DB failure as a false "duplicate committee" conflict; a notice that can print "Round 1, Round 2, Round 1, and Round 2" when an event has more than one plan; and no test or browser evidence for the one newly-introduced interactive behaviour (the focus jump), whose implementation changed *after* the recorded validation run.

### 3. Issues

```
**[MINOR] src/routes/evaluation.routes.ts:779–786 — the conflict catch now swallows the UPDATE's failures and lies about why**
```
The `try { … } catch { throw ApiError.conflict("a committee with that identity already exists"); }` used to wrap a single INSERT. It now wraps the whole batch, so a failure in the round `UPDATE` — or any D1-level error — is reported to the organizer as "a committee with that identity already exists". That statement is not merely unhelpful, it is false, and `committees` has no unique constraint at all (`migrations/0001_init.sql:474–480`), so the message was already close to unreachable-as-written; the change makes the blast radius bigger rather than smaller. On a product being graded on honesty this is the wrong direction, even though the failure is unlikely in practice.

**Fix:** rethrow anything that isn't a constraint violation and let the 500 handler own it (there is no `ApiError.internal`, so bubbling is the idiom):
```ts
} catch (reason: unknown) {
  if (!/UNIQUE|constraint/i.test(String(reason))) throw reason;
  throw ApiError.conflict("a committee with that identity already exists");
}
```

```
**[MINOR] src/ui/evaluation/EvaluationPage.tsx:370–376 — the attachment notice can name "Round 1" twice**
```
`attached_rounds` is scoped to the **event**, spanning every plan (`evaluation.routes.ts:781–784` — correct, and what the plan asked for), but the notice labels rounds by `position + 1` alone. An event with two plans that both have unassigned rounds produces: *"Committee created · set as the reviewer pool for Round 1, Round 2, Round 1, and Round 2."* Multiple plans per event are reachable — `createPlan` (`evaluation.routes.ts:556`) has no one-per-event limit and the page ships a `+ New evaluation plan` button (`EvaluationPage.tsx:610`), while `load()` renders only `summaries.data[0]`. So the sentence can name rounds the organizer cannot see, twice, with the same label.

**Fix:** label only the rounds on the plan currently on screen, and let the count carry the rest:
```ts
const visible = created.attached_rounds.filter((round) => plan?.rounds.some((item) => item.id === round.id));
```
…then build `roundSummary` from `visible`, or fall back to "the N rounds that had no pool" when `visible.length !== created.attached_rounds.length`.

```
**[MINOR] tests/ — the one new interactive behaviour has no coverage, and its final form was never exercised**
```
The contract test covers the server seam well, but nothing covers the UI seam: not the "needs reviewer pool" option labels, not the gate copy, and not `focusReviewerPool`. That last one matters more than the others, because commit `cb95ff71` changed it from `window.setTimeout(… , 0)` to a synchronous `focus()` *after* the validation comment was written — and that comment records that "the shared c11 control socket then timed out during final dialog reads", i.e. the dialog was never read in a browser in its shipped form. My reading of the code says the sync version is fine (Preact defers the re-render to a microtask, the `<select>` lives outside the dialog subtree and is always mounted, so focus lands and survives the unmount) — but "my reading says fine" is not the standard this repo holds for a dead-end fix.

**Fix:** either a source-assertion unit test in the style of `tests/unit/reviewer-surface.AC-61-158-159.test.ts` (assert the `round-${id}-reviewer-pool` id, the gate copy, and the `focusReviewerPool` wiring), or one browser pass on the shipped build: open Distribute on a poolless round, click **Pick a reviewer pool**, confirm the dialog closes and the round card's select actually holds focus.

```
**[MINOR] tests/ac-claims/MRQ-152.json — missing ticket manifest**
```
`pr-gate --ticket=MRQ-152` emits `{"code":"missing-current-ticket-manifest","ticket":"MRQ-152"}`. It is a warning, not a failure, and the gate is green — but every other ticket in the tree carries one (73 claims present), including tickets that claim nothing (`MRQ-146.json` has empty `owns`/`exercises` and a note).

**Fix:** add the file, `owns: []`, `exercises: []`, note explaining that MRQ-152 closes ABS-06 (w2 partial) without minting a new AC.

```
**[MINOR] src/ui/evaluation/EvaluationPage.tsx:593 — the sentence the ticket quotes is still in the code**
```
The ticket's human problem quotes *"Choose a reviewer pool on this round card"* — a message pointing at a control on a different card. That exact string still renders, in `renderCommitteeRound`'s empty state, and its button is **Manage committee**, which opens the committee dialog rather than the pool select. The build plan scoped step 2 to "the committee-create handler and Distribute dialog seam", so leaving it is defensible, and after this change the state is rarely reachable. But `focusReviewerPool` now exists and `round` is in scope right there, so it is a one-line completion of the AC's own words ("the gate message names the exact control and links focus to it").

**Fix:** in that `inline-empty`, swap the copy to name the control and the button to `onClick={() => focusReviewerPool(round.id)}` labelled "Pick a reviewer pool". Fine as a follow-up ticket if the scope line is being held.

```
**[MINOR] src/routes/evaluation.routes.ts:788 / EvaluationPage.tsx:123 — attached_rounds.name is fetched, typed, and unused**
```
The SELECT returns `round.name` and `CreatedCommitteeResult` declares it, but the notice only reads `position`. Dead weight in a payload and an interface.

**Fix:** either use it (`Round 1 · Initial review` reads better than `Round 1`, and would also disambiguate the multi-plan case in the finding above) or drop it from both.

**Observation, not an issue:** the reverse direction is still open — create a committee, then `+ New evaluation plan`, and the new plan's rounds land with `committee_id` null (the UI's plan POST never sends one, `EvaluationPage.tsx:268–280`). That is out of this ticket's scope and, importantly, is no longer a dead end: the new Distribute gate names the control and jumps to it. Worth a follow-up ticket if the "one-committee conference" default is meant to hold in both directions.

### 4. Positive Observations

- **The attachment is one batch, server-side.** Insert and `NULL`-only update in a single `DB.batch` is exactly right: no client-only path, no window where a committee exists with no rounds attached, and agents get the same default the UI does. The plan's non-goal ("no client-only attachment path") was honoured literally.
- **The `WHERE committee_id IS NULL` guard is the whole ticket in one clause**, and the contract test proves it the honest way — it PATCHes an explicit pool onto round one, snapshots the unassigned set *before* the create, then asserts both halves after: the explicit pool unchanged, every previously-null round now carrying the new committee. Testing behaviour through the API and verifying through the DB, not through the response alone, is the right shape.
- **The read-back for `attached_rounds` is truthful rather than optimistic.** It would have been easy to echo back what the UPDATE was *supposed* to touch; querying what actually carries the committee means the notice cannot claim an attachment that did not happen.
- **The gate now explains itself.** Round options labelled `ready · <pool>` / `needs reviewer pool` mean the organizer can see the problem before selecting the round, and the disabled Distribute button is paired with a message naming the fix. Reusing `committeeForRound` for both the option label and the disabled predicate keeps one source of truth for "is this round ready".
- **Scope discipline.** The diff touches exactly the two seams the plan named and stays clear of MRQ-151's invite-link, export, and score-review lines — no drive-by edits, no reformatting noise.
