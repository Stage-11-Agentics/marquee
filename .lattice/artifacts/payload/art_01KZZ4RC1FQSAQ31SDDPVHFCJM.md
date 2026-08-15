# Code Review: MRQ-177 — silent replacement-upload failure on the speaker portal

## 1. Verdict

**FAIL (implementation-level)** — the visibility/honesty work is well designed and correctly wired, but the timeout is implemented as a flat 30-second cap on *total* upload duration. Against this repo's own upload policy (25 MB default per file task, 100 MB contract ceiling), that converts legitimate, actively-progressing slide-deck uploads into forced failures — the mirror image of the defect being fixed, on the exact artifact class (speaker decks) this ticket covers. The approach is sound; one mechanism needs rework.

## 2. Summary

Reviewed the diff for MRQ-177: honest progress states (`loaded: null` until a real progress event), a terminal "Upload stopped" failure state that names the true server state ("Previous version kept" / "No version saved"), version-aware failure copy, an abort message replacing the previously silent abort, an XHR timeout, layout-stability CSS, and regression tests that verifiably fail on `main`. The state-machine and copy work is strong and satisfies acceptance items 2, 4, and (via the existing `await onComplete()` refetch) 5. The key finding is that `xhr.timeout` bounds the entire request, not inactivity, so the 30 s value will kill healthy large uploads; secondarily, the diff contains no root-cause fix or explanation for the original stall, which item 1 of the ticket explicitly required.

## 3. Issues

**[MAJOR] src/ui/upload/upload-client.ts:273 (`UPLOAD_PUT_TIMEOUT_MS = 30_000`, applied at `xhr.timeout` in `putFileToR2`) — Flat 30 s total-duration timeout aborts legitimate large uploads**
`XMLHttpRequest.timeout` measures the whole request from `send()` to completion, not idle time. Upload policy (`src/lib/r2/policy.ts`) allows 25 MB by default for file tasks and 100 MB at the contract ceiling. A 25 MB deck needs a sustained ~6.7 Mbps uplink to finish inside 30 s — conference-hotel and international-speaker uplinks are routinely 2–5 Mbps, i.e. 40–100 s for a perfectly healthy upload. Such a speaker now watches a genuinely advancing progress bar get killed at 30 s with "That upload took too long and was stopped." The ticket's own language is "a **stuck** upload times out" — stuck, not slow. This is a new false-failure regression on the primary artifact this feature exists for.
**Fix:** Implement a stall watchdog instead of a total cap: start a timer on `send()`, reset it on every `upload.onprogress` event, and reject with `UPLOAD_PUT_TIMED_OUT` only when no bytes have moved for N seconds (30 s idle is reasonable). If a total ceiling is also wanted, scale it to file size (e.g. `max(120 s, size / MIN_ACCEPTABLE_BPS)`). The existing unit test structure (`HangingXHR`) adapts cleanly: fire a progress event mid-test and assert the watchdog resets.

**[MAJOR] Diff-wide — no root cause identified or fixed for the original silent stall**
Item 1 of "What to build" is explicit: "Find the actual failure. Root-cause it before changing anything… A fix you cannot explain will not survive the next round." Everything in this diff is mitigation — visibility, timeout, honest progress. Nothing explains why the judge's first PUT sat at 0 B for 15 s with no `onerror` (candidates the ticket itself names: presigned-PUT race, stale token, aborted request). Mitigation may in fact be the right call if investigation concluded the stall was environmental/transient and unattributable — but that conclusion has to be stated somewhere durable (PR description, ticket comment, or a code comment on the watchdog). If it exists outside this diff, this issue reduces to "link it from the PR"; if it doesn't, the investigation still needs to happen.
**Fix:** Record the root-cause analysis (or the explicit dead-end: what was ruled out and why) on the ticket/PR. If a concrete cause was found, fix or guard it, not just its symptom.

**[MINOR] src/ui/portal/PortalPage.tsx:405 (file input `onChange`) — stale "Upload stopped" row persists after a new file is chosen**
`onChange` clears `error` and `canRetry` but not `progress`, so after a failure the "Upload stopped · Previous version kept" row keeps rendering next to a freshly selected file until the next submit. It's honest-but-stale state that slightly muddies an otherwise crisp state machine.
**Fix:** Also call `setProgress(null)` in the file-input `onChange` handler.

**[MINOR] src/ui/upload/upload-client.ts (new `UPLOAD_PUT_TIMED_OUT`) — raw diagnostic string reaches speakers on the other upload surfaces**
`putFileToR2` is also used by `ProfileTaskSurface` (headshots, PortalPage.tsx:561 → catch at :598 renders `(caught as Error).message`), `CoSpeakerPage.tsx`, `SpeakerRecord.tsx`, and `PublicForm.tsx`, none of which route through `speakerUploadFailureMessage`. A timed-out headshot upload will now display the literal string "upload PUT timed out". This wart pre-exists for `UPLOAD_PUT_NETWORK_ERROR`, but the diff adds a new failure mode to every one of those paths without extending the human mapping to them.
**Fix:** Either route those catch blocks through `speakerUploadFailureMessage(caught) ?? (caught as Error).message`, or file a follow-up ticket noting the surfaces that still leak transport strings.

**[MINOR] tests/node/r2-cors.MRQ-92.test.mjs:362 — the "regression test for the panel's failure branch" is source-regex, not behavior**
The acceptance asks for a test that "proves the panel does not report success when nothing was written." What ships is (a) a real behavioral unit test of the transport timeout (good) and (b) regex assertions that the panel source contains `state: "failed"`, `"Upload stopped"`, etc. Regex-on-source is an established idiom in this exact file, and the suite does fail on `main` (the imports and patterns don't exist there), so the letter of "fails on main, passes on branch" is met — but a refactor that keeps the strings while mis-wiring the render would still pass. The repo already does `preact-render-to-string` component tests (e.g. `submitter-portal.MRQ-150.test.ts`).
**Fix:** Add a render-level assertion where feasible — e.g. render the file-task form in the failed-progress state and assert "Upload stopped" / "Previous version kept" appear and no success copy does. If driving the async submit path isn't practical without an interactive DOM, say so in the test header comment so the regex tier reads as a deliberate floor, not the intended proof.

**[MINOR] tests/unit/upload-client.MRQ-92.test.ts:433 — `vi.stubGlobal("XMLHttpRequest", …)` is never unstubbed**
Vitest does not auto-restore global stubs without `unstubGlobals: true`, which `vitest.config.ts` does not set. File isolation contains the leak today (and it's the last test in the file), but the next test added to this file inherits a fake XHR silently.
**Fix:** `afterEach(() => vi.unstubAllGlobals())` (or `vi.unstubAllGlobals()` at the end of the test).

**[MINOR] src/ui/portal/portal.css:257–258 — reserved widths are hardcoded to current copy lengths**
`min-width: 174px`/`118px` are tuned to "Uploading · waiting for transfer" and "Previous version kept". They satisfy elements-never-jump now, but any copy edit silently breaks the guarantee with no failing check.
**Fix:** Acceptable as-is; a one-line comment tying the widths to the longest swapped strings would keep the invariant maintainable.

## 4. Positive Observations

- **The honest-progress fix is exactly right.** `loaded: null` until the first real `onprogress` event, rendered as an indeterminate `<progress>` with "waiting for transfer", removes the "0% · 0 B / 608 B" lie that made the original failure invisible — and the contract test pins `assert.doesNotMatch(portal, /setProgress\(\{ loaded: 0/)` so the lie can't quietly return.
- **The failure copy states the true server state, version-aware.** "Your previous version is still current" vs. "No new file was saved" is precisely the distinction that matters on a replacement path, and it's threaded consistently through network, HTTP, timeout, expiry, and abort branches via one `previousVersionRecovery` helper rather than five hand-written strings.
- **`uploadStarted`/`uploadCompleted` is a clean minimal state machine.** Notably, because `uploadFile` includes the R2-completion POST, a PUT that succeeds but fails to complete still lands in the "failed, previous version kept" state — which is accurate, since the attachment never became current. The `finally` clause clearing progress only on `uploadCompleted || !uploadStarted` keeps the terminal failure row (and its retry affordance) in place instead of snapping back to the pre-upload state, per the elements-never-jump rule.
- **Abort is no longer silent.** The old path set `error` to `null` on cancel — a quieter cousin of the original defect. `speakerUploadAbortedMessage` closes it.
- **The regression tests genuinely fail on `main`:** the unit test imports `UPLOAD_PUT_TIMEOUT_MS`/`UPLOAD_PUT_TIMED_OUT`, which don't exist there, and the contract regexes have no match. The `HangingXHR` fake is a tidy, dependency-free way to drive `ontimeout` deterministically.
- The existing MRQ-92 contract test was updated (`speakerUploadFailureMessage\(caught(?:,|\))`) rather than deleted or loosened into meaninglessness — the old guarantee still holds alongside the new one.
