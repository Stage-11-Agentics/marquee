# Code Review: MRQ-124 — Batch publish in the agenda builder

**Branch:** `mrq-124-batch-publish` @ `1e6cc2b`
**Reviewer:** independent (cold context), verified by executing the code, not by reading the diff alone.

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the hard part — the accepted-only, all-or-nothing, dual-table batch write — is correct and I proved it works. Two things block: the mandatory PR gate is red on this branch (`check:api`), and the accessibility half of the ticket ships a false affordance that makes ~108 inert grid cells keyboard-focusable "buttons."

## 2. Summary

Reviewed the batch-publish API (`agenda.routes.ts`, `agenda.queries.ts`, `api/agenda.ts`), the builder chrome (`AgendaPage.tsx`, `agenda.css`), the slot-labelling change (`track-board.tsx`), and both test files. The write path is the strongest part of the change: the `COUNT(DISTINCT …) = N` guard inside the agenda `UPDATE` makes the batch genuinely atomic, the submission mirror and audit insert are both predicated on the agenda write having landed, and the `status='accepted'` reversal guard is preserved exactly as the ticket demands.

What I ran (worktree, load avg ~86, all timings unremarkable):

| Check | Result |
|---|---|
| `tsc -p tsconfig.json` / `tsconfig.client.json` | pass |
| `vite build` | pass |
| `npm run check:design` | pass |
| `npm run check:api` | **FAIL (exit 1)** |
| `vitest run tests/integration/api/agenda tests/unit` | 40 files, 285 tests pass |
| `vitest run tests/integration/api/agenda.AC-70-74-252-253.test.ts` | 9 pass |
| `node --test tests/node/agenda-publish.AIA-07.test.mjs` | pass |
| ad-hoc multi-record batch test (written, run, deleted) | pass — 3 records, both tables mirrored, 3 distinct audit rows |

The worktree is clean; my scratch test was removed.

## 3. Issues

**[CRITICAL] cli/api-registry.json:1 — the mandatory PR gate is red on this branch**

`npm run pr-gate` runs `check:api`, which compares the served OpenAPI document against `cli/api-registry.json`. The new operation was never regenerated into it, so the check exits 1 with two findings:

```
cli-registry-parity  missing: ["POST /api/v1/events/{eventId}/agenda/publish batchPublishAgenda"]
cli-registry-hash-mismatch  served: adba6f8d… registry: 8e5648e5…
```

The registry has 133 operations; the branch serves 134. The ticket's own handoff requires a green `npm run pr-gate -- --ticket MRQ-124` pasted into the completion comment, so this is not cosmetic — the PR cannot legitimately open. It is also the exact failure mode MRQ-104 (CLI parity) exists to catch.

**Fix:** `npx vite build && node cli/generate-api-registry.mjs`, then commit `cli/api-registry.json`. Re-run `npm run check:api` and confirm `"status": "pass"` before the gate.

---

**[MAJOR] src/ui/agenda/AgendaPage.tsx:254 and src/ui/agenda/track-board.tsx:37 — drop cells claim to be buttons but are not operable**

Both `DropCell` components now render `role="button"` + `tabIndex={0}` with an `aria-label`, but neither has an `onClick` nor an `onKeyDown` — the only handlers are `onDragOver`/`onDragLeave`/`onDrop`. Two consequences:

- **Every empty slot becomes a dead keyboard stop.** The seed has 9 rooms × 12 `TIME_SLOTS` = 108 focusable "buttons" in the day view alone, plus the week and track boards. A keyboard user tabbing toward the pool or the new publish panel walks through a hundred controls that announce as buttons and do nothing on Enter or Space. That's WCAG 2.1.1 (keyboard operability) and 4.1.2 (role must match behavior), and it is a worse baseline than the unlabelled `div` it replaced.
- **The week board makes it explicit:** when `fallbackRoom` is undefined the drop handler is a no-op (`AgendaPage.tsx:582`), so the cell announces a slot it cannot accept anything into.

The ticket's actual requirement was *refs* — a stable accessible name a browser agent can address (CFP-S4 burned 9 turns because the cells exposed nothing). `role="button"` was overshoot; a name on a non-interactive-but-exposed role gets the same targeting benefit without lying about operability. Note that a bare `aria-label` on a `role="generic"` div will not reliably reach the a11y tree, so simply deleting the role is not the fix.

**Fix:** give the cells a non-interactive but exposed role that matches what they are — `role="gridcell"` inside a `role="row"`/`role="grid"` wrapper on the boards (the CSS grid already has the structure), keeping the `aria-label` and dropping `tabIndex`. If keyboard placement is genuinely wanted, keep `role="button"` and add an `onKeyDown` (Enter/Space) that places the currently selected pool item — but that is new scope, so the gridcell route is the honest minimum. Also drop the now-orphaned `.agenda-drop-cell:focus-visible` rule (`agenda.css:61`) if focusability goes away.

---

**[MINOR] src/routes/agenda.routes.ts:194,308 — `skipped_submission_ids` is permanently empty**

The response schema advertises a partial-success shape the endpoint cannot produce: ineligible IDs throw 409 before any write, and the SQL guard makes the batch all-or-nothing, so the field is hard-coded `[]`. A client that branches on it will silently never take that branch, and a future reader will assume partial publishing is supported.

**Fix:** remove the field from `batchPublishResponse` and the handler. The 409 message already carries the semantics.

---

**[MINOR] src/ui/agenda/AgendaPage.tsx:548-557 — no "select all unpublished," while the API caps at 100**

The ticket describes *select-unpublished → publish N*, but the only selection affordance is a per-row checkbox. Today's seed has exactly one candidate so it demos fine; a real organizer publishing a wave of 40 clicks 40 boxes. Worse, `batchPublishBody` caps `submission_ids` at 100 (`agenda.routes.ts:190`) with no client-side awareness, so a large event's operator would hit a raw 422 through `errorSummary` with no explanation of the limit.

**Fix:** add a "Select all (N)" / "Clear" pair in the select-step footer next to the count, disable it past the cap, and say so in the intro copy (or raise/remove the cap and paginate the preview).

---

**[MINOR] src/routes/agenda.queries.ts:508 — the `live` counter and the public agenda disagree on one status**

`live` counts published items with `submission.status = 'accepted'`. The public site renders published items with `s.status NOT IN ('rejected','withdrawn')` (`src/lib/public-site.ts:316-317`). A session published while accepted and later moved to `waitlisted` stays visible to the public but stops being counted as live, so the chrome under-reports what is actually on the public agenda. The seed never produces this today (all scheduled records are accepted; withdrawn/waitlisted live only in the unscheduled pool), so it is latent, not live.

**Fix:** count `live` with the public predicate (`status NOT IN ('rejected','withdrawn')`) so the counter answers "what the public can see," while keeping the strict `= 'accepted'` predicate on the *candidate* and *write* paths where the reversal-safety guard belongs. The two questions are genuinely different and the code should say so.

---

**[MINOR] src/ui/agenda/AgendaPage.tsx:539-570 — the panel resizes between select and review, moving the board**

The panel sits above the toolbar, and the review step renders only the selected subset. Selecting 1 of 12 candidates and hitting "Review publication" collapses the panel and jerks the toolbar, day filter, and board upward; the success notice then pushes everything back down. The plan's step 3 explicitly promised space-reserved status regions, and it collides with the standing house rule that interactive elements never jump.

**Fix:** set a `min-height` on `.agenda-publication-list` sized to the select-step list (or cap both steps at the same scrollable height), or render the review step as an overlay so the page behind it never moves. The success notice following the existing `.agenda-notice` pattern is fine and consistent — the step transition is the part that moves.

---

**[MINOR] src/ui/agenda/AgendaPage.tsx:672 — a failed publish reports far from the control that failed**

`publishSelected`'s catch routes into the shared `notice` state, which renders below the toolbar (`:801`) while the publish button lives in the panel above it. The user confirms in one region and is corrected in another, and on a 409 ("refresh the agenda and try again") the reload has already silently refreshed the list underneath them.

**Fix:** render publish failures inside the publication panel's action footer (the space is already reserved by `.agenda-publication-actions`), so the error lands where the click did.

---

**[MINOR] tests — the multi-record path is untested, and the node test asserts whitespace**

- `agenda.AC-70-74-252-253.test.ts:873` only ever publishes a **single** record. The riskiest new SQL — the `COUNT(DISTINCT …) = N` guard and the N-arm `UNION ALL` audit insert — has no coverage. I wrote and ran a 3-record test against this branch and it passes correctly (3 published, both tables mirrored, 3 distinct audit ULIDs), so this is a coverage gap rather than a bug; it just means nothing in the suite protects it. Also untested: the duplicate-ID 422, the already-published 409, and the 100-ID cap.
- `tests/node/agenda-publish.AIA-07.test.mjs:945,948` asserts `/role="button"\n    tabIndex=\{0\}\n    aria-label=\{ariaLabel\}/` — exact newlines and exact indentation of the source. Source-grep tests are an established convention in `tests/node/`, but this one breaks on any reformat and pins the very markup decision flagged above. Assert the presence of the label semantics, not the byte layout.

**Fix:** extend the integration test with a 2–3 record batch asserting `published_count`, both `is_published` flags, and one audit row per submission; add the duplicate-ID negative. Loosen the node regexes to whitespace-tolerant patterns.

## 4. Positive Observations

- **The write is genuinely atomic, and it is atomic in SQL rather than in hope.** The correlated `COUNT(DISTINCT candidate.submission_id) = ?` inside the `UPDATE … WHERE` means a reversal landing between the preview read and the command flips the whole batch to zero rows rather than publishing a partial set; the submission mirror and the audit insert are both gated on `item.updated_at = <this batch's stamp>`, so neither can run ahead of the agenda write. The post-batch reconcile then converts that zero into a 409 with no committed side effects. I verified the rollback behavior and the multi-row path by execution.
- **The reversal-safety constraint was honored precisely.** `status='accepted'` is asserted three separate times — in the candidate read, in the count guard, and in the audit predicate — and the integration test's withdrawn negative control proves a withdrawn speaker cannot be published even when the agenda row still exists. That is exactly the bug class the ticket warned about.
- **One predicate, three surfaces.** Deriving the counter, the preview, and the command from the same joined truth in `readAgendaPublication` (with the comment explaining why publication is a scheduled-agenda concern rather than a submission-stage count) is the right call and removes a whole family of "the badge says 1 but the list is empty" bugs.
- **The public link is real, not decorative.** `/agenda?event=<slug>` matches the actual public route contract (`public-agenda.route.tsx:63` reads `query.event`), and `events.slug` is `NOT NULL`, so the `?? eventId` fallback is dead-but-harmless rather than a broken link.
- **The preview is honest.** Title, formatted local time in the event timezone, room, building, and full speaker line — the fields that actually become public — with "Nothing is visible until you confirm" copy that respects the operator instead of a bare "Are you sure?".
- **Convention adherence throughout:** `defineApiRoute` with the same `program:write` / write-bucket / `concurrency: "none"` policy as the per-record publisher, `publicationActor` mirroring the established `actorFor` pattern, `newUlid(now)` for audit IDs, and CSS that passes the design contract check unmodified.
