# MRQ-77: Two organizer screens render broken layouts — /evaluation round flow and the submission record aside

Two organizer screens render visibly broken layouts. Both are walkthrough-visible and both are prototype-fidelity regressions. Full evidence: sequence/UX-SWEEP-FINDINGS.md rows 3-4, with screenshots.

## Why this exists

Prototype-to-product fidelity is a taste rule (SPEC.md preamble, PHILOSOPHY.md): what the client signed ships one-to-one, and divergence is a defect, not a liberty. One of these two screens has demonstrably drifted from the binding prototype. The other renders content underneath another card. A judge scrolling either screen sees a broken product regardless of how correct the data is.

## IMPORTANT — these two defects do NOT share a root cause

The sweep hypothesized one shared "sidebar card doesn't reserve space" CSS defect. Reading the components disproves it: defect A is a DOM-ordering bug against a correct grid, defect B is something else entirely and the authored CSS is sound. They are batched here because both are small, self-contained, front-end-only layout fixes with the same visual verification pass — NOT because one fix resolves both. Do not go looking for a unified cause.

## Defect A — `/evaluation` Round 2 card (ROOT-CAUSED, small fix)

`src/ui/evaluation/evaluation.css:5` declares a three-column grid:

    .round-flow { grid-template-columns: minmax(0, 1fr) 34px minmax(0, 1fr); }

`src/ui/evaluation/EvaluationPage.tsx:259-268` emits the children in the WRONG ORDER. It maps `[firstRound, secondRound]` to two cards and then appends the arrow AFTER both:

    [round 1 card] [round 2 card] [arrow]

So Round 2 lands in the **34px arrow track** and the arrow lands in the second 1fr track. Round 2's text wraps one word per line in a 34px column; the arrow floats alone in the empty right column.

The binding prototype has it right — `prototypes/pipeline/index.html:775` and `prototypes/pipeline-v1.1/index.html:2077` both emit `[round card] [round-arrow] [round card]`. This is a straight fidelity regression against the signed design.

**"IdentitySep visible 8" is NOT a raw identifier leak.** Do not go hunting for it. It is line 266's `{round.anonymized ? "Anonymous review" : "Identity visible"}` next to the formatted close date `Sep 8`, wrapped one word per line in the 34px column and read out of order. It disappears when the column is the correct width. The sweep's reading of it as an internal identifier was a misread of wrapped text; nothing is leaking.

Fix by restoring prototype DOM order (arrow between the cards) or by explicit `grid-column` placement. Keep the empty-round fallback at line 267 working — the arrow must sit between the cards whether or not Round 2 is configured.

## Defect B — `/submissions/:id` aside overlaps main content (NEEDS LIVE DIAGNOSIS)

At 1316x924 on `/submissions/sub_agent-eng`, the right-hand "Evaluation panel" card is drawn ON TOP of the main column: the `WAVE` field value is hidden entirely and the venue text in the green schedule box is clipped mid-word ("Sheraton New York Times Square ·"). Confirmed a genuine overlap by zoom, not a scroll artifact. A longer-abstract record (`sub_gemini-deep-research`) at the same viewport renders correctly, because taller main content pushes the schedule box clear of the aside — so the overlap is height-dependent.

**Start from this: the authored CSS is correct.** `src/ui/submissions/record.css:2-3` is

    .record-layout { align-items: start; display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) 330px; }
    .record-main, .record-aside { min-width: 0; }

That is a well-formed two-track grid with blowout guards on both items — grid items in separate tracks cannot overlap. The rendered screenshot nonetheless measures a main column far wider than its track, running under an aside wider than 330px. So the cause is NOT the rule as written and reading harder at this file will not find it. Diagnose in the browser with devtools and establish which of these is true before changing anything:

- Is `.record-layout` actually computing as `display: grid` with the declared template, or is a computed override winning?
- Is `record.css` reaching this route at all in the built bundle? It is imported per-component (`SubmissionRecordPage.tsx:6`) and Vite bundles it; confirm it is present and not order-shadowed by `components.css`.
- Is content escaping its box rather than the track being wrong? `.record-summary p` (record.css:6) sets `white-space: pre-wrap` with NO `overflow-wrap`, and this record's abstract contains a long unbroken Google Slides URL. `.card` sets no `overflow`. That is a real candidate for painted overflow — but the observed clipping is on the SCHEDULE BOX, not the paragraph, so confirm before acting.

Fix the actual cause. Do not paper over it with a `z-index`, an `overflow: hidden` that clips real content, or a fixed height on the aside.

## Scope

- Restore prototype DOM order in the round flow; the `/evaluation` plan card renders as designed at desktop and at both existing breakpoints (900px, 600px).
- Root-cause and fix the record-page overlap so no aside content covers main content at any content height.
- Layout only. No data, no API, no route changes. If either fix appears to require an API change, stop and say so in the PR.

## Constraints

- DESIGN.md / Flight Deck tokens. Reproduce the binding prototype one-to-one; for defect A the prototype is the spec — match it rather than inventing a new arrangement.
- ELEMENTS NEVER JUMP. Reserve space for swapped text, fixed widths on toggles, constant row counts.
- `npm run check:design` asserts the design contract — it must stay green.
- Do NOT edit `package.json`.
- Shipped files must avoid the repo-policy denied vocabulary (`scripts/checks/repo-policy.mjs`): no company name, no absolute /Users/ paths, no real email addresses, no internal tooling vocabulary.

## Verification

1. `npm run pr-gate -- --ticket <this ticket>` — all checks green, `check:design` included.
2. REAL-ARTIFACT SMOKE, non-negotiable — this is a visual defect and only looking at it proves the fix. `wrangler dev` against seeded data, then in a browser at 1316x924:
   - `/evaluation` — both round cards equal width with the arrow between them, no one-word-per-line wrapping, no "IdentitySep visible 8" artifact. Re-check with Round 2 unconfigured so the empty-round fallback is exercised.
   - `/submissions/sub_agent-eng` — the `WAVE` value is fully visible and the green schedule box renders its complete venue text with nothing drawn over it.
   - `/submissions/sub_gemini-deep-research` — the previously-correct tall record is STILL correct (guard against fixing short content by breaking tall).
   - Both screens at the 1000px and 760px breakpoints (record) and 900px / 600px (evaluation) — the responsive arms must not regress.
3. Attach before/after screenshots of both screens to the ticket as validation evidence.

## Delivery

Own git worktree, branch `mrq-76-layout-fidelity`. PR via `gh pr create --repo Stage-11-Agentics/marquee --base main`.

## File ownership (MRQ-75 / MRQ-76 / MRQ-77 run in parallel)

MRQ-76 OWNS: `src/ui/evaluation/EvaluationPage.tsx`, `src/ui/evaluation/evaluation.css`, `src/ui/submissions/record.css`, `src/ui/submissions/SubmissionRecordPage.tsx`.
MRQ-76 MUST NOT TOUCH: `src/routes/*` (MRQ-75 owns `submission-record.routes.ts` and the count surfaces), `src/api/board.ts`, `src/routes/tokens.routes.ts`, `scripts/seed/*` (MRQ-77), `package.json`. Note MRQ-75 also works the submission record — it owns the ROUTE, this ticket owns the COMPONENT AND CSS. Do not cross that line.

---

## Delegator plan (agent:delegator-mrq-77)

### Defect A — `EvaluationPage.tsx` round-flow DOM order

Extract the existing round-card ternary (currently inline inside `[firstRound, secondRound].map(...)`, `EvaluationPage.tsx:260-267`) into a small local render function `renderRoundCard(round, index)` defined in the component body (it closes over `updateRound`, `percent`, `formatDate`, all already in scope). Replace the `.round-flow` block:

```jsx
<div class="round-flow">
  {renderRoundCard(firstRound, 0)}
  <div class="round-arrow" aria-hidden="true">→</div>
  {renderRoundCard(secondRound, 1)}
</div>
```

This restores prototype DOM order `[card][arrow][card]` for both the populated and empty-round-fallback cases, with zero CSS changes (the existing three-column grid is already correct). No route/data changes.

### Defect B — submission record aside overlap

Live-diagnosed in-browser (c11-browser, wrangler dev on :8802 against seeded D1): `.record-layout` computes as `display: grid` with `grid-template-columns: 662px 330px` (or similar, width-dependent) and zero overlap at the viewports checked (≈1310–1322px wide). The three candidates the ticket lists (grid not computing as declared; `record.css` not reaching the bundle; content escaping its box via the unbroken CFP-slides URL in `sub_agent-eng`'s abstract) were each checked directly via `getBoundingClientRect`/computed styles and ruled out for this specific record/viewport combination — grid math is exact, track widths match the declared columns, and the abstract paragraph's rect stays well inside `.record-main`'s track.

Given the code is unchanged since the UX sweep (same `ba22fb3` base) and the grid renders correctly under direct inspection, the working hypothesis is now a **transient/loading-state rendering artifact** rather than a persistent structural bug — most likely a layout race between the record fetch resolving and a still-in-flight webfont/CSS load, or a specific narrower sub-1316px width this delegator hasn't yet tried. Next steps (post defect-A commit, c11-browser only): sweep a matrix of widths (900–1400px) and capture screenshots at several points during page load (not just after `wait --load-state complete`) rather than only the settled state, and check `record.evaluation.rounds` reviewer-assignment content length, since a record with more assigned reviewers renders a taller aside than `sub_agent-eng`'s (only evaluation-bypassed, no assignments) — a taller aside is the one condition that could push its content into the main column's rendered region if there is a track-sizing edge case under content-driven height. Will not apply any fix (z-index/overflow/fixed-height are explicitly forbidden by the ticket) until the actual failure condition reproduces under direct inspection.

### Order of operations

1. This plan, committed + pushed.
2. Defect A fix, committed + pushed, `check:design` + unit suite green.
3. Defect B live diagnosis continues (c11-browser only, stop-and-report after 2 failed attempts per standing rule), fix once root cause reproduces.
4. Rebase onto `github/main` (MRQ-74 merged 4 commits since worktree cut).
5. `npm run pr-gate -- --ticket MRQ-77`, screenshots attached `--role validation`, PR opened, `pr_open`.
