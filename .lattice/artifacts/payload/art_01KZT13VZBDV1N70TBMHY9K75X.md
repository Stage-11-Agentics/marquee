# Plan Review: MRQ-96 — organizer-configurable upload file types

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

Reviewed the delegator plan for MRQ-96 against the live codebase (`src/lib/r2/policy.ts`,
`src/lib/r2/sniff.ts`, `src/lib/r2/complete.ts`, `src/routes/uploads.routes.ts`,
`src/routes/portal.routes.ts`, `src/ui/upload/upload-policy.ts`, `src/ui/shell/route-table.ts`,
`src/ui/shell/AppShell.tsx`, `src/routes/event-settings.routes.ts`, `DEPLOY.md`, `SPEC.md`).
The structural decisions are sound and well-grounded — `/settings/tasks` really is already
routed and rendering the shell stub, `program:read`/`program:write` with `concurrency: "none"`
really is the settings-route convention, and `file_config` really is read live off the template
on every portal and presign query, so persistence and propagation will work as described.

The plan fails on two things it does not acknowledge. First, the organizer-facing vocabulary it
promises (Images, Video, arbitrary custom extensions) cannot be enforced by the pipeline it
commits to not changing: `policyFor("task_upload")` narrows **`DOCUMENT_RULES` only**
(pdf/pptx/key), so saving an "Images" or "Video" or custom-extension config produces an empty
rule set and rejects *every* file — the exact silent-brick failure the ticket asks to prevent,
reached through a non-empty accept list the plan's validation would happily save. Second, the
acceptance criterion "validated on the live deployed site" is unreachable under the plan's own
delivery order (stop at `pr_open`, and per `DEPLOY.md` merging does not ship); the plan's
"report deployment drift" escape hatch dodges the criterion rather than satisfying it.

## 3. Issues

**[CRITICAL] Decision / Implementation §1 — "Images", "Video", and the custom-extension escape hatch are unenforceable and will brick the task**

`policyFor` at `src/lib/r2/policy.ts:117-122` builds a `task_upload` policy as
`narrowRules(DOCUMENT_RULES, config?.accept)`. `DOCUMENT_RULES` is exactly
`pdf | pptx | key` (`policy.ts:38-46`). `narrowRules` (`policy.ts:88-97`) is a *filter over that
base*, not a union — so an accept list of `["jpg","png"]` or `["mp4","mov"]` or `["docx"]`
yields `rules: []`, and `validateDeclared` (`policy.ts:163-164`) then returns
`{ ok: false, violation: "extension" }` for **every** file. The task is silently bricked. The
same holds at completion time: `src/lib/r2/complete.ts` verifies magic bytes via
`matchesExpectedKind`, and `SniffKind` is a closed set of six (`sniff.ts:8`) with no video
kind at all, so widening the extension list without touching the sniffer would only move the
failure from sign time to completion time.

The plan is half-aware of this — "the live proof will use the already supported Presentation
Upload formats" — but it never resolves the contradiction. Scope item 2 of the ticket demands
Images and Video presets, plan step 3 says it will build them, and plan step 1 and the Non-goals
both forbid changing the policy/completion layer that would make them work. As written, the
implementer ships an organizer control whose most obvious uses destroy the task. This is
strictly worse than the hardcoded seed value it replaces.

Note also that the plan's only guard against this class is "reject an explicitly empty list."
An empty list is *not* the dangerous case — `narrowRules` treats an empty accept as "no
restriction" (`policy.ts:92`) and falls back to the full base. The dangerous case is a
**non-empty list containing no supported extension**, which the plan's validator would save.

**Recommendation:** Pick one and state it in the plan.
(a) *Narrow the promise:* offer only presets the pipeline can enforce today — Slides (PDF, PPTX,
Keynote) and its subsets — and have the server **reject any accept list that narrows
`policyFor("task_upload")` to zero rules**, with a 422 naming the supported set. Say plainly in
the PR that Images/Video are out of reach until the policy base and sniffer are widened, and
file a follow-up ticket. This keeps the plan's non-goals intact.
(b) *Widen the base:* extend the `task_upload` base to `[...IMAGE_RULES, ...DOCUMENT_RULES]`
(the `draft_file`/`submission_file` cases at `policy.ts:129-135` already do exactly this, so
Images becomes real for the cost of one line), and add the corresponding `FileTypeRule`s. Video
still requires new `SniffKind`s + `matchesExpectedKind` branches; scope it out explicitly.
Either way the zero-rule guard in (a) is mandatory — it is the real "cannot brick the task"
invariant, and the ticket's empty-list criterion is only its degenerate case.

---

**[CRITICAL] Verification and delivery — live-site validation is unreachable under the plan's own delivery order**

The plan ends with "stop at `pr_open` for human merge," and `DEPLOY.md` opens with **"There is
no auto-deploy. Merging does not ship."** Deploys run from a clean worktree at `github/main`.
So at the moment the delegator would run its browser validation, `https://marquee.stage11.dev`
is guaranteed to be serving code without this change. The plan's contingency — "If the live
deployment is still on an older main revision, report that as deployment drift" — converts a
certainty into a reported surprise and leaves the acceptance criterion ("Validated on the live
deployed site … Screenshots of both in the PR") unmet by construction.

**Recommendation:** Plan the actual path before implementing. Realistic options, in preference
order: (1) run the full organizer→speaker loop against a **local Wrangler runtime with the real
D1 seed**, capture those screenshots, and state in the PR that live validation is pending the
post-merge deploy — naming who owns it, per `DEPLOY.md`'s "whoever merges owns getting it live";
(2) request an explicit deploy handoff through Lattice as part of the ticket, so live validation
happens after merge and the PR is updated; (3) if the orchestrator authorizes it, deploy the
branch and validate, then note the temporary divergence. Whichever is chosen, write it into the
plan — do not leave it to the implementer to discover at validation time.

---

**[MAJOR] Implementation §4 / Acceptance — the server-side rejection message is not addressed**

Acceptance requires: "A file outside the configured list is rejected **server-side** … with a
message naming what is accepted." Today both presign paths return
``uploadError(context, "invalid_request", `rejected: ${decision.violation}`)``
(`uploads.routes.ts:265`, `:397`) — literally `rejected: extension`. That is the terse
validation string the ticket's scope item 5 names as unacceptable. No plan step changes it;
step 4 commits only to "the smallest portal-facing assertion," and Non-goals could be read to
forbid touching `uploads.routes.ts` at all.

Worth noting in the implementer's favor: the *client* half of scope item 5 is already done.
`validateClientUpload` (`src/ui/upload/upload-policy.ts:36-38`) returns
`Choose a .pdf, .pptx, .key file.` — a plain sentence naming what is accepted — and it lives in
`upload-policy.ts`, **not** in the MRQ-92-owned `upload-client.ts`, so improving it would not
collide. The plan should say this explicitly rather than leaving it ambiguous.

**Recommendation:** Decide and state whether the presign error message is in scope. It is a
message-string change in the route handler, not the presign transport or `src/lib/r2/presign.ts`,
so it does not conflict with MRQ-92 — but say so, and coordinate through Lattice as the ticket
instructs. Concretely: on an `extension` violation, return the accepted extension list in the
error detail. Add an integration test that POSTs a `.exe` to the authenticated sign route and
asserts the response names the configured types.

---

**[MINOR] Decision — no AC lineage, and the screen's spec'd scope is unexamined**

`SPEC.md:523` already assigns `/settings/tasks` to **AC-46, AC-47**, and `SPEC.md:265` ties
`file_config` (`accept[]`, `maxBytes`) to **AC-146**. The plan names none of them, though the
project convention is that requirements trace to R-numbers and stories to AC-numbers. Building
this screen as a file-config-only editor is the right narrow call for this ticket, but without
saying so the next agent to pick up the §5.13 task-templates screen will either duplicate it or
overwrite it.

**Recommendation:** Add a line to the plan's Decision: this ticket builds the AC-146 slice of
the AC-46/AC-47 task-templates screen; name/due/kind/position editing remains unbuilt. Repeat it
in the PR body.

---

**[MINOR] Decision — canonical form diverges from the seed, leaving a mixed corpus**

The plan stores extensions dot-stripped (`pdf`), while `scripts/seed/event.ts:348-350` writes
the dotted form (`.pdf`), and Non-goals explicitly exclude "changes to the seed's default." Both
forms work — `narrowRules` (`policy.ts:94`) and `acceptedExtensions`
(`upload-policy.ts:12-16`) each strip a leading dot — so this is not a defect, but the codebase
will carry two representations of the same value and the next reader will not know which is
canonical.

**Recommendation:** Keep the dot-stripped canonical form (it matches `extensionOf` and
`FileTypeRule.extension`), and add one comment at the normalizer saying so and noting that both
forms are read tolerantly by design. Consider updating the seed literal in the same PR — it is
one line and costs nothing.

---

**[MINOR] Implementation §2 — a second task-template list endpoint duplicates an existing read**

`src/routes/onboarding.queries.ts:385` already selects the event's task templates and returns
them as `task_templates` in the onboarding ready payload. A new list route is defensible (that
payload is shaped for the chase matrix and almost certainly omits `file_config`), but the plan
asserts the need without checking.

**Recommendation:** Verify the onboarding payload's template shape first. If it lacks
`file_config`, keep the new module and say why in the PR; if it already carries it, reuse the
read and add only the PATCH.

---

**[MINOR] Implementation §1 — silent clamping at the 100 MB ceiling**

`clampOwnerMaxBytes` (`policy.ts:75-79`) silently `Math.min`s to `ABSOLUTE_MAX_BYTES` and
silently falls back to the 25 MB default for a non-finite or non-positive value. If the organizer
UI accepts a number above 100 and the server clamps it, the saved value will not match what was
typed — a small "respect the operator" violation.

**Recommendation:** Reject above-ceiling values at the API with a 422 naming the 100 MB limit
(the plan says "cap," which reads as clamp), and state the ceiling in the UI next to the MB
input so it is known before it is hit.

---

**[MINOR] Verification and delivery — stale documentation is not updated**

`sequence/UX-SWEEP-FINDINGS.md:32` and `SITEMAP.md` both record `/settings/tasks` as an unbuilt
stub. This PR falsifies that.

**Recommendation:** Update the UX-sweep row (or note it as superseded) in the same PR.

## 4. Positive Observations

- **The orientation work is real, and it checks out.** Every structural claim I verified was
  accurate: `/settings/tasks` is in `route-table.ts:38` and falls through to the shell's honest
  empty state (`AppShell.tsx:168`); `VenuesPage`/`ApiTokensPage` at `AppShell.tsx:156-157` give
  an exact wiring precedent; `program:read`/`program:write` with `concurrency: "none"` is
  precisely the `event-settings.routes.ts` and `venues.routes.ts` convention; the glob manifest
  (`_manifest.ts`) means a new `*.routes.ts` self-registers with no snapshot test to update.
  Choosing to extend the existing route rather than invent a screen is the right call and is
  correctly argued.
- **The "no second representation" discipline is exactly right.** Writing the same
  `{ accept, maxBytes }` shape that `parseUploadOwnerConfig` already reads means propagation is
  free — `portal.routes.ts:707` and `uploads.routes.ts:347,501` both join `template.file_config`
  live on every request, so "the speaker's picker reflects the change after a refresh" needs no
  new plumbing at all. The plan identified this correctly and refused to build a parallel path.
- **The MRQ-92 boundary is drawn carefully and correctly**, down to naming the two forbidden
  files rather than gesturing at "the upload code" — and, as it happens, the client-side
  validation the ticket cares about lives just outside that boundary.
- **Backward compatibility is handled deliberately**: keeping `null` configs intact preserves
  the `DEFAULT_FILE_MAX_BYTES` fallback path unchanged, which is what the ticket's "behaves
  exactly as it does today" criterion actually requires.
- **The test list is genuinely good** — normalization, dotted/uppercase/duplicate input,
  event/template scoping, and no-config preservation are the right axes, and running focused
  tests against the unfixed baseline so new failures are attributable is a discipline worth
  keeping. Adding the zero-rule-narrowing case from the critical issue above completes it.
