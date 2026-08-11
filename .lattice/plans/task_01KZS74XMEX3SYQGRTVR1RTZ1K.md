# MRQ-81: Public CFP submission is completely blocked — headshot upload never clears its required state

WALKTHROUGH BLOCKER — STEP 1 OF 11. No submission can be created through the public CFP form. Full evidence: `sequence/UX-SWEEP-FINDINGS-PASSB.md` (Flow 1), screenshot `B-public-f-cfp-headshot-BLOCKER.png`.

## Why this exists

The walkthrough video is the evaluation rubric (project `CLAUDE.md`), and its first step is a public speaker submitting through `/f/cfp`. That step cannot complete. A judge who opens the public form — the single most obvious thing to try — hits a wall on field one and never reaches the product. Pass B had to abandon the real intake path and chain the rest of its testing off a pre-seeded submission, which means **the main loop has never been exercised end to end from a real public submission.**

## Symptom

On `/f/cfp` logged out, every required field clears its warning except **Headshot**. A valid 400×400 PNG attaches at the DOM level (`input.files.length === 1`, correct name/size/`image/png`), but no crop preview mounts, no upload request fires, the required-field error never clears, and Submit re-scrolls to the field and refuses. Each attempt throws an uncaught `TurnstileError: [Cloudflare Turnstile] Nothing to reset found for provided container`. Re-dispatching `input` and `change` directly on the file input changes nothing — this is real client state, not an automation artifact. `.dev.vars` carries the correct Cloudflare always-pass test keys, so it is not a missing credential.

## Root cause — CONFIRMED IN SOURCE

`src/ui/public/form/PublicForm.tsx`.

**1. The first file selection deliberately bails, and the message explaining that never renders.** `handleFile` (line 219):

```
const hadDraft = Boolean(state.resume_token && state.draft_id);
const draftState = await ensureDraft();
if (!draftState?.resume_token || !draftState.draft_id) return;
if (!hadDraft) {
  resetTurnstile();                                    // line 226 — THROWS HERE
  setPageError("Your draft is saved. Complete the security check again, then choose the file once more.");
  return;                                              // line 228 — never reached
}
```

A first-time submitter has no draft, so `hadDraft` is false and the upload is intentionally skipped to force a re-pick. Line 226 runs first and throws, so line 227 never executes and the user is told nothing at all.

**2. `resetTurnstile()` is not actually defensive.** Line 76:

```
function resetTurnstile() {
  setTurnstileToken("");
  (window as ...).turnstile?.reset?.();
}
```

The optional chaining guards only against the script being absent. When the script IS loaded but no widget is mounted in the container, Cloudflare's own `reset()` throws — which is precisely the observed `TurnstileError`. Turnstile is not mounted at file-pick time.

**3. The throw is unhandled and pre-empts every user-facing message.** Line 226 sits OUTSIDE the `try` that begins at line 231, and `handleFile` is invoked as `void handleFile(...)` (line 311), so the rejection is unhandled. `resetTurnstile()` is called twelve times in this file; at lines 183, 190, 193, 226 and 238 it precedes the `setPageError` that would explain the failure, so a throw there silently swallows the explanation every time.

Net effect: the upload never runs, `setAnswer(field.key, ...)` (line 248) — the ONLY thing that clears the field's required state — is never reached, and Submit is blocked permanently.

## Scope

- A public submitter can attach a headshot and submit successfully, first try, logged out, with no console exception.
- Make `resetTurnstile()` defensive so it can never throw, whatever the widget's state. It is a cleanup helper; it must not be able to abort a flow or suppress an error message.
- Fix the first-selection dead end. Selecting a file once must either upload it or state plainly what the person must do next — silently requiring the same file to be chosen twice is not acceptable even when the message does render. Prefer completing the upload after `ensureDraft()` rather than bouncing the user, if the security check allows it.
- Verify the crop preview the field's own label promises ("JPG or PNG · crop preview appears before submission") either appears or the label stops promising it. Do not ship copy that describes UI that does not exist.
- Re-check the other `resetTurnstile()` call sites (183, 190, 193, 238, 270, 283, 285) for the same swallowed-message pattern.

## Constraints

- DESIGN.md / Flight Deck tokens; `check:design` stays green. ELEMENTS NEVER JUMP — this form validates under the reader, so reserve space for error text rather than letting rows shift.
- The public form is anonymous. Do not weaken the Turnstile gate to make the upload work, and do not make the upload path trust client input it should not.
- No new D1 table and no migration.
- If you touch an API route, `npx vite build && node cli/generate-api-registry.mjs` — `check:api` asserts exact registry parity.
- Corrected fleet gate (merge driver, this run): three `tsc --noEmit` passes, `npx vite build`, `check:design`, `check:api`, `trace:ac`, and your own diff's test files. NO full `npm test` and NO `pr-gate` while the queue drains — say so in the PR body. Push and let GitHub CI run the suite; the runners are load-independent and this box is not.
- Test titles must begin `AC-<n> · ` or `CONTRACT · `. Any other prefix fails `trace:ac`.

## Verification

1. Regression test that a file answer clears its required state, and that `resetTurnstile()` cannot throw with no widget mounted. Both are the actual defects; a test that only checks the happy path would have missed this.
2. REAL-ARTIFACT SMOKE, non-negotiable, and this is the whole point of the ticket. Start your own Worker on a port nobody else holds (8787/8801/8802/8803/8863 are taken — pick 8804+). Logged out in a real browser, complete `/f/cfp` end to end with a genuine image file and submit. Then confirm the submission lands: it appears in `/submissions`, and the record opens.
3. Then walk the loop the blocker has been hiding — review, accept, onboarding task, schedule, publish — starting from YOUR newly submitted record, not a seeded one. Nobody has ever run that path from a real submission; this ticket is the first chance to.
4. Zero uncaught console exceptions on the public form at every step.

## Delivery

Own git worktree, branch `mrq-79-public-cfp-file-upload`, cut off current `github/main`. PR via `gh pr create --repo Stage-11-Agentics/marquee --base main`.

## File ownership

MRQ-79 OWNS: `src/ui/public/form/*`, `src/routes/public-form*.ts(x)`, `src/routes/uploads.routes.ts` if the presign path needs it, its own tests.
MRQ-79 MUST NOT TOUCH: `src/routes/submissions.queries.ts`, `src/api/board.ts`, `src/routes/dashboard.routes.ts`, `src/routes/submission-record.routes.ts` (MRQ-76), `src/ui/evaluation/*`, `src/ui/submissions/*` (MRQ-77), `scripts/seed/*`, `src/routes/tokens.routes.ts` (MRQ-78), `package.json`.
