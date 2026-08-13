# Code Review: MRQ-155 — V2-6 reversible publication control

Reviewed at `Marquee-worktrees/v2-6-publish-control`, commit `eaa30e26`, against `main`.

## 1. Verdict

**PASS**

No critical or major issues. Five minor findings, all of which are safe to fix in a
follow-up; finding #1 is a one-line change I would take before merge.

## 2. Summary

Reviewed the new `unpublish` transition on the submission record API, the
`setPublication` helper that now backs both directions, the slot-panel publication
control that replaces the old publish-only card and `window.confirm`, and the two new
test files. The API work is the strongest part of the change: the three-statement D1
batch is genuinely all-or-nothing because each statement's predicate depends on the
prior one having landed, and it also closes a read-then-write TOCTOU that the old
`publishSubmission` had. Key finding: the new operator-facing copy and the OpenAPI
description both promise the session disappears from **embeds** "immediately", but
embed responses are served from a 30-second KV cache that no publication mutation
purges — the helper written for exactly this (`purgePublicEmbedCache`) has no
production caller.

Verified independently, in the worktree:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `tests/integration/api/submission-record-board.AC-118-…test.ts` | 4/4 pass |
| `tests/node/publication-control.CNT-12.test.mjs` | 2/2 pass |
| `npm test` (full suite) | 193/193 pass, 39.5s (budget 45s) |
| `npm run pr-gate` | pass, 93.4s (budget 120s) |

## 3. Issues

**[MINOR] src/routes/submission-record.routes.ts:1400 and src/ui/submissions/SubmissionRecordPage.tsx:348 — "and embeds immediately" is not true; the embed cache is never purged**

Both the route description ("…so the Session disappears from the public agenda and
embeds immediately") and the confirm copy the organizer reads ("This Session
disappears from the public agenda and embeds immediately") claim embeds update at
once. They do not. `/embed/{slug}` (`src/routes/embed.route.tsx:48-52`) and
`/api/v1/public/embeds/{slug}` (`src/routes/public.routes.ts:181-188`) answer from
`env.CACHE` with a 30-second logical TTL (`EMBED_CACHE_TTL_SECONDS`,
`src/lib/public-site.ts:10`). `purgePublicEmbedCache` exists and its own docstring says
*"Call this from the agenda publish mutation so every public variant is fresh"* — but
grep shows **no production caller anywhere**, only tests. `setPublication` does not call
it either.

Failure scenario: a speaker cancels at 23:59, the organizer unpublishes the session and
sees "Not yet public" plus copy telling them embeds are already updated; the conference
site's embedded agenda iframe (whose variant was cached by any visitor in the last 30s)
keeps listing the cancelled session for up to 30 more seconds. Self-healing and bounded,
but the copy states otherwise, and this is precisely the pull-it-now moment the ticket
exists for. The pre-existing gap (batch publish doesn't purge either) is not this diff's
fault, but this diff is what puts the word "immediately" in front of the operator.

**Fix:** after `setPublication` returns in both handlers, `await purgePublicEmbedCache(context.env.CACHE, { eventId })`
(the same env binding `public.routes.ts` uses). If the purge is deliberately deferred to a
separate ticket, drop "and embeds" from both strings instead — do not ship the claim
unbacked.

---

**[MINOR] src/ui/submissions/SubmissionRecordPage.tsx:348 — the in-flight button label is unreachable; the panel silently snaps back mid-request**

The confirm button renders `busy === publicationRequest ? (…"Publishing…" : "Removing…") : …`.
But `changePublication` (line 212) calls `setPublicationRequest(null)` *before* `act()`
sets `busy`, and both state updates land in the same render pass. The confirm block is
gated on `{publicationRequest ? …}`, so by the time `busy` is `"publish"`/`"unpublish"`,
the block no longer exists — the `busy === publicationRequest` branch can never render.

Failure scenario: organizer clicks "Remove from public site" in the confirm; the confirm
disappears and the panel returns to the pre-confirmation trigger, still reading "Remove
from public site" and still showing the green "Live on the public site" chip, with no
progress cue for the duration of the POST + reload. On a slow link that reads as "my
click did nothing," and invites a second click. (The same shape exists in the decision
dialog above it, so this is consistent with the file — but the dead branch here is new
code that cannot execute.)

**Fix:** keep `publicationRequest` set until the request settles — clear it after `act()`
resolves rather than before — so the intended "Publishing…"/"Removing…" label actually
renders. Alternatively drive the label off `busy` on the trigger button and delete the
unreachable ternary.

---

**[MINOR] src/routes/submission-record.routes.ts:775 — `can_schedule` was left without the `program:write` gate its neighbours just got**

The diff correctly adds `&& canWriteProgram` to `can_publish` (780) and `can_unpublish`
(781), which is the fix the `canWriteProgram` docstring at line 203-211 describes. The
line immediately above, `can_schedule`, still has no grant test.

Failure scenario: an ops-staff or form-admin account with read access but no
`program:write` opens an accepted, unscheduled session record and is shown the "Working
agenda" card; filling it in and submitting returns 403 and loses the typed slot — the
exact dead end this projection exists to prevent, one line above the lines that were
fixed.

**Fix:** `can_schedule: row.kind === "session" && row.stage === "accepted" && slot === null && canWriteProgram`.
Pre-existing, but adjacent and one word.

---

**[MINOR] cli/registry.mjs:303-307 — `unpublishSubmission` has no CLI/skill command, so an agent can publish but not reverse it**

`cli/registry.mjs` maps `submissions publish` → `publishSubmission`, and
`cli/generate-skill.mjs:204-207` documents publishing in the generated agent skill. No
command was added for the new operation. `check:api` stays green because
`cli/api-registry.json` is generated from the served OpenAPI document, so nothing fails
loudly — the gap is silent.

Failure scenario: an agent operating Marquee through the CLI/skill (the "agent-native by
design" principle) hits the same one-way publishing this ticket was written to remove: it
can put a cancelled speaker's session on the public site and has no command to take it
off.

**Fix:** add the mirror entry (`path: ["submissions", "unpublish"]`,
`operations: ["unpublishSubmission"]`) and the `client.post(`${base}/unpublish`)` branch
alongside `cli/marquee.mjs:451-457`. Out of the ticket's stated scope — reasonable as a
follow-up ticket rather than a rework.

---

**[MINOR] src/ui/submissions/record.css:24 — the confirm-copy font size is silently overridden**

`.record-publication-confirm > span` (specificity 0,1,1) sets `font: 400 10.5px/1.45 var(--sans)`,
but `.record-slot span:not(.chip)` at line 16 (specificity 0,2,1) wins on `font-size` and
forces 11px. Source order doesn't help — the higher-specificity rule always wins. The
declared 10.5px never renders; family, weight and line-height do.

**Fix:** scope it as `.record-slot .record-publication-confirm > span`, or fold the size
into the existing rule. Cosmetic only, but a declaration that reads as authoritative and
isn't is the kind of thing the next person edits twice.

## 4. Positive Observations

- **`setPublication`'s batch is genuinely atomic, not just hopefully atomic.** The
  interlock is the good part: the agenda update requires the submission row at its
  *pre-read* values, the submission update requires the agenda row already at the *new*
  `(target, agendaUpdatedAt)` — which can only be true if the agenda update landed — and
  the conditional audit `INSERT … SELECT` requires both rows at their new values. Combined
  with `Math.max(now, old + 1)`, the stamps strictly increase, so no run can accidentally
  satisfy another run's predicate. There is no reachable path where one flag moves and the
  other doesn't, which is exactly the failure ("organizer sees one truth, attendees another")
  the comment claims to prevent.
- **The accepted-status guard moved into the write.** The old code read `status` in a
  separate query and then wrote — a real TOCTOU window where a reversal landing in between
  would publish a withdrawn speaker's name, time and room. The new
  `AND (? = 0 OR status = 'accepted')` inside the batch closes it, and correctly applies
  only to the publish direction: unpublishing a withdrawn-but-still-public session is
  allowed, which is the whole point.
- **It follows the house pattern instead of inventing one.** `auditStatementFromSelect` +
  CAS on `updated_at` + conflict-on-`meta.changes` is lifted straight from
  `batchPublishAgenda` (`src/routes/agenda.routes.ts:243-305`), so the two publication
  paths now fail the same way and read the same way.
- **The integration test tests behavior, not shape.** It asserts DB flags on both tables,
  that both `updated_at` values actually advanced on each transition, the public agenda
  HTML, the public agenda JSON, the `/s/{slug}` page returning **404** after unpublish, full
  restoration after republish, and the exact audit action sequence
  `["published","unpublished","published"]` with before/after payloads. That is the
  strongest coverage in the diff and it is what makes the UI-level static assertions
  tolerable.
- **The projection fix is the right kind of fix.** Gating `can_publish`/`can_unpublish` on
  `program:write` removes a button that 403s for ops staff, and the record GET is one of
  the two call sites that actually passes the real grant through (line 1027) rather than
  the permissive default.
- **`window.confirm` is gone and the copy names the consequence in both directions.** The
  inline confirm states what becomes public / what disappears, in the organizer's language,
  and the reserved chip/trigger footprint (`min-width: 164px` / `200px`, `min-height: 32px`)
  keeps the control from resizing as the label swaps — the house "elements never jump" rule,
  honored at the control level.
- **`.first()` on the agenda join is safe** — `uq_agenda_items_submission` in
  `migrations/0001_init.sql:894` guarantees one session row per submission, so there is no
  hidden second agenda item left published.
