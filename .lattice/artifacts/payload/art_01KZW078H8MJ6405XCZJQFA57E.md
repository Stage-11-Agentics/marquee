# Plan Review: MRQ-158 — V2-9: latent.space theme leaves native controls unstyled

### 1. Verdict

**FAIL (plan-level)**

### 2. Summary

I reviewed the submitted plan for MRQ-158 against the task description, the source brief (`.briefs/eval-gap-v2-human-lens.md` §4, V2-9), and the actual state of the stylesheets. The plan is a byte-for-byte copy of the task description — it contains no implementation content whatsoever: no file list, no selector strategy, no token plan, no contrast method, no test story. Beyond that formal gap, verification against the codebase turned up two substantive problems the plan inherits from the ticket: **the target files do not exist on `main`** (so the ticket's "safe to run at any time, no sequencing constraint" is exactly backwards), and **the prescribed fix targets the wrong layer** — the real defects are a missing `color-scheme` in *every* theme (including the built-in Night theme) plus one entirely unstyled component, neither of which a `latent-space`-scoped input block fixes.

The underlying bug report is real and well-observed. The plan is not yet a plan.

### 3. Issues

---

**[CRITICAL] Whole document — The plan is a verbatim copy of the task description**

The "Plan" section (lines 27–39 of the prompt) is identical to the "Task Description" section (lines 14–24), including the source attribution header and the `CLOSES NO EVAL ITEM` note. No planning work has been done. There is nothing to evaluate for completeness, feasibility, decomposition, or risk, because the document restates the problem rather than proposing a solution.

Specifically absent: which files will be modified; which selectors will be added; which new tokens will be minted and with what values; how the 4.5:1 claim will be measured; whether a regression test is added; what the ai-engineer audit produces.

**Recommendation:** Return to `in_planning` and produce an actual plan. At minimum it should name the files to touch, list the tokens to mint with measured contrast ratios, state the selector layer (see the next two issues — this is the load-bearing decision), and state the verification method and test posture.

---

**[CRITICAL] "CLOSES NO EVAL ITEM" / sequencing — The files to be edited do not exist on `main`**

The ticket asserts the work is "Small, isolated, and safe to run at any time — no sequencing constraint, which makes it a good filler for an agent that is blocked on someone else's merge." That is inverted. `src/styles/themes/` is **absent from `main` entirely**:

```
$ git ls-tree -r --name-only main | grep styles/themes/     → (nothing)
$ ls src/styles/                                            → tokens.css  components.css
```

`latent-space.css`, `ai-engineer.css`, and `swyxy.css` exist only on unmerged branches — `fix/ci-test-step-timeout` (= worktree `ci-timeout`), `chore/gate-schema-verify`, and `capture/unbacked-design-docs`. None of the three is merged into `main`.

An agent that follows the project's standard flow (`git worktree add` off `main`) will find no file to edit. Far from being unconstrained filler for a blocked agent, this ticket has a **hard dependency on the theme branch landing first** — it is one of the *worst* candidates for an agent waiting on someone else's merge, because it is waiting on exactly that.

**Recommendation:** State the base branch explicitly in the plan and record the dependency on the board. Either (a) mark MRQ-158 blocked until the branch introducing `src/styles/themes/` merges to `main`, or (b) if the intent is to fold this fix into that branch, say so and name the branch. Also correct the ticket's "no sequencing constraint" line so the next agent to pick it up is not misled the same way.

---

**[MAJOR] "GOOD LOOKS LIKE" — The prescribed fix is scoped to the wrong layer; it under-fixes and over-fixes simultaneously**

The plan prescribes "`color-scheme: dark` on the register's root, plus tokenized input / select / textarea treatment, scoped under `html[data-theme='latent-space']`." Checking the actual stylesheets, that prescription is wrong in three separate ways:

1. **`color-scheme` is missing from every theme, not just latent-space.** `grep -c color-scheme src/styles/tokens.css src/styles/components.css` returns `0` and `0`. The built-in dark theme **Night** (`html[data-theme="night"]`, `tokens.css:86`) therefore has the *identical* native-control defect — light scrollbars, light form-control internals, light autofill and caret on a dark ground. Night is a first-class palette theme in the switcher (`src/ui/shell/theme.ts:40`), not a demo register. Fixing only latent-space leaves the project's main dark theme visibly broken.

2. **Themed inputs inside `.field` are not actually broken.** `components.css:135` styles `.field input, .field select, .field textarea` with `background: var(--panel); border: 1px solid var(--line-strong); color: var(--ink)`. `--panel: var(--surface)` and `--line-strong: var(--rule)` are declared on `:root` (`tokens.css:38,41`) — the *same element* that `html[data-theme="latent-space"]` targets — so the aliases resolve against the themed values and these inputs already render dark correctly. Adding per-theme `input` rules would duplicate treatment that already works.

3. **The actual "Filter Sessions" bug is a component gap, not a theme gap.** `AgendaPage.tsx:474` renders that input inside `<div class="agenda-pool-search">`, and `agenda-pool-search` **has no CSS rule anywhere** (`grep -rn agenda-pool-search src/styles/` → nothing). It is a bare UA-default control. It renders light in Night too. Styling it under `html[data-theme="latent-space"]` fixes it in one theme out of five and leaves the same white box in the other four.

There is also a stated contract this prescription would break. `tokens.css:80` says of theme blocks: *"Structure tokens are absent on purpose: a theme may only move color."* A block of `input`/`select`/`textarea`/scrollbar rules under `html[data-theme="latent-space"]` is structure in a theme file.

The simpler fix that actually satisfies the operator's report: **one `color-scheme` declaration per theme block** (`dark` for night / latent-space / ai-engineer, `light` for day, keyed to mode for swyxy) — which fixes scrollbars and native control internals across all themes at once — **plus a base-layer rule for the unclassed inputs** so `.agenda-pool-search input` and its peers inherit the same tokenized treatment `.field input` already gets. Both changes are token-driven, both respect "a theme may only move color," and both fix five themes instead of one.

**Recommendation:** Re-plan around the two-part fix above. If the narrow latent-space-only scope is a deliberate deadline call, say so explicitly in the plan and file the Night-theme instance as a follow-up ticket rather than leaving it silently unfixed.

---

**[MAJOR] Source header — The referenced brief is unreachable from any worktree**

The plan opens with "Read that section for the full human-problem framing before starting," pointing at `.briefs/eval-gap-v2-human-lens.md`. That path resolves nowhere in the repo — the file is untracked and lives at `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.briefs/eval-gap-v2-human-lens.md`, i.e. in the *parent* directory of the worktrees, outside every checkout. `git log --all --diff-filter=A -- .briefs/eval-gap-v2-human-lens.md` returns nothing on any branch.

A delegator picking this up cold in a fresh worktree cannot follow the one instruction the plan gives it. (For the record: I located and read V2-9 at line 302 of that file, and the ticket is a faithful transcription of it — no content was lost. The problem is reachability, not accuracy.)

**Recommendation:** Either inline the V2-9 text into the ticket (it is nine lines) or give the absolute path. Longer-term, briefs that tickets cite should be committed, or the citation convention should use paths agents can actually resolve.

---

**[MINOR] "BINDING RULES" — "No raw hex" is ambiguous at the layer where the work happens**

The plan restates "every color is a token, 4.5:1 contrast floor. No raw hex." Taken literally that is unsatisfiable: `latent-space.css` is *built* from raw hex — that is what a token block is — and its component rules already use raw `rgba()` (e.g. `.nav a.active` background, `.chip.alarm` border). An implementer adding a scrollbar thumb color cannot tell from this whether `--ls-scrollbar-thumb: #2a2a33` is compliant or a violation.

**Recommendation:** Restate as the rule the file actually follows: *new colors are minted as tokens in the theme's token block with their measured contrast recorded in the header table; component rules reference tokens, never literals.*

---

**[MINOR] "VERIFY" — The contrast criterion is wrong for the controls in scope, and no method is named**

"Contrast holds at 4.5:1" is the WCAG 1.4.3 text criterion. Scrollbar thumbs and tracks, input borders, and focus rings are **non-text UI components**, governed by 1.4.11 at **3:1**. Holding a scrollbar thumb to 4.5:1 against a near-black ground over-constrains the design for no accessibility gain; more importantly, the plan names no measurement method, while the existing file carries a hand-computed contrast table in its header comment that any new token is expected to extend.

**Recommendation:** Split the criterion — 4.5:1 for input text and placeholders, 3:1 for control chrome — and state that new tokens are added to the header's measured table, matching the file's existing convention.

---

**[MINOR] No test or regression story**

The project gates on `npm run pr-gate` and has a Playwright suite (`npm run e2e`), but the plan names no test. CSS-only theme changes are genuinely awkward to unit-test, so "no test, here's why" may well be the right answer — but it should be a stated decision, not an omission. Without one, nothing prevents a future theme from shipping with the same `color-scheme` gap that caused this ticket.

**Recommendation:** State the posture explicitly. A cheap durable guard: assert every `html[data-theme=…]` block declares `color-scheme`, which would have caught this class of bug at authoring time and covers all future themes.

---

**[MINOR] The ai-engineer audit has no defined deliverable**

"While you are there, audit `ai-engineer.css` for the same class of gap" does not say what the audit *produces* — a fix in this PR, or a follow-up ticket. I ran it: `ai-engineer.css` has the same gap (its only control-related rule is `text-transform` on `.theme-switch select` at line 98; no `color-scheme`, no input or scrollbar rules). `swyxy.css` is a third instance, and it is the trickiest one, because it carries its own light/dark mode on a separate `data-swyxy-mode` attribute (`theme.ts:104,130`) — so its `color-scheme` must key on the mode, not the theme.

**Recommendation:** Name the deliverable. If the two-part fix in the MAJOR issue above is adopted, all three registers plus Night are covered by construction and the audit becomes a verification step rather than separate work.

### 4. Positive Observations

The credit here belongs to the underlying bug report rather than the plan document, but it is real and worth stating:

- **The observation is precise and reproducible.** "Side scrollbars, the 'Filter Sessions' box, and other text inputs" names a specific, findable control and generalizes correctly to a class. I confirmed the `Filter Sessions` input at `AgendaPage.tsx:474` is genuinely unstyled. That is a good bug report.
- **The core diagnosis is correct.** `latent-space.css` does contain no `input`, `scrollbar`, or `color-scheme` rules — verified. The missing `color-scheme` is the right root cause for the native-control symptom; my objection is to the *scope* of the prescribed remedy, not the diagnosis.
- **The binding rules are cited with a specific source.** Pointing at DESIGN.md §Themes and carrying the 4.5:1 floor into the ticket is the right instinct, and `latent-space.css`'s header contrast table shows the convention is being genuinely maintained rather than nominally invoked.
- **Transcription from the brief is faithful.** The ticket reproduces V2-9 accurately — a real virtue in a fleet where tickets are written by one agent and executed cold by another.

The gap is that none of this was carried forward into implementation planning. The raw material for a good plan is here; the plan step was skipped.
