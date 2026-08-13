# Code Review: MRQ-150 — submitter portal dead-end, OpenAPI ETag overclaim, CFP close date

## 1. Verdict

**PASS**

Three minor issues are listed below; none is a correctness or security defect that
warrants rework of this ticket. The first is worth a small follow-up commit.

## 2. Summary

Reviewed the MRQ-150 commits on `portal-submitter` (`1c398538`, `75c16676` over
`5441cf1c`) — 8 files, ~680 lines: a new submitter seat on `GET /api/v1/me/portal`
(`src/routes/portal.routes.ts`), its rendered surface (`src/ui/portal/PortalPage.tsx`,
`portal.css`), the confirmation-link copy change (`src/ui/public/form/PublicForm.tsx`),
the rewritten OpenAPI concurrency paragraph (`src/api/openapi.ts`), and three test files.
(The prompt's diff was computed against a stale base and additionally contains merged
sibling work — MRQ-79 Resend webhooks, MRQ-148 auto-place, the 404 route, MRQ-139/143 —
which is out of scope here and was not reviewed as MRQ-150's.)

Quality is high. The fix follows SPEC §10 (Amendment 15) exactly: a submitter resolves
their conference through `participations`, gets an honest read-only surface, and **no**
speaker membership is invented — and there is a test that asserts the `memberships` table
stays empty, which is the assertion that keeps the ruled answer from eroding later. All
three defects are addressed: #1 and #2 in code, #3 as a live-data `UPDATE` recorded on the
ticket with its prior value for reversal.

**Verified independently, not taken on trust:**

- `npx vitest run --config vitest.worker.config.ts tests/integration/api/submitter-portal.MRQ-150.test.ts tests/integration/api/meta.test.ts` → 12 passed, 24.6s.
- `npx vitest run --config vitest.node.config.ts tests/unit/submitter-portal.MRQ-150.test.ts` → 7 passed, 0.8s.
- `npm run typecheck` → clean.
- Defect #3 live: `GET /f/cfp` renders "Closes 9/13/2026"; `closes_at = 1789271999000`
  (2026-09-13T03:59:59Z) — matches `scripts/seed/event.ts`, so the fix is live and correct.
- Defects #1 and #2 are **not yet live**: `/health` reports build `cda770b4`
  (2026-08-12T21:42Z), which predates the merge `b95fa130`. Live `/api/openapi.json` still
  carries MRQ-146's one-clause wording — accurate, just not this ticket's fuller paragraph.
  The ticket already records the deploy as owned by Eval Fix Orchestrator; the live
  click-through of the confirmation link remains genuinely open and should not be closed
  until it is run against the deployed build.

## 3. Issues

```
**[MINOR] src/routes/portal.routes.ts:~1000 (submitterSnapshot, `form` LEFT JOIN) — an
expired call is still offered as a way back**
The join qualifies the form with `form.status = 'open'` only. The rest of the codebase
decides "open" with `publicFormIsClosed` (src/routes/public-form.shared.ts:218), which also
refuses a form whose `opens_at` is in the future or whose `closes_at` has passed. So a form
left at status `open` past its close date — precisely the live-data shape defect #3 of this
same ticket documents — yields a non-null `form_slug`, and the submitter portal renders
"Open the call for speakers" pointing at a page that answers "closed". The inline comment
("Only set while the form is still open — an expired call is not a way back") and the unit
test's comment both assert a guarantee the SQL does not make; the test only covers the
`form_slug: null` case, so it cannot catch this.
**Fix:** bind `Date.now()` and extend the join predicate —
`AND (form.opens_at IS NULL OR form.opens_at <= ?) AND (form.closes_at IS NULL OR form.closes_at > ?)`
— or select the form row and gate `form_slug` through `publicFormIsClosed` so there is one
definition of open. Add an integration case with `closes_at` in the past.
```

```
**[MINOR] src/ui/portal/PortalPage.tsx:~830 (SubmitterPortal) — the hero can pair one
abstract's title with another abstract's decision date**
`lead` is the most recently updated submission, but `decisionOn`/`waveName` are the first
non-null values found across *all* submissions. With `per_submitter_limit = 3` on the live
CFP, a person with two abstracts in different waves can see `lead.title` next to a decision
date that belongs to the other one. The claim is unfalsifiable from the screen, which is the
kind of quiet inaccuracy the ticket exists to remove.
**Fix:** derive the hero's decision copy from `lead` (`lead?.wave_decision_on`), falling back
to the cross-submission scan only when the lead has none — or move the date onto each
`SubmissionRow` where it is unambiguous.
```

```
**[MINOR] src/routes/portal.routes.ts (findSubmitterEvent) — the seat is granted on any
participation role, but the copy assumes authorship**
The fallback resolver matches `participations.person_id` with no role predicate, so a
co-speaker or moderator attached to someone else's abstract, holding no membership, also
lands on this surface. Landing there beats the old 404, but the copy is written for the
author: "Thank you, {name}", "What you sent", "{n} abstracts on file". The API already
returns `role` per submission and the UI ignores it.
**Fix:** either branch the headline/section copy on `role` (author vs. named participant),
or restrict `findSubmitterEvent` to `p.role = 'submitter'` and let other roles keep the
existing 404. Worth a deliberate ruling rather than an accident of the join.
```

Nit (no action required): `submitterSnapshot` duplicates the ~18-line next-unsent-wave
fallback from `portalSnapshot` verbatim. Extracting it alongside the `AWAITING_DECISION`
constant the same commit already introduced would keep the two seats from drifting.

## 4. Positive Observations

- **The integration test refuses the shortcut.** It submits through the real public form,
  follows the real `/api/v1/auth/exchange` magic link, and then asks the portal — the exact
  sequence a judge clicks. That is why the defect was invisible before: every prior portal
  test seeded a `memberships.role = 'speaker'` row. The file's header comment says so
  plainly, which makes the test durable rather than merely green.
- **The ruled-out fix is asserted, not just avoided.** `SELECT COUNT(*) FROM memberships
  WHERE role = 'speaker'` → 0, plus a `PATCH /api/v1/me/profile` → 404 check, encodes SPEC
  §10's distinction in a form a future refactor has to consciously break.
- **Tenant isolation is tested, not assumed** — two real submitters, each seeing only their
  own abstract.
- **The dedup comment earns its place.** The one-row-per-submission `EXISTS` + correlated
  role subquery, with the note that the public form writes *two* participations per person,
  documents a non-obvious trap that a naive join would have shipped as duplicate abstracts.
- **`meta.test.ts` holds the prose to the route table.** Asserting the exact set of
  `concurrency: "if-match"` routes from `apiManifest` — not a count — means the OpenAPI
  sentence cannot silently drift out of true as routes are added. That is the right shape
  for an honesty contract, and MRQ-146's assertions were re-pointed at the new wording
  without being weakened.
- **The empty state is tested as a screen, not a payload:** decision date rendered as a
  calendar day in UTC (no timezone slippage on a `YYYY-MM-DD`), every status phrased
  honestly including `rejected`/`withdrawn`, no "Invalid Date", and every next action a real
  link. Copy and code agree, which is the standard PHILOSOPHY sets.
- **Defect #3 was diagnosed rather than assumed.** `git log -S` on the seed constant plus a
  fresh local seed proved it was live mutation, not code; the ticket records the exact
  `UPDATE`, the prior value for reversal, what was deliberately left untouched (three
  unattributed form fields), and a known cosmetic UTC-rendering artifact. That is the
  disclosure a reviewer needs and rarely gets.
