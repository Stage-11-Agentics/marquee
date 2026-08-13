# Code Review: MRQ-103 — Theme system (Day default, Night opt-in)

**Reviewed:** branch `mrq-103-themes`, the six MRQ-103 commits `4959d8c..da648ac`
(prototype machinery → `?theme=` override → night-winner selection → app fold →
DESIGN.md → behavioral tests). Note for the record: the diff embedded in the review
prompt was computed from a stale merge-base and consisted entirely of `.lattice`
board artifacts plus unrelated tickets' work; I reviewed the actual MRQ-103 commits
directly from the worktree instead.

**State at review time:** already squash-merged to `github/main` as `9eaa9bf`
(PR #60); merged blobs for `theme.ts` and the test file are identical to the branch
tip. This is therefore a post-merge review; findings below are follow-up material,
not merge blockers.

## 1. Verdict

**PASS**

## 2. Summary

The implementation matches the plan as amended by two documented operator rulings
(Vaporwave removed 2026-08-12; Night = Graphite picked from three candidates, the
losers deleted). The architecture is exactly what the ticket asked for — palette-only
`html[data-theme]` overrides, structure tokens invariant, one CSS block + one registry
row per theme, localStorage persistence with no `prefers-color-scheme` auto-switch,
and a pre-paint stamp that kills the flash. I re-ran the evidence rather than trusting
the comments: 9/9 theme tests pass (138ms, Worker-free pool), `check:design` passes
including both new rules, and I verified the day-extension capture regex actually
matches the current `tokens.css`. The remaining issues are all minor: the tokenization
and the new guard rule stop at `components.css`, leaving a handful of night-visible
literals in sibling admin-shell stylesheets.

## 3. Issues

**[MINOR] src/ui/dashboard/dashboard.css:10 — the pipeline spectrum gradient is hardcoded with day hues; the prototype tokenized it and the app fold dropped that**

The prototype introduced `--spectrum` with a distinct night octave, with its own
comment explaining why: the day track hues are tuned for white ground and go muddy
on dark. The app's dashboard pipeline border-image still hardcodes the day gradient
(`linear-gradient(90deg,#635bff,#db4c3f,…)`), so in Night the one place the app
paints that spectrum shows day hues on a dark panel — and it is a prototype↔app
divergence under DESIGN.md's one-to-one rule.
**Fix:** add `--spectrum` to the Day extension block in `tokens.css`, give the night
block the prototype's night octave (`#8b85ff,#f2705f,#2ec4b6,…`), and use
`border-image: var(--spectrum) 1` in `dashboard.css`.

**[MINOR] src/ui/shell/quick-search.css:8, src/ui/review/review.css:71, src/ui/submissions/reversal.css:14 — three backdrops still hardcode the light-mode veil that components.css now tokenizes as `--backdrop`**

`components.css` moved the modal/drawer backdrop to `var(--backdrop)` (night flips it
to `rgba(0,0,0,.62)`), but the quick-search overlay, reviewer detail modal, and
reversal modal keep the literal `rgba(16,24,32,.46)` (reversal uses a fourth variant,
`rgb(24 23 21 / 45%)`). In Night, which backdrop you get depends on which modal you
opened. And because the new `check:design` rule only scans `components.css`, these
can't be caught by the gate — they are exactly the rot the rule exists to prevent.
**Fix:** replace all three with `var(--backdrop)`, and consider extending the
no-literal-color rule from the single `THEMED_STYLESHEET` to a small list of
admin-shell stylesheets with an explicit allowlist for the deliberate dark
sub-language surfaces (the plan itself budgeted for a "small allowlist"). The
remaining literals in `forms.css` (form preview) and `portal.css` (status hero) are
defensible as always-dark instrument surfaces, but they're invisible to the gate too
— an allowlist would make that deliberateness legible instead of accidental.

**[MINOR] scripts/checks/verify-design-contract.mjs (day-extension capture) — the regex fails silent, not loud**

The night-coverage rule extracts Day's second `:root` via a regex anchored on the
`/* Binding` comment between the two blocks. It matches today (I verified: 1183 chars
captured). But if that comment is ever reworded or the blocks reorganized, the capture
falls back to `""` and the rule passes vacuously — a guard that silently stops
guarding. The same file's other rules fail loud; this one should too.
**Fix:** after computing `dayExtensions`, push a finding if it's empty
(`"could not locate the Day extension :root — the night-coverage rule is not running"`).
Same for generalizing `html[data-theme="night"]`: the rule names one theme, so a
future third theme gets no coverage check unless someone remembers to extend it.
Iterating every `html[data-theme="…"]` block would make the rule registry-shaped
like everything else in this design.

**[MINOR] src/styles/components.css:41 vs prototype — theme select is 96px in the app, 124px in the prototype (and `:focus-visible` vs `:focus`)**

Both are fixed-width so nothing jumps, and 96px comfortably fits DAY/NIGHT, but the
binding prototype says 124px and DESIGN.md says one-to-one. If 96px is the better
call for the app topbar's tighter layout, fine — but it's an undocumented divergence.
**Fix:** either match the prototype's 124px or note the divergence where the other
acknowledged ones live. (`:focus-visible` in the app is strictly better; no change.)

## 4. Positive Observations

- **The alias-resolution design is the load-bearing insight and it's correct.** Night
  redefines the canonical tokens (`--surface`, `--rule`, `--ok`…) and the v1.6
  compatibility aliases (`--panel: var(--surface)`) re-resolve through them at
  computed-value time, so one night block re-lights every consumer including the
  aliased ones. I checked the night block against the real Day token names before
  believing it — they match.
- **Both new check:design rules and the tests were verified failing on seeded
  violations before being kept**, per the task trail — the discipline that separates
  a guard from a decoration. The 9 tests run in the Worker-free pool in 138ms,
  exactly what the 45s suite budget asks of new tests.
- **The cross-artifact contract tests are unusually good**: asserting the pre-paint
  script in `index.html` stamps the same key/values the module reads, and that every
  registry row has a matching `tokens.css` block, turns the two-implementations-one-
  contract risk into a tripwire. Adding a theme without updating the inline script
  fails a test — which retroactively makes "one CSS block + one registry row" honest.
- **Failure paths are handled with taste**: private-mode storage throws yield Day on
  read and apply-without-persist on write; Day removes the attribute rather than
  setting an empty one (a lingering `data-theme=""` would still match `[data-theme]`
  selectors — the test even documents this).
- **Scope rulings are traceable**: Vaporwave's removal and the Graphite pick are
  operator decisions recorded on the task and in commit messages, DESIGN.md was
  rewritten timelessly (the no-dark-mode ruling replaced, not annotated), and the
  seeded-tracks-get-octaves / authored-tracks-don't distinction is exactly the right
  reading of "track colors are the organizer's data."
- **Merge hygiene under deadline pressure**: rebased onto the sibling cold-start work
  with the version-label conflict resolved sensibly (v1.11 kept for cold start, themes
  deferred to v1.12), real-artifact smoke check of the built Worker bundle, and the
  contention-aware call to skip the full suite at load-35 per the documented
  false-red policy.
