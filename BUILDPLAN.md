# Marquee — Build Plan

**Status:** DRAFT for orchestrator review · tone-architect Phase 3 · authored 2026-08-08 night.
**Reads with:** `SPEC.md` (what it is) · `EVALUATION.md` (what "done" means) · `sequence/USER_STORIES.md` (AC-1–AC-233, including Amendment 1's contract-review fold) · `sequence/research/seams-feasibility.md` (limits, hour estimates §9, the 16 deadline traps §8).
**Folded 2026-08-08 night** against `USER_STORIES.md` Amendment 1: US-72 (Airtable mirror) and US-73 (reset the demo) minted, AC-231/AC-232/AC-233 appended, Tier B ranks 3–23 shifted to 4–25. Ticket ACs, ordering, and the cut line below reflect that fold.
**Deadline:** **Wed 2026-08-12, 22:00 PT.** From this file's timestamp that is ~98 hours, of which roughly a day elapses before requirements freeze.

Hours below are **agent-hours**, not wall-clock. The fleet runs ~4–6 delegators in parallel; wall-clock is the critical path through the dependency graph, not the sum.

---

## 1. Architecture in one page

Decisions are made. **Do not reopen them** — they were ratified in `run-state.md` on 2026-08-08 and the evidence is in `seams-feasibility.md`.

One **Cloudflare Worker on the Paid plan** with static assets bound, serving two things: server-rendered public pages (landing, CFP form, agenda, permalinks, embeds, `/i/{uid}.ics`) and a client-rendered admin SPA that talks to `/api/v1/*` and nothing else. **D1 is the source of truth.** **R2** holds every file, uploaded browser→bucket by presigned PUT and never through the Worker. **KV** caches public fragments and rate-limit counters, never sessions. **Queues** drain the email outbox and the Airtable mirror; **cron** fires pre-close reminders, the mirror webhook keepalive, and the orphan sweep. **Turnstile** gates every public write. **Resend** sends from `Marquee <marquee@stage11.systems>`, verified since March. **Auth is ours**: single-use magic-link tokens in D1 exchanged for an HttpOnly session cookie scoped to the exact subdomain.

**Airtable is a genuine two-way mirror and is never on a read path.** Outbound: a `mirror_outbox` change feed drains on a queue, batching 10 records per PATCH with `performUpsert.fieldsToMergeOn: ["marquee_id"]` at ≤4 req/s. Inbound: a webhook ping triggers a cursor'd payload pull that applies an allowlisted field set back into D1, with `last_write_source` breaking echo loops and a daily keepalive cron beating the 7-day webhook expiry.

**Calendar invites are ICS `METHOD:REQUEST` + `ATTENDEE`,** with `SEQUENCE` bumping and `METHOD:CANCEL` implemented from the first invite, delivered as a single-send Resend attachment (the batch endpoint does not carry attachments), plus Google/Outlook deep links and a stable `/i/{uid}.ics`.

Stack: TypeScript · Hono · Preact (+`preact-render-to-string` for public SSR) · Vite · raw SQL on D1 through a thin query helper · numbered `.sql` migrations. CSS is lifted from `prototypes/pipeline-v1.1/index.html`.

---

## 2. How the plan is sequenced

Three waves, each ending in something a human can look at:

| Wave | Ends at | What is true then |
|---|---|---|
| **0 · Walking skeleton** | **CP-1** | A deployed URL on the real plan, on the real seed, with both demo logins and one real loop screen. Traps 2 and 4 are dead by 03:00, not on Tuesday. Felt checkpoint **C1** can run. |
| **1 · The loop** | **CP-2** | All eleven walkthrough steps complete on the deployed preview with zero dead ends. Tier A (AC-1 – AC-90) green. Checkpoints **C2, C3** can run. |
| **2 · Differentiators** | **CP-3** | Tier B built top-down to the cut line, the Airtable round-trip demonstrable, the gate rehearsed. Checkpoints **C5, C6, C7**. |

**The walking skeleton goes first and it goes tonight.** It is not a nicety: deploying to the real Workers Paid plan on day one is the only way to discover the 10 ms CPU ceiling (trap 2) and a lapsed R2 entitlement (trap 4) while there is still time, because neither is visible in local dev.

---

## 3. Wave 0 — walking skeleton (tonight)

Serialized where marked; everything else runs in parallel.

| # | Ticket | Scope | ACs | File surface | Hrs | Deps |
|---|---|---|---|---|---|---|
| **M-01** | **Platform skeleton & first real deploy** | Repo, `wrangler.jsonc` with every binding (D1, R2, KV, Queue, cron, Turnstile secrets), Vite + TS, Hono entry, health route, custom domain `marquee.stage11.dev`, **deploy to the Paid plan before anything else lands**. `https://` only; session cookie helper with **no `Domain` attribute**. | — | `wrangler.jsonc`, `package.json`, `vite.config.ts`, `src/index.ts`, `src/lib/cookies.ts` | 3 | — |
| **M-02** | **Migration `0001_init.sql` — the whole schema** ⛔serialized | Every table in `SPEC.md` §3 in one migration, with indexes: `submissions(event_id,status)`, `(event_id,track_id)`, `(event_id,kind)`, `participations(submission_id)`, `(person_id)`, `speaker_tasks(person_id,status,due_at)`, `agenda_items(event_id,starts_at)`, `outbox(person_id)`, `outbox(idempotency_key) UNIQUE`, `evaluations(round_id,submission_id,reviewer_person_id) UNIQUE`. **Status enum complete including `waitlisted` (AC-176); `(person, submission, role)` triple; round-aware evaluation; per-event reviewer scope (AC-214).** | AC-176, AC-212, AC-214, AC-222 | `migrations/0001_init.sql`, `src/db/schema.ts` | 3 | M-01 |
| **M-03** | **Auth, demo entry, reset-demo** | Magic links (256-bit random, hash stored, single-use, 15-min TTL), session cookie middleware, bearer-token middleware, scope resolution from `memberships`, **one-click organizer/speaker demo login**, on-screen magic link in demo mode, `POST /admin/reset-demo` + product button + `npm run reset:demo` (idempotent, safe mid-judging, never partially-reset — **US-73 ranks in Tier B but is built here**, because the demo logins need it from the first deploy). | AC-1, AC-2, AC-107, AC-214, **AC-230** | `src/routes/auth.routes.ts`, `src/lib/auth/*`, `src/routes/admin-ops.routes.ts` | 4 | M-02 |
| **M-04** | **Seed generator v1** | `scripts/seed/` from `sources/aie-summit-2025-program.json`: event, formats, tracks, rooms, waves, 1,000 submissions, the real accepted core, participations, tasks, evaluations, agenda with **two live double-bookings**, the deliberate ugliness list. Idempotent; `npm run seed`; `reset:demo` calls it. **Placeholder avatars only; no real emails; no real headshots.** Explicit `User-Agent` on every stdlib HTTP call (trap 16). | AC-3, AC-8 | `scripts/seed/*.ts`, `src/lib/ids.ts` | 6 | M-02 |
| **M-05** | **Design system, admin shell, landing page** | Tokens + component CSS lifted verbatim from the v1.1 prototype; sidebar (home, seven pipeline stages, modules, footer), topbar with search affordance, toast host, drawer/modal hosts, route table; **public landing with both demo entries**. | AC-1, AC-2, AC-4 | `src/styles/tokens.css`, `src/ui/shell/*`, `src/routes/landing.route.tsx` | 4 | M-01 |
| **M-06** | **Harness skeleton** ⛔serialized on `package.json` | All eleven `EVALUATION.md` §1.1 scripts registered up front (stubs where empty): `test`, `e2e`, `check:speed`, `check:seed`, `check:api`, `check:repo`, `check:readme`, `trace:ac`, `reset:demo`, `smoke:mail`, `smoke:ics`, `check:skill-agent`. Vitest + `@cloudflare/vitest-pool-workers`, Playwright desktop+mobile projects, `trace:ac` scanner, `check:repo` (gitleaks + badge + `Atin/` + history scan), CI. **`npm test` budget ≤30 s from the first commit.** | — | `package.json`, `vitest.config.ts`, `playwright.config.ts`, `scripts/checks/*`, `.github/workflows/ci.yml` | 4 | M-01 |
| **M-07** | **API core** | Hono router with a generated route manifest (glob, never a hand-edited list), error envelope, list contract (`page/per_page/q/sort/filters` → `{data,page,per_page,total}`), pagination helper, **bulk selector type (ids *or* filter)**, `json_each` chunking helper, OpenAPI assembly from route definitions, `/api/openapi.json`, `/api/docs`. | AC-105, AC-106, AC-108 | `src/api/*`, `src/routes/_manifest.ts` (generated) | 4 | M-02 |
| **M-08** | **First loop screen: submissions list** | Server-side filtered/sorted/paginated list at 50/page over the seed, type/status/track filters, selection state, empty state. Proves the whole stack end to end on real data. | AC-23, part AC-66 | `src/routes/submissions.routes.ts`, `submissions.queries.ts`, `src/ui/submissions/*` | 4 | M-04, M-05, M-07 |

**CP-1 — human-visible checkpoint.** Deployed URL, populated, both demo logins land on a real screen, `npm test` green in <30 s, `check:repo` clean. **Traps 2, 4, 15 closed.** Felt checkpoint **C1** runs here (a stranger opens it cold and answers three questions in 10 s).

---

## 4. Wave 1 — the loop, in walkthrough order

The order below is the judge's order. **A chain has no most-important link**: nothing in Wave 2 starts while a Wave 1 ticket is red.

| # | Ticket | Scope | ACs | File surface | Hrs | Deps |
|---|---|---|---|---|---|---|
| **M-09** | Event settings | Event details (incl. timezone driving every rendered time and ICS `DTSTART`), formats with default durations, tracks with colors + reorder, rooms with capacity. Save confirms in place, no reload. | AC-5 – AC-13 | `src/routes/event-settings.routes.ts`, `src/ui/settings/*` | 4 | M-08 |
| **M-10** | Program dashboard | Seven-stage pipeline card (every count clickable to the filtered list behind it), attention strip, wave planner, work-in-motion metrics, speaker-task preview. 5 s SWR poll for liveness. | AC-14 – AC-16 | `src/routes/dashboard.routes.ts`, `src/ui/dashboard/*` | 4 | M-08 |
| **M-11** | **Email core + demo-safe outbox** ⚠️ before any send path | Template store, `{{merge}}` renderer, `outbox` table writes with `idempotency_key`, queue consumer as **the single choke point** that calls Resend, demo-safe allowlist enforced *in the consumer*, `Idempotency-Key` header, two send paths from the start (**batch for plain bulk, single-send ≤10/s for anything carrying an ICS** — trap 14), comms log screen with rendered previews. | AC-33, AC-117, AC-125 – AC-131 foundation | `src/jobs/mail/*`, `src/routes/comms.routes.ts`, `src/ui/comms/*` | 6 | M-02, M-07 |
| **M-12** | Form builder | Steps rail, abstract/session target (immutable once open), field CRUD + drag reorder, all eight field types, per-field validation config, participant limits (**min speakers default 1**), lifecycle settings, duplicate, live preview that deep-equals the public form. | AC-17 – AC-21, AC-24, AC-27 – AC-33 | `src/routes/forms.routes.ts`, `forms.queries.ts`, `src/ui/forms/*` | 7 | M-09 |
| **M-13** | Uploads | `POST /uploads/sign` → presigned **PUT against `{account}.r2.cloudflarestorage.com`** (never a custom domain — trap 9), direct browser PUT with progress, `/complete` with HEAD verify + magic-byte sniff, Images variants for headshots, per-IP/per-submission caps in KV, nightly orphan sweep, separate-origin serving with `Content-Disposition: attachment`. **R2 canonical for media; Airtable only ever receives a public R2 URL (trap 10).** Turnstile is verified before a presign is issued; a magic-byte mismatch rejects **and deletes the object**. | AC-52, AC-146 – AC-148, **AC-231** (presign gate), **AC-232** | `src/routes/uploads.routes.ts`, `src/lib/r2/*` | 5 | M-01 |
| **M-14** | Public CFP form | SSR form in builder order, client-blur + server-authoritative validation, plain-language errors with focus to the first invalid field, drafts + emailed resume link + last-saved indicator, **Turnstile verified server-side before the write commits, replay-safe, no side effects on rejection (AC-231 — inside Tier A's no-waiver set)**, closed/at-limit states, confirmation screen + email, 375 px pass. | AC-25, AC-26, AC-29, AC-30 – AC-42, AC-155 – AC-157, **AC-231** | `src/routes/public-form.route.tsx`, `src/ui/public/form/*` | 7 | M-12, M-11, M-13 |
| **M-15** | Speaker portal | Status hero (most prominent, concrete next-wave date pre-decision), task list ordered by due date with textual overdue markers and completion that updates the organizer with no admin action, profile edit with crop preview, **handbook pages as static markdown per event (AC-233 — hosted on a Tier A story but below the Tier B cut line; if cut, name it in the gate report)**. | AC-43 – AC-52, **AC-233** | `src/routes/portal.routes.ts`, `src/ui/portal/*` | 6 | M-13, M-11 |
| **M-16** | Evaluation plan + committees | Plan (name, instructions, scale), scorecard with weighted rubric validated to 100 %, **rounds table exercised with two rounds from the start**, committees, assignment in both distribution modes, per-evaluator/per-submission progress. **No order-dependent step; evaluators assignable to an open plan.** | AC-53 – AC-58, AC-98 | `src/routes/evaluation.routes.ts`, `src/ui/evaluation/*` | 6 | M-08 |
| **M-17** | Reviewer queue | Own shell with no admin chrome and no reachable admin route, one card at a time, score→advance with no navigation, position/remaining + resume, keyboard 1–5, anonymity stripped **in the query layer** so exports and API are covered by construction. | AC-59 – AC-65, AC-158, AC-159 | `src/routes/review.routes.ts`, `src/ui/review/*` | 6 | M-16 |
| **M-18** | Bulk actions + acceptance cascade | Select-all-matching as a **server-side filter selector**, bulk accept/reject/waitlist/withdraw through the chunking helper, per-record success/failure summary under injected partial failure, cascade (status → portal → queued mail → task assignment), CFP stays open. | AC-66 – AC-69, AC-114 – AC-117 | `src/routes/submissions-bulk.routes.ts`, `src/jobs/cascade/*` | 5 | M-11, S-3 |
| **M-19a** | Agenda: data, pool, placement, day/list/week/room views | Unscheduled pool = accepted-and-unplaced, configurable schedulable statuses, drag pool↔slot, drop sets date/time/room, duration from format, resize, **no save button**, filters + scroll preserved across view switches. | AC-70 – AC-74, AC-80, AC-82 | `src/routes/agenda.routes.ts`, `agenda.queries.ts`, `src/ui/agenda/*` | 7 | M-16 |
| **M-19b** | Agenda: track swimlane + conflicts | True swimlane per track (own lane box per track, day bands, slot columns), conflict computation over rooms **and every participation role**, tile flags, conflicts drawer with jump-to, warn-never-block. | AC-75 – AC-79, AC-81 | `src/ui/agenda/track-board.tsx`, `src/lib/conflicts.ts` | 5 | M-19a |
| **M-20** | Public event site + permalinks | Logged-out agenda with times/rooms/tracks/speakers, day + track + search controls, session and speaker permalinks cross-linked, published-only with no URL-guess leakage, 375 px, cold <1 s. | AC-83 – AC-86 | `src/routes/public-agenda.route.tsx`, `src/ui/public/agenda/*` | 5 | M-19a |
| **M-21** | Embeds | Config screen → copyable snippet + live preview, agenda and speaker-gallery embeds filterable by track and status, responsive, configured colors, **KV TTL 30 s with explicit purge on publish** so the 60 s budget has headroom. | AC-87 – AC-90 | `src/routes/embed.routes.tsx`, `src/ui/embeds/*` | 4 | M-20 |
| **M-22** | `check:seed` + `check:speed` | Seed shape/scale assertions over the public API including the deliberate ugliness; speed harness measuring every §1.3 budget on deployed infra against the real seed, emitting `speed-report.json`. | AC-3 evidence, guardrail G7 | `scripts/checks/seed.ts`, `scripts/checks/speed.ts` | 4 | M-20 |

**CP-2 — human-visible checkpoint.** The eleven-step loop completes on the deployed preview, desktop and mobile, with zero dead ends; `trace:ac` shows every Tier A `auto` AC covered. Felt checkpoints **C2** (dashboard reads as a home) and **C3** (error and empty-state copy read aloud) run here.

---

## 5. Wave 2 — Tier B, top-down, plus the mirror

**Built in this order. The cut line moves up from the bottom.** A cut story is named in the gate report with its ACs and the reason; silently missing is a failure (`EVALUATION.md` gate 19).

Ranks are `USER_STORIES.md`'s, **as shifted by Amendment 1** — US-73 took rank 3 and US-72 took rank 7, moving the former ranks 3–23 down to 4–25. No AC ID moved.

| Rank | Story | # | Ticket | ACs | Hrs | Deps |
|---|---|---|---|---|---|---|
| 1 | US-44 | **M-23** | **Chase board** — accepted-speaker × task matrix with state glyphs, live filter chips with counts, task-type and track filters, select-all → fixed-width `Send reminder (N)`, per-row Nudge, compose drawer with template + merge preview + per-recipient outbox rows and per-speaker send log, speaker context drawer (tasks, message history, sessions, bio), live update as speakers complete tasks | AC-91 – AC-94 | 6 | M-15, M-11 |
| 2 | US-47 | **M-24** | **Calendar invites** — ICS builder (`METHOD:REQUEST`, `ATTENDEE;RSVP=TRUE`, stable `UID`, `SEQUENCE`, `DTSTAMP`, `VTIMEZONE`+`TZID`, CRLF folding), `multipart/alternative` calendar part, `METHOD:CANCEL`, Add-to-Google and Add-to-Outlook links, `/i/{uid}.ics`, single-send path at ≤10/s | AC-95 – AC-97 | 5 | M-11, S-2 |
| 3 | US-73 | *(M-03)* | **Reset the demo** — built early in Wave 0 rather than here, because the demo logins need it from the first deploy. Ranked third in Tier B; already green by CP-1. | AC-230 | — | done in Wave 0 |
| 4 | US-30 | **M-27** | Two-round funnel — per-round scorecard and evaluator set, bulk promote from a filtered round-1 list, both rounds' scores together on the record | AC-98 – AC-100 | 4 | M-16 |
| 5 | US-67 | **M-28** | Quick search — affordance on every admin route, `/` and ⌘K with no navigation, one labelled result list across submissions/speakers/sessions/forms, fuzzy on name and title, <200 ms | AC-101 – AC-104 | 4 | M-10 |
| 6 | US-68 | **M-29** | API surface completion — tokens UI, docs route linked from the sidebar, `check:api` route-manifest parity replay | AC-105 – AC-108 | 4 | M-07 |
| **7** | **US-72** | **M-25** | **Airtable mirror — outbound** — `mirror_outbox` hooks on mirrored tables, queue drain, 10-per-PATCH `performUpsert` on `marquee_id`, 4 req/s token bucket, seeded demo base, **Settings → Airtable** page (base link, both row counts, last sync, outbox depth, Sync now + live log) | **AC-225, AC-228** | 8 | M-02, M-08 |
| **7** | **US-72** | **M-26** | **Airtable mirror — inbound** — webhook receive (signature-checked, ping-only), cursor'd payload pull, allowlisted field application with non-allowlisted edits ignored and logged, `last_write_source` echo suppression, **daily keepalive cron with expiry surfaced on the settings page** (trap 7) | **AC-226, AC-227, AC-229** | 5 | M-25, S-1 |
| 8 | US-66 | **M-30** | Sessionize import — upload, column mapping with first-rows preview before any write, statuses preserved **including undecided**, bios/headshots/custom fields/relationships, historical scores attributed on email match and explicitly unattributed otherwise, idempotent re-run, per-row outcomes, single-batch undo. **Named entry point on the empty-event screen and in the README.** | AC-109 – AC-113 | 7 | M-08 |
| 9 | US-34 | **M-31** | Rejection at scale — merge fields, rendered preview of one real recipient, portal outcome, double-send impossible | AC-114 – AC-117 | 2 | M-18 |
| 10 | US-22 | **M-32** | Admin manual entry + submission record screen — create abstract or session without the public form, bypass-evaluation toggle, origin marker in lists, record with participants/answers/per-round scores/applied routing rule/history | AC-118 – AC-120 | 4 | M-08 |
| 11 | US-36 | **M-33** | Un-accept cascade — accepted → withdrawn/rejected at any point, timestamped and attributed; session leaves agenda, public surfaces and embeds; vacated slot visible; dialog enumerates portal tasks, scheduled emails and invites with cancel/retain each; `METHOD:CANCEL` for every sent invite | AC-121 – AC-124 | 5 | M-24, M-19a |
| 12 | US-46 | **M-34** | Automated triggers — all seven, each toggleable with an editable template; pre-close reminder on a configurable offset via cron + `scheduled_at` | AC-125 – AC-127 | 3 | M-11 |
| 13 | US-45 | **M-35** | Filtered group email — filter-built recipient set with count before send, preview of one real recipient, per-recipient logging on the record | AC-128 – AC-131 | 3 | M-11 |
| 14 | US-11 | **M-36** | Conditional logic — show/hide on one or many prior answers, hidden ⇒ not required and not submitted, conditions visible in the builder list | AC-132 – AC-134 | 4 | M-12 |
| 15 | US-12 | **M-37** | Category routing — rule maps track/format/vendor flag to plan or reviewer pool, applied at submit, named on the record, vendor-flag routing away from mainstage | AC-135 – AC-137 | 4 | M-16, M-14 |
| 16 | US-69 | **M-38** | `marquee` CLI — six commands, `--json` with clean stdout and logs on stderr, token auth, `--url` targeting, complete `--help` | AC-138 – AC-141 | 5 | M-29 |
| 17 | US-70 | **M-39** | `SKILL.md` + `check:skill-agent` — five workflow headings, every fenced command resolving against the CLI registry or OpenAPI, product vocabulary with banned synonyms absent, clean-agent oracle | AC-142 – AC-145 | 4 | M-38 |
| 18 | US-41 | **M-40** | Slide upload — PDF/PPTX/KEY with the limit stated before the picker, progress, recoverable failure, organizer sees it with no refresh; **allowlist + magic-byte sniff + rate caps + separate serving origin (AC-232, mechanism built in M-13)** | AC-146 – AC-148, **AC-232** | 2 | M-13 |
| 19 | US-21 | **M-41** | Co-speaker — add in-form to the configured max with a stated refusal at max+1, notification naming who added them and to what, own profile completion without editing the abstract | AC-149 – AC-151 | 4 | M-14 |
| 20 | US-37 | **M-42** | Confirm / decline — portal action visible to the program lead, **per role held**, decline notifies and flags the agenda slot | AC-152 – AC-154 | 3 | M-15 |
| 21 | US-18 | **M-43** | Mobile submit pass | AC-155 – AC-157 | 3 | M-14 |
| 22 | US-27 | **M-44** | Mobile reviewer pass | AC-158, AC-159 | 3 | M-17 |
| 23 | US-02 | **M-45** | README + self-host path + `check:readme` — numbered deploy/config/seed sequence executable verbatim with zero human input, empty-install next-action states on every route, extension points named (registration sync, Airtable mirror, calendar OAuth) | AC-160 – AC-162 | 5 | M-30 |
| 24 | US-71 | **M-46** | Comparison-mode triage — per-round mode, three at a time with ties, win-count aggregate visible to the chair, mode switch preserves the other mode's scores | AC-163 – AC-166 | 4 | M-27 |
| 25 | US-32 | **M-47** | Optional AI first pass — off by default, aid language never decision language, zero status transitions, absent from the demo path | AC-167 – AC-169 | 3 | M-17 |

**Cut-line guidance.** If Tuesday runs short, cut from **rank 25** upward. **Ranks 1–7 are not cuttable** — they are the moat, and rank 7 (US-72, the Airtable mirror) is now a story with its own ACs as well as `EVALUATION.md` gate 9 and the competition's larger stack bonus. **Rank 23 (README/self-host) is a *judged deliverable*, not a nicety**: if the cut reaches it, cut ranks 22 and 21 instead and say so in the gate report. **AC-233** (Speaker Handbook, built in M-15) is the one criterion outside this ranking that is explicitly cuttable — cutting it is acceptable only if the gate report names it with its AC ID and reason.

### Cross-cutting tickets (run alongside, not after)

| # | Ticket | Hrs |
|---|---|---|
| **M-48** | Empty-state pass — every route renders an empty-state component naming the next action on a fresh install (AC-161) | 3 |
| **M-49** | Craft sweep — elements never jump (reserved space, fixed-width toggles, `—` over removed rows, tabular numerals), one primary action per screen, textual state markers everywhere colour is used | 3 |
| **M-50** | `trace:ac` closure — every `auto` AC in scope named by at least one test; the coverage report attached to the gate | 3 |

### Audit track

Guardrail audits from `SPEC.md` §7, each owned by an auditor who did not write the code: **A-1** repo hygiene · **A-2** PROTOTYPE-badge sweep · **A-3** mail containment · **A-4** mirror isolation · **A-5** cookie scope · **A-6** speed report · **A-7** public write surface · **A-8** anonymity scan · **A-9** cross-event isolation · **A-10** bulk-write audit · **A-11** reset drill (**AC-230**). **A-1 is mandatory immediately before the public repo push and again after it.** A-7 now has ACs behind it (**AC-231, AC-232**) and A-4's isolation rule is what makes **AC-225**'s 60-second budget affordable.

---

## 6. Spikes

Three things are genuinely unproven. Each is time-boxed; each blocks a specific ticket; each fails loudly rather than leaking into a feature build.

| # | Spike | Question it settles | Box | Blocks | When |
|---|---|---|---|---|---|
| **S-1** | **Airtable webhook inbound loop** | Does the ping→list-payloads→cursor→apply loop actually work against a real base, and does our echo suppression hold when our own outbound write bounces back? Webhooks are **not data-carrying**, the payload pull spends the same 5 req/s budget, and delivery is at-least-once with up to 13 retries over a day. | 2 h | M-26 | Sunday morning |
| **S-2** | **ICS rendering in real clients** | Does a `METHOD:REQUEST` invite render as **Accept/Decline** in Gmail, Outlook, and Apple Calendar — and does a `SEQUENCE+1` update *replace* the entry rather than duplicate it, and a `CANCEL` remove it? Neither Google nor Microsoft publishes a normative statement; this is the 15 minutes that separate R3 working from R3 looking like it works. | 1 h + operator inboxes | M-24 sign-off, gate 10 | Sunday, as soon as the first invite emits |
| **S-3** | **D1 bulk-write chunking at wave scale** | Does a 150- and a 1,000-record bulk accept survive the **100-bound-parameter cap** and the per-invocation query limit, and which pattern wins — chunk at ≤90 or a single `json_each` parameter? It throws only under real data, only at scale (trap 11). | 1 h | M-18 | Saturday night, before M-18 starts |

---

## 7. Merge-friendly boundaries

Sixteen tickets writing into one repo overnight fail on shared files, not on logic.

**The rule: one file per route/module, and registration by glob, never by a hand-edited list.** Every module ships as `src/routes/<name>.routes.ts` + `<name>.queries.ts` + `src/ui/<name>/*`, and `src/routes/_manifest.ts` is *generated* at build from `import.meta.glob`. No agent ever edits a central registry to add a route. The same goes for OpenAPI: the document is assembled from route definitions, never hand-written.

**Unavoidable shared files — named, and the orchestrator serializes edits to them:**

| File | Owner | Rule |
|---|---|---|
| `migrations/0001_init.sql` | M-02 | Written once. Every later change is its own `000N_<ticket>.sql`; nobody edits 0001 after M-02 merges. |
| `wrangler.jsonc` | M-01 | All bindings declared up front so no later ticket needs to touch it. Additions serialized through the orchestrator. |
| `package.json` (scripts) | M-06 | The full eleven-command script table registered at once, stubs included. Dependency additions are the only other edits, and they queue. |
| `src/styles/tokens.css` | M-05 | Design tokens only. Per-module styles live in the module. |
| `src/db/schema.ts` | M-02 | Type mirror of 0001; later tickets append `src/db/schema.<module>.ts`. |
| `scripts/seed/index.ts` | M-04 | Orchestration only; per-entity seeders are separate files it globs. |
| `.github/workflows/ci.yml` | M-06 | Single author. |
| `README.md` | M-45 | Single author; other tickets file notes into `docs/notes/<ticket>.md` for M-45 to fold in. |

**Keyword-safe naming.** Module files carry their module name — `submissions.routes.ts`, `agenda.queries.ts`, `chase-board.view.tsx`. **No `utils.ts`, no bare `index.ts` inside a module, no `list.ts`, no `helpers.ts`** anywhere: those names collide across tickets and turn an agent's grep-and-replace into another ticket's regression. Shared helpers live in `src/lib/<specific-name>.ts` and are added, never rewritten.

---

## 8. The human track

Agents cannot do these. Each is Atin's, with the deadline that actually binds it.

**Before the first migration (tonight):**
1. **Enable and verify Workers Paid** ($5/mo). Free's 10 ms CPU will not SSR a 1,000-row table and it fails at deploy, not in dev (trap 2). **Blocks M-01's deploy gate.**
2. **Probe the R2 entitlement** — create a bucket, fetch a public object. A lapse 403s every public URL while DNS and TLS look fine, and the fix is dashboard-only (trap 4). **Re-probe on deploy day.**
3. **Confirm the Resend plan tier** (30 seconds in the dashboard). Free is 100/day; it decides whether Pro is bought for the judging window. The outbox and demo-safe allowlist are built either way (trap 3).
4. **Put the Airtable demo base on Team or above** *before* the seed script runs — Free caps at 1,000 records per base and the seed is exactly 1,000 (trap 6).

**Sunday:**
5. **Relay both clarification videos and any Discord rulings**, particularly **Q1** (Airtable primary vs mirror) and **Q2** (embeddable gallery). The Sunday video is the requirements freeze; the delta is triaged the same day, new criteria append from **AC-225**, and nothing is renumbered.
6. **Three real inboxes** for the ICS chain — one Gmail (mandatory), one Outlook, one Apple Calendar — and click **Accept** in each when S-2 fires.
7. **Sign or amend the seven *proposed* speed budgets** in `EVALUATION.md` §1.3, and rule on the seed-scale question (flag F-2) and the flag batch F-1/F-3/F-5/F-6.

**Monday:**
8. **One real Sessionize export** (any event: sessions + speakers + evaluation results). It is the only thing that proves our column fixture matches reality (AC-109, the single `op-assist` criterion).
9. **A Cloudflare API token in CI** for `check:readme`'s scratch deploy, and **a model credential** for `check:skill-agent`.

**Tuesday — the public-repo push ritual, in this order:**
10. Curate which strategy documents ship publicly (this file, `SPEC.md`, `EVALUATION.md`, `PHILOSOPHY.md` are fine; internal budget material, Stage 11 internals, and anything from `Atin/` are not).
11. Run **`npm run check:repo` over the full history**, not the tip.
12. Add **Apache-2.0 `LICENSE`** and `SEED-DATA.md`.
13. Create the **public** GitHub repo — the one deliberate exception to the privacy-by-default rule, ratified as decision 4 — push, then re-run `check:repo` against the pushed remote.
14. **Felt checkpoint C6** needs one real iPhone and one real Android; **C7** needs a person who did not build it to drive the walkthrough cold.

**Throughout:** keep token-spend evidence from day one — the $500 reimbursement is claimable on request and reconstructing proof after the fact is painful.

---

## 9. Schedule

All times PT. Deadline **Wed 2026-08-12, 22:00**.

| When | Track | Milestone |
|---|---|---|
| **Sat night → Sun 06:00** | Fleet | Wave 0. M-01 → M-02 serialized, then M-03/M-04/M-05/M-06/M-07 in parallel, M-08 last. **S-3** runs alongside. **CP-1 by ~03:00** — deployed, seeded, both demo logins live. Traps 2 and 4 dead. |
| **Sun 06:00 → 18:00** | Fleet | Wave 1. M-09/M-10/M-11/M-13/M-16 in parallel; then M-12 → M-14, M-15, M-17, M-18, M-19a → M-19b, M-20 → M-21, M-22. **S-1** and **S-2** run Sunday morning. |
| **Sun, on video drop** | Human + one agent | Sunday clarification video → **requirements freeze**. Dossier re-run, delta triaged into new AC-225+ criteria and, if needed, new tickets. Q2's ruling decides whether embeds (AC-87 – AC-90) stay or move to non-goals. |
| **Sun 18:00 → 22:00** | Human | **CP-2**: full-loop QA on the deployed preview, desktop and mobile. Felt checkpoints **C2** and **C3**. Anything red goes back to the fleet before Wave 2 widens. |
| **Sun night → Mon 12:00** | Fleet | Wave 2 ranks 1–8 — the uncuttable block (M-23, M-24, M-27, M-28, M-29) plus the **Airtable mirror at rank 7** (M-25, M-26) and the import (M-30). Rank 3 is already green from Wave 0. |
| **Mon 12:00 → Mon 23:00** | Fleet | Wave 2 ranks 9–17 (M-31 – M-39) and cross-cutting M-48/M-49/M-50. `check:speed` running on every PR against its preview. |
| **Tue 08:00 → 14:00** | Fleet | Wave 2 ranks 18–25 to the cut line; audit track A-1 – A-11; empty-state and craft sweeps close. |
| **Tue 14:00 → 18:00** | Human + auditor | **CP-3 / gate dry run** — all nineteen `EVALUATION.md` §4 gates end to end, including the Airtable round-trip (gate 9), the Gmail ICS chain (gate 10), live mail (gate 11), the agent-only run (gate 12), and the reset drill (gate 13). Felt checkpoints **C5** and **C6**. |
| **Tue 18:00 → 22:00** | Human | **Public repo push ritual** (§8 items 10–13). Production deploy. `check:readme` against the pushed repo from a clean container. |
| **Wed 08:00 → 14:00** | All | Buffer for whatever the dry run found. **Felt checkpoint C7** after the last functional change: a person who did not build it drives the walkthrough cold, narrating. Re-run `reset:demo` and gate 4 so the first judge inherits a clean demo. |
| **Wed ~18:00** | Human | **Submit** — form + public repo + deployed URL, **four hours before the deadline, not four minutes.** |

**What moves if we are behind.** The cut line, and nothing else. Tier A never yields — and its no-waiver set is `AC-1 – AC-90` **plus AC-231**, not the whole numeric range. The mirror never yields (rank 7, its own ACs, the larger stack bonus, gate 9). The README/self-host path never yields (rank 23, judged). Everything below **rank 17** is expendable in order, plus AC-233, each named in the gate report with its ACs and its reason.

---

## 10. Traps, dodged by name

Every trap in `seams-feasibility.md` §8 that touches this plan, and where it dies.

| # | Trap | Where it dies |
|---|---|---|
| 1 | OAuth calendar write | Not built. ICS `METHOD:REQUEST` is the shipped path (M-24); OAuth is a named README extension point (M-45). |
| 2 | Workers Free 10 ms CPU | Human item 1 + **M-01 deploys to the Paid plan on day one**, before any feature code. |
| 3 | Resend 100/day | **M-11 builds the outbox and demo-safe allowlist before any send path exists**, with the check in the queue consumer (guardrail G3). |
| 4 | R2 entitlement lapse | Human item 2, probed tonight and re-probed on deploy day; gate 1. |
| 5 | Fresh sending domain | Not attempted. `marquee@stage11.systems`, verified since March. |
| 6 | Airtable demo base on Free (1,000-record cap) | Human item 4, **before** M-04's seed runs. |
| 7 | Airtable webhooks expire in 7 days | Daily keepalive cron in **M-26**. |
| 8 | Airtable Team throttle at 2 req/s | Architectural: **never read Airtable on a request path** (guardrail G4, import-boundary lint). |
| 9 | Presigned URLs don't work on custom domains | **M-13** signs against `{account}.r2.cloudflarestorage.com` and serves reads from the custom domain. |
| 10 | Airtable attachment URLs expire in 2 h | R2 is canonical; the mirror receives a public R2 URL, never the reverse (M-13, M-25). |
| 11 | D1's 100-bound-parameter cap | **S-3** settles the pattern; one chunking helper in M-07; guardrail G11 tests 150 and 1,000 records. |
| 12 | D1 read replication takes 24 h to disable | Not enabled. Decision closed; no Tuesday flip. |
| 13 | Smart Placement won't help | R7 is not budgeted against it; `check:speed` measures reality. |
| 14 | Resend batch has no attachments | **Two send paths from the first commit** (M-11): batch for plain bulk, single-send ≤10/s for anything carrying an ICS. |
| 15 | `.dev` is HSTS-preloaded; parent-domain cookies leak | **M-01** sets the session cookie with no `Domain` attribute; guardrail G6 asserts it; `https://` always. |
| 16 | `api.resend.com` 403s the `Python-urllib` UA | **M-04** sets an explicit `User-Agent` on every stdlib HTTP call in seed/backfill scripts. |

---

## 11. Flags carried from `SPEC.md`

**Closed by `USER_STORIES.md` Amendment 1** — no longer open questions, now ordinary ticket work: **F-1** → US-72, AC-225 – AC-229, Tier B rank 7, built by M-25/M-26 · **F-3** → AC-233 on US-39, built by M-15, explicitly cuttable if named · **F-5** → US-73, AC-230, Tier B rank 3, built early by M-03 · **F-6** → AC-231 on US-14 (Tier A no-waiver, M-13/M-14) and AC-232 on US-41 (M-13/M-40).

**Still open — the client rules at review:** **F-2** seed scale collides with AC-3, and the build assumes seed option **A′** until told otherwise · **F-4** several loop affordances are toasts in v1.1 and are specified in `SPEC.md` §5.13 pending re-verification against the final prototype.

**Recorded decisions, not questions:** **F-7** embed KV TTL set to 30 s against AC-89's 60 s budget · **F-8** liveness is a 5 s poll, not a push channel.

---

## Amendment 2 — Discord day-1 rulings (2026-08-08 night, orchestrator)

- **M-02 (first migration) now includes `submission_tracks`** (many-to-many, `is_primary`; SPEC Amendment 2 / AC-234). Landing this before the fleet's first migration is the entire reason this amendment is time-sensitive; retrofit after dependent tickets ship is expensive.
- **New ticket M-52 — Decision feedback + email-from-review (US-74, AC-235–236), 2h, depends M-11/M-23.** Tier B rank 8; cheap, and it is a *named* bonus from the leads (dossier R51).
- **Cut-pressure relief, recorded:** the leads' stated floor is narrower than our Tier A (review floor = approve/maybe/deny; agenda floor = day/room + DnD + conflicts; five views confirmed bonus). Tier A does not shrink — it is our margin of victory — but if Tuesday goes badly, this is the honest fallback line.
- **Kickoff prompt note:** swyx called the competition "somewhat of a recruiting exercise" and entertained judging maintainability ("have them demo implement a change"). Code legibility is part of the deliverable: clean module boundaries, a real CONTRIBUTING section, no clever-but-opaque constructs.

## Amendment 3 — full-brief recovery (2026-08-08 night, orchestrator)

- **API bonus is explicit in the full brief (R53):** US-68's API ticket is confirmed inside the uncuttable block — it now carries brief-bonus sourcing, not just philosophy. CLI/SKILL (US-69/70) keep their ranks.
- **Speaker talk-content editing (AC-237):** fold into the portal ticket's scope (+1h) — editable title/description while CFP open, org re-open toggle, history stamp.
- **Speed re-sourced as MUST *and* explicit bonus** — no change, it was already the thesis.
- **Relief recorded:** analytics dashboards are "optional/best efforts" in the brief annotations; embeds are marked "(OPTIONAL)" — Q2 resolves to *build by default, safely cuttable under pressure*; success page + confirmation email annotated must-work (already Tier A).
- **R54 — "very teeny bonus" for hosting on Forge (swyx's side project) instead of GitHub:** client call at push time; a mirror is ~20 min.
- **Incumbent-fidelity notes held pending rulings** (kyzo's asked questions): rich-text bios/descriptions, accept/decline-queue literal statuses (our outbox + wave planner covers the job), central file-request pages. No contract change until answered; JTBD over fidelity (R26).

## Amendment 4 — Q1 positioning + seed content (2026-08-08 late night, orchestrator)

- **Forge mirror (R54): DEFERRED by Atin** — revisit at the Tuesday public push at most; no ticket.
- **Saturday video confirmed absent** — the polished walkthrough consolidates into Sunday's freeze video; single video watch (Discord Intel owns it). Sunday absorption window in the schedule bands stands.
- **M-45 README bonus story reframed** (SPEC Amendment 4): lead with Cloudflare + the explicit API bonus (R53); present the Airtable mirror as a deliberate engineering trade — *"your team keeps its Airtable view without paying its latency"* — never as a claim to the source-of-truth bonus.
- **M-04 seed carries swyx's named task templates**: "Hotel and Travel Reservations" (form) + "Presentation Upload" (file request) leading every accepted speaker's list, plus the optional four across a subset (SPEC §6).
- **Waitlisted displays as "Maybe"** on chips/filters (SPEC vocabulary note).

## Amendment 5 — client v1.2 review feedback (2026-08-09, orchestrator)

- **New ticket M-53 — Program board (US-75, AC-238–239), 4h, depends M-11** (list actions/cascades reused). Tier B, insert at rank 9 behind US-74.
- **AC-240 folds into existing tickets**: slot chips + "Not yet public" into the submissions-list and record tickets; stage sub-labels into the dashboard ticket; publish affordance into the agenda/publish ticket. +1h total, spread.
- **M-04 seed**: multi-track distribution (≥15%, ≥3 accepted+scheduled two-track sessions) asserted by `check:seed`.

---

*Draft, 2026-08-08 (Amendment 2 applied). The orchestrator finalizes this with the client after the v1.1 prototype review, then turns §3–§5 into Lattice tickets.*
