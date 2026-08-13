# MRQ-108 validation — real runtime, real UI

Local Worker via `npx vite dev` (port 5231), real D1, `wrangler d1 migrations apply DB --local`
(0009 applied clean) + `npm run seed` (9980 rows, `rubric_criteria=7`). Driven with Playwright
against the running app; zero console errors on every page exercised.

## ABS-01 — two rounds, own names, own dates, own scorecards, surviving reload

Round cards read back from the API after reload:

| round | name | opens | closes | anonymized | mode | scorecard |
|---|---|---|---|---|---|---|
| 1 | Initial review | 2026-08-01 | 2026-08-28 | ✔ | scorecard | Program fit 40 · Audience value 35 · Clarity 25 · Recommendation (dropdown) · Comments (text) |
| 2 | Final selection | 2026-08-29 | 2026-09-08 | ✘ | scorecard | Final score (1–10, 100) · Committee notes (text) |

Every field on the card is an editable control (name input, two date pickers, mode select,
anonymized checkbox, per-round "Edit scorecard"). Round 2's dialog opens headed
**"Round 2 · Final selection"** carrying round 2's own two criteria — the round-1 hardcode is gone.

**Defect found and fixed during this pass:** the card's summary line rendered UTC-midnight round
dates in America/New_York, so a round the organizer set to open on 08/01 displayed "Jul 31" beside
a picker reading 08/01/2026. `formatDate` now reads back in UTC, matching the editor.

## ABS-03 — all three kinds render reviewer-side and store

Reviewer surface, criteria read from the queue payload:

```
Program fit · 40%      rating x5
Audience value · 35%   rating x5
Clarity · 25%          rating x5
Recommendation         dropdown [Accept|Maybe|Reject]
Comments               textarea
```

Filled 4 / 2 / Accept / "Clear worked examples throughout.", chose Approve, saved. The item left
the open queue, appeared under **Completed**, and reopening it showed the stored values labelled by
criterion name:

```
Program fit  4      Audience value  2
Recommendation  Accept
Comments  Clear worked examples throughout.
```

Confirmed at the API too — numbers stay numbers, strings stay strings:

```json
{"rbc_rnd-initial-review-program-fit":4,"rbc_rnd-initial-review-audience-value":2,
 "rbc_rnd-initial-review-recommendation":"Accept",
 "rbc_rnd-initial-review-comments":"Clear worked examples throughout."}
```

This is the ABS-S3 step-5 artifact that was previously unobtainable: before this change a submitted
review vanished from the queue with no reopen path, so storage could never be shown.

Editor add/remove verified live: "+ Add criterion" then switching its type to Dropdown pre-fills
`Accept, Maybe, Reject`.

## ABS-07 — anonymization is a control, and the redaction copy stops lying

`anonymized` is a checkbox on each round card (was display-only text). Round 1 (anonymized) still
shows four `Redacted in anonymous review` cells and `identity: null` from the API. The redaction
block is now gated on `blind_mode`, so a non-anonymized round shows the real speaker instead of
claiming a redaction that is not happening. Server-side stripping is unchanged — AC-64's byte-scan
mechanism (query layer, not template) still passes.

## Screenshots

`01-evaluation-rounds.png`, `02-round2-scorecard.png`, `03-add-dropdown-criterion.png`,
`10-reviewer-scorecard.png`, `11-reviewer-filled.png`, `12-reviewer-completed.png`,
`13-reviewer-reopened.png`

## Also fixed from looking at the real screen

The legacy overall-score strip sat directly above the round's scorecard, both labelled "Scorecard".
Relabelled the legacy one **"Overall score (optional) · keys 1–5"** — copy only; the 1–5 keyboard
shortcut and AC-245's "numeric score never required" behaviour are untouched.

## Targeted suites (fleet load rule — no full `npm test` during the build)

`evaluation` · `reviewer-queue` · `reviewer-anonymity` · `reviewer-isolation` · `reviewer-surface`
→ **36 passed**. `reset-demo` → 4 passed. `schema-verify` → 48 tables, 120 indexes, 91 FKs.