# Marquee — Build Plan

**Status:** v1.4 contract revision for client prototype review · updated 2026-08-09; do not dispatch until the prototype is signed and `DESIGN.md` exists.
**Reads with:** `SPEC.md` (what it is) · `EVALUATION.md` (what "done" means) · `sequence/USER_STORIES.md` (249 live criteria through AC-250; AC-239 struck) · `sequence/research/seams-feasibility.md` (limits, hour estimates §9, the 16 deadline traps §8).
**Folded through 2026-08-09** against `USER_STORIES.md` Amendments 1–9: reviewer detail/recommendation/track authority are Tier A; decision feedback/talk editing, Program board, webhooks/scoped tokens, saved views/configurable columns/Draft queue, and agent-composed sends (**AC-250**, M-35/M-38) are Tier B. Ticket ACs, ordering, and the cut line below reflect that fold.
**Deadline:** **Wed 2026-08-12, 22:00 PT.** **The window is measured from dispatch, not from this file's timestamp**, and it shrinks hour for hour until the fleet starts: ~86 h remain as of Sunday 2026-08-09 08:00 PT, ~74 h from a Sunday 20:00 dispatch. §9's checkpoints are therefore all expressed as **dispatch + N hours** (`D+N`). A wall-clock schedule anchored to a night that has already passed is worse than no schedule — the fleet reads §9 as its clock, and the cut-line decision keys off it.

Hours below are **agent-hours**, not wall-clock. The fleet runs ~4–6 delegators in parallel; **wall-clock is the critical path through the dependency graph, not the sum** — a 13-hour serial chain is 13 hours no matter how many workers are idle beside it. Neither figure includes the delegator's own plan → implement → review → fix loop, so treat every estimate as optimistic.

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
| **0 · Walking skeleton** | **CP-1** | A deployed URL on the real plan, on the real seed, with both demo logins and one real loop screen. Traps 2 and 4 are dead at **D+13**, not on Tuesday. Felt checkpoint **C1** can run. |
| **1 · The loop** | **CP-2** | All eleven walkthrough steps complete on the deployed preview with zero dead ends. The full Tier-A no-waiver set — AC-1–90 plus AC-231, AC-234, AC-240, and AC-244–246 — is green. Checkpoints **C2, C3** can run. |
| **2 · Differentiators** | **CP-3** | Tier B built top-down to the cut line, the Airtable round-trip demonstrable, the gate rehearsed. Checkpoints **C5, C6, C7**. |

**The walking skeleton goes first and it goes at dispatch.** It is not a nicety: deploying to the real Workers Paid plan on day one is the only way to discover the 10 ms CPU ceiling (trap 2) and a lapsed R2 entitlement (trap 4) while there is still time, because neither is visible in local dev.

---

## 3. Wave 0 — walking skeleton (D+0 → D+13)

Serialized where marked; everything else runs in parallel.

| # | Ticket | Scope | ACs | File surface | Hrs | Deps |
|---|---|---|---|---|---|---|
| **M-01** | **Platform skeleton & first real deploy** | Repo, `wrangler.jsonc` with every binding (D1, R2, KV, Queue, cron, Turnstile secrets), Vite + TS, Hono entry, health route, custom domain `marquee.stage11.dev`, **deploy to the Paid plan before anything else lands**. `https://` only; session cookie helper with **no `Domain` attribute**. | — | `wrangler.jsonc`, `package.json`, `vite.config.ts`, `src/index.ts`, `src/lib/cookies.ts` | 3 | — |
| **M-02** | **Migration `0001_init.sql` — the whole schema** ⛔serialized | Every table in `SPEC.md` §3 in one migration, including `submission_tracks`, `submission_decisions`, `reviewer_track_scopes`, `saved_views`, and `form_admins`; indexes for submissions/status/kind, track intersections, reviewer scopes, saved-view ownership, participations, tasks, agenda, outbox, and evaluation uniqueness. **`outbox.send_policy TEXT NOT NULL DEFAULT 'demo_safe'` (`demo_safe|always_live`) lands in this migration** — it is what lets the queue consumer implement G3's tested exception (B-8). **Status enum complete including `waitlisted`; `(person, submission, role)` triple; round-aware evaluation; event + explicit-track reviewer authority from day one.** | AC-176, AC-212, AC-214, AC-222, **AC-234, AC-235, AC-246–249** | `migrations/0001_init.sql`, `src/db/schema.ts` | 4 | M-01 |
| **M-03** | **Auth, demo entry, reset-demo** | Magic links (256-bit random, hash stored, single-use, 15-min TTL), session cookie middleware, bearer-token middleware, scope resolution from `memberships`, **one-click organizer/speaker demo login — `POST /api/v1/auth/demo` 403s and sets no cookie unless the target event's `demo_mode = 1`** (SPEC §4.1, guardrail G6/A-5), on-screen magic link in demo mode, **auth mail (`magic_link_login`, `draft_resume`, `task_link`) enqueues an `outbox` row and never calls Resend directly — the queue consumer is the only sender (G3/A-3)**, `POST /admin/reset-demo` + product button + `npm run reset:demo` (idempotent, safe mid-judging, never partially-reset — **US-73 ranks in Tier B but is built here**, because the demo logins need it from the first deploy). **The route enqueues the reseed to a Queue and returns a job id the button polls**, and the reseed writes with `suppress_mirror` so it does not re-queue the entire Airtable base, enqueuing **one** reconcile job at the end (§3.9/§4.1). | AC-1, AC-2, AC-107, AC-214, **AC-230** | `src/routes/auth.routes.ts`, `src/lib/auth/*`, `src/routes/admin-ops.routes.ts` | 4 | M-02 |
| **M-04a** | **Seed generator — spine** ⛔on the critical path | `scripts/seed/` skeleton from `sources/aie-summit-2025-program.json`: event, formats, tracks, rooms, waves, task templates, and the **60-session real accepted core** with its speakers and participations. Idempotent; `npm run seed`; `reset:demo` calls it. **Placeholder avatars only; no real emails; no real headshots.** Deliberately small so it does not sit on M-08's critical path. | AC-8 | `scripts/seed/index.ts`, `scripts/seed/event.ts`, `scripts/seed/accepted-core.ts`, `src/lib/ids.ts` | 2 | M-02 |
| **M-04b** | **Seed generator — pool, evaluation, ugliness** | The 940-row rejected/pending pool including ~40 incomplete Drafts, multi-track distribution (≥15%; ≥3 scheduled), participations, tasks, evaluations/recommendations, agenda with **two live double-bookings**, and the deliberate ugliness list. **Seeds the *demo organizer* persona a `reviewer` membership on the demo event, `reviewer_track_scopes` covering every track, and round-1 `round_assignments` over ~40 unreviewed submissions** — so the Review queue the admin sidebar links opens populated instead of on "no matching track scope", and AC-62's 20-advance speed run has material (B-3). Runs in parallel with M-09/M-10; off the CP-1 chain. | AC-3, **AC-234, AC-245, AC-246, AC-249** | `scripts/seed/pool.ts`, `scripts/seed/evaluations.ts`, `scripts/seed/agenda.ts`, `scripts/seed/ugliness.ts` | 5 | M-04a |
| **M-05a** | **Design system + admin shell** | Tokens + component CSS lifted verbatim from the v1.1 prototype; sidebar (home, seven pipeline stages, modules, footer), topbar with search affordance, toast host, drawer/modal hosts, route table. | — | `src/styles/tokens.css`, `src/ui/shell/*` | 2 | M-01 |
| **M-05b** | **Landing page** | **Public landing with both demo entries** and the live pipeline preview carrying **real counts from the seed** — §5.1 has no loading state because the counts are server-rendered, and AC-2 requires both demo buttons to land on a populated screen. Split from M-05a (F-16) because the seed is M-04a/b, the demo login is M-03, and the first populated screen is M-08: built against M-01 alone, this ticket merges green against zeros and asserts AC-1/AC-2 on a page that cannot yet be true. | AC-1, AC-2, AC-4 | `src/routes/landing.route.tsx` | 2 | M-03, M-04a, M-05a |
| **M-06** | **Harness skeleton** ⛔serialized on `package.json` | **All thirteen** `EVALUATION.md` commands registered up front (stubs where empty) — the ten §1.1 rows `test`, `e2e`, `check:speed`, `check:seed`, `check:api`, `check:repo`, `check:readme`, `trace:ac`, **`check:mirror`**, `reset:demo`, plus the three §1.5 smokes `smoke:mail`, `smoke:ics`, `check:skill-agent`. `package.json` is M-06-owned and its edits serialize through the orchestrator, so M-25/M-26 cannot self-register `check:mirror` later — without it here, gate 9 and AC-225–229 name a command that exists in the contract and in no `package.json`. `trace:ac` ships both `--scope=merged` (PR default) and `--scope=all` (gate). **`check:api` skips its CLI-registry parity assertion with a printed notice until `cli/` exists** (M-38) — the served-JSON/rendered-docs half runs from the first PR; the three non-`/api/v1` calendar and feed URLs (SPEC §4.2) are a named allowlist. Vitest + `@cloudflare/vitest-pool-workers`, Playwright desktop+mobile projects, `trace:ac` scanner, `check:repo` (gitleaks + badge + `Atin/` + history scan), CI. **`npm test` budget ≤30 s from the first commit.** | — | `package.json`, `vitest.config.ts`, `playwright.config.ts`, `scripts/checks/*`, `.github/workflows/ci.yml` | 4 | M-01 |
| **M-07** | **API core** | Hono router with a generated route manifest (glob, never a hand-edited list), error envelope, list contract (`page/per_page/q/sort/filters` → `{data,page,per_page,total}`), pagination helper, **bulk selector type (ids *or* filter)**, `json_each` chunking helper, OpenAPI assembly from route definitions, `/api/openapi.json`, `/api/docs`. **The chunking helper's default pattern is S-3's verdict** — M-07 must not pick one before the spike answers (trap 11). | AC-105, AC-106, AC-108 | `src/api/*`, `src/routes/_manifest.ts` (generated) | 4 | M-02, **S-3** |
| **M-08** | **First loop screen: submissions list** | Server-side filtered/sorted/paginated list at 50/page over the seed, type/status/track filters including Draft, selection state, exact record navigation, empty state, and the stable column registry that M-55 configures. Proves the whole stack end to end on real data. | AC-23, part AC-66, foundation **AC-240, AC-247–249** | `src/routes/submissions.routes.ts`, `submissions.queries.ts`, `src/ui/submissions/*` | 4 | M-04a, M-05a, M-07 |

**M-04 is split** (adversarial B-5): **M-04a** carries only what M-08 needs, so the Wave 0 critical chain runs M-01 (3) → M-02 (4) → M-07 (4) → M-08 (4) = **15 h** (corrected at intake 2026-08-09: M-07 is also gated on M-02 and also blocks M-08, so it — not M-04a's 2 h — sets the chain; the split still saves 3 h against the unsplit 18 h seed path). **M-04b** runs in parallel with Wave 1's opening tickets. Where §7, §10, and the amendment log say "M-04", read the pair.

**CP-1 — human-visible checkpoint.** Deployed URL, populated, both demo logins land on a real screen, `npm test` green in <30 s, `check:repo` clean. **Traps 2, 4, 15 closed.** Felt checkpoint **C1** runs here (a stranger opens it cold and answers three questions in 10 s).

---

## 4. Wave 1 — the loop, in walkthrough order (D+13 → D+36)

The order below is the judge's order. **A chain has no most-important link**: nothing in Wave 2 starts while a Wave 1 ticket is red.

| # | Ticket | Scope | ACs | File surface | Hrs | Deps |
|---|---|---|---|---|---|---|
| **M-09** | Event settings | Event details (incl. timezone driving every rendered time and ICS `DTSTART`), formats with default durations, tracks with colors + reorder, rooms with capacity. Save confirms in place, no reload. | AC-5 – AC-13 | `src/routes/event-settings.routes.ts`, `src/ui/settings/*` | 4 | M-08 |
| **M-10** | Program dashboard | Seven-stage pipeline card (every count clickable to the filtered list behind it), Scheduled/Published explanatory sub-labels, attention strip, wave planner, work-in-motion metrics, speaker-task preview. 5 s SWR poll for liveness. | AC-14 – AC-16, **AC-240** | `src/routes/dashboard.routes.ts`, `src/ui/dashboard/*` | 4 | M-08 |
| **M-11** | **Email core + demo-safe outbox** ⚠️ before any send path | Template store, `{{merge}}` renderer, `outbox` table writes with `idempotency_key`, queue consumer as **the single choke point** that calls Resend, demo-safe allowlist enforced *in the consumer* as one rule — **suppress unless `send_policy='always_live'` or `to_email` ∈ allowlist** — with `always_live` written by exactly two call sites (the public-form confirmation for an address typed in that request, and the `smoke:mail`/`smoke:ics` harness); the auth trigger keys `magic_link_login`, `draft_resume`, `task_link` exist from the first commit so **no route ever has a reason to call Resend directly**; `Idempotency-Key` header, two send paths from the start (**batch for plain bulk, single-send ≤10/s for anything carrying an ICS** — trap 14), comms log screen with rendered previews. | AC-33, AC-117, AC-125 – AC-131 foundation | `src/jobs/mail/*`, `src/routes/comms.routes.ts`, `src/ui/comms/*` | 6 | M-02, M-07 |
| **M-12** | Form builder + catalog | Multiple independent event forms with name/kind/status/visibility/response count; new + duplicate (fields/rules, never responses); steps rail, immutable post-open target, all field CRUD/types, per-field validation, participant limits, form admins, lifecycle/open-close-reopen settings, and deep-equal live preview. Seeded baseline visibly includes title/abstract/outcome/format/multi-track, primary speaker profile/headshot, co-speaker, supporting file, and conditional vendor field. **Owns the condition *evaluator* (+2h, moved out of M-36 by B-7):** the `form_fields.condition` schema shape, the shared `isFieldApplicable()` helper in `src/lib/form-conditions.ts`, client show/hide, and the server rule that a hidden field is neither required nor persisted. The evaluator is load-bearing for a Tier A screen on M-14 and for M-55's applicable-missing-fields computation, both of which land before rank 17 — building it here is what stops M-14 hardcoding a vendor conditional that M-36 would then have to unpick. | AC-17 – AC-21, AC-24, AC-27 – AC-33, **AC-132, AC-133, AC-234** | `src/routes/forms.routes.ts`, `forms.queries.ts`, `src/lib/form-conditions.ts`, `src/ui/forms/*` | 10 | M-09 |
| **M-13** | Uploads | `POST /uploads/sign` → presigned **PUT against `{account}.r2.cloudflarestorage.com`** (never a custom domain — trap 9), direct browser PUT with progress, `/complete` with HEAD verify + magic-byte sniff, Images variants for headshots, per-IP/per-submission caps in KV, nightly orphan sweep, separate-origin serving with `Content-Disposition: attachment`. **R2 canonical for media; Airtable only ever receives a public R2 URL (trap 10).** Turnstile is verified before a presign is issued; a magic-byte mismatch rejects **and deletes the object**. | AC-52, AC-146 – AC-148, **AC-231** (presign gate), **AC-232** | `src/routes/uploads.routes.ts`, `src/lib/r2/*` | 5 | M-01 |
| **M-14** | Public CFP form | SSR form in builder order with the complete participant/profile/file/conditional path; client-blur + server-authoritative validation; drafts + emailed resume link + restored values/files; **Turnstile server-side before every write/presign**; real open, closed, at-limit, resumed, submitted, and re-opened states; confirmation email; 375 px pass. **The vendor conditional renders through M-12's `isFieldApplicable()` helper — it is an ordinary schema-driven field, never a hardcoded alternate form (SPEC §5.4/§5.5).** M-14 exercises **AC-132/AC-133** on the public surface; M-12 owns those IDs for `trace:ac`. | AC-25, AC-26, AC-29, AC-30 – AC-42, AC-155 – AC-157, **AC-231, AC-234** | `src/routes/public-form.route.tsx`, `src/ui/public/form/*` | 8 | M-12, M-11, M-13 |
| **M-15** | Speaker portal | Status hero and concrete wave/slot; task list where acknowledge/form/file open and validate their actual payload surface; profile/headshot edit; organizer-controlled talk title/description edit + history; handbook pages (AC-233 cuttable if named). **Does not own AC-235/236** — it renders the decision-feedback slot that M-52 fills, and **role confirm/decline is M-42's** (AC-152–154, rank 23), not duplicated here in prose. Three tickets writing `src/ui/portal/*` against one AC is exactly the failure §7 exists to prevent, and an AC owned by everyone is owned by no one when `trace:ac` asks who covers it. | AC-43 – AC-52, **AC-237, AC-240**, AC-233 | `src/routes/portal.routes.ts`, `src/ui/portal/*` | 7 | M-13, M-11 |
| **M-16** | Evaluation plan + committees | Plan, optional weighted scorecard, two rounds, committees, both assignment modes, per-reviewer progress, and explicit one-or-more reviewer track responsibilities editable by managers. One centralized intersection helper is exported for M-17 and audits. | AC-53 – AC-58, AC-98, **AC-246** | `src/routes/evaluation.routes.ts`, `src/lib/reviewer-scope.ts`, `src/ui/evaluation/*` | 7 | M-08 |
| **M-17** | Reviewer queue | Own shell; queue constrained by track intersection; one card opens full evaluator-visible fields/files and returns to the same index; primary **Approve/Maybe/Deny** recommendation saves without a numeric score; optional scorecard; resume/advance; blind identity stripped in query layer; **`GET /rounds/:id/export?format=csv` ships (+1h) — AC-64 and AC-246 both assert over "every export" and there was no reviewer export route to scan**; detail/file/export/write routes all use M-16's helper. | AC-59 – AC-65, AC-158, AC-159, **AC-244–246** | `src/routes/review.routes.ts`, `src/ui/review/*` | 9 | M-16 |
| **M-18** | Bulk + record-owned decisions and cascade | Select-all-matching as server selector; bulk accept/reject/waitlist/withdraw, **each transition into `accepted|waitlisted|rejected` writing a `submission_decisions` row (feedback null) so bulk and record decisions share one render path**; per-record results; record-owned Approve/Maybe/Deny confirmation **invoking M-52's decision write** (M-52 owns AC-235/236 end to end — schema use, render-once, portal display, record log — and M-18 calls it); cascade (status → portal → rendered mail → tasks), CFP stays open. | AC-66 – AC-69, AC-114 – AC-117, **AC-243** | `src/routes/submissions-bulk.routes.ts`, `src/routes/submission-decisions.routes.ts`, `src/jobs/cascade/*` | 6 | M-11, S-3 |
| **M-19a** | Agenda: data, pool, placement, day/list/week/room views | Unscheduled pool = accepted-and-unplaced, configurable schedulable statuses, drag pool↔slot, drop sets date/time/room, duration from format, resize, **no save button**, filters + scroll preserved across view switches. **The unscheduled pool is derived from status** (accepted-and-unplaced), so a live M-18 accept flows into it with no code dependency — which is why this ticket depends on M-08's list/queries and **not** on M-16's evaluation plan. That dependency was serializing the whole agenda branch behind evaluation and made M-08 → M-16 → M-19a → M-20 → M-22 the longest chain in Wave 1; removing it is the single cheapest schedule win available (F-17). | AC-70 – AC-74, AC-80, AC-82 | `src/routes/agenda.routes.ts`, `agenda.queries.ts`, `src/ui/agenda/*` | 7 | **M-08** |
| **M-19b** | Agenda: track swimlane + conflicts | True swimlane per track (own lane box per track, day bands, slot columns), conflict computation over rooms **and every participation role**, tile flags, conflicts drawer with jump-to, warn-never-block. | AC-75 – AC-79, AC-81 | `src/ui/agenda/track-board.tsx`, `src/lib/conflicts.ts` | 5 | M-19a |
| **M-20** | Public event site + permalinks | Logged-out agenda with times/rooms/tracks/speakers, day + track + search controls, session and speaker permalinks cross-linked, published-only with no URL-guess leakage, scheduled-but-unpublished distinction, 375 px, cold <1 s. | AC-83 – AC-86, **AC-240** | `src/routes/public-agenda.route.tsx`, `src/ui/public/agenda/*` | 5 | M-19a |
| **M-21** | Embeds | Config screen → copyable snippet + live preview, agenda and speaker-gallery embeds filterable by track and status, responsive, configured colors, **KV TTL 30 s with explicit purge on publish** so the 60 s budget has headroom. | AC-87 – AC-90 | `src/routes/embed.routes.tsx`, `src/ui/embeds/*` | 4 | M-20 |
| **M-22** | `check:seed` + `check:speed` | Seed shape/scale assertions over the public API including the deliberate ugliness **and the assertion that the organizer demo persona's review queue returns ≥20 unreviewed candidates** (B-3 — the check that keeps walkthrough step 8 from going dead); speed harness measuring every §1.3 budget on deployed infra against the real seed, emitting `speed-report.json`. | AC-3 evidence, guardrail G7 | `scripts/checks/seed.ts`, `scripts/checks/speed.ts` | 4 | M-20 |

**CP-2 — human-visible checkpoint.** The eleven-step loop completes on the deployed preview, desktop and mobile, with zero dead ends; `trace:ac` shows every Tier A `auto` AC covered. Felt checkpoints **C2** (dashboard reads as a home) and **C3** (error and empty-state copy read aloud) run here.

---

## 5. Wave 2 — Tier B, top-down, plus the mirror

**Built in this order. The cut line moves up from the bottom of the *remaining band*.** A cut story is named in the gate report with its ACs and the reason; silently missing is a failure (`EVALUATION.md` gate 19).

**🔒 Tickets backing an `EVALUATION.md` §4 gate are never in the band.** A gate is unconditional — "a failure stops the gate; it is not noted and passed over" (§4) — so a rule that permits cutting the ticket behind it is not a cut rule, it is a contradiction that resolves differently depending on which file the auditor is holding. Three tickets are therefore built out of rank order, ahead of the band, and are marked 🔒 below: **M-45** (README/self-host, gate 14), **M-38** and **M-39** (CLI + `SKILL.md`, gate 12). They keep their rank numbers — rank is the story's differentiator ordering and gate 19 still records the cut line by rank — but they are not cuttable and their position in this table is their build position, not their rank position. **M-56** (public-repo assembly, gate 16) is 🔒 for the same reason and lives in the cross-cutting table.

Ranks are `USER_STORIES.md`'s after Amendments 1–9. US-76 sits after US-67; US-74/75 sit after US-72. No AC ID moved or was reused; AC-239 is a tombstone. **This table is the single authority for rank, hours, and deps**; where an amendment below quotes an estimate or a dependency, this table wins.

| Rank | Story | # | Ticket | ACs | Hrs | Deps |
|---|---|---|---|---|---|---|
| 1 | US-44 | **M-23** | **Chase board** — accepted-speaker × task matrix with state glyphs, live filter chips with counts, task-type and track filters, select-all → fixed-width `Send reminder (N)`, per-row Nudge, compose drawer with template + merge preview + per-recipient outbox rows and per-speaker send log, speaker context drawer (tasks, message history, sessions, bio), live update as speakers complete tasks | AC-91 – AC-94 | 6 | M-15, M-11 |
| 2 | US-47 | **M-24** | **Calendar invites** *(written against S-2's verdict, which returned at D+2)* — ICS builder (`METHOD:REQUEST`, `ATTENDEE;RSVP=TRUE`, stable `UID`, `SEQUENCE`, `DTSTAMP`, `VTIMEZONE`+`TZID`, CRLF folding), `multipart/alternative` calendar part, `METHOD:CANCEL`, Add-to-Google and Add-to-Outlook links, `/i/{uid}.ics`, single-send path at ≤10/s | AC-95 – AC-97 | 5 | M-11, S-2 |
| 3 | US-73 | *(M-03)* | **Reset the demo** — built early in Wave 0 rather than here, because the demo logins need it from the first deploy. Ranked third in Tier B; already green by CP-1. | AC-230 | — | done in Wave 0 |
| 4 | US-30 | **M-27** | Two-round funnel — per-round scorecard and evaluator set, bulk promote from a filtered round-1 list, both rounds' scores together on the record | AC-98 – AC-100 | 4 | M-16 |
| 5 | US-67 | **M-28** | Quick search — affordance on every admin route, `/` and ⌘K with no navigation, one labelled result list across submissions/speakers/sessions/forms, fuzzy on name and title, <200 ms | AC-101 – AC-104 | 4 | M-10 |
| 6 | US-76 | **M-55** | **Saved views, configurable columns, Draft queue** — personal event-scoped view CRUD captures query/filters/sort/column order; immutable built-ins; fixed column registry with Title mandatory; `Drafts needing attention` count/contact/last-save/applicable-missing-fields **computed through M-12's `isFieldApplicable()` helper, never against the full required set** (a draft must not be marked incomplete for a field its submitter can never see); opening/editing never submits; form-admin/program-staff authorization | **AC-247–249** | 6 | M-08, M-12 (`src/lib/form-conditions.ts`) |
| **26 🔒** | US-02 | **M-45** | **README + self-host + executable clean-checkout deploy, empty states, extension points** — states that demo login is a `demo_mode`-only affordance and how to turn it off (B-2). **Backs gate 14 (`check:readme`); never in the cut band.** Built here rather than at rank 26: it depends on M-30 only for the import section, which is written against `fixtures/sessionize/*` and folded to M-30's real text later. | AC-160 – AC-162 | 5 | M-08 (a deployable, seeded app to document). **Not M-30**: the import section is written against `fixtures/sessionize/*` and reconciled with M-30's real text when M-30 lands — that dependency is what pinned M-45 to rank 26 behind the cut line. |
| 7 | US-68 | **M-29** | API surface completion — scoped token UI and effective grant∩membership, docs route linked from sidebar, `check:api` route-manifest parity | AC-105 – AC-108, **AC-242** | 5 | M-07 |
| **19 🔒** | US-69 | **M-38** | **`marquee` CLI** — six commands, clean JSON stdout, token/url targeting, complete help; `remind --filter (--template <key> | --subject <s> --body <b>)` against M-35's `POST /comms/send`. **Backs gate 12 (`check:skill-agent`); never in the cut band.** | AC-138 – AC-141, **AC-250** (CLI half) | 5 | M-29 |
| **20 🔒** | US-70 | **M-39** | **`SKILL.md` + clean-agent oracle** — workflow headings, commands resolve, vocabulary, API-only operation. **Backs gate 12; never in the cut band.** | AC-142 – AC-145 | 4 | M-38 |
| 7 | US-68 | **M-54** | Signed outbound webhooks — endpoint CRUD/test/log, six-event allowlist, queue retry/backoff, HMAC over `id.timestamp.body`, replay idempotency; cannot begin until CP-2/Tier A is green | **AC-241** | 4 | M-07, CP-2 |
| **8** | **US-72** | **M-25** | **Airtable mirror — outbound** — change feed, 10-per-PATCH upserts, token bucket, seeded base, Settings status/live log | **AC-225, AC-228** | 8 | M-02, M-08 |
| **8** | **US-72** | **M-26** | **Airtable mirror — inbound** — signed webhook ping/payload pull, allowlist, echo suppression, keepalive/expiry; **an inbound status change sets status + `last_write_source='airtable'` and does *not* run the acceptance cascade** — the record surfaces "changed in Airtable · cascade not run" with a one-click "run onboarding cascade" for a program lead (SPEC §3.9) | **AC-226, AC-227, AC-229** | 5 | M-25, S-1 |
| 9 | US-74 | **M-52** | Decision feedback + email from record/review — **sole owner of AC-235/236 end to end**: the `submission_decisions` write, the render-once into the outbox, the portal display from that same row, and the record log. M-15 renders the slot and M-18 calls the write; neither claims the IDs. One-off templated email logged on the record. | **AC-235, AC-236** | 3 | M-11, M-15, M-17, M-32 |
| 10 | US-75 | **M-53** | Read-only Program board — every non-draft submission once across seven stages, full filters/count/reset, card click/Enter/Space to record, no drag/actions on cards, record owns confirmations/cascades; virtualized at seed scale | **AC-238, AC-243** | 4 | M-08, M-32 |
| 11 | US-66 | **M-30** | Sessionize import — mapping preview, relationships/scores/statuses, idempotent outcomes, batch undo, named empty-state/README entry | AC-109 – AC-113 | 7 | M-08 |
| 12 | US-34 | **M-31** | Rejection at scale — merge fields, real rendered preview, portal outcome, double-send impossible | AC-114 – AC-117 | 2 | M-18 |
| 13 | US-22 | **M-32** | Admin create + record — abstract/session, bypass, origin, participants/answers/scores/routing/history, scheduled slot visibility, stage actions on record | AC-118 – AC-120, **AC-240, AC-243** | 5 | M-08 |
| 14 | US-36 | **M-33** | Un-accept cascade — attributed reversal; agenda/public removal; dependent tasks/mail/invites choices; calendar cancellation | AC-121 – AC-124 | 5 | M-24, M-19a |
| 15 | US-46 | **M-34** | Automated triggers — seven toggleable templates; configurable pre-close cron | AC-125 – AC-127 | 3 | M-11 |
| 16 | US-45 | **M-35** | Filtered group email — counted selector, real-recipient preview, per-recipient record logging; **owns the single send route `POST /events/:id/comms/send` `{selector, template_key?, subject?, body?}` — exactly-one-of enforced server-side, merge fields render in both, ad-hoc sends log identically** (there is no `/messages/send`; one operation, one path) | AC-128 – AC-131, **AC-250** | 4 | M-11 |
| 17 | US-11 | **M-36** | Conditional logic — **builder-list summary affordance only**: conditions visible in the field list without opening a field. The evaluator (schema, `isFieldApplicable()`, client show/hide, hidden-not-required) is M-12's, built in Wave 1. | AC-134 | 1 | M-12 |
| 18 | US-12 | **M-37** | Category routing — track/format/vendor → plan/pool, stamped rule, any-carried-track match | AC-135 – AC-137, **AC-234** | 4 | M-16, M-14 |
| 19 | US-69 | *(M-38)* | **`marquee` CLI** — promoted 🔒 out of the cut band; built directly after M-29. Rank retained for gate 19's cut-line record. | AC-138 – AC-141, AC-250 | — | built above |
| 20 | US-70 | *(M-39)* | **`SKILL.md` + clean-agent oracle** — promoted 🔒 out of the cut band; built directly after M-38. | AC-142 – AC-145 | — | built above |
| 21 | US-41 | **M-40** | Slide upload — file types/limit/progress/recovery/live organizer view; upload safety from M-13 | AC-146 – AC-148, **AC-232** | 2 | M-13 |
| 22 | US-21 | **M-41** | Co-speaker — max enforcement, notification, own-profile completion | AC-149 – AC-151 | 4 | M-14 |
| 23 | US-37 | **M-42** | Confirm / decline — visible to lead, per role, decline notifies/flags agenda | AC-152 – AC-154 | 3 | M-15 |
| 24 | US-18 | **M-43** | Mobile submit pass | AC-155 – AC-157 | 3 | M-14 |
| 25 | US-27 | **M-44** | Mobile reviewer pass | AC-158, AC-159 | 3 | M-17 |
| 26 | US-02 | *(M-45)* | **README + self-host** — promoted 🔒 out of the cut band; built directly after M-55. Rank retained for gate 19's cut-line record. | AC-160 – AC-162 | — | built above |
| 27 | US-71 | **M-46** | Comparison mode — three-card ranking/ties, win aggregate, mode switch preserves evidence | AC-163 – AC-166 | 4 | M-27 |
| 28 | US-32 | **M-47** | Optional AI first pass — off, aid-only language, zero status changes, absent from demo path | AC-167 – AC-169 | 3 | M-17 |

**Cut-line guidance.** The cut line runs up from the bottom of the **remaining band** — the tickets still unbuilt, excluding the 🔒 gate-backing set (M-45, M-38, M-39, M-56), which is built ahead of the band and is never cuttable at any pressure. Within the band, cut from **rank 28** upward. The moat/API/mirror block through rank 8 remains protected. AC-233 is independently cuttable only when named. Tier A never yields, regardless of rank arithmetic.

**When the line moves is a calculation, not a mood.** At each Wave 2 band boundary in §9, compare the remaining band's agent-hours against remaining fleet capacity (workers × wall-hours left before the CP-3 dry run). If demand exceeds capacity, cut from the bottom of the band until they match, and name every cut ticket with its ACs and reason in the gate report. A time-triggered "if Tuesday runs short" leaves the decision to whoever notices first.

### Cross-cutting tickets (run alongside, not after)

| # | Ticket | Hrs |
|---|---|---|
| **M-48** | Empty-state pass — every route renders an empty-state component naming the next action on a fresh install (AC-161) | 3 |
| **M-49** | Craft sweep — elements never jump (reserved space, fixed-width toggles, `—` over removed rows, tabular numerals), one primary action per screen, textual state markers everywhere colour is used | 3 |
| **M-50** | `trace:ac` closure — every live `auto` AC in scope named by at least one test; AC-239 treated as a tombstone and any reuse/unknown ID rejected; coverage report attached | 3 |
| **M-56 🔒** | **Public-repo assembly** — build the publishable tree as an **orphan/squashed initial commit with no ancestry from this working repo** (`src/`, `migrations/`, `scripts/`, `cli/`, `README.md`, `LICENSE`, `SKILL.md`, `SEED-DATA.md`, `PHILOSOPHY.md`, plus whichever of SPEC/EVALUATION/BUILDPLAN survive §8 item 10's curation). Extend `check:repo`'s ruleset with the third-party-content denylist (below) and run it over the assembled history *before* the remote exists. **Backs gate 16; never in the cut band.** Rehearsed at the CP-3 dry run, not improvised at 21:00 Tuesday. | 3 |

### Audit track

Guardrail audits from `SPEC.md` §7, each owned by an auditor who did not write the code. **This is a lane, not a Tuesday afternoon** — eleven audits, several requiring code-level scans and one a live drill, cannot share a six-hour window with eight feature tickets. Each starts the moment its subject code lands, and the ~15 agent-hours below are counted in the plan's total rather than assumed free.

| # | Audit | Hrs | Starts when |
|---|---|---|---|
| **A-1** | Repo hygiene — secret scan, `Atin/` and internal paths, third-party denylist, full history | 2 | At every milestone; **twice at the push** (assembled orphan history, then the pushed remote) |
| **A-2** | PROTOTYPE-badge sweep — grep `src/` and the built bundle, visual pass over every product route | 1 | After M-49 |
| **A-3** | Mail containment — no module imports Resend but the consumer; **exactly two `send_policy='always_live'` write sites**; all seven triggers + bulk suppressed under demo mode | 2 | **From CP-2** (M-11 landed) |
| **A-4** | Mirror isolation — Airtable client importable only from `src/jobs/mirror/*`; zero mirror calls during page renders | 1 | **From CP-2**, tightened after M-25/M-26 |
| **A-5** | Cookie scope and session issuance — no `Domain=`; enumerate every route that mints an `auth_sessions` row and assert its precondition, including the demo route's `demo_mode` gate; **embed routes never read `mq_session`** | 2 | **From CP-2** (M-03 landed) |
| **A-6** | Speed report — `speed-report.json` attached with actuals, AC-sourced vs objective separated | 1 | After M-22 |
| **A-7** | Public write surface — Turnstile gating set, upload extension/MIME/magic-byte/caps/serving origin | 2 | After M-13/M-14 |
| **A-8** | Anonymity scan — byte-scan every reviewer-visible response **and export** for seeded identity strings | 1 | After M-17 |
| **A-9** | Reviewer event+track isolation (**AC-214, AC-246**) — one helper on every reviewer route incl. export; out-of-scope ID probe | 1 | **From CP-2** (M-16/M-17 landed) |
| **A-10** | Bulk-write audit — every bulk path through the one chunking helper; 150- and 1,000-record drives | 1 | After M-18 |
| **A-11** | Reset drill (**AC-230**) — mutate, reset by command and by button, twice consecutively, concurrent poller sees no partial state, **mirror change feed short-circuited and one reconcile enqueued** | 1 | After M-03; re-run at CP-3 |

**A-1's second run is a hard gate on the push** (§8 item 13), not a formality. A-7 has ACs behind it (**AC-231, AC-232**) and A-4's isolation rule is what makes **AC-225**'s 60-second budget affordable.

---

## 6. Spikes

Three things are genuinely unproven. Each is time-boxed; each blocks a specific ticket; each fails loudly rather than leaking into a feature build.

| # | Spike | Question it settles | Box | Blocks | When |
|---|---|---|---|---|---|
| **S-1** | **Airtable webhook inbound loop** | Does the ping→list-payloads→cursor→apply loop actually work against a real base, and does our echo suppression hold when our own outbound write bounces back? Webhooks are **not data-carrying**, the payload pull spends the same 5 req/s budget, and delivery is at-least-once with up to 13 retries over a day. | 2 h | M-26 | Early in the D+13 → D+36 band |
| **S-2** | **ICS rendering in real clients** | Does a `METHOD:REQUEST` invite render as **Accept/Decline** in Gmail, Outlook, and Apple Calendar — and does a `SEQUENCE+1` update *replace* the entry rather than duplicate it, and a `CANCEL` remove it? Neither Google nor Microsoft publishes a normative statement; this is the 15 minutes that separate R3 working from R3 looking like it works. **Runs as a standalone ~30-line script that hand-builds a `METHOD:REQUEST` + `SEQUENCE+1` + `CANCEL` triplet and sends it through Resend to the three inboxes — it needs no product code and can fire the moment `marquee@stage11.systems` is confirmed.** | 1 h + operator inboxes | **Blocks M-24** — the builder is written against the verdict, not the reverse | **D+2**, before any product code depends on the answer |
| **S-3** | **D1 bulk-write chunking at wave scale** | Does a 150- and a 1,000-record bulk accept survive the **100-bound-parameter cap** and the per-invocation query limit, and which pattern wins — chunk at ≤90 or a single `json_each` parameter? It throws only under real data, only at scale (trap 11). | 1 h | **M-07** (which builds the one chunking helper — trap 11) and M-18 | D+0 → D+3, alongside M-01/M-02 |

---

## 7. Merge-friendly boundaries

Sixteen tickets writing into one repo overnight fail on shared files, not on logic.

**The rule: one file per route/module, and registration by glob, never by a hand-edited list.** Every module ships as `src/routes/<name>.routes.ts` + `<name>.queries.ts` + `src/ui/<name>/*`, and `src/routes/_manifest.ts` is *generated* at build from `import.meta.glob`. No agent ever edits a central registry to add a route. The same goes for OpenAPI: the document is assembled from route definitions, never hand-written.

**Unavoidable shared files — named, and the orchestrator serializes edits to them:**

| File | Owner | Rule |
|---|---|---|
| `migrations/0001_init.sql` | M-02 | Written once. Every later change is its own `000N_<ticket>.sql`; nobody edits 0001 after M-02 merges. |
| `wrangler.jsonc` | M-01 | All bindings declared up front so no later ticket needs to touch it. Additions serialized through the orchestrator. |
| `package.json` (scripts) | M-06 | The full thirteen-command script table registered at once, `check:mirror` included, stubs included. Dependency additions are the only other edits, and they queue. |
| `src/styles/tokens.css` | M-05a | Design tokens only. Per-module styles live in the module. |
| `src/db/schema.ts` | M-02 | Type mirror of 0001; later tickets append `src/db/schema.<module>.ts`. |
| `scripts/seed/index.ts` | M-04a | Orchestration only; per-entity seeders are separate files it globs, so M-04b never edits it. |
| `.github/workflows/ci.yml` | M-06 | Single author. |
| `README.md` | M-45 | Single author; other tickets file notes into `docs/notes/<ticket>.md` for M-45 to fold in. |

**Keyword-safe naming.** Module files carry their module name — `submissions.routes.ts`, `agenda.queries.ts`, `chase-board.view.tsx`. **No `utils.ts`, no bare `index.ts` inside a module, no `list.ts`, no `helpers.ts`** anywhere: those names collide across tickets and turn an agent's grep-and-replace into another ticket's regression. Shared helpers live in `src/lib/<specific-name>.ts` and are added, never rewritten.

---

## 8. The human track

Agents cannot do these. Each is Atin's, with the deadline that actually binds it.

**Before the first migration (before dispatch):**
1. **Enable and verify Workers Paid** ($5/mo). Free's 10 ms CPU will not SSR a 1,000-row table and it fails at deploy, not in dev (trap 2). **Blocks M-01's deploy gate.**
2. **Probe the R2 entitlement** — create a bucket, fetch a public object. A lapse 403s every public URL while DNS and TLS look fine, and the fix is dashboard-only (trap 4). **Re-probe on deploy day.**
3. **Confirm the Resend plan tier** (30 seconds in the dashboard). Free is 100/day; it decides whether Pro is bought for the judging window. The outbox and demo-safe allowlist are built either way (trap 3).
4. **Put the Airtable demo base on Team or above** *before* the seed script runs — Free caps at 1,000 records per base and the seed is exactly 1,000 (trap 6).

**Sunday:**
5. **Relay both clarification videos and any Discord rulings**, particularly **Q1** (Airtable primary vs mirror) and **Q2** (embeddable gallery). The Sunday video is the requirements freeze; the delta is triaged the same day, new criteria append from **AC-251** (AC-250 is taken by Amendment 9), and nothing is renumbered or reused.
6. **Three real inboxes** for the ICS chain — one Gmail (mandatory), one Outlook, one Apple Calendar — and click **Accept** in each when S-2 fires. **S-2 now runs at D+2 as a standalone script**, so these are needed within two hours of dispatch, not on Sunday afternoon; the spike that settles the least-verifiable question in the stack must not run after the code betting on its answer is written.
7. **Review/sign the v1.4 Pipeline prototype.** The seed-scale question (F-2) was ruled A′ on 2026-08-09 and is closed; the seven proposed speed budgets are already signed as report-only objectives; the old prototype gap batch is closed.

**Monday:**
8. **One real Sessionize export** (any event: sessions + speakers + evaluation results). It is the only thing that proves our column fixture matches reality (AC-109, the single `op-assist` criterion).
9. **A Cloudflare API token in CI** for `check:readme`'s scratch deploy, and **a model credential** for `check:skill-agent`.

**Tuesday — the public-repo push ritual, in this order:**
10. Curate which strategy documents ship publicly (this file, `SPEC.md`, `EVALUATION.md`, `PHILOSOPHY.md` are fine; internal budget material, Stage 11 internals, the `sequence/research/` dossiers and `sources/` tree, the agent briefs, `run-state.md`, and anything from `Atin/` are not).
11. Run **`npm run check:repo` over the full history**, not the tip.
12. Add **Apache-2.0 `LICENSE`** and `SEED-DATA.md`.
12a. **Assemble the public tree as an orphan/squashed initial commit (M-56) — the public repo is *created*, never *curated at the tip*.** This working repo's history carries material that deleting at the tip does not remove: the organizers' full brief PDF, another entrant's context document archived from Discord, absolute `/Users/…` paths, Stage 11 account posture, and c11 workspace/surface IDs. A full-history scan at 18:00 Tuesday either fails four hours before the push with no rewrite budgeted, or passes and the material ships. Neither is acceptable, and republishing a redistributed brief or a rival's document under Apache-2.0 cannot be un-pushed. Run `check:repo` against the assembled orphan history before item 13.
13. Create the **public** GitHub repo — the one deliberate exception to the privacy-by-default rule, ratified as decision 4 — push **the orphan commit only**, then re-run `check:repo` against the **pushed remote's full history** (audit **A-1**, hard gate on the push).
14. **Felt checkpoint C6** needs one real iPhone and one real Android; **C7** needs a person who did not build it to drive the walkthrough cold.

**Throughout:** keep token-spend evidence from day one — the $500 reimbursement is claimable on request and reconstructing proof after the fact is painful.

---

## 9. Schedule

**`D` is the dispatch timestamp** — the moment the orchestrator releases the fleet, recorded in `run-state.md` at dispatch. Every row below is `D+N` **wall-hours**. Deadline **Wed 2026-08-12, 22:00 PT**; the submit target is **deadline − 4 h**, not four minutes.

| When | Track | Milestone |
|---|---|---|
| **D+0 → D+13** | Fleet | Wave 0. M-01 → M-02 serialized, then M-03/M-04a/M-05a/M-05b/M-06/M-07 in parallel, M-08 last; M-04b starts behind M-04a and runs into Wave 1. **S-3** runs D+0 → D+3 and blocks M-07's chunking helper; **S-2** fires at D+2 as a standalone script, well ahead of M-24. **CP-1 at D+15** — the critical chain is M-01 (3) → M-02 (4) → M-07 (4) → M-08 (4) = 15 h (intake correction, 2026-08-09) and no number of workers shortens it. Deployed, seeded, both demo logins live; traps 2, 4, 15 dead. |
| **D+13 → D+36** | Fleet | Wave 1. M-09/M-10/M-11/M-13/M-16 in parallel; then M-12 → M-14, M-15, M-17, M-18, M-19a → M-19b, M-20 → M-21, M-22. **CP-2 at D+36** — after F-17 freed the agenda branch from evaluation, the longest chain from M-08 is **M-09 (4) → M-12 (10) → M-14 (8) = 22 h**, i.e. CP-2 lands at D+35 with an hour of margin; the agenda branch (M-19a 7 → M-20 5 → M-22 4 = 16 h) and the review branch (M-16 7 → M-17 9 = 16 h) both finish ahead of it. **S-1** runs early in this band. **S-2 already returned at D+2** and M-24 is written against its verdict. |
| **on video drop** *(wall-clock, not dispatch-relative)* | Human + one agent | Sunday clarification video → **requirements freeze**. Dossier re-run, delta triaged into new **AC-251+** criteria and, if needed, new tickets. Q2's ruling decides whether embeds (AC-87 – AC-90) stay or move to non-goals. |
| **D+36 → D+40** | Human | **CP-2 gate**: full-loop QA on the deployed preview, desktop and mobile. Felt checkpoints **C2** and **C3**. Anything red goes back to the fleet before Wave 2 widens. M-54 unblocks only when this is green. |
| **D+40 → D+50** | Fleet | Wave 2, first band: ranks 1–8 plus the 🔒 promotions — chase, invites, funnel, search, **M-55**, **M-45** (README/self-host, gate 14), **M-29**, **M-38 + M-39** (CLI + SKILL, gate 12), webhooks, Airtable mirror. Rank 3 is already green from Wave 0. **Capacity check at D+50.** |
| **D+50 → D+58** | Fleet | Wave 2, second band: ranks 9–20 remainder and cross-cutting M-48/M-49/M-50/**M-56**. Audit lane (~15 agent-hours, §5) runs concurrently from CP-2 — A-3, A-4, A-5, and A-9 start the moment their code lands and do not wait for the Tuesday band. `check:speed` runs on every PR against its preview. **Capacity check at D+58; the cut line is set here.** |
| **D+58 → D+62** | Fleet + auditor | Wave 2 to the cut line; remaining audits close; empty-state and craft sweeps close. |
| **D+62 → D+66** | Human + auditor | **CP-3 / gate dry run** — all nineteen `EVALUATION.md` §4 gates end to end, including the Airtable round-trip (gate 9), the Gmail ICS chain (gate 10), live mail (gate 11), the agent-only run (gate 12), and the reset drill (gate 13). Felt checkpoints **C5** and **C6**. **M-56's orphan-commit assembly is rehearsed here**, not improvised at the push. |
| **D+66 → D+70** | Human | **Public repo push ritual** (§8 items 10–13). Production deploy. `check:readme` against the pushed repo from a clean container. |
| **D+70 → deadline−4h** | All | Buffer for whatever the dry run found. **Felt checkpoint C7** after the last functional change: a person who did not build it drives the walkthrough cold, narrating. Re-run `reset:demo` and gate 4 so the first judge inherits a clean demo. |
| **deadline − 4 h** | Human | **Submit** — form + public repo + deployed URL. |

**The clock and the hours must both be true, and this is the rule that keeps them so.** The table above needs **~70 wall-hours** from dispatch. A Sunday-evening dispatch leaves ~74 — four hours of slack across four days, so the bands are not a forecast, they are a budget. **Wave 2's band carries ~133 agent-hours plus ~15 in the audit lane — ~148 — against ~18 wall-hours of fleet time (D+40 → D+58); at 5 workers that is ~90 agent-hours of capacity.** The gap is real and it is named here rather than discovered on Tuesday.

**What moves if we are behind.** The cut line, and nothing else — and it moves by the calculation in §5, run at the two capacity checks above: remaining band agent-hours vs. workers × wall-hours left before D+62. Cut from the bottom of the remaining band until they match. Tier A never yields — its no-waiver set is `AC-1 – AC-90` plus **AC-231, AC-234, AC-240, and AC-244–246**. The mirror remains protected at rank 8. **The 🔒 gate-backing tickets — M-45, M-38, M-39, M-56 — are outside the band and are never cut**, because gates 12, 14, and 16 cannot be waived. Everything cut is named with its ACs and reason; AC-233 is independently cuttable only when named.

**If dispatch slips later than a Sunday-evening `D`,** the first thing that gives is Wave 2's second band, not Wave 0's chain and not the CP-2 gate: a walking skeleton on the real plan is what buys back trap-2 and trap-4 time, and an ungated CP-2 is how a red Tier A reaches Tuesday.

---

## 10. Traps, dodged by name

Every trap in `seams-feasibility.md` §8 that touches this plan, and where it dies.

| # | Trap | Where it dies |
|---|---|---|
| 1 | OAuth calendar write | Not built. ICS `METHOD:REQUEST` is the shipped path (M-24); OAuth is a named README extension point (M-45). |
| 2 | Workers Free 10 ms CPU | Human item 1 + **M-01 deploys to the Paid plan on day one**, before any feature code. |
| 3 | Resend 100/day | **M-11 builds the outbox and demo-safe allowlist before any send path exists**, with the check in the queue consumer (guardrail G3). |
| 4 | R2 entitlement lapse | Human item 2, probed before dispatch and re-probed on deploy day; gate 1. |
| 5 | Fresh sending domain | Not attempted. `marquee@stage11.systems`, verified since March. |
| 6 | Airtable demo base on Free (1,000-record cap) | Human item 4, **before** M-04a's seed runs. |
| 7 | Airtable webhooks expire in 7 days | Daily keepalive cron in **M-26**. |
| 8 | Airtable Team throttle at 2 req/s | Architectural: **never read Airtable on a request path** (guardrail G4, import-boundary lint). |
| 9 | Presigned URLs don't work on custom domains | **M-13** signs against `{account}.r2.cloudflarestorage.com` and serves reads from the custom domain. |
| 10 | Airtable attachment URLs expire in 2 h | R2 is canonical; the mirror receives a public R2 URL, never the reverse (M-13, M-25). |
| 11 | D1's 100-bound-parameter cap | **S-3** settles the pattern **and blocks M-07**, which builds the one chunking helper; guardrail G11 tests 150 and 1,000 records. |
| 12 | D1 read replication takes 24 h to disable | Not enabled. Decision closed; no Tuesday flip. |
| 13 | Smart Placement won't help | R7 is not budgeted against it; `check:speed` measures reality. |
| 14 | Resend batch has no attachments | **Two send paths from the first commit** (M-11): batch for plain bulk, single-send ≤10/s for anything carrying an ICS. |
| 15 | `.dev` is HSTS-preloaded; parent-domain cookies leak | **M-01** sets the session cookie with no `Domain` attribute; guardrail G6 asserts it; `https://` always. |
| 16 | `api.resend.com` 403s the `Python-urllib` UA | **M-04a** sets an explicit `User-Agent` on every stdlib HTTP call in seed/backfill scripts. |

---

## 11. Flags carried from `SPEC.md`

**Closed by `USER_STORIES.md` Amendment 1** — no longer open questions, now ordinary ticket work: **F-1** → US-72, AC-225 – AC-229, Tier B final rank 8, built by M-25/M-26 · **F-3** → AC-233 on US-39, built by M-15, explicitly cuttable if named · **F-5** → US-73, AC-230, Tier B rank 3, built early by M-03 · **F-6** → AC-231 on US-14 (Tier A no-waiver, M-13/M-14) and AC-232 on US-41 (M-13/M-40).

**Closed by client ruling 2026-08-09:** **F-2** — seed option **A′** confirmed by Atin (real Feb-2025 sessions + the CODE-2025 roster → ~150 accepted, zero fabricated accepted people). Recorded in `run-state.md`'s decision log; it is not a live item on anyone's Sunday.

**Closed in v1.4:** **F-4** — every formerly toast-only loop affordance now has an interactive route/modal/control in the candidate binding prototype.

**Recorded decisions, not questions:** **F-7** embed KV TTL set to 30 s against AC-89's 60 s budget · **F-8** liveness is a 5 s poll, not a push channel.

---

## Amendment 2 — Discord day-1 rulings (2026-08-08 night, orchestrator)

- **M-02 (first migration) now includes `submission_tracks`** (many-to-many, `is_primary`; SPEC Amendment 2 / AC-234). Landing this before the fleet's first migration is the entire reason this amendment is time-sensitive; retrofit after dependent tickets ship is expensive.
- **New ticket M-52 — Decision feedback + email-from-review (US-74, AC-235–236).** Tier B final rank 9; cheap, and it is a *named* bonus from the leads (dossier R51). **Hours and dependencies: see §5's table, which is the sole authority** — this amendment's original estimate was never reconciled with it, and a delegator reading the amendment would have started M-52 before M-32 existed.
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

- **New ticket M-53 — Program board (US-75, AC-238 plus then-proposed AC-239), 4h.** AC-239's drag behavior was later struck and replaced by AC-243 in Amendment 7; the ID remains retired.
- **AC-240 folds into existing tickets**: slot chips + "Not yet public" into the submissions-list and record tickets; stage sub-labels into the dashboard ticket; publish affordance into the agenda/publish ticket. +1h total, spread.
- **M-04 seed**: multi-track distribution (≥15%, ≥3 accepted+scheduled two-track sessions) asserted by `check:seed`.

## Amendment 6 — API comparison fold (2026-08-09, orchestrator)

- **M-07 (API core) absorbs the four pre-kickoff gaps** (+3h): `GET /events` discovery, people reads, file lifecycle, scoped tokens (AC-242) — plus the pinned semantics (pagination, ETag/If-Match, error envelope, rate-limit headers, bulk `operation_id`). All are contract-level; none add product screens.
- **New ticket M-54 — signed outbound webhooks (AC-241), 4h, gated on CP-2 (Tier A green).** Tier B low; the strongest direct R53 comparator after core REST.
- **`check:api` strengthened** (EVALUATION §1.1): docs/CLI/SKILL derive from one route registry; operation counts and hashes must match across served JSON and rendered docs — this directly beats the incumbent's own 177-vs-18 docs drift.

## Amendment 7 — client v1.3 board refinement (2026-08-09)

- **M-53 scope correction (AC-238, AC-243; AC-239 struck):** replace board drag/drop with composable search/type/track/format/wave filters and exact-record card navigation; lifecycle buttons and confirmation/cascade behavior belong to the submission-record ticket. Agenda drag/drop is unchanged. Estimate remains 4h because the board interaction is simpler and the record action surface reuses existing transition logic.

## Amendment 8 — context-coverage closure (2026-08-09)

- **Tier A absorbed before dispatch:** M-12/M-14 carry the multi-track/full-form surface (AC-234); M-10/M-15/M-20/M-32 carry scheduled/public legibility (AC-240); M-16/M-17 carry full reviewer detail, score-optional Approve/Maybe/Deny, and one centralized track-authorization helper (AC-244–246). CP-2 and gate 18 name the widened no-waiver set explicitly.
- **M-15/M-18/M-52 close decision and portal demonstration:** feedback uses one decision row for email + portal; one-off mail is logged; title/description edits are policy-controlled/history-stamped; acknowledge/form/file tasks validate real payloads (AC-235–237).
- **New M-55 (US-76, AC-247–249):** personal event-scoped saved views, configurable fixed-registry columns with mandatory Title, and the role-gated Drafts needing attention queue. Schema lands in M-02; seed obligations land in M-04; M-55 owns UI/API/e2e.
- **Explicit non-work:** no Month view and no generalized CMS. The first was reference-image vocabulary; the second remains R8/optional. Narrow handbook pages and embeds remain.
- **Dispatch gate:** v1.4 prototype client sign-off → mint `DESIGN.md` → only then convert this plan to Lattice tickets.

---

*v1.4 contract revision, 2026-08-09 (Amendments 1–9 applied). Await client prototype sign-off; then mint `DESIGN.md` and turn §3–§5 into Lattice tickets. New criteria append from AC-251; AC-239 remains struck and unrecycled.*

## Intake amendment — board mint, 2026-08-09

- **USER_STORIES Amendments 10/11 (AC-251–253) ratified into the plan** per SPEC's fold text: AC-251 → the evaluation/record tickets (MRQ-20/22 lineage), AC-252/253 → schema (M-02), seed (M-04a), Event Settings (M-09), and agenda/public render tickets, exactly as mapped in `.lattice/orchestration/ticket-map.md`. EVALUATION §2.3 carries their rows as of this date.
- **CP-1 critical chain corrected 13 h → 15 h** (M-07 supersedes M-04a on the chain; edits in §2 and §10 above). Checkpoint clock: CP-1 = dispatch+15 h.
- **Duplicate AC claims resolved to single owners for `trace:ac`:** AC-155–157 → M-43's ticket (MRQ-37, co-speaker + mobile submit), AC-146–148 → M-40's ticket (MRQ-24, chase board + slide upload); the other claimant (M-14 / M-13) tests but does not own.
- M-51 does not exist (numbering skip, no gap).


## Amendment 9 — geography as a constraint (2026-08-10, client-directed)

*Folds `SPEC.md` Amendment 14 and `USER_STORIES.md` US-77 – US-79 (AC-255 – AC-263). Binding prototype v1.7; design reasoning in `sequence/venue-map-ux.md`.*

**Already landed.** MRQ-58 shipped `migrations/0002_venue_geography.sql` (`lat`, `lng`, `access_minutes`) and mirrored `src/db/schema.ts`. That work is not re-done here; three tickets sit on top of it.

**One blocking seed defect, found while folding.** `scripts/seed/event.ts` seeds Sheraton and the Workshop Annex at *identical* coordinates (`40.7625188, -73.9814528`) with `access_minutes` 0 on both. The migration is correct and the seed is faithful to §6 as written — and the consequence is that **the Transit conflict class can never fire in the shipped product and the site map stacks two pins on one point.** The feature would pass its unit tests and be inert in the demo. SPEC Amendment 14 supersedes §6's "without inventing a second real venue" clause for exactly this reason, and AC-259 makes `check:seed` fail until the seed can produce a live Transit conflict. **M-57 owns the fix; it is a prerequisite for M-58 demonstrating anything.**

| # | Ticket | ACs | Hrs | Deps |
|---|---|---|---|---|
| **M-57** | **Venue geography — `access_note`, the Venues screen, and a seed that can actually conflict.** Third migration adding `buildings.access_note` (0002 is merged and immutable). Move buildings *and* rooms authoring to `/settings/venues` under the site map; strip venue editors from `/settings` and leave a linking count; one shared writer behind both Save paths. **Re-seed the building set so two buildings are genuinely apart in space with a non-zero access time on one**, and move the photo-ID/security sentence off its room note onto the building's `access_note`. Site map as a tile mosaic — plain `<img>` OSM rasters on a centre-clipped plane, pins and walking lines drawn over, fixed-aspect reserved box, attribution visible, tile failure degrading to pins over the grid. No map library, no CDN, no API key. | AC-255 – AC-257 | 6 | MRQ-58 (merged) |
| **M-58** | **Transit conflicts.** Third conflict class in `getConflicts` beside room overlap and speaker double-booking: shared speaker, different pinned buildings, gap < walk + destination access. `haversine × 1.3 ÷ 80 m/min`, floored at 1. Warns, never blocks. Flows into the existing dashboard count, drawer, and tiles through the one existing call — no parallel path. Building band over the agenda room columns, and room headers drop the now-redundant building suffix. **The class is Transit, never Travel**, across `kind`, drawer, tiles, dashboard, API type, and copy; byte-scan enforced. | AC-258, AC-259 | 5 | M-57, agenda |
| **M-59** | **Arrival instructions.** Speaker-portal location card — room, building, address, entrance note, and a leave-by computed from the speaker's own previous session that day (primary building as fallback), degrading honestly when unscheduled or unpinned. Five place merge fields in comms with an insertable field reference. Real ICS `LOCATION` + `GEO`, replacing the bare room name, leaving `METHOD:REQUEST`/`UID`/`SEQUENCE`/cancel semantics untouched. | AC-260 – AC-262 | 4 | M-57, M-24 (ICS), comms |
| **M-60** | **Disclosure fold.** Fewer than two pinned buildings hides the comparison — room-label building suffix, walk times, Transit conflicts, agenda building band — and collapses the embedded site map, while address, entrance note, and access minutes stay rendered at any building count. Cross-cutting: touches every surface M-57 – M-59 produce. | AC-263 | 2 | M-57, M-58, M-59 |

**Rank.** US-77 – US-79 insert after US-72 in the Tier B band, above the mirror. **M-57 is not cuttable while M-58 or M-59 are in scope** — it owns the seed those two need to demonstrate anything; cutting it and keeping them ships an inert feature, the exact failure mode this amendment exists to prevent. M-58 and M-59 are cuttable as a pair from the bottom of the band; M-60 is cuttable only if all three are cut.

**Total: 17 agent-hours.**

---

## Amendment 10 — the states a forward-only model forgot (2026-08-10, client-directed)

*Folds `SPEC.md` Amendment 15 and `USER_STORIES.md` Amendment 15 (**US-80, US-81; AC-264 – AC-269**) into the plan. Source dossier: `sequence/research/state-model-gaps.md`. Binding prototype **v1.8**.*

**Timing is the good news.** Every ticket this touches was still `backlog` when the gaps were found — the un-accept cascade, the portal, the chase board, webhooks — so none of this is rework on merged code. The one exception is *Bulk and record-owned decisions with cascade*, `in_progress`, which owns AC-268/AC-269's write path and should receive this amendment directly.

**One migration, three additions.** `0002_venue_geography.sql` established that additive migrations after M-02 are fine, so `0003` carries all of it as one ticket and one review rather than three migrations racing each other:

```sql
ALTER TABLE speaker_tasks ADD COLUMN cancelled_at INTEGER;   -- AC-264; open|done CHECK unchanged
CREATE TABLE webhook_endpoints  (...);                       -- AC-241; see SPEC §3
CREATE TABLE webhook_deliveries (...);                       -- AC-241
```

`handbook_pages` is **deliberately not** in this migration — the Speaker Handbook is ruled if-capacity (below), and a table with no writer is what `SPEC.md` §3 says must not ship. If the if-capacity band opens, it joins `0004`.

| # | Ticket | ACs | Hrs | Deps |
|---|---|---|---|---|
| **M-61** | **Migration `0003`** — `speaker_tasks.cancelled_at` plus the two webhook tables, with the index on `webhook_deliveries(endpoint_id, created_at)`. Nothing else; no read sites, no UI. Split out so the three consumers below can start in parallel behind one merged migration, exactly as MRQ-58 did for venues. | — (serves AC-264, AC-241) | 1 | M-02 (merged) |
| **M-62** | **Task cancellation and the idempotent reconciliation.** `cancelTaskSet` (stamp `cancelled_at` on open rows; never touch `completed_at`; never delete) and **one** `reconcileTaskSet` called by *every* acceptance path — first accept, re-accept, and accept after a template change — so restoration has no separate branch and running it twice is a no-op. Convert **every** reader to the `owes = neither done nor cancelled` predicate: portal active list and progress denominator, all four chase-board metric buttons, all four filter-chip counts, the task-type filter, severity ordering, overdue totals, the **`task overdue` trigger**, and the comms recipient selector. Relabel the reversal dialog's branches to `Cancel open tasks` / `Keep tasks active` and stamp both, plus any restoration, into `audit_log`. | **AC-264 – AC-267** | 4 | M-61, M-33, M-15, M-23 |
| **M-63** | **Decided · not notified.** Derived only — `submission_decisions` left-joined to `outbox`, no schema. The immutable built-in view naming which of the three reasons applies per record, the fourth attention-strip row that holds its place at zero, and a `Notify N speakers` action that writes a **new** outbox row against the **unchanged** decision row and excludes no-address records from both the action and its count. | **AC-268, AC-269** | 2 | M-52, M-11 |
| **M-54** | *(unchanged in rank, scope, hours, and its CP-2 gate.)* Its three missing layers are now specified — tables in `SPEC.md` §3, routes in §4.2, `/settings/webhooks` in the screen inventory — so it can be built without inventing routes that `check:api`'s registry/OpenAPI parity would reject on its own PR. **This amendment adds no hours to M-54.** | AC-241 | 4 | M-07, **M-61**, CP-2 |

**Rank.** US-80 and US-81 are **Tier A** and insert after US-33 — they close behaviour an existing Tier A criterion (AC-123) already required and an existing trigger (AC-125) actively gets wrong. M-61 → M-62 is the critical pair; M-63 is independent of both and can run alongside.

**Total: 7 agent-hours** (M-61 1 + M-62 4 + M-63 2). M-54 unchanged at 4.

**Ruled out of this amendment, on the record:**
- **Speaker Handbook (AC-233)** — *if capacity, after the walkthrough-loop tickets are green.* Same shape as the webhooks gap: it renders in the prototype, and has no table, no route, and no authoring surface. It remains the one cuttable criterion on a Tier A story, and gate 19 must name it if cut.
- **Submitter/speaker split** — *extra credit.* Named as a known limitation in `SPEC.md` §10 and enforced by new **gate 19b**, citing the already-specified AC-223/AC-224. Criteria drafted and held unminted; mint from AC-270 only if the if-capacity band opens.

---

## Amendment 11 — public widgets widened and protected (2026-08-11, client-directed)

*Folds `SPEC.md` Amendment 18 and `USER_STORIES.md` Amendment 18 (US-16 promoted to live in-scope; US-58 gains AC-273–AC-274). Binding prototype **v1.10** (`showEmbedModal()`), public agenda → `Get embed code`.*

M-21 (embeds, merged under MRQ-22) shipped a two-kind dialog (`agenda|speakers`). This amendment turns it into four (`agenda|sessions|speakers|cfp`) on the same route surface, KV cache, and purge-on-publish path — no new milestone dependency beyond M-21 itself.

| # | Ticket | ACs | Hrs | Deps |
|---|---|---|---|---|
| **M-64** | **Public widgets widened.** Embed dialog gains a four-format segment (equal flex widths) replacing the single kind select; Track select and a new Layout segment (`Cards\|List`) are always rendered, disabling — never disappearing — when inapplicable (Track for `cfp`; Layout for anything but `speakers`). New `sessions` kind: flat title/track/time row, same query/cache/purge path as `agenda`. `speakers` gains `layout` carried in the snippet URL. New `cfp` kind: renders the event's primary open form's deadline and formats plus a link to `/f/:slug`, flipping to closed from `closes_at` alone on the existing 30s cache TTL — no republish, no new job, no new queue. `embeds.kind` CHECK constraint widened (migration, additive rebuild — the table has zero writers in any environment, so nothing to migrate). | **AC-217, AC-218, AC-273, AC-274** | `src/routes/embed.route.tsx`, `src/ui/embeds/EmbedPage.tsx`, `src/lib/public-site.ts`, `migrations/0006_embed_widget_kinds.sql` | 5 | **M-21** |

**Rank.** AC-217, AC-218, AC-273, and AC-274 are **Tier A**, joining AC-87–90 rather than landing in Tier B — the client ruling was "protect and widen," and Tier B stays cuttable-from-the-bottom (gate 19). Landing the widened half of the family there would leave exactly the part this amendment is about exposed to the cut it exists to end. All eight embed ACs (AC-87–90, AC-217–218, AC-273–274) are now grouped as one no-waiver unit.

**Total: 5 agent-hours.**

---
