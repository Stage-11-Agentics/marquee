# MRQ-75 validation evidence

Driven live against `wrangler dev --port 8804` (real local D1/KV, real seed: event `aie-ny-2026`,
1,000 submissions) via the c11 embedded browser. HEAD 3ef6e22.

## 1. Config dialog — all four formats, disable-not-hide
- Screenshot `01-config-agenda-default.png`: default state, Agenda active, Track/Status/Layout
  all visible, Layout disabled with note "Applies to the Speakers format".
- Clicked `[data-embed-kind=sessions]` → embed code textarea (`.value`, not `.textContent`)
  updated to `.../embed/aie-ny-2026-sessions?...` live, no reload.
- Clicked `[data-embed-kind=cfp]` → `is enabled #embed-track` = 0, `is enabled
  [data-embed-layout=cards]` = 0 (both present in DOM, both disabled — never removed), note text
  swapped to "Not applicable — the block promotes the whole call" / "Applies to the Speakers
  format", snippet correctly omits `track` param. Screenshot `02-config-cfp-disabled-controls.png`.

## 2. Sessions kind (AC-273) — track filter
- `/embed/aie-ny-2026-sessions` unfiltered: 23 flat rows (title + track chip + time only, no
  room, no speaker names — confirmed absent from body text).
- `?track=trk_agents`: narrowed to 9 rows, every one carrying the Agents chip.

## 3. Speakers kind (AC-274) — cards vs list
- `/embed/aie-ny-2026-speakers` (default, no `layout` param): card grid, `04-speakers-cards-default.png`.
- `?layout=list`: compact name/affiliation rows, visually distinct, `05-speakers-list.png`.
- Responsive CSS (`@media (max-width: 375px)`) present in the served page for both (WKWebView
  can't emulate viewport width for a literal resize test — same evidence style the existing
  AC-90 test already uses).

## 4. CFP kind (AC-217, AC-218) — open → closed, no republish
- Real seeded form `frm_cfp` ("2026 CFP", closes 2026-09-13): embed rendered "Call for speakers
  is open · closes Sep 13, 2026", formats Stage Talk/Workshop/Lightning/Online, `Submit a
  proposal →` linking to `/f/cfp`.
- `UPDATE forms SET closes_at = <now - 1s> WHERE id = 'frm_cfp'` via direct D1 write — **no
  cache purge call, no republish action**.
- Waited 32s (past the 30s KV TTL) and re-fetched: embed now reads "Call for speakers is
  closed" / "Submissions are closed. This block updates automatically — no republish — once the
  call reopens." CTA gone. Screenshot `03-cfp-closed-automatic.png`.
- Restored `closes_at` afterward so the shared local seed isn't left mutated.

## 5. Anonymity (SPEC §5.12 / A-5)
Both new kinds pass the existing tampered-`mq_session`-cookie CONTRACT test pattern (see
`tests/integration/public-embed-widgets.AC-217-218-273-274.test.ts`, last test).
