# MRQ-81 — Public CFP submission is completely blocked

Repo root: `/Users/atin/Projects/Stage11/deployments/Marquee`. Read its `CLAUDE.md` first — it is binding. Then `DESIGN.md` and `PHILOSOPHY.md`.

You own this end to end: plan, implement, validate against a real running Worker, PR. You are an Opus delegator launched by the merge driver at **surface:261**, on Atin's instruction.

## Orient

`lattice show MRQ-81` — read it in full before touching anything. **It is unusually complete: the root cause is already confirmed in source, with file and line numbers.** Do not re-derive it from scratch; verify it, then fix it. If your reading contradicts the ticket, say so explicitly and bring evidence — the ticket is a strong prior, not scripture.

Supporting evidence: `sequence/UX-SWEEP-FINDINGS-PASSB.md` (Flow 1) and the screenshot it names.

## Why this one matters more than its line count

The walkthrough video is the evaluation rubric, and **this is step 1 of 11**. A judge who opens the public CFP form — the single most obvious thing to try — hits a wall on field one and never reaches the product. Worse: because this has been broken, Pass B had to chain all its testing off a pre-seeded submission, so **the main loop has never once been exercised end to end from a real public submission.** You are the first person who will run that path. Expect to find things nobody has seen.

## The shape of the bug (from the ticket, verify then fix)

In `src/ui/public/form/PublicForm.tsx`:

1. `handleFile` deliberately bails on a first-time submitter's first file pick (no draft yet), intending to show a message telling them to re-pick — but `resetTurnstile()` on the preceding line **throws**, so the `setPageError(...)` never runs and the user is told nothing.
2. `resetTurnstile()` guards only against the Turnstile script being absent. When the script is loaded but no widget is mounted, Cloudflare's own `reset()` throws. That is the observed `TurnstileError: Nothing to reset found for provided container`.
3. The throw is unhandled (`void handleFile(...)`), sits outside the `try`, and pre-empts the user-facing message. `resetTurnstile()` is called **twelve times** in this file; at five of them it precedes the `setPageError` that would explain a failure.

Net: the upload never runs, `setAnswer(...)` never clears the field's required state, and Submit is blocked forever.

## Scope

- A public submitter attaches a headshot and submits successfully, **first try**, logged out, with zero uncaught console exceptions.
- Make `resetTurnstile()` genuinely defensive — it is a cleanup helper and must never be able to abort a flow or swallow an error message, whatever the widget's state.
- Fix the first-selection dead end. **Prefer completing the upload after `ensureDraft()`** rather than bouncing the user; silently requiring the same file to be chosen twice is unacceptable even when the message does render.
- The field label promises "JPG or PNG · crop preview appears before submission". Either the crop preview appears, or the label stops promising it. Do not ship copy describing UI that does not exist.
- Re-check the other `resetTurnstile()` call sites (183, 190, 193, 238, 270, 283, 285) for the same swallowed-message pattern.

## Constraints

- **Do not weaken the Turnstile gate to make the upload work**, and do not make the upload path trust client input it should not. The public form is anonymous; that is exactly why the gate exists.
- Flight Deck tokens per `DESIGN.md`; `check:design` stays green. **Elements never jump** — this form validates under the reader, so reserve space for error text instead of letting rows shift.
- No new D1 table, no migration.
- If you touch an API route: `npx vite build && node cli/generate-api-registry.mjs` — `check:api` asserts exact registry parity.
- Test titles must begin `AC-<n> · ` or `CONTRACT · `. Anything else fails `trace:ac`. **`test.each(...)` also fails it** — the scanner reads the inner call's table as the title. Write tables longhand.

## Gate (corrected fleet gate, this run)

Three `tsc -p … --noEmit` passes, `npx vite build`, `npm run check:design`, `npm run check:api`, `npm run trace:ac`, plus **your own diff's test files**. 

**No full `npm test` and no `npm run pr-gate`.** Say so plainly in the PR body. Push and let GitHub CI run the suite — the runners are load-independent and this box is not. CI is green on `main` and is now a trustworthy judge; it has caught two real regressions tonight that local runs missed.

## Validation — non-negotiable, and the whole point

Green tests are not a working product. This ticket exists *because* something passed review while being completely broken for a real user.

1. Regression tests for both actual defects: a file answer clears its required state, and `resetTurnstile()` cannot throw with no widget mounted. A happy-path-only test would have missed this bug entirely.
2. **Real-artifact smoke.** Start your own Worker on a port nobody holds — **8787, 8801, 8802, 8803 and 8863 are taken; pick 8804+**. Add `--var INSECURE_LOCAL_COOKIES:1` to your `wrangler dev` command or your browser session will 401 after a 200 login (Safari/WKWebView drop a `Secure` cookie on `http://`; fixed on main as PR #20, but the flag is required to use it).
   Logged out, in a real browser, complete `/f/cfp` end to end with a genuine image file and submit. Then confirm it landed: it appears in `/submissions` and the record opens.
3. **Then walk the loop this blocker has been hiding** — review, accept, onboarding task, schedule, publish — starting from **your** newly submitted record, not a seeded one.
4. Zero uncaught console exceptions on the public form at every step.

Prefer the c11 embedded browser (`c11-browser` skill) over Chrome MCP — you are inside c11. If you hit two consecutive failed browser attempts, stop and report rather than grinding.

## Delivery

Own git worktree, branch `mrq-81-public-cfp-file-upload`, cut off current `github/main`. Never work in the main checkout — a fix was lost that way earlier tonight.

PR via `gh pr create --repo Stage-11-Agentics/marquee --base main`.

**`main` is now behind a manual merge gate** (`CODEOWNERS` + the "main: manual merge gate" ruleset, added by Atin). You open the PR; a human merges. Do not attempt to bypass it.

## File ownership

**OWNS:** `src/ui/public/form/*`, `src/routes/public-form*.ts(x)`, `src/routes/uploads.routes.ts` if the presign path needs it, its own tests.

**MUST NOT TOUCH:** `src/routes/submissions.queries.ts`, `src/api/board.ts`, `src/routes/dashboard.routes.ts`, `src/routes/submission-record.routes.ts`, `src/ui/evaluation/*`, `src/ui/submissions/*`, `scripts/seed/*`, `src/routes/tokens.routes.ts`, `package.json`.

## Reporting

Set your c11 title and description now (`c11 rename-tab --surface "$C11_SURFACE_ID" "…"`). Update the Lattice status before you start working (`lattice status MRQ-81 in_planning`, then onward). Milestones go on the ticket, not into chat.

Report the PR number to **surface:261** with `c11 send --workspace workspace:9 --surface surface:261 "…"`.

If you hit something only a human can decide, raise a c11 flag with a one-line reason — but note the deadline is **Wed 2026-08-12 22:00 PT**, so prefer a documented assumption and forward motion over a blocking question.

## Two things that will otherwise cost you an hour

- **Do not run the full suite locally.** It takes ~150s, and five agents doing it simultaneously is what wedged this machine earlier tonight at load average 158.
- If a gate fails and you suspect the machine rather than your code, check `uptime` before believing it — but CI on GitHub is the honest answer, and it is free.
