# Code Review — MRQ-158: V2-9 latent.space theme leaves native controls unstyled

Reviewed at `Marquee-worktrees/v2-9-latent-theme` @ `1503ef7f` (PR #141, `Stage-11-Agentics/marquee`).
Files: `src/styles/themes/latent-space.css` (+61), `tests/node/latent-space-theme.MRQ-158.test.mjs` (new).

Independent verification I ran:
- `node --test tests/node/latent-space-theme.MRQ-158.test.mjs` → pass.
- `npm run check:design` → `{"status":"pass","findings":[]}`.
- Recomputed every relevant WCAG pair from the token hexes (script below results in §3).
- Headless-Chromium probe of the theme applied to a real document: `color-scheme` resolves to `dark`, `scrollbar-color` resolves to `rgb(38,38,46) rgb(15,15,19)`, input background resolves to `rgb(15,15,19)` — the rules do apply as written.

---

## 1. Verdict

**FAIL (implementation-level)**

The approach is right and the latent.space text-input half of the bug is genuinely fixed. Three things keep it from passing: the themed scrollbar thumb is effectively invisible (1.27:1 against its own track), the swyxy explicit-dark scope carries the identical defect and was excluded without the evidence its acceptance criterion requires, and the browser verification was done against a synthetic static page rather than the surfaces the operator reported — which is precisely why the scrollbar problem went unseen.

## 2. Summary

The diff adds `color-scheme: dark`, tokenized input/select/textarea/placeholder/focus treatment, `accent-color` for checkable controls, and scrollbar rules, all scoped under `html[data-theme="latent-space"]`, plus a source-shape CONTRACT test. Craft is good: token-only, no raw hex, Day/Night token blocks untouched, contrast documented and independently reproducible (my numbers match the PR body exactly — 16.90:1 text, 5.52:1 placeholder). The key finding is that the fix is correct but narrower than the defect: the actual root cause is an app-level gap (`.agenda-pool-search input` has no background/border/color rule anywhere, and `tokens.css:132` gives it `color: inherit`), so every dark scope — latent.space, Night, swyxy-dark — renders light ink on a native white field. Only one of the three was fixed.

## 3. Issues

**[MAJOR] src/styles/themes/latent-space.css:84–108 — the themed scrollbar is invisible**
`scrollbar-color: var(--rule) var(--surface-sunk)` puts a `#26262e` thumb on a `#0f0f13` track. Measured: **1.27:1** (and 1.31:1 against `--bg`). The operator's report was "side scrollbars … render without the theme's color treatment"; this replaces a wrong-but-visible light scrollbar with a correctly-themed one nobody can see. WCAG 1.4.11 asks 3:1 for UI component boundaries, and this is well under it.
**Fix:** thumb on `var(--muted)` (`#8b8896` → **5.52:1** on sunk, already an in-register token and already inside the theme's documented contrast table), keeping `var(--accent)` on hover:
```css
html[data-theme="latent-space"] { scrollbar-color: var(--muted) var(--surface-sunk); }
```
and the same swap for `::-webkit-scrollbar-thumb`'s `background-color`.

**[MAJOR] src/styles/themes/swyxy.css:75 (+ src/styles/tokens.css:84) — the same defect is live in swyxy dark and Night, unaudited**
`.agenda-pool-search input` (`src/ui/agenda/agenda.css:43`) sets only `width`/`min-width`; the sole other rule reaching it is `tokens.css:132` `button, input, select, textarea { color: inherit; … }`. So on *any* dark scope the Filter Sessions box paints native-white with light inherited ink — near-unreadable typed text, not merely off-palette. `html[data-theme="swyxy"][data-swyxy-mode="dark"]` and `html[data-theme="night"]` both lack `color-scheme` and any control treatment (verified by grep: `color-scheme` appears only in the new block and in `src/api/openapi.ts`). The acceptance criterion permits leaving swyxy alone only "if already correct" — it is not, and the PR body records an audit of AI Engineer only, with no swyxy/Night evidence either way.
**Fix (preferred):** move the control block out of the register and into `src/styles/components.css`/`tokens.css` as unscoped, token-only rules — every theme then inherits correct native chrome from its own tokens, and this class of bug stops recurring per-theme. **Minimum:** add `color-scheme: dark;` to the `night` and `[data-swyxy-mode="dark"]` blocks and give the bare input the same tokenized treatment; if Night is judged out of scope for this ticket, file it rather than leave it silent.

**[MAJOR] verification — the reported surfaces were never exercised**
The ticket's VERIFY line and plan step 4 name the agenda Filter Sessions control, list search inputs, scrollbars, typed/placeholder text, AI Engineer, and Day/Night. PR #141 records "a static latent.space page with input, select, textarea, and checkbox" driven by Playwright, with computed styles read off it. That proves the CSS parses and cascades; it does not prove the operator's screen is fixed, and it structurally cannot surface the scrollbar issue above (a bare page has no long scroll surface and no rendered scrollbar to look at). The Playwright substitution for a wedged c11 browser socket is fine — the synthetic *page* is the gap.
**Fix:** run `npx vite dev`, load the agenda in latent.space, and capture the Filter Sessions field (empty + typed), one long scrolling list with its scrollbar, and one `select`/`date` control; repeat the scrollbar shot in Night and swyxy-dark to cover the finding above. Attach to the PR.

**[MINOR] src/styles/themes/latent-space.css:84–108 — `*` is redundant and probably kills the `::-webkit-scrollbar` block**
`scrollbar-color` is an inherited property, so `html[data-theme="latent-space"] *` adds nothing over the `html` declaration, and it costs a universal-selector match on every element. Worse, Chromium ≥121 ignores `::-webkit-scrollbar-*` pseudo-elements on any element whose `scrollbar-color`/`scrollbar-width` is non-initial — which, with the `*` rule, is every element. If that holds, the ~20 lines of webkit rules (10px sizing, 2px inset border, `var(--radius)`, and the accent hover) never render in Chrome/Edge. I could not confirm this on this machine: headless Chromium on macOS forces overlay scrollbars, so the gutter measured 0 in all four probe permutations (plain, webkit-only, webkit+`scrollbar-color`, standard-only) — treat as plausible, confirm in a headed browser.
**Fix:** drop the `, html[data-theme="latent-space"] *` arm, and pick one mechanism — the standard properties alone are the simpler bet given the accent hover is the only thing the webkit block adds. Note also that defining `::-webkit-scrollbar` at all converts Safari's overlay scrollbars into always-visible classic ones inside this theme, changing layout width on every scroll container.

**[MINOR] src/styles/themes/latent-space.css:110–116 — blanket rule outranks every component field style**
The `:not()` chain gives this selector specificity (0,4,2), so under latent.space it beats `.field input` (`--panel`), `.files-search input` (`--panel`), `.forms-add-row input` (`--bg`), `.program-board-filters input` (`--panel`), and the deliberately hard-coded `.forms-preview-input` canvas colors (`forms.css:100–110`) — all collapse to `--surface-sunk`. In this near-black palette `--surface` #131318 vs `--surface-sunk` #0f0f13 is a small delta, so this is a taste call, not a break; but it means the register silently diverges from the shared field treatment and the forms *preview* stops previewing what the public form looks like.
**Fix:** either narrow the rule to the gap it was written for, or state the intent in the block comment so the next reader knows the flattening is deliberate.

**[MINOR] src/styles/themes/latent-space.css:127–133 — the focus ring contributes nothing in this register**
`box-shadow: 0 0 0 2px var(--accent-wash)` is `#231626` — **1.07:1** against `--surface`. The visible focus cue is entirely `border-color: var(--accent)`. The pattern is copied faithfully from `components.css:87`, where `--accent-soft` is a light teal on white and does read; here it does not. Focus is still indicated, so this is not a WCAG 2.4.11 failure, but the ring is dead pixels.
**Fix:** double ring — `box-shadow: 0 0 0 2px var(--accent-wash), 0 0 0 3px var(--accent);` — or drop the shadow and keep the border swap.

**[MINOR] tests/node/latent-space-theme.MRQ-158.test.mjs:1–19 — the test asserts source text, not behavior**
It regexes the stylesheet and slices on the `/* ── native controls` … `/* ── chrome` comment fence. It will keep passing if the rules are later outranked, if the selector stops matching real markup, or if the file stops being loaded; and it breaks on a purely cosmetic comment rename. The `doesNotMatch(/#[0-9a-f]{3,8}|rgba?\(/)` no-raw-hex assertion is the genuinely valuable line and it duplicates what `check:design` already enforces.
**Fix:** keep it as a cheap source guard (there is repo precedent for CONTRACT tests of this shape), but anchor the real claim in an e2e that reads `getComputedStyle` on the actual Filter Sessions input under `data-theme="latent-space"` — which also gives the missing browser evidence from the MAJOR above a permanent home.

## 4. Positive Observations

- **Root cause named correctly and fixed at the right layer for the scoped ticket.** `color-scheme: dark` on the register root is the one declaration that makes the whole class of native chrome (date pickers, the file-selector button, spinners, autofill) follow the theme, and it was not skipped in favour of only patching visible controls.
- **Token discipline is exact.** Zero literal colors added; `check:design` passes; the `:not([type=checkbox]):not([type=radio]):not([type=range])` carve-out plus `accent-color` for the checkables is the right partition, and `opacity: 1` on `::placeholder` correctly defeats the UA's default fade so the measured 5.52:1 is the number that actually renders.
- **Contrast claims are honest.** I recomputed both PR figures from the hexes independently and got 16.90:1 and 5.52:1 — they match to the hundredth. The theme file's existing measured-contrast header made that check trivial, and this change respects it.
- **The AI Engineer audit conclusion is correct.** Its palette is `#ffffff` ground with `#000000` ink, so native light chrome is already coherent; adding `color-scheme: dark` there would have been actively wrong. Auditing and declining is the right outcome, and it was stated in the PR rather than left implicit.
- **Blast radius held.** Every new rule is scoped under `html[data-theme="latent-space"]`; the Day `:root` block that `check:design` compares byte-for-byte against skin-c is untouched, and Night's tokens are unmodified.
- **The comment explains the invisible thing.** "Native widgets otherwise keep the browser's light defaults" is exactly the sentence a future reader needs, and it names the two surfaces where it shows.
