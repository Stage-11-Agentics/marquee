# Plan Review: MRQ-77 — two organizer screens render broken layouts

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

Reviewed the delegator plan for MRQ-77 against the ticket, the four owned source files, the binding prototype, and the sweep's own screenshot artifact. The Defect A half of the plan is correct, minimal, and ready to implement as written. The Defect B half is not a plan — it is a deferral: it declares the defect non-reproducible, adopts "transient/loading-state rendering artifact" as the working hypothesis, commits to no fix, and exits via "stop-and-report after 2 failed attempts." That leaves half the ticket's scope with no approach, and the reasoning that got there is invalid: the three candidates the ticket listed were "ruled out" in a browser session where the defect was not present, which proves nothing about the session where it was.

Defect B **is** a real, deterministic, structural CSS bug, and it is reproducible. Measuring the sweep screenshot directly (below) identifies the root cause exactly — a min-content blowout from the abstract's unbroken URL — and explains why the delegator's session missed it: the delegator tested at ~1310–1322 CSS px, and the bug only appears below ~1290 CSS px. The plan should return to `in_planning` and come back with the reproduction condition and a committed fix.

## 3. Issues

**[CRITICAL] Delegator plan, "Defect B" — half the ticket's scope has no fix, and the diagnosis is wrong**

The plan's conclusion ("the working hypothesis is now a transient/loading-state rendering artifact rather than a persistent structural bug") is incorrect. The bug is structural, deterministic, and content-specific. It is measurable from the sweep's own artifact, `A-organizer-submission-detail-published-OVERLAP-BUG.png`, without any browser at all.

Pixel measurements from that PNG (1316×924, DPR 1):

| Element | Rendered px | Notes |
|---|---|---|
| `.sidebar` right edge | 262 | CSS declares `224px` + 1px border = 225 |
| `.card` (main) left / right | 297 / 1048 | width 752 |
| `.record-aside` left / right | 878 / 1263 | width 385 |

The sidebar tells you the scale: 262 / 225 = **1.1667**. The whole page is rendered at a uniform 7/6 scale, so the sweep's "1316×924" is *device* px — the CSS viewport was **≈1128 px wide, not 1316**. Divide everything through:

- `.record-aside` = 385 / 1.1667 = **330.0 px** — the declared track, exactly. The grid is working.
- Grid container = (1263 − 297) / 1.1667 = **828 px** → track 1 = 828 − 16 − 330 = **482 px**.
- `.record-main`'s card = 752 / 1.1667 = **643.7 px** — 162 px wider than its 482 px track. The item overflows its track and, because `.record-aside` is later in DOM order, the aside paints on top. That is the "overlap."

Why the item exceeds its track, given `min-width: 0` is present: `min-width: 0` on `.record-main` stops the *track* from growing (it did — the aside never moved), but `.record-main` also carries `.stack` (`display: grid`, components.css:52). Its single implicit `auto` column has an `auto` minimum, so the column's base size is the **min-content width of the card**, and when that exceeds the container the grid overflows to the right rather than shrinking.

The min-content floor comes from `.record-summary` (record.css:4, `display: flex`) whose first child `<div>` has no `min-width: 0`, containing `.record-summary p` (record.css:6, `white-space: pre-wrap`, **no `overflow-wrap`**). `sub_agent-eng`'s abstract is:

    An anthropological approach.\n\nhttps://docs.google.com/presentation/d/1SWoBIvTQu__uNEvSawmNcROiUx-n86O_fP0arZcTGb8/edit?usp=sharing

(`sequence/research/sources/aie-summit-2025-program.json:624`). The engine breaks that URL only at the hyphen — visible in the screenshot — so the longest unbreakable run is the 66-char head, measured in the shot at 522 rendered px = **447.4 CSS px**. Arithmetic closes to within 1.3 px:

    447.4 (URL run) + 18 (flex gap) + 145 (.record-summary-meta flex-basis) + 32 (card padding) = 642.4 ≈ 643.7 measured

So the ticket's third candidate — the one the plan ruled out — is the actual cause. It was ruled out on non-evidence.

**Why it didn't reproduce for the delegator.** Overlap occurs when track 1 < 643.7. With container = viewport − 15 (scrollbar) − 225 (sidebar) − 60 (`.page` padding), track 1 = viewport − 646, so the defect appears for any CSS viewport below **≈1290 px** (down to 1000 px, where the media query stacks the layout). The plan tested "≈1310–1322 px" — 20–30 px above the threshold. The band 1000–1290 px includes the 1280-px default of a 13" MacBook, so this is walkthrough-relevant, not an edge case.

**Recommendation:** Return to `in_planning` and rewrite the Defect B section around this: (1) reproduce at a CSS viewport of ~1128 px (or anywhere in 1050–1280) on `/submissions/sub_agent-eng` — confirm with `document.querySelector('.record-main').getBoundingClientRect().width` exceeding the computed track width; (2) fix at the source of the min-content floor — `overflow-wrap: anywhere` on `.record-summary p`, plus `min-width: 0` on `.record-summary`'s first child for defense. Note the precedent already in the same file (`record.css:1` on `.page-head h1`, `record.css:47` on `.record-answer strong`), so this is the file's own convention, not a new pattern. **Use `anywhere`, not `break-word`** — only `overflow-wrap: anywhere` participates in min-content sizing; `break-word` would leave the overlap exactly as it is while appearing to fix the wrap. None of this is z-index papering, `overflow: hidden`, or a fixed aside height, so it stays inside the ticket's prohibitions.

---

**[CRITICAL] Delegator plan, "Order of operations" step 3 — the exit condition abandons the ticket's second scope item**

"Stop-and-report after 2 failed attempts, fix once root cause reproduces" means the plausible outcome of this plan is a PR that fixes only Defect A while the ticket's stated scope is "Root-cause and fix the record-page overlap so no aside content covers main content at any content height." Given a 2026-08-12 22:00 PT deadline and a walkthrough-visible defect, a plan whose defined success path may deliver 50% of scope needs an explicit fallback, not an implicit one.

**Recommendation:** State the reproduction condition (above) as a precondition of the plan rather than an open question, and define what ships if it still won't reproduce — including who is told and when. Do not leave "stop and report" as the only branch.

---

**[MAJOR] Plan preamble — the ticket body is a stale MRQ-76 copy, including a wrong branch name and an inverted ownership boundary**

Lines under "### Plan" reproduce the ticket text with MRQ-76 substituted throughout:

- **Delivery** says branch `mrq-76-layout-fidelity`. The real branch and worktree are `mrq-77-layout-fidelity` (confirmed in `git worktree list` and the boot brief), and `mrq-76-pipeline-stage-derivation` is a live parallel delegator. Following the plan text literally would collide with another agent's ticket.
- **File ownership** is shifted by one and now reads "`scripts/seed/*` (MRQ-77)" — i.e. it tells this ticket, MRQ-77, that it owns the seed scripts. The real boundary assigns `scripts/seed/*` to MRQ-78 and this ticket is layout-only. It also names the parallel set as MRQ-75/76/77 rather than 76/77/78.

Three delegators are live in the same tree; a mis-stated ownership line is exactly how a cross-ticket conflict happens.

**Recommendation:** Correct the copied block to MRQ-77 throughout, or delete the duplicated ticket body entirely and let the plan carry only the delegator's own sections — the ticket is already the scope of record via `lattice show MRQ-77 --json`.

---

**[MAJOR] Verification — "Round 2 unconfigured" has no stated mechanism**

Both the ticket and the plan require exercising the empty-round fallback (`EvaluationPage.tsx:267`) live. `firstRound`/`secondRound` are `plan.rounds[0]`/`[1]` (lines 110–111), and the seeded plan has two rounds. The delegator cannot edit `scripts/seed/*` (MRQ-78 owns it) and cannot touch `src/routes/*` (MRQ-76). The plan does not say how it will produce a one-round plan.

**Recommendation:** Name the mechanism in the plan — create a fresh plan through the UI's "+ New evaluation plan" and check whether it yields zero or one round, or delete a round via the API against the delegator's own local D1 (a runtime data action in its own worktree, not a seed-script edit). If neither produces the state, say so and fall back to a temporary local-only edit that is not committed, stated explicitly in the PR.

---

**[MINOR] Verification — the viewport matrix misses the band where Defect B lives**

The plan inherits the ticket's matrix: 1316, then the 1000/760 breakpoints. Given the ~1290 px threshold derived above, that matrix brackets the defect without ever entering it, which is precisely how the first diagnosis pass went wrong.

**Recommendation:** Add explicit checks at ~1280, ~1150 and ~1050 CSS px on both `sub_agent-eng` (short abstract with URL) and `sub_gemini-deep-research` (tall record), and record the measured `.record-main` width against the computed track width at each, not just a screenshot.

---

**[MINOR] No regression guard for either fix**

Both fixes are one-line and both are invisible to the existing suites: `verify-design-contract.mjs` reads only `skin-c.html`, `tokens.css`, `components.css`, `route-table.ts` and four shell sources, so `check:design` stays green whether or not either defect exists, and `tests/unit` has no DOM-render harness. Nothing stops a later refactor from re-appending the arrow or dropping the `overflow-wrap`.

**Recommendation:** Add a cheap source-level assertion in `tests/unit` following the `route-table.test.ts` precedent — the `.round-flow` block emits `round-arrow` between the two card expressions, and `.record-summary p` declares `overflow-wrap`. Low cost, and it makes the fidelity contract enforceable rather than screenshot-dependent.

---

**[MINOR] Defect A — two small confirmations worth writing into the plan**

The `renderRoundCard(round, index)` extraction is right and matches the prototype (`prototypes/pipeline-v1.1/index.html:2077`). Two things the plan should state so the reviewer does not have to re-derive them: (a) with explicit sibling children rather than a `.map`, the `key` props at lines 260/267 become unnecessary — keep or drop them deliberately, do not leave a half-converted mix; (b) the fix also corrects the 600 px arm, where `.round-flow` collapses to one column and `.round-arrow` rotates 90° (evaluation.css:72–73) — today the arrow stacks *below both* cards there, so the mobile arm is a second, currently-unstated defect that this change fixes. Worth an explicit before/after screenshot at 600 px since it is a visible improvement, not just a non-regression.

## 4. Positive Observations

- **Defect A is exactly right.** The root cause, the prototype citation, the "IdentitySep visible 8 is wrapped text, not a leak" call, and the proposed `[card][arrow][card]` restoration with zero CSS change are all correct against the source. It is the minimal fix, it matches the binding prototype, and it needs no further planning.
- **The delegator actually ran the browser** rather than reading the CSS harder, which is what the ticket asked for, and it reported its inability to reproduce honestly instead of shipping a speculative fix.
- **It refused to paper over Defect B.** Declining to reach for `z-index`, `overflow: hidden`, or a fixed aside height while the cause was unknown is the correct instinct and the right reading of the ticket's prohibitions.
- **Ordering is sound** — plan committed first, Defect A landed independently of the unresolved Defect B, rebase before the gate. That sequencing means the confirmed half is not held hostage by the unconfirmed half.
- The one thing missing from an otherwise disciplined diagnosis is the recognition that eliminating candidates in a session where the bug is absent carries no information. Everything else about the method was right.
