# Marquee — First Manual UX Sweep

**Purpose:** nobody has driven this build yet. Zero e2e specs exist (`playwright.config.ts`
is present, `tests/` has no spec files). Every green check so far ran against seeded state
through curl or vitest — none of it proves a page renders. This is the first pass where a
model looks at the product the way the judge will.

**Status:** local Worker is live on `http://127.0.0.1:8787` (health OK, 1,000 seeded
submissions, both demo personas returning 200).

---

## The environment, already verified

| Fact | Value |
|---|---|
| Worker | `http://127.0.0.1:8787` — `{"service":"marquee","status":"ok"}` |
| Seeded submissions | **1,000** on `evt_aie-ny-2026` |
| Organizer persona | `POST /api/v1/auth/demo {"role":"organizer"}` → `per_aie-program-committee`, memberships **owner + program_lead + reviewer** |
| Speaker persona | `POST /api/v1/auth/demo {"role":"speaker"}` → `per_aarush-selvan`, membership **speaker** |
| Principal check | `GET /api/v1/auth/me` |
| Reset between runs | `npm run reset:demo` (manual by ruling — no cron) |

One demo login covers all three admin seats; the speaker seat is a separate login.
There is no reviewer-only persona and no impersonation route — reviewer scope rides on
the organizer principal's `reviewer` membership.

---

## The one hard constraint: a shared cookie jar

Every browser tab in one profile shares one session cookie. **Two seats cannot be live at
the same time in the same browser profile.** This decides the whole parallelism shape:

- **Read-only work parallelizes** only if each agent gets its own browser profile/context.
- **Seat switches must be serialized** inside any single profile.
- **Write work must be serialized globally**, because all agents share one D1. Agent A
  accepting a talk changes what Agent B sees on the board.

So: Pass A is read-only and may fan out by seat if we have isolated contexts. Pass B is
strictly one agent at a time, with `npm run reset:demo` between runs.

---

## Pass A — Static sweep (read-only, no writes)

Visit every route in all reachable seats. Screenshot, read console, read network. **Click
nothing that mutates.** Navigation, filters, tabs, expanding a row, opening a detail
record: all fine. Anything labelled Accept / Deny / Send / Publish / Save / Delete / Reset:
not in this pass.

### Admin routes (organizer seat) — from `src/ui/shell/route-table.ts`

| Route | Label |
|---|---|
| `/dashboard` | Program home |
| `/board` | Program board |
| `/submissions?status=submitted` | Submitted |
| `/submissions?status=in_review` | In review |
| `/submissions?status=waved` | Waved |
| `/submissions?status=accepted` | Accepted |
| `/onboarding` | Onboarding |
| `/submissions?status=scheduled` | Scheduled |
| `/submissions?status=published` | Published |
| `/submissions` | Abstracts & sessions (all 1,000 — **speed check**) |
| `/submissions/:id` | Submission record (sample ≥5 across statuses) |
| `/submissions/new` | Create submission (render only, do not submit) |
| `/forms` | CFP forms |
| `/evaluation` | Evaluation plan |
| `/evaluation/ai` | AI assist |
| `/reviewer` | Review queue |
| `/agenda-builder` | Agenda |
| `/communications` | Communications |
| `/settings` | Conference settings |
| `/settings/venues` | Venues |
| `/settings/tasks` | Task templates |
| `/settings/airtable` | Airtable mirror |
| `/settings/api` | API tokens |
| `/import` | Sessionize importer |
| `/api/docs` | API & CLI reference |

### Speaker seat

| Route | Note |
|---|---|
| `/portal` | Speaker portal — the run-state flags a known contradiction here: the chase board once described this speaker as owing nothing while the portal showed 3 outstanding. **Check this explicitly.** |

### Public / unauthenticated (clear cookies first)

| Route | Note |
|---|---|
| `/` | Landing |
| `/agenda` | Public conference site |
| `/f/:slug` | CFP form — open state |
| `/s/:slug` | Session page |
| `/p/:slug` | Speaker page |
| `/i/:uid` | Invite / ICS link |
| `/embed/:slug` | Embed |
| `/embed/config` | Embed config |

### What counts as a finding

Capture per route: **screenshot**, **console errors**, **failed network requests**, **wall-clock to interactive**.

Flag any of:

- JS error in console (any, even non-fatal)
- 4xx/5xx on a request the page made for itself
- Blank region, spinner that never resolves, skeleton left in place
- Placeholder text that shipped — `TODO`, `Lorem`, `undefined`, `null`, `NaN`, `[object Object]`, `REPLACE_ME`
- A count, badge, or total that disagrees with another screen showing the same thing
- Broken layout: overflow, overlap, clipped text, a control off-screen
- Dead end: a page with no way back, or a link to a route that 404s
- **Slow anything** — speed is a graded feature (R7). Any list or transition that feels slow is a defect, not a note.
- Elements that jump position when state toggles (house rule: elements never jump)

---

## Pass B — Flow sweep (writes; strictly serialized)

One agent at a time. `npm run reset:demo` before each flow. The competition's 11-step
walkthrough loop is the evaluation rubric, so it runs first and must complete with **zero
dead ends**.

1. **The main loop** — public CFP submit → appears in Submitted → review & score → accept →
   speaker gets task set → speaker completes portal tasks → schedule onto agenda →
   publish → appears on the public site.
2. **Reversal cascade** — accept, then reverse it. The dialog's branches are
   `Cancel open tasks` / `Keep tasks active`; verify both, and that re-acceptance
   **restores** rather than reassigns.
3. **Decision + comms** — deny/waitlist with feedback; confirm mail lands in the
   **outbox**, not a real send. Resend is on the free tier with a hard **100/day** cap, so
   any bulk decision mail that tries to send for real is a serious finding.
4. **Bulk paths** — multi-select and act on many records; watch chunking and timing.
5. **Importer** — Sessionize import against the fixture.

---

## Pass C — Adversarial states

The states that only appear when you go looking:

- **CFP states:** open, closed, at-limit, resumed draft
- **Empty states:** a filter matching zero records; a fresh event with nothing in it
- **Deep-link + refresh:** load every route cold by URL, not by clicking — SPA fallback is
  `single-page-application`, so a cold deep link is a genuinely different code path
- **Back/forward button** through a few flows
- **404 / bad IDs:** `/submissions/sub_does-not-exist`, a bad slug, an expired magic link
- **Auth boundaries:** hit an admin route while logged out; hit it as the speaker seat
- **Mobile viewport** — 390×844; the submit path had a dedicated mobile pass (M-41)
- **Long content:** the longest seeded title/abstract, a many-speaker session

---

## Agent shape

**Model:** Sonnet. **Count:** 1 for Pass B and C (serialization is forced). Pass A can run
2–3 in parallel *only* with isolated browser profiles — otherwise 1 agent sweeping seat by
seat.

Each agent gets:

- The route table above and its seat's login recipe
- A screenshot directory and a strict naming convention: `<pass>-<seat>-<route-slug>.png`
- One append-only findings file, structured: **route · seat · severity · what I saw ·
  exact repro · screenshot path**
- The standing rule: **report what you saw, never what you assume**. A screenshot is the
  evidence; a claim without one is a hypothesis.
- A hard instruction not to fix anything — this pass observes. Fixes are separate tickets
  so the sweep stays fast and the findings stay comparable.

---

## Deliverable

`sequence/UX-SWEEP-FINDINGS.md` — findings ranked by severity, each with a screenshot and a
repro. Anything blocking the 11-step walkthrough loop is top of the list, because that loop
is the rubric.
