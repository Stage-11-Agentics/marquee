# MRQ-109 validation — the real app, driven end to end

Local Worker (`npx vite dev`, port 5209) on a migrated + seeded local D1 (9,976 rows,
1,000 submissions). Three seeded evaluations were given real scorecard content so the
chair's surfaces had something true to show:

| Submission | criteria_scores | Expected |
|---|---|---|
| Operating agent workflows… | Program fit 5, Audience value 4, Clarity 3 (weights 40/35/25) | **4.15** weighted |
| Evaluating retrieval systems… | 4, 2, 2 | **2.80** weighted |
| Debugging open-model infra… | scalar `score = 3.5`, no criteria | **3.50** unweighted |

## API (curl, authenticated demo organizer)

- `sort=score` → `4.15 (1 review, weighted) · 3.5 (1, unweighted) · 2.8 (1, weighted) · null`
- `sort=score_asc` → `2.8 · 3.5 · 4.15 · null` — **unscored still last**, which is the
  whole reason for the nulls-last flag: without it the two reviewed submissions sit
  under ~997 unreviewed rows and ABS-10's ascending screenshot shows nothing.
- Weighted arithmetic confirmed live: (5·40 + 4·35 + 3·25)/100 = 4.15, not the plain
  average 4.0.

## Browser (headless Chromium, the real client bundle)

- Column header renders **"WEIGHTED SCORE ▼"**, `aria-sort="descending"`.
- **Clicking the header** flips to `sort=score_asc`, `aria-sort="ascending"`, glyph `▲`,
  and the rows genuinely reorder (`2.80, 3.50, 4.15, —`). Header bounding box **104px
  before and after** — the toggle moves nothing.
- Score cells: `4.15` / `1 review`; `3.50*` / `1 review` with title "Unweighted — includes
  reviews recorded before this round had scorecard criteria"; `—` / `Not scored`.
- **"Export scores (CSV)"** present on the results toolbar; clicking it produced a real
  browser download named `review-results.csv`.
- `/evaluation`: **"View results →"** (primary action, first in the header) navigates to
  `/submissions?sort=score`; **"Export scores (CSV)"** beside it; committee rows read
  `20/20 reviewed` at a fixed 104px width — the per-reviewer roll-up, not the old
  plan-wide count over the round total.

## The downloaded file, opened (ABS-13 is scored by a human opening it)

1,001 lines (header + 1,000 submissions), ordered exactly as the screen:

```
"Submission ID","Title","Speakers","Tracks","Format","Status","Weighted score","Score basis","Reviews","Accept","Maybe","Decline","Program fit (Initial review)","Audience value (Initial review)","Clarity (Initial review)"
"sub_synthetic-pool-0041","Operating agent workflows…","Avery Cairn","AI in Financial Services; Infra","Stage Talk","in_review","4.15","Weighted","1","1","0","0","5","4","3"
"sub_synthetic-pool-0043","Debugging open-model infrastructure…","Cleo Cairn","Evals; RAG/Retrieval","Lightning","in_review","3.5","Unweighted","1","0","0","1","","",""
"sub_synthetic-pool-0042","Evaluating retrieval systems…","Briar Cairn","Agents; Open Models","Workshop","in_review","2.8","Weighted","1","0","1","0","4","2","2"
```

Per-criterion values, the aggregate, the reviewer count and the recommendation tally all
match the on-screen row. Full 1,000-row export returned in **0.49s**.

Screenshots: `results-descending.png`, `results-ascending.png`, `evaluation-page.png`.
