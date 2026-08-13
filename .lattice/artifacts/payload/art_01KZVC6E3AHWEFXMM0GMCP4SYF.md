# MRQ-131 — validation evidence

Driven through the real running Worker (`npx vite dev`, Cloudflare plugin) against the
**seeded 1,101-person demo organization**, in the c11 embedded browser, signed in as the
demo organizer. Every check below is something I watched happen, not something I inferred
from a test.

## Persistence — the run-1 "Draft saved locally" defect, specifically

| What | Evidence |
|---|---|
| Note written on Alexander Bricken | drawer showed it, then a **full page navigation** to `/people?person=per_alexander-bricken` still showed it, attributed "AIE Program Committee · 2026-08-12 16:06" |
| Tag "Keynote" added | server read back `tags ['Keynote']`; the tag facet then appeared in the filter panel as "Keynote 1" |
| Stage moved Identified → Interested | board showed the card under INTERESTED; **after a reload** it was still there |
| Stage history | drawer showed both moves with timestamps, newest first, plus the same moves in the activity feed — all from the one append-only table |

## The list, at real scale

- People reports **1,101** across all conferences; KPI strip agrees with the list total.
- Search "Alexander" → "Showing 3 of 3 matching people", server-side; chip `search: "Alexander" ×` + `Clear all` in the reserved row.
- Filter panel offered real facets with counts (Mosaic Relay 95, Principal Engineer 470, …) — server-resolved, not page-derived.
- Tag facet click → "Showing 1 of 1 matching people", chip `tag: Keynote ×`.
- Timings on the seeded org, three runs each: full page **11.8 / 17.2 / 14.9 ms**, search **16.4 / 16.2 / 17.5 ms**.

## Elements never jump

The status row measured **34 px with filter chips and 34 px with the selection bar** —
`{"height":34}` in both states. The save control is fixed-width and only swaps its label
("Save filter as list" → "Save selected as list").

## Lists — both kinds

- Saved "Keynote shortlist" as **Live** from the tag filter → Lists showed `LIVE · 1 people`.
- Tagged a second person "Keynote" without touching the list → the list read **`2 people`**.
  A live list picks up new matches, which is the whole difference between the two kinds.

## Bulk email

Selected two people → Communicate → Preview rendered
`To: aarush.selvan@example.com` with `Hi Aarush,` — merge tags resolved per recipient.
Sent; both rows landed in `outbox` with subject "Speak at our next conference?" and status
`suppressed`, which is the existing demo-safe policy doing its job on a demo-mode event.
No second mail path.

## Import

Dropped a real CSV on the drop zone (`Full Name,Email Address,Company,Job Title,Twitter`).
The button became "Import speakers.csv"; after the run:

- **Rosalind Okonkwo created** (`total 1`, company "Harbour Systems")
- **Aarush Selvan updated, not duplicated** — still one row, title now "Director of Product"
- `Twitter` came back in `unmapped[]`

## Nav, routes, and the scope boundary

Sidebar reads **ORGANIZATION (People · Lists · Sourcing pipeline) → CONFERENCE (AI Engineer
New York 2026) → PIPELINE 1–7 → MODULES → SYSTEM** — the org group sits above the conference
caption, which is the scope boundary the ticket asks for. All four URLs resolve to the same
page with a real table: `/people`, `/crm`, `/directory`, `/contacts`.

## Schema

`wrangler d1 migrations apply DB --local` applied `0011_people_annotations.sql` cleanly
against a real D1, listed ✅ alongside the ten migrations before it.

## Gate

`npm run pr-gate --ticket MRQ-131` — **pass**. 740 tests, suite 31.4 s (45 s budget),
gate 35.5 s (120 s budget). MRQ-111's 16 roster tests pass unchanged against the refactor
that points the roster at the shared query builder.

## Defects found by driving it, and fixed

1. Enter in the tag field did nothing — it relied on implicit form submission. Now handled explicitly.
2. A long name pushed the board's **Declined** column past the scroll edge; columns can shrink now.
3. The import receipt vanished in 3.2 s; it is a number the organizer has to read, so it holds for 8 s.
