# Marquee — UX Sweep Findings (Pass A, read-only)

**Run:** 2026-08-11 · local Worker `http://127.0.0.1:8787` · `evt_aie-ny-2026` (1,000 seeded submissions)
**Agent:** Pass A — static sweep, organizer + speaker + public seats. No writes performed.
**Screenshots:** `/private/tmp/claude-501/-Users-atin-Projects-Stage11-deployments-Marquee/e2059b77-e39b-431b-84df-d0c1dfa9db8f/scratchpad/sweep-shots/`

---

## 1. Summary

- **Routes swept:** 24 organizer routes + 5 submission detail records + 1 speaker route (`/portal`) + 8 public routes = **38 surfaces**, all reached except one.
- **Clean:** 30 surfaces showed no console errors, no failed requests, and no visible defects.
- **With findings:** 8 surfaces (5 major/blocker-class, 3 minor/polish).
- **Not reached:** 1 (`/i/:uid` — no real UID could be found without a mutating action).

**The single worst problem:** the app shows conflicting pipeline counts for the same event across three different surfaces (landing page hero, `/dashboard`, `/board`), and the disagreement isn't a rounding quirk — it spans **4 of the 7 pipeline stages** (Submitted, Waved, Onboarding, Scheduled), with one case off by more than 10x (`/board` shows "Waved: 620" against an actual/true count of 60). Compounding this, the `Waved` and `Accepted` submission-list filters return the **same 60 records**, including at least one record whose own detail page shows it has already progressed to the `Onboarding` stage. Anyone driving this product for the first time — including a competition judge — will notice the numbers don't add up within the first two clicks.

No console errors and no 4xx/5xx-on-page-load were found anywhere except the confirmed `/settings/api` 403 (finding #5). Every route rendered; nothing hung or blanked. The defects here are data-integrity and layout bugs, not crashes.

---

## 2. Findings table (ranked by severity)

| Severity | Route | Seat | What I saw | Exact repro | Screenshot |
|---|---|---|---|---|---|
| **Blocker** | `/`, `/dashboard`, `/board` (cross-screen) | organizer | Pipeline stage counts disagree across three surfaces for the same event, in both directions: **Submitted** — landing hero shows 960, `/dashboard` shows 0, `/submissions?status=submitted` actually has 0 matching records (landing is wrong/stale). **Waved** — `/dashboard` shows 60, `/board` shows **620**, `/submissions?status=waved` actually has 60 matching records (`/board` is wrong, off by >10x). **Onboarding** — landing shows 153, `/dashboard` shows 58, `/onboarding` page itself shows "153 accepted speakers still owe something" (dashboard is wrong). **Scheduled** — landing shows 24, `/dashboard` shows 1, `/submissions?status=scheduled` actually has 1 matching record (landing is wrong). Only `In review` (280) and `Published` (23) agree everywhere. | Load `/` and note hero numbers, then load `/dashboard`, then `/board`, then filter `/submissions` by each status and read "N matching records" at the top of the list. Compare all four sources per stage. | `A-public-landing.png`, `A-organizer-dashboard.png`, `A-organizer-board.png`, `A-organizer-submissions-submitted.png`, `A-organizer-submissions-waved.png`, `A-organizer-onboarding.png`, `A-organizer-submissions-scheduled.png` |
| **Major** | `/submissions?status=waved` vs `?status=accepted` | organizer | The two filtered lists return the **identical 60 records**, same order, same titles (e.g. `sub_mcp-workflows`, `sub_letta-workshop`, `sub_improving-rag` appear in both). Opening `sub_mcp-workflows`'s own detail page shows its actual current stage is **Onboarding** (top-right status pill), not Waved or Accepted — so a record already past both stages still shows up in both filtered views. | Load `/submissions?status=waved`, screenshot the row IDs; load `/submissions?status=accepted`, screenshot again — rows match. Then open `/submissions/sub_mcp-workflows` and read the top-right stage pill. | `A-organizer-submissions-waved.png`, `A-organizer-submissions-accepted.png`, `A-organizer-submission-detail-mcp-workflows.png` |
| **Major** | `/submissions/sub_agent-eng` | organizer | Detail-page layout bug: the right-side "Evaluation panel" card visually overlaps the main content column, hiding the `WAVE` field value entirely and clipping the venue text in the green schedule box ("Sheraton New York Times Square ·" is cut off mid-word, with the panel drawn on top of it). Confirmed genuine overlap via zoom, not a scroll/viewport artifact — a longer-abstract record (`sub_gemini-deep-research`) at the same viewport renders correctly because its taller content pushes the schedule box below the sidebar's height. Root cause looks like the main column not reserving space for the fixed-height sidebar when content is short. | Open `/submissions/sub_agent-eng` at 1316×924 and look at the region below "ROUTING RULE" — the schedule box's right edge and the `WAVE` field are behind the white Evaluation Panel card. | `A-organizer-submission-detail-published-OVERLAP-BUG.png` (zoomed crop taken in-session) |
| **Major** | `/evaluation` | organizer | The "Round 2 · Final selection" card renders with catastrophically broken text wrapping — "3 reviews per submission · 0 comparisons" and "0 complete · 0 remaining" render one word per line in a column roughly 40px wide — and displays what looks like a raw internal identifier as if it were prose: **"IdentitySep visible 8"**. The adjacent "Round 1 · Initial review" card on the same page renders normally with the same kind of content. | Load `/evaluation`, look at the right-hand "Round 2" card under the Evaluation plan header. | `A-organizer-evaluation-LAYOUT-BUG.png` |
| **Major** | `/settings/api` | organizer | Page shows "Tokens unavailable — API tokens require an organization program lead or owner" and a failed request, even though the logged-in organizer persona's own memberships (confirmed via `/api/v1/auth/me`) are `owner`, `program_lead`, and `reviewer` on the only event in the org. The demo organizer — who by design *is* the owner/program_lead — cannot access this page. | Load `/settings/api` as the organizer demo login; network panel shows `GET /api/v1/org/tokens → 403`. | `A-organizer-settings-api-403-BUG.png` |
| Minor | `/submissions/sub_what-rl-means-for-agents` | organizer | The record is already `Accepted` and `Scheduled` (visible in the top-right pill and decision history), yet the "Record action" card still shows live **Accept / Maybe / Reject** buttons with no visual indication a decision was already made and locked in. Not clicked (read-only pass), so it's unconfirmed whether clicking would actually re-decide a scheduled talk — but the affordance itself is confusing on an already-placed session. | Open `/submissions/sub_what-rl-means-for-agents`; note "Scheduled" pill top-right alongside active decision buttons below. | `A-organizer-submission-detail-scheduled.png` |
| Polish | `/evaluation/ai`, `/settings/tasks`, `/settings/airtable` | organizer | These three routes are unbuilt: each shows an honest, explicitly-labeled empty state ("X is ready for its module. Navigation, layout, overlays, responsive behavior, and accessibility are live; no product data is being simulated."). Not a bug — flagged only so the operator knows 3 of the 24 swept organizer routes are stubs, in case a judge clicks into one of them during the walkthrough. | Load each route directly. | `A-organizer-evaluation-ai-stub.png`, `A-organizer-settings-tasks-stub.png`, `A-organizer-settings-airtable-stub.png` |
| Checked, not reproduced | `/portal` (speaker) vs organizer chase board | speaker / organizer | Brief called out a **known past defect**: chase board describing this speaker (Aarush Selvan / "Going deep on Gemini Deep Research") as owing nothing while the portal showed 3 outstanding tasks. In this run, the portal shows **0/3 tasks complete** with 3 named outstanding tasks (Hotel and Travel Reservations, Finalize talk description, Presentation Upload). The organizer-side `/onboarding` page and `/dashboard` task preview both list the same speaker with the same 3 pending tasks, and none are flagged overdue — consistent with the seeded due dates (Aug 19/29/31, 2026) all being in the future relative to the sim date. **No contradiction found today** — worth a re-check after any data reseed, since the defect may be date-sensitive. | Log in as speaker, load `/portal`, screenshot task list; log in as organizer, load `/onboarding`, search "Aarush Selvan". | `A-speaker-portal-tasks.png`, `A-organizer-onboarding.png` |

---

## 3. Clean routes

No console errors, no failed self-requests, no visible layout/placeholder/dead-end issues found on:

**Organizer seat**
`/dashboard`* · `/board`* · `/submissions?status=submitted` · `/submissions?status=in_review` · `/submissions?status=accepted`* · `/submissions?status=published` · `/onboarding`* · `/submissions?status=scheduled` · `/submissions` (all 1,000 — fast: server paginates at `per_page=50`, list rendered well inside a 1s wait, no full-1000-row client render) · `/submissions/new` (render only) · `/forms` · `/reviewer` · `/agenda-builder` (Unscheduled: 36 and Conflicts: 7 match `/dashboard` exactly) · `/communications` (demo-safe outbox confirmed) · `/settings` · `/settings/venues` (site map + buildings/rooms render correctly) · `/import` (render only) · `/api/docs`
`/submissions/sub_synthetic-pool-0280` (in_review) · `/submissions/sub_what-rl-means-for-agents`* (scheduled) · `/submissions/sub_gemini-deep-research` (published)

*Starred routes are clean *except* for the specific issue logged in the findings table above — they are not double-counted as fully clean.

**Speaker seat**
`/portal`

**Public / logged out**
`/` * · `/agenda` · `/f/cfp` · `/s/beyond-the-consensus-navigating-ai-s-frontier-in-2025` · `/p/grace-isford` · `/embed/aie-ny-2026-agenda` · `/embed/config`

---

## 4. Not reached

- **`/i/:uid`** (invite / ICS link) — could not find a real UID to test. `/api/openapi.json` confirms there is only a `POST /api/v1/events/{eventId}/submissions/{submissionId}/invites` to *create* an invite; no `GET` endpoint lists existing ones, and creating one would be a write, which this pass does not perform. Per the sweep's own rule, not guessing a slug here rather than fabricating a finding.

---

## 4b. Root-cause verification (orchestrator, independent API check)

The blocker was re-verified directly against the API, bypassing the UI. **All three headline
findings reproduce at the API layer, so these are backend defects, not rendering artifacts.**

**True status distribution across all 1,000 submissions** (paged, `per_page=100`):

| Count | Status |
|---:|---|
| 550 | `rejected` |
| 280 | `in_review` |
| 70 | `waitlisted` |
| 40 | `draft` |
| 36 | `accepted` |
| 23 | `published` |
| 1 | `scheduled` |
| **1000** | **total — reconciles exactly** |

**There is no `submitted` status in the data at all**, and no `waved` status either.

**What each filter actually returns, decomposed by real status:**

| Filter | n | Composition |
|---|---:|---|
| `status=submitted` | **0** | — nothing matches |
| `status=in_review` | 280 | `in_review` 280 |
| `status=waved` | 60 | `accepted` 36 + `published` 23 + `scheduled` 1 |
| `status=accepted` | 60 | `accepted` 36 + `published` 23 + `scheduled` 1 |
| `status=scheduled` | 1 | `scheduled` 1 |
| `status=published` | 23 | `published` 23 |

### The actual defect: two competing definitions of a "stage"

Some surfaces count a stage **cumulatively** (once a record passes a stage it stays counted
there), others count it **literally** (`status` column equality). That single split explains
almost every disagreement, and the arithmetic confirms it:

- **Submitted** — landing shows **960** = 1000 − 40 drafts (cumulative). The sidebar filter
  matches `status='submitted'` literally and returns **0**. The sidebar's first pipeline
  stage is a link to an empty list.
- **Scheduled** — landing shows **24** = 23 published + 1 scheduled (cumulative); dashboard
  and filter show **1** (literal).
- **Accepted** — 60 everywhere, because the filter is already cumulative here.
- **Published / In review** — agree everywhere (23 / 280); nothing downstream of them.

**`Waved` is the odd one out and is a genuinely separate bug.** It isn't a cumulative-vs-literal
split — it's three unrelated definitions:
- `/dashboard` → **60** (the accepted set)
- the filter → **60** (aliased to `accepted`; returns zero actually-waved records)
- `/board` → **620**, which is exactly **550 rejected + 70 waitlisted**

So `/board` treats "waved" as *decided-but-not-accepted*, while the dashboard and the filter
treat it as *accepted-and-beyond*. Both cannot be right, and the filter returning the accepted
set under a `waved` label is wrong under either reading.

**Fix ordering suggestion:** rule on the semantics first (is a pipeline stage cumulative or
literal? what does "waved" mean?), then make all four surfaces read from one shared derivation.
Patching the counts surface-by-surface will reintroduce this.

**Also independently confirmed:** `GET /api/v1/org/tokens` → **403** for the demo organizer
whose `/api/v1/auth/me` reports `owner + program_lead + reviewer`.

---

## 5. Notes for Pass B / follow-up

- The pipeline-count and Waved/Accepted-filter findings (table rows 1–2) look like they share a root cause in how the "waved" stage is computed/joined — worth investigating together rather than as two separate tickets.
- The `/settings/api` 403 (row 5) may indicate the demo organizer's membership needs an org-level role in addition to event-level roles, or that the permission check is checking the wrong scope — worth a quick trace of the authorization middleware for that route.
- The `/evaluation` layout bug (row 4) and the `sub_agent-eng` overlap bug (row 3) are both instances of a sidebar-card overlapping main content when the main column is shorter than the sidebar — likely one shared CSS/layout defect (missing `min-height` or flex-basis) rather than two independent ones.
