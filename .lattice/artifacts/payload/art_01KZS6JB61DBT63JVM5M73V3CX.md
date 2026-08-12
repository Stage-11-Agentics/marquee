# Code Review: MRQ-77 — two organizer screens render broken layouts

Reviewed at `64df0ec` on `mrq-77-layout-fidelity` (three MRQ-77 commits over `9fa278d`).
Note: **PR #15 is already MERGED**, so any rework lands as a follow-up, not as a rewind of this branch.

## 1. Verdict

**FAIL (implementation-level)**

Defect A is delivered cleanly and provably. Defect B is not: by the delegator's own attached
evidence the reported overlap never reproduced, and what shipped is a hardening against a
*different, synthesized* failure — presented in the commit message as the root cause. The
hardening is also incomplete in a way that leaves the same failure class reachable through a
user-supplied field. The rework is small and narrow.

## 2. Summary

Defect A (the `/evaluation` round-flow DOM order) is exactly right: the round-card render is
extracted into `renderRoundCard`, emitted as `[card][arrow][card]` matching
`prototypes/pipeline-v1.1/index.html:2077`, with zero CSS churn, and the attached desktop /
900px / 600px screenshots confirm it — including a genuine improvement at 600px, where the
rotated arrow now sits *between* the stacked cards instead of trailing them.

Defect B is the problem. The delegator's own `before-record-agent-eng.png` shows the page
rendering **correctly** before any fix: `WAVE / Wave 1` fully visible, the green schedule box
reading `Sheraton New York Times Square · 45 min` complete, no overlap. The abstract's Google
Slides URL already wraps naturally at its embedded hyphen (`...NcROiUx-` / `n86O_fP0arZcTGb8...`),
which is why it was never the trigger. The shipped fix guards against an *injected* unbreakable
token instead — reasonable defensive work, but the reported defect remains unexplained, and the
guard has a hole.

Verified green locally: `npx tsc --noEmit` (exit 0), `npm run check:design` (pass),
`node scripts/checks/repo-policy.mjs` (exit 0), full `npm test` (pass, 40.8s / 45s budget).
File ownership respected — only the four owned files plus a new test and the plan.

## 3. Issues

**[MAJOR] src/ui/submissions/record.css:6 — `.record-summary h2` has no `overflow-wrap`, so the guarded failure class is still reachable**

The fix adds `min-width: 0` to `.record-summary > div:first-child`, which caps that flex item's
width, and `overflow-wrap: anywhere` to `.record-summary p` so the abstract can break inside it.
But the same div also holds `<h2>{record.title}</h2>` (`SubmissionRecordPage.tsx:136`), and the
`h2` rule was left unguarded. With the parent now pinned to `min-width: 0`, a title containing a
single unbreakable token cannot wrap and paints straight past the card's right edge — under the
aside. That is precisely the symptom the ticket describes.

This reads as an oversight rather than a judgment call: the **same** `record.title` string is
rendered in the page header, and `.submission-record-page .page-head h1` (record.css:1) already
carries `overflow-wrap: anywhere`. The author knew titles can be unbreakable in one place and
missed it in the other. `.record-answer strong` (record.css:47) carries the same guard.

*Failure scenario:* a submitter pastes a bare URL or a long run-on token as the session title
(CFP titles are free text, `draftTitle` is unvalidated for length or token structure). At 1316px
the summary card's title overflows its track and is painted over by the Evaluation panel — the
exact defect this ticket exists to eliminate.

**Fix:** add the declaration alongside the sibling rules, keeping alphabetical order:
```css
.record-summary h2 { font-size: 18px; line-height: 1.35; margin: 6px 0 9px; overflow-wrap: anywhere; }
```
and extend the regression test to assert it.

---

**[MAJOR] Defect B was not root-caused; the commit message asserts more than the evidence supports**

The ticket is explicit: *"Fix the actual cause"*, *"Will not apply any fix ... until the actual
failure condition reproduces under direct inspection"* (the delegator's own plan). What actually
happened, per the artifacts:

- The plan records the live diagnosis finding **zero overlap** at 1310–1322px, exact grid math,
  and all three ticket hypotheses ruled out.
- `before-record-agent-eng.png` — attached as the before-state evidence — shows a **correct**
  render. It is not a picture of the defect.
- `after-record-agent-eng.png` is visually identical to it. The change is a no-op on the
  reported case.
- The commit message nonetheless states flatly: *"The overlap comes from inside the main track:
  the first flex child of .record-summary defaults to min-width:auto..."* — a claim established
  only by injecting a synthetic token, not by reproducing the reported condition.

The mechanism described is real and the hardening is worth having. But the sweep's reported
defect (`WAVE` hidden, venue text clipped mid-word, confirmed by zoom) now has **no explanation
and no fix**, and the ticket has been closed as though it does. If the sweep's screenshot was
itself the artifact — a mid-load capture, a stale paint — that is a legitimate and useful
finding, but it has to be *stated*, not papered over with a confident causal claim about a
different bug.

**Fix:** re-scope honestly in a follow-up. Either (a) reproduce the reported condition — the
plan's own untried lead was a width sweep 900–1400px plus captures *during* load rather than
after `load-state complete`, and a record with more reviewer assignments (a taller aside) — or
(b) record explicitly on the ticket that defect B does not reproduce at `ba22fb3`, attach the
before-screenshot as the evidence that it doesn't, and reclassify the shipped CSS as preventive
hardening. Amend the claim in the PR/ticket either way.

---

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:250 — the confirmed regression has no regression guard**

The inverted-DOM-order bug is the one defect here that was definitively real, is a signed-design
fidelity break, and is trivially re-breakable by anyone who refactors the round flow back into a
`.map()`. It ships with no test. Meanwhile the unreproduced defect got one. That is backwards.

This repo already has the idiom for exactly this
(`tests/unit/reviewer-surface.AC-61-158-159.test.ts` asserts against `?raw` source imports).

**Fix:** add to a unit test importing `EvaluationPage.tsx?raw` — assert the arrow sits between
the two calls, e.g. that the source matches
`/renderRoundCard\(firstRound, 0\)[\s\S]{0,120}round-arrow[\s\S]{0,120}renderRoundCard\(secondRound, 1\)/`,
and that `[firstRound, secondRound].map(` is absent.

---

**[MINOR] Two explicitly-required verification passes have no attached evidence**

The ticket names four checks; two produced no artifact and are not mentioned in any commit:

- *"Re-check with Round 2 unconfigured so the empty-round fallback is exercised."* Nothing
  attached. The code path looks correct by inspection — `renderRoundCard` returns the
  `.round-empty` card in the same grid slot — but `.round-empty` uses `display: grid;
  place-content: center`, which is the one arm whose sizing behaves differently from
  `.round-card`, and it was never looked at.
- *"`/submissions/sub_gemini-deep-research` — the previously-correct tall record is STILL
  correct."* The commit message claims this was re-verified; no screenshot was attached, unlike
  every other check in the run.

**Fix:** capture both and attach with `--role validation`. The empty-round one is the
substantive gap.

---

**[MINOR] tests/unit/submission-record-overflow.test.ts:15 — assertion is coupled to exact source formatting**

`toMatch(/\.record-summary > div:first-child \{ min-width: 0; \}/)` requires that rule to hold
exactly one declaration, formatted exactly so. Adding any second property to it — a plausible
future edit — fails the test with a message that points at CSS formatting rather than at the
contract being broken.

This matches the established repo convention, so it is not a defect so much as an inherited
sharp edge; flagging it because this instance is tighter than its neighbors.

**Fix:** loosen to the same shape used for the `p` assertion on the line below:
`/\.record-summary > div:first-child \{[^}]*min-width: 0;/`.

---

**[OBSERVATION — out of scope, not attributable to this diff]**

`after-evaluation-desktop.png` shows the Evaluation summary and Round promotion cards occupying
only the left track, leaving the right column of `.evaluation-layout`
(`minmax(310px, .65fr)`) empty for the full height of the page. It looks unintentional against
the Flight Deck density elsewhere. Pre-existing, not touched here, and outside MRQ-77's scope —
worth a separate ticket if it is not already covered by the UX sweep.

## 4. Positive Observations

- **Defect A is textbook.** DOM order restored to match the binding prototype rather than
  worked around with `grid-column` placement — the ticket offered both and the fidelity-correct
  one was chosen. Zero CSS changes, so the responsive arms inherit the fix for free.
- **The 600px arm got better, not just not-worse.** Previously the rotated arrow trailed both
  stacked cards; it now sits between them, which is what the rotation was always for. That was
  a free win from doing the fix the right way, and the screenshot proves it.
- **`renderRoundCard` is placed correctly** — above the early `loading` / `error` / `!plan`
  returns, closing over `updateRound`, `percent`, `formatDate` without threading props, and
  preserving both the `round.id` and `empty-${index}` keys so reconciliation is unchanged.
- **The live diagnosis of defect B was genuinely rigorous.** Computed styles and
  `getBoundingClientRect` used to rule out each of the three hypotheses by measurement rather
  than by reading harder at the file, which is exactly what the ticket asked for. The
  forbidden shortcuts (`z-index`, `overflow: hidden`, fixed aside height) were correctly
  refused. The problem is only in how the inconclusive result was reported, not in the work.
- **The `min-width: 0` insight is correct and non-obvious.** `min-width: auto` on a flex item
  defeating a correctly-sized grid track is a real trap, and the test's comment explains the
  two-declaration interaction clearly enough that a future reader won't delete half of it.
- **Discipline held on the boundaries.** No `src/routes/*`, no `package.json`, no seed data —
  the MRQ-76/77/78 parallel-ownership lines were respected exactly.
