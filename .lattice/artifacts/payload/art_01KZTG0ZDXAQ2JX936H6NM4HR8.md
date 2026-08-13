# MRQ-111 validation — real running Worker, real seeded data

Commit `f807f78`. Local Worker via `npx vite dev` (port 5411) against a freshly
migrated + seeded D1: **9,976 rows, 1,000 submissions, 1,101 people**.
Migration `0009` applied to real SQLite via `wrangler d1 migrations apply` (all
nine migrations ✅) — not only through the test harness's statement splitter.

## API, driven with curl as the organizer persona

| Check | Result |
|---|---|
| Roster size on real seed | **507 speakers** · counts pending 467 / invited 3 / confirmed 36 / declined 1 |
| Roster latency (3 runs) | **33 / 38 / 36 ms** — R7 headroom on a 507-row roster |
| Search latency | 58 ms, narrowed 507 → 1 |
| Add speaker (Priya Raman, full profile incl. bio) | 201, bio persisted (the admin path used to insert literal NULL) |
| Bio sentinel edit `SBEK-ORG-EDIT-01` + status + logistics | 200 |
| Re-read after write | bio, `status: confirmed`, `custom_fields {Arrival, Dietary}` all present |
| Status filter | `?status=confirmed` → 37 incl. Priya; `?status=pending` excludes her |
| Re-add same email, blank form | bio and title **intact** — the review's data-loss finding, verified fixed against real data |
| `headshot_attachment_id` projected | present on list rows and record (MRQ-112's hook) |

## UI, driven headless in a real browser (1440×900)

c11's embedded browser timed out twice (`browser.open_split`, 10s) under fleet
load ~200, so this ran through Playwright headless instead — a real render, real
navigation, real reload.

| Check | Result |
|---|---|
| Sidebar entry labelled exactly "Speakers" | visible |
| Roster renders | **508 rows** |
| Status badge widths across all four statuses | `[92]` — one width, so nothing jumps |
| Search narrows / clearing restores | 508 → 1 → 508 |
| `?person=` deep link (the formerly dead quick-search link) | opens the record |
| Bio edited **through the UI**, saved, page reloaded | sentinel survives the reload — SPK-02's literal test |
| Logistics field after reload | `Arrival May 11, aisle seat` — SPK-15 |
| `/onboarding?person=` | drawer now opens (was dead) |
| Console/page errors | **none** |

## Defect found only by looking at the real artifact

The record drawer shipped at `z-index: 40` while the sticky topbar is `50`, so
the topbar painted over the drawer's own title and Close button. Every test was
green; the screenshot was not. Fixed to `500`, matching `.drawer-backdrop` in
`components.css` and the onboarding drawer, and re-validated.

Screenshots: `scratchpad/shots/{01-roster,02-search-narrowed,03-record,04-after-reload}.png`.
