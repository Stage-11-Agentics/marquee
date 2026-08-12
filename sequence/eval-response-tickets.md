# Eval Run-1 Response — Validated Findings and Ticket Set

**Status: COMPLETE — all 54 issues validated by six parallel Opus agents; full ticket set below.**

**Three shas matter for every verdict:** run-1 evidence graded `ddc22ef` (25 commits behind main); the **live site is `399cff7`** (5 behind main, an ancestor — so live carries every fix through it); current main is `4b2dc09`. A re-run today grades `399cff7`, not run-1's build.

**Evidence bases.** Code: `github/main @ 4b2dc09` (detached worktree `Marquee-worktrees/eval-triage-ro` — the triage list was written against a checkout 23 commits stale, and several of its findings were already fixed). Rubric: `.eval-kit/` pinned at `2b0f795` — **the `specs/*.yaml` files are what the judge scores; the `docs/*.md` "Rubric rationale" sections disagree with the YAML on at least six weights (CFP-02/04/08, CNT-04/13/14, SPK-13/14/16). Cite the YAML, always.** Run evidence: `.eval-kit/runs/2026-08-12T02-37-27/` (CFP-S1–S4, ABS-S1–S3 only; no SPK/CNT/AIA/EMB scenario has ever executed).

Produced by six parallel Opus validation agents, one per cluster, each verifying every claim against code with file:line evidence and against the kit's YAML. Manager synthesis by the eval-triage session, 2026-08-12.

---

## 1. Cross-cutting facts every ticket must respect

1. **The YAML is the rubric.** `.eval-kit/src/judge.ts:166` builds the judge prompt from `spec.rubric` (the YAML) only. Do not size work off the `.md` docs.
2. **The turn budget is scoring surface.** 70 turns per scenario (`evalconfig.json`); run 1 hit the cap on all four CFP scenarios and burned ~10 turns of ABS-S3 hunting for surfaces. Every fix should prefer: controls in place over new modals, sidebar entries with the exact nouns the specs search for ("Files", "Speakers", "Scorecard", "Round", "Export"), and links from where the agent already is.
3. **`cannot_judge` is excluded from the denominator; `fail` is not.** Shipping a *partial* affordance that lets the judge reach a broken flow can be strictly worse than shipping nothing (see MRQ-A trap). Never ship the discovery affordance without the working flow behind it.
4. **Manual-half items are scored by a human opening the artifact.** A control wired to the wrong data passes the robot and fails the human (see ABS-13). Build the honest artifact.
5. **The `memberships` table has no runtime writer.** `grep "INTO memberships" src/` → only `src/lib/reset-demo/demo-fixture.ts`. Every "speaker roster" and "reviewer provisioning" surface is downstream of fixing this.
6. **Auditability pattern:** audit rows compose into the same `batch()` as the write (`src/lib/audit.ts:50-66`). Restore is a forward edit that emits its own audit row; history is never rewritten.
7. **UI stability is a house rule:** elements never jump (reserve space, fixed widths, tabular numerals). Applies to every status indicator these tickets add.

## 2. Validated findings register

Verdicts: ✅ confirmed · ✅± confirmed with nuance · ❌ refuted · 🔧 already fixed on main.

| # | Finding (short) | Verdict | Key evidence / correction |
|---|---|---|---|
| 1 | No reviewer role in demo auth | ✅± | `auth.routes.ts:32,319`. Schema already allows `reviewer` (`0001_init.sql:155`). **Trap:** persona query (`auth.routes.ts:98-105`) has no `ORDER BY`; seeded staffer holds owner+program_lead+reviewer, so naive fix can sign the judge in as the organizer → CFP-10 fail. |
| 2 | No on-screen reviewer door | ✅ | Only auth call in client is `POST /auth/demo` (`landing.route.tsx:246`). ABS-S3 step 1 names two acceptable doors: reviewer sign-in, or an **organizer-side copyable link / view-as for the assigned reviewer**. A landing role button satisfies neither. |
| 3 | No reviewer provisioning | ✅ | Four writes deep: person → `memberships` (no API exists at all) → `committee_members` (API exists, UI doesn't) → `reviewer_track_scopes` (unscoped reviewer is silently unassignable, `reviewer-scope.ts:39-71`). Committee dialog has one field: name (`EvaluationPage.tsx:298`). |
| 4 | Confirmation can't reach portal | ❌/✅± | Refuted as stated: submit path mints `portal_url` on demo events (`public-form.routes.ts:760-765`, shipped `2895e76`). Broken only on the **SSR revisit path** (`/f/:slug?resume=` renders confirmation without the link). Needs a live smoke before ticketing; guard against minting a credential on every GET. |
| 5 | Scorecards per-plan not per-round | ✅ | UI-only: editor hardcodes `firstRound.id` (`EvaluationPage.tsx:167`), dialog title hardcoded "Round 1 · Initial screen" (`:297`). **Schema is already per-round** (`rubric_criteria.round_id`). Worse: round 2 defaults `mode:"comparison"` with no scorecard concept (`seed/evaluations.ts:133`, `EvaluationPage.tsx:150`). |
| 6 | Round names/dates not editable | ✅ | API accepts all of it (`roundPatch`, `evaluation.routes.ts:41-48`); UI renders one control (mode select). **Also missed: `anonymized` is display-only → ABS-07 (w2) rides the same fix.** |
| 7 | No per-round reviewer pools | ✅± | Committees are event-level; but `round_assignments.committee_id` + `distributeAssignments` already accept per-round committees. Cheap door: attach committee to round (rubric explicitly allows "pool/committee"). Add-reviewer-to-committee UI doesn't exist at all. |
| 8 | Criteria have no field types | ✅ | `rubric_criteria` = name+weight only. Fixed Approve/Maybe/Deny + comment box may earn partial today. Migration traps: `assertCriteriaTotal` must exempt non-numeric kinds; `criteria_scores` wire schema is numbers-only (`review.routes.ts:22`). |
| 9 | Reviewer never renders/stores criteria | ✅ | `ReviewerPage.tsx:270` hardcodes `criteria_scores: null`; queue payload carries no criteria. Server write/read paths already exist. **Also missed: submitted reviews vanish from the queue (no reopen path) — ABS-03's storage evidence is unprovable; needs a Completed section.** |
| 10 | No weighted aggregate | ✅ | `AVG(score)` across all rounds, unlabeled (`submissions.queries.ts:473`). Arithmetically impossible until #9 lands (nothing per-criterion to weight). ABS-04 is w1 and already likely partial — don't over-invest. |
| 11 | No results table w/ bidirectional sort | ✅ | Sort direction baked into registry (`SUBMISSION_SORTS.score` desc-only); no clickable headers. **Ascending doesn't exist → ABS-10 (w3) fails outright today.** Recommend: make the submissions list the results table + "View results" link from /evaluation. |
| 12 | No COI/recusal control | ✅± | Nothing named COI exists — but `evaluations.abstained` column already exists, hardcoded 0 (`review.routes.ts:743,749`). Pass bar is low (presence + queue effect). Chair side must exclude abstained rows from aggregates. |
| 13 | Score export: API exists, no button | ❌→✅ | **Refuted as stated: the endpoint is `exportReviewerQueue` — unreviewed items, zero scores.** No score export exists anywhere. Wiring a button to it would pass auto-half and fail the human manual check. Build a real results export. |
| 14 | No bulk reminder to lagging reviewers | ✅ | `reminderSelectorSchema.role` has no reviewer; audience engine is participation-shaped. Don't widen it — add a narrow "Remind" on progress rows via `listRoundAssignments` (SQL already returns assigned/reviewed per reviewer). |
| 15 | Co-authors can't be added at submission | ❌ | Seeded form has co-speaker name+email fields; server writes `participations role='co_speaker'` + invite flow + `CoSpeakerPage`. Run-1 screenshots prove the agent used them. Real defect: copy promises "up to four participants," form offers one slot. |
| 16 | No speaker roster | ✅ | No `/speakers` anywhere. Onboarding board ≠ roster: memberships-derived (see #24n), and **completed speakers vanish** (`onboarding.queries.ts:300` `owedCount===0 → continue`). Quick-search returns speaker hits with a dead `?person=` deep-link. |
| 17 | No add/edit speaker organizer-side | ✅ | Zero organizer `UPDATE people` paths. Create exists only as submission side-effect, bio inserted as literal NULL (`submission-record.routes.ts:671`). SPK-02 requires bio on create + edit surviving reload. |
| 18 | No reachable speaker CSV import | ✅+ | Three blockers: both CSVs structurally required (`sessionize-import.ts:948`); **the kit's fixture speakers.csv lacks `external_ref`, which the UI requires** (`SessionizeImportPage.tsx:81`); the only in-app link to /import renders only when the program is empty (`DashboardPage.tsx:86,92`). |
| 19 | No speaker workflow status | ✅± | Vocabulary exists on the right object (`participations.confirmation_status`), rendered as chips, but organizer can't write it and nothing filters by it. Don't add a person-level status column — surface + make writable the per-session one. |
| 20 | No travel/custom fields | ✅ | Nothing person-scoped. w1: `custom_fields` JSON column + logistics section; skip the field-definition engine. |
| 21 | Organizer can't see bio/headshot | ❌ bio / ✅+ headshot | Bio renders in onboarding drawer (`OnboardingPage.tsx:98`). **Headshot renders nowhere in the product, portal included** — and no route can serve `person_headshot` attachments (preview joins strictly via `submission_answers`, `uploads.routes.ts:604-608`). SPK-08 fails on the speaker half too. |
| 22 | No organizer view of speaker files | ✅ | No admin surface lists attachments; `speaker_tasks.attachment_id` never projected to the board. Shares its fix with #21 and F1's version helper. |
| 23 | No portal-invite control | ✅± | Mechanism fully built (`POST /auth/magic-link`, demo mode returns link on screen, outbox logs → "Message history" free). Missing only the button (single + bulk). **Highest ROI in the speaker cluster: also protects SPK-07/09, CNT-02/03 coverage.** |
| 24 | Tasks can't be created | ✅± | Mechanism wrong: acceptance cascade mints tasks at runtime (`jobs/cascade/decisions.ts:362`); what's missing is template authoring (new `task-templates.routes.ts` has GET/PATCH-file-config only) + ad-hoc assignment. Chain damage quantified: **16 of CNT's 31 item-weight** downstream of CNT-01. |
| 24n | (unnamed by triage) memberships gap | ✅ | Runtime-created speakers get no membership row → invisible on onboarding board and any memberships-derived roster. The participations→memberships bridge exists only in the seed. Must be fixed or the roster must be participation-derived. |
| 25 | /settings/tasks dead route | 🔧 | Fixed on main (`e2f6066`, #49). Remaining: page lists file-kind only (`TaskTemplatesPage.tsx:173`), empty state instructs an action it offers no control for (`:183`), still no sidebar entry or settings link. |
| 26 | No file versioning | ✅± | **No migration needed**: every presign mints a new attachment row (unique r2_key), old rows survive; `speaker_tasks.attachment_id` is the "latest" pointer. Version list = one query. Derive `is_latest`, never store it. **Also missed: portal never shows the uploaded filename → CNT-02 (w3) evidence at risk. Cheapest high-value fix in the area.** |
| 27 | No comments on files | ✅ | Confirmed. **Anchor threads on the deliverable slot (owner_type+owner_id), NOT attachment_id** — CNT-S3 comments on v1 then uploads v2; attachment-anchored threads orphan and the item fails looking like data loss. Rubric explicitly excuses notifications — build no mail. |
| 28 | No central files library | ✅+ | Confirmed, severity understated: it's the only door to the organizer half of CNT-04/05/14 — **7 of 31 item-weight hangs on one screen**. Sidebar label exactly "Files" (spec enumerates the agent's guesses). Per-session tab optional per rubric. |
| 29 | No bulk ZIP export | ✅ | Feasible on Workers: stream via TransformStream, **STORE not deflate**, MEDIA binding already there; queue variant later behind same UI. **Trap: CNT-S3 says "do NOT download the ZIP" — the scored artifact is the visible Preparing→Ready state, not the bytes.** Latest-only must reuse F1's `is_latest` derivation. |
| 30 | History: no restore, weak attribution | ✅+ | Worse: **organizers cannot edit accepted content at all** (`submission-record.routes.ts:793` draft-only guard) — so there's nothing to restore. Blocks CNT-09 (w2), gates CNT-11 (w2), feeds CNT-12 (w3): largest lever in the area. Cheaper: portal already has the full pattern (before/after audit rows, actor-name join, rendered history) — lift it, don't rebuild. Admin panel renders literal "user" (`actor_kind`). |

| 31 | No publish/go-live in builder | ✅± | Per-record publish exists (`SubmissionRecordPage.tsx:162`) but seed leaves exactly **one** unpublished session, so the button is nearly unfindable. AIA-07 wants a builder-level action; must be **batch** publish, keeping the `status='accepted'` guard (reversal-safety comment at `submission-record.routes.ts:~893`). |
| 32 | No auto-schedule assist | ✅ | Confirmed absent. 0.56 overall points — won't-do ruling stands. If ever built, drive it through the existing conflict engine as a per-slot *proposal*, not an apply. |
| 33 | Session cards lack description/Show more/title/company | ✅+ | Confirmed — and `PublicSession.abstract` + speaker title/company are **already in the projection**, rendered on detail pages; card work is pure render. **Triage missed: EMB-01 also requires a Format value, which the public data model doesn't carry at all** — without it EMB-01 caps at partial. Server-truncate snippets (speed budget AC-85 pins agenda-cold-interactive); `<details>` for Show more (pages are SSR strings). |
| 34 | Only a Track facet | ✅ | Confirmed. Two WHERE clauses (`sessionRowsQuery`); rooms already joined, format needs the join. Inline selects satisfy "panel/control" — don't build a facet modal. |
| 35 | No headshots on speaker cards | ✅+ | Blocked **three** ways, not one: no render, no field on `PublicSpeakerSummary`, and **zero headshots in the seed** (deliberate: no real people's images) + no public inline-image route (`handleMedia` is attachment-only; preview route is authenticated). Fix: seeded synthetic monogram/geometric avatars for ~30 published speakers, leave 2–3 without (EMB-12 rewards the fallback), `headshotUrl` in the projection. Don't wire the R2 media origin for this. |
| 36 | No directory search/drill-in | ✅± | Overstated: `/p/:slug` detail page is fully built and linked from agenda rows — EMB-05 is *partial* today, not fail. Missing: `<a>` on embed cards, a `q` input (server search already matches name/company), and a real `/speakers` public page (also feeds unowned EMB-14 w3). Don't build a modal for EMB-13's 1 point. |
| 37 | No personal schedule | ✅ | Confirmed — and both items are w1, kit-flagged "(inferred; a faithful clone would lack it)". 1.14 overall points for the largest new subsystem in the cluster. **Defer post-deadline** (it IS beloved product — Sessionize favorites — just worthless for this eval). |
| 38 | No add-to-calendar public | ✅± | Triage double-counted: EMB-11 bundles persistence+export in ONE w1 item. Cheap honest slice: single-session "Add to calendar" ICS on `/s/:slug` (~30 lines, reuse the invite VEVENT builder). |
| 39 | Agenda list vs room-grid | ✅ fact, ❌ rubric | **Most important correction in the cluster: EMB-06's pass_criteria accepts "a clearly time-slotted list" as a PASS.** The grid earns zero additional points (and the admin `DayBoard` grid is a Preact drag-drop component — not liftable into SSR pages anyway). Real risks: default "All days" view (post-13a77cb) weakens the "per-day" framing — default to day 1 or add time-group headers. On a phone the list is the better product; the rubric agrees. |
| 40 | Embed builder not organizer-side | ✅± | Partial floor already cleared (4 widget kinds, filters, branding, copyable snippet). **JSON already exists** — all public API routes are anonymous; a "JSON" format option is ~10 lines. **Regression on current main: the `Agenda data ↗` feed link was removed** between 13a77cb and 4b2dc09. Coverage trap: EMB-S3 is organizer-persona and the sidebar has no Embeds entry — **one route-table row de-risks the w3**. Saved-embed CRUD: the `embeds` table exists, empty by design (migration 0007 comment). Ship JSON+iCal, skip XML. |

| 41 | No POST /events, switcher, create-event UI | ✅± | Confirmed — but **1–2 days, not a week**: every table is already event-scoped with composite FKs, authorization already resolves per-event, and the demo organizer holds an org-wide owner membership (`event_id: null`). Remaining: 2 endpoints + an event context replacing **16 hardcoded default props** (no Preact context exists yet). The old "Not installed" switcher was replaced (`e1a461c`) by a `/dashboard` link still dressed as a switcher — worse for the eval (burns turns, produces no scoreable observation). New events must render a working empty shell (a 500 scores worse than absence), and **reset won't clean up agent-created events** (cross-dependency with T-O). |
| 42 | Per-event scoping unprovable | ✅± | Scoping is **implemented and enforced** (every query opens `s.event_id = ?`; cross-event roles denied per-request) — merely unobservable. CFP-17+18 moving `not_found→pass` ≈ **+3.0 overall points** and doubles the `scoping` type row (25% in run 1; the kit calls `rule`+`scoping` "the strongest signal in the whole rubric"). Don't build scoping — *expose* it. |
| 46 | Conference name hardcoded | ✅ | `AppShell({ eventName = "AIE NYC 2026" })` — **the prop is never passed anywhere**; MRQ-101 rebuilt the breadcrumb structure but not the name source. Load-bearing for CFP-03 (w3) and manufactures the #48 mismatch. Fix: fetch in the existing boot path, make the prop **required** so the bug class can't return. Same in `DeliveryHealthShell`. |
| 47 | Form Format options hand-typed | ✅+ | **Upgraded from minor to major.** The server binds by *name at submit time* and hard-rejects on mismatch — rename a format in Settings and every in-flight form rejects submissions from a dropdown visibly containing that option. Exposure: CFP-01 (w3) + CFP-06 (w3) + CFP-15 (w2) = **8 weighted points** plus a live data-loss trap. Fix is a first-class bound field (`config.source: "formats"|"tracks"`), not a string sync. Own ticket. |
| 48 | Branding mismatch | ✅+ | **Five** stale strings across three files, not three — two hardcoded on the landing page (turn 1 of three scenarios) alongside the live name. Fix all five + a forbidden-literal check in `scripts/checks/` so it can't grow back. |
| 49 | Accepted filter returns 0 | 🔧 | **Fixed on main AND live** (`2543206` #51 + `2b0612d` #54; both ancestors of `399cff7`). Mechanism confirmed: `accepted` was a *pipeline stage* that excludes records with open tasks; fix added stored-fact `accepted_any` + optgroup'd filter + renamed sidebar row "Ready to place". **Residual trap:** the URL `?status=accepted` still means the stage — an agent typing the URL gets 0 records on a conference with 150 accepted talks. Add the inline escape: "0 in Ready to place. N accepted overall — view all accepted." |
| 50 | Admin create needs internal slugs | ✅+ | Confirmed — and the triage missed the worst field: **`Submitter person ID`**, whose blankness made "AIE Program Committee" the speaker of record and is cited in the judge's reasoning for CFP-06/13/15. Total exposure of this one screen: **10 weighted points**. Fix: pickers (track multi-select, format select, person typeahead with required choice + inline create), and surface the API's field-level 422 detail instead of `api-client.ts:89`'s blanket sentence. |
| 51 | Turn budget is a scoring variable | ✅+ | Turn-burn now quantified. CFP-S1: **~30 of 70 turns adding 3 form fields** (~9–10/field; editor re-renders invalidate refs) — steps 7–12 never ran, killing CFP-03/04/17/18 (~9 weighted pts). Collapsing add-a-field to ~3 turns is the cluster's most under-rated fix. Also: `/submissions` **has no sidebar link** (rubric says "the organizer's submissions list" in two w3 items); agenda drop targets expose no accessible refs; CFP-S2 burned 43 turns on the headshot upload (fixed on live by `1fc2e2e` — **unverified post-fix; verify first, ~15 min, gates everything**). |
| 52 | submissionNotes from deployed build | ✅ still open | The rewrite **repeated the failure**: current notes contain four false route claims — `/site` (not a route), `/comms` ×2 (route is `/communications`), `/settings/webhooks` (doesn't exist), `/agenda` listed as organizer (it's the public site; builder is `/agenda-builder`). All return HTTP 200 with the shell, so a naive probe can't catch it. Fix with teeth: **generate the ROUTES block from `route-table.ts`** + PR-gate check. |
| 53 | Manual items need inbox + checklist | ✅± | Right principle, wrong list and mechanism. True non-auto set is **17 items** (2 manual, 15 auto-partial) — triage's 11 missed ABS-07 (w2), ABS-14, **SPK-07 (w3)**, SPK-10 (w2), **EMB-16 (w3)**. Auto-partials ARE auto-scored; manual verdicts *replace* (upside ≈ 0.5×weight each, ~14 weighted pts total). The checklist is **generated per run** (5 of run-1's 7 pending items were turn-cap artifacts, not manual items). Evidence: `manual-results.json` `{verdict, notes}` + `pnpm run finalize`; typo'd verdicts silently stay pending. Verify `personaEmails` deliver *before* the run. The `/communications` outbox itself satisfies several pass criteria ("a logged message with correct recipient also passes"). |
| 54 | reset:demo after every run | ✅± | Need confirmed; prescription wrong: `npm run reset:demo` targets localhost and 401s against prod without the worker's secret. **The supported path is the sidebar "↻ Reset demo" button** (any organizer session, polls the job). And the reset only sweeps the `demo_mode=1` event — **a "Forward Summit 2028" created via T-M's new endpoint survives every reset permanently** unless T-M marks created events demo_mode or T-O sweeps the demo org. |

**Free wins found (no triage issue):** CNT-06 (w1) already passes (portal prints accept-types + size limit). Shareable media link (CNT-S3 step 14 bonus) is one "Copy link" button over existing `publicMediaUrl`. ABS-08 (w2) is a roll-up of an existing correct query (`listRoundAssignments`) that no UI consumes. Sidebar "Embeds" entry (minutes of work, de-risks EMB-15 w3). Restoring the removed `Agenda data ↗` link. `submissionNotes` names `/site`, which does not exist, and lists `/agenda` as an organizer route when the builder moved to `/agenda-builder` — threatens the whole 10-weight AIA area (run-1's exact failure mode, repeating).

---

## 3. Ticket set — settled clusters (A–H; I–O pending validation)

Sections 3.x are full ticket texts, ready to mint. IDs are provisional letters; Lattice numbers assigned at mint (single-writer). Priority bands: **P0** = unlocks other scoring or stops active bleed; **P1** = direct rubric weight; **P2** = polish/optional; **WON'T** = ruled out with reasons.

### T-A · Reviewer provisioning, end to end — P0, the unlock

**Rubric:** CFP-10 (w2) direct; unlocks the entire ABS-S3 scenario (~19 of 28 item-weight in a 20-weight area). ABS-05 (w3) becomes *winnable* only through this ticket — the reviewer queue's scoping logic is already architecturally correct (`reviewer-scope.ts:195-196` requires track scope AND assignment), so a properly provisioned reviewer's queue contains exactly the assigned set with no further work.

**Build, in this order (the order is load-bearing):**

1. **"Invite reviewer" action on the committee card** (`EvaluationPage.tsx` committee dialog): name, email, track responsibilities → one transactional API that performs all four writes: `people` insert (or match by email) → `memberships (role='reviewer')` insert (**no API for this exists today — you are creating the first runtime membership writer in the codebase**) → `committee_members` insert → `reviewer_track_scopes` insert. Response includes a copyable magic link on demo conferences (reuse `mintMagicLink` with `purpose:"login"`, `redirectTo:"/reviewer"` — do not invent a second credential path). This single control satisfies CFP-S3 step 3, ABS-S2 step 6, and ABS-S3 step 1's "copyable reviewer-portal link" branch simultaneously.
2. **Demo reviewer door**: add `reviewer` to `roleSchema` and `DEMO_ROLE_TO_MEMBERSHIP` (`auth.routes.ts:32,319`) — **and fix the persona query** (`auth.routes.ts:98-105`): it has no `ORDER BY`, and the seeded staffer holds owner+program_lead+reviewer, so the naive fix can sign the judge in as the organizer (an outright CFP-10 fail: "no organizer/admin navigation exposed"). Add `ORDER BY` + exclude people holding staff roles. Surface the persona name in the response.
3. **Landing page third door** — last, and only after (1) guarantees a provisioned reviewer exists whose queue is the assigned set. Shipping the door without provisioning converts ABS-05/ABS-08 from `cannot_judge` (excluded from denominator) into hard `fail`s against seeded all-track reviewers.

**Also fix:** relax `POST /committees/{id}/reviewers`'s requirement that the person already hold a reviewer membership (`evaluation.routes.ts:577`) — the invite flow creates it; direct adds should offer to.

**Non-goals:** `seat.tsx` needs no change (already ranks `reviewer` correctly — touching it risks the working half). No reviewer password auth.

**Files:** `auth.routes.ts`, `evaluation.routes.ts`, `EvaluationPage.tsx` (committee dialog region), `landing.route.tsx`, `src/lib/auth/magic-links.ts` if needed.

**AC:** invite creates all four rows transactionally; invited reviewer's `/reviewer` queue shows exactly their assigned submissions; demo `role:"reviewer"` never resolves to a staff persona; smoke-pass performed *as the invited reviewer*, not the seeded organizer.

**Human lens:** today an organizer literally cannot add a committee member without a database. Invite-with-scopes plus copy-link-when-spam-eats-the-invite is the honest product; the demo door is scaffolding and should read as scaffolding.

---

### T-B · Review depth: per-round scorecards, criterion types, reviewer capture — P0 (critical path for T-C)

**Rubric:** ABS-01 (w3), ABS-03 (w3), ABS-07 (w2). Validation of the full loop requires T-A's seat.

**Reality check that shrinks this ticket:** criteria are **already per-round** in schema (`rubric_criteria.round_id`, unique per round/position) and the API already supports per-round criteria PUT and round PATCH (name/dates/anonymized/mode). The work is one small migration + UI.

**Build:**

1. **Round cards become the editing surface** (`EvaluationPage.tsx` `renderRoundCard`): name input, opens/closes date pickers (server 422s `opens_at<=closes_at` — render inline on the field, not the page-top alert), **anonymized toggle** (ABS-07 rides free — currently display-only text), mode select, and a per-round "Edit scorecard" button passing `round.id`. Root cause to fix: `criteria` state is a single array seeded from `rounds[0]` (`:126`) — must become per-round.
2. **Criterion kinds migration:** `kind TEXT CHECK (kind IN ('numeric','select','text')) DEFAULT 'numeric'`, `options TEXT` (json, select), `scale_min/scale_max REAL`. **Two traps:** `assertCriteriaTotal` requires weights to sum to 100 — exempt non-numeric kinds (or force weight 0) or the editor becomes a 422 wall; the editor currently has no add/remove-criterion controls — add them.
3. **Wire schema:** `criteria_scores` is `z.record(z.number())` (`review.routes.ts:22`) — widen to accept strings for select/text.
4. **Reviewer side** (`ReviewerPage.tsx`): queue payload carries the round's criteria; render numeric scales/selects/textareas; `saveNext` sends the collected map (killing the hardcoded `criteria_scores: null` at `:270`). **Plus the piece the triage missed:** a **Completed section in the queue whose items reopen read-only with stored values** — ABS-S3 step 5 explicitly requires reopening a submitted review to prove storage; without it ABS-03 caps at partial forever.
5. **Round 2 defaults to `scorecard` mode** with its own criteria (seed + `EvaluationPage.tsx:150`). Keep comparison mode as a selectable option — it's a real differentiator — just not the silent default that makes "Round 2's scorecard" a concept that can't exist.
6. **Rider:** fix the unconditional "blind mode" redaction copy at `ReviewerPage.tsx:420` (renders even for non-anonymized rounds while the API returns full identity).

**Files:** `evaluation.routes.ts`, `review.routes.ts` (schema + queue payload), `EvaluationPage.tsx` (round cards + scorecard dialog), `ReviewerPage.tsx` (scorecard region), one migration. **Collision:** T-A also edits `EvaluationPage.tsx` (committee dialog) — disjoint regions but land T-A first; T-C edits the committee card — land after B's round-card work or coordinate.

**AC:** both rounds show distinct editable names/dates/scorecards surviving reload; all three criterion kinds render reviewer-side and store; a submitted review is reopenable showing stored values; weights total-100 rule intact for numeric-only.

**Human lens:** a chair's vocabulary is "screening" and "final," not "the evaluation plan." Editable names/dates are the single cheapest "feels like a real product" win — and the API already guarantees evidence preservation on rename, which is the honest behavior.

---

### T-C · Chair results: weighted aggregates, sort, real export, progress — P1 (schema-dependent on T-B)

**Rubric:** ABS-10 (w3 — **fails outright today**: ascending sort doesn't exist), ABS-08 (w2 — nearly free), ABS-13 (w2), ABS-04 (w1 — likely already partial; don't over-invest).

**Build:**

1. **One shared aggregate helper** (view or `src/lib/`): weighted score from `criteria_scores` ⋈ `rubric_criteria.weight_pct` (numeric kinds only), per round; scalar-`score` fallback for pre-criteria evaluations, honestly labeled. Exclude `abstained` rows (see T-C2). Every consumer — list column, export, evaluation page — reads this one helper so screen and file can never disagree.
2. **Bidirectional sort:** `score_asc` in `SUBMISSION_SORTS` + clickable score header. Recommend the submissions list *is* the results table, with a prominent "View results" link from `/evaluation` into the pre-filtered score-sorted view (turn-budget: a new unlinked screen is a discovery gamble; a link from where the agent already stands is not). Column label: **"Weighted score"** (the rubric grants full ABS-04 credit for an explicit label). Show reviewer count next to score — "4.7 from 1 review" is not 4.7.
3. **Real results export:** new `GET /events/{eventId}/plans/{planId}/results/export?format=csv` (program:read): one row per submission — title, track, format, status, per-criterion scores, weighted aggregate, reviewer count, recommendation tally. Button on the results surface. **Do NOT wire the existing `/rounds/{id}/export` endpoint — it exports the reviewer's unreviewed queue with zero scores; a button on it passes the auto-half and fails the human manual check.**
4. **Per-reviewer progress:** replace the committee card's broken ratio (person's plan-wide count over the round's total assigned — `EvaluationPage.tsx:289`) with a roll-up of `listRoundAssignments`' existing correct `assigned_count/reviewed_count`. ABS-08's before/after evidence needs exactly this.

**Files:** `submissions.queries.ts`, `SubmissionsPage.tsx`, `EvaluationPage.tsx` (committee card only), new export route. Tabular numerals; sticky sort state.

**AC:** sort toggles visibly reorder both directions; aggregates match hand-checked weighted math or carry the "Weighted" label; export CSV columns match the on-screen table; progress reads 0/2 before and 2/2 after the ABS-S3 flow.

---

### T-C2 · Reviewer pools per round, recusal, reviewer reminders — P1 (independent, parallel from minute zero)

**Rubric:** ABS-02 (w2), ABS-12 (w1), ABS-09 (w1).

**Build:**

1. **Per-round committee attachment** (cheap door the rubric explicitly allows: "pool/committee"): `evaluation_rounds.committee_id` nullable FK (or join table); round card shows its pool; `distributeAssignments` already accepts `committee_id` — pass the round's. **Do not** build per-round membership rows (rejects working scope machinery).
2. **Recusal:** "Declare conflict" beside Save in the reviewer view → existing evaluation route with `abstained: 1` (column exists, hardcoded 0 today; widen `evaluationInput`, make `recommendation` optional when abstaining). Assignment completes → leaves queue naturally. **Chair side in the same PR:** exclude abstained from aggregates/denominators and show "1 recusal · needs reassignment" — a recusal that silently drags the average is worse than not shipping.
3. **Reviewer reminders:** narrow "Remind" action on progress rows (from `listRoundAssignments`' outstanding counts) queueing an outbox template. **Don't widen the comms audience engine** — it's participation-shaped and reviewers aren't.

**Files:** committee/round-pool controls, `ReviewerPage.tsx` (one button — land after T-B or rebase), comms template, small migration. Depends on T-A for add-reviewer UI existing at all.

---

### T-D1 · Speaker roster + person CRUD — P0 (the membership fix everything else stands on)

**Rubric:** SPK-01 (w3), SPK-02 (w3), SPK-04 (w2), SPK-15 (w1 rider), assists SPK-11. ~9 overall points ride on this cluster with D2/D3.

**Build:**

1. **Fix the memberships gap first:** runtime speaker-creation paths (admin create, public form, importer, acceptance cascade) must produce roster visibility. Either write `memberships(role='speaker')` at the acceptance boundary (mirroring the seed's bridge) **or** make the roster participation-derived; pick one and make the onboarding board read the same truth. Also remove the `owedCount === 0` vanishing act for the roster context (`onboarding.queries.ts:300`) — a roster lists *all* speakers.
2. **`/speakers` route + sidebar entry** (label exactly "Speakers"), backed by new `speakers.routes.ts` querying `people ⋈ participations ⋈ submissions(event)` — the same join quick-search already uses, so the two can't disagree. Search + filters (status, track).
3. **Add/edit speaker**: full profile including **bio** (SPK-02 names it; admin create currently inserts bio as literal NULL) — `POST/PATCH /events/{id}/speakers`. **Share the portal's `updateProfile` normalizer** (`portal.routes.ts:1303`); a second normalizer is how the SPK-08 round-trip diverges. Audit rows on organizer edits (free CNT-11 evidence).
4. **Workflow status:** surface per-session `confirmation_status` rollup as Invited/Confirmed/Declined badge + filter + organizer-settable override ("she confirmed on a call"). **No new person-level status column** — that's the two-screens-contradiction failure this project already paid for once.
5. **Riders:** `custom_fields` JSON column + "Logistics & notes" section (SPK-15, w1 — skip the field-definition engine); wire the dead `?person=` deep-link from quick-search on both roster and onboarding.

**Files:** new `speakers.routes.ts` + `src/ui/speakers/`, `onboarding.queries.ts` (D1 owns it; T-E owns `onboarding.routes.ts`), `route-table.ts` row, one migration (custom_fields (+ membership backfill if that path is chosen)).

**AC:** a speaker created via admin, public form, and importer each appears on the roster; completed speakers remain listed; bio edit survives reload; status filter narrows correctly; CNT-10's sentinel round-trip passes.

**Human lens:** the organizer's mental model is a person list; the chase matrix is a derived question. Keep both, with the chase board effectively a saved filter of the roster — not a parallel universe with its own membership rules.

---

### T-D2 · Headshots render + speaker files panel — P1 (parallel with D1)

**Rubric:** SPK-08 (w3), SPK-10 (w2), half of CNT-10 (w2).

**Build:** one serve path for `person_headshot` attachments (widen the preview handler's join — it currently reaches attachments only via `submission_answers`, `uploads.routes.ts:604-608` — or add `GET /events/{id}/people/{personId}/headshot`), then `<img>` in three places: **portal profile (the speaker currently never sees their own uploaded headshot render — SPK-08 fails on the speaker half too)**, roster row, speaker record. Files panel on the speaker record: attachments where owner is the person + their task uploads — filename, size, uploaded-at, download. **Consume T-F1's `listVersionsFor` helper and `FileVersions` component; write no attachments SQL of your own** (this dissolves the D↔F coordination hazard).

**Files:** `uploads.routes.ts` (read/serve handlers only — T-F owns sign/complete), portal + roster + record renders. Initials fallback stays for the photo-less.

---

### T-D3 · Portal invite + speakers CSV — P1, small, highest ROI in the speaker cluster

**Rubric:** SPK-06 (w2), SPK-03 (w2), plus coverage protection for SPK-07/09 (w3/w2) and CNT-02/03 (w3/w3): the on-screen demo magic link is the most reliable way the judge reaches the portal at all.

**Build:** "Invite to portal" on the speaker record + bulk roster action → existing magic-link machinery (organizer-authenticated variant; demo mode already returns the link on screen; outbox row gives "logs the send" free). Stamp `participations.invited_at` (already written on the co-speaker path). CSV: make `external_ref` optional for speakers (importer already synthesizes identity from email), accept a speakers-only manifest, entry point **on the roster** ("Import speakers") — **the kit's own fixture CSV has no `external_ref` column and fails today's validation**, and the only in-app link to `/import` renders solely on an empty program.

---

### T-E · Task authoring — P0 (16 of CNT's 31 item-weight downstream)

**Rubric:** CNT-01 (w3 — the area's entry point), SPK-05 (w2); unblocks the CNT-S1→S2→S3 chain (CNT-02/04/05/07/08/13 evidence all flows from a created task).

**Build:** full CRUD on `task_templates` — POST/DELETE plus PATCH beyond file_config (name, kind `acknowledge|file|form`, description, **`due_at` or `due_offset_days` — the CHECK makes them mutually exclusive, and the eval wants literal dates (2027-05-01), so expose `due_at` in the UI**; `kind='form' ⇒ form_id NOT NULL`). `POST /speaker-tasks` for direct multi-speaker assignment bypassing `auto_assign`. **Fix the existing page** (`TaskTemplatesPage.tsx`): remove the file-kind-only filter (`:173`), give the empty state the control it instructs you to use (`:183`), sidebar/settings link (EventSettings links venues but not tasks). Note the acceptance cascade already mints tasks at runtime — this is authoring + ad-hoc assignment, not a task engine.

**Files:** `task-templates.routes.ts` (extend — it exists now), new assignment route in `onboarding.routes.ts` (T-E owns it), `TaskTemplatesPage.tsx`, route-table/settings links. Both fixture tasks creatable with names, due dates, multi-speaker assignment per CNT-01's pass line.

---

### T-F1 · Files library + versions — P0 (keystone of the content area)

**Rubric:** CNT-13 (w1) direct, but it's the only door to the organizer half of CNT-04 (w2), CNT-05 (w2), CNT-14 (w2) — ~23% of the area hangs on this one screen. Plus the **CNT-02 (w3) rescue**: the portal never shows an uploaded filename; after upload the speaker sees a ✓ and no evidence of what they uploaded.

**Build:**

1. **No migration.** Versioning already exists in storage: every presign mints a new attachment row with unique r2_key; `speaker_tasks.attachment_id` is the latest-pointer; superseded `ready` rows persist. Ship `src/lib/files/versions.ts` — `listVersionsFor(db, ownerType, ownerId)` with `ROW_NUMBER()` version numbers and **`is_latest` derived as `attachments.id = speaker_tasks.attachment_id` — derive, never store** (a stored flag can drift from the pointer the portal writes; that's how AV stages the wrong deck).
2. **`FileVersions` component**, mounted in the portal task row (`slides.pdf · v2 of 2 · uploaded …` + prior versions listed, each downloadable) and in the library. T-D2 consumes both exports.
3. **`/files` route, sidebar label exactly "Files"** (the spec enumerates the agent's guesses; match one verbatim). `GET /events/{id}/files`: attachments → speaker_tasks → submissions/people. Columns: filename, session, speaker, uploaded, version count, size. Row expands to versions + (later) the T-F2 thread. "Copy link" per row over existing `publicMediaUrl` (CNT-S3 step 14 bonus — state the honest caveat: unauthenticated capability URLs).
4. Skip the per-session Files tab (rubric explicitly forgives its absence).

**Human lens:** the honest library lists **expected** deliverables too — one row per speaker×file-task, filled or empty, chaseable in place. That's the screen an AV lead runs the show from, and it makes the library and the chase board two views of one truth.

---

### T-F2 · Deliverable comments — P1 (after F1's detail surface)

**Rubric:** CNT-05 (w2). One migration: `file_comments(id, event_id, owner_type, owner_id, attachment_id NULL, author_person_id, body, created_at)`. **Anchor on the deliverable slot, not the attachment** — the scenario comments on v1, uploads v2, then the organizer replies on the same thread; attachment-anchored threads orphan and the failure reads as data loss. `attachment_id` is a nullable "written against v1" tag. Author name + **role** on every comment; version chip. Organizer reads/replies in the library detail; speaker in the portal task row. **Build no mail — the rubric explicitly excuses notifications.**

---

### T-F3 · Bulk ZIP export — P1 (after F1's selection surface)

**Rubric:** CNT-14 (w2, auto-partial). **The scored artifact is the visible state, not the bytes:** CNT-S3 step 13 says "do NOT download the ZIP," so a bare `<a download>` scores `not_found` even when it works. Build multi-select in the library → export dialog (grouping: by session / by speaker) → **visible Preparing→Ready panel**. Mechanism: streaming ZIP via TransformStream over the `MEDIA` binding, **STORE not deflate** (decks are already compressed; CPU is the billed budget), latest-only via F1's `is_latest` derivation (one definition of "current" shared with the version list, or the manual check fails while the UI looks right). Folder names humans use: `Thu-1400-Room_Speaker/`, `manifest.txt` listing missing deliverables, total size shown before generating. Vendored ~120-line ZIP-STORE encoder or `client-zip` (~3KB) — operator's call; the queued-to-R2 variant is a later swap behind the same Ready panel.

---

### T-G · Organizer content editing, with named history and restore — P1 (rescoped: the editor doesn't exist)

**Rubric:** CNT-09 (w2), CNT-11 (w2), feeds CNT-12 (w3) — the largest lever in the content area, missed by the triage. The proposed "attribution + restore" ticket assumed an editor that isn't there: `patchDraft` hard-rejects non-drafts (`submission-record.routes.ts:793`) and the record page renders its editor only for drafts.

**Build:** extend the record editor to accepted/scheduled sessions (explicit status allowlist; published records behind a confirm). Every write emits before/after audit rows composed into the same `batch()` as the change. **Lift the portal's proven history machinery** (`historyFor` already joins people for actor names and renders "Priya Raman · 12 Aug · updated title") into `src/lib/history.ts` rather than writing a second one; add the missing people-join to the admin history query (~2 lines) and stop rendering the literal string "user" (`actor_kind`). **Restore is a forward edit**: re-apply `before_json` through the same write path, emit `content_restored` with its own before/after; never rewrite history. **Ownership split with T-D1:** G owns session content editing + the history component on the submission record; D1 owns the speaker record (CNT-10) and consumes G's history component.

---

### T-I · Public session cards + facets + agenda framing — P1 (highest-leverage public change; no new data needed)

**Rubric:** EMB-01 (w3), EMB-09 (w2), EMB-03 (w2), de-risks EMB-06 (w3).

**Build:**

1. **Card anatomy** on public agenda + embed session/agenda kinds: description snippet (**server-truncated** 2–3 lines — speed budget AC-85 pins agenda-cold-interactive; don't ship full abstracts) with `<details>`-based "Show more" (pages are SSR strings; zero JS), speaker job title/company (already in the projection, pure render), **and Format — which the public data model doesn't carry at all**: add the formats join + field to `PublicSession`. Without Format, EMB-01 caps at partial no matter how pretty the card.
2. **Facets:** Format + Location/room selects beside the existing Track (two WHERE clauses in `sessionRowsQuery`; rooms already joined). Inline selects satisfy the rubric — no facet modal.
3. **Agenda framing:** default to day 1 (or add sticky time-group headers under "All days") — EMB-06 **passes on a time-slotted list per its own pass_criteria; the room-column grid earns zero and is dropped from scope**. The current all-days default is the weakest presentation of a passing feature; the first screenshot is what the judge reads.
4. **Contract for T-J (if ever built):** emit a stable per-card hook (`data-public-session-id` exists) so a future star control is a script module, not an edit to this render tree.

**Human lens:** on a phone in a hallway, the time-ordered list beats the grid; the rubric agrees with the better product here. And for a multi-building venue (which Marquee uniquely models, transit conflicts and all), the Location facet is honest product, not rubric-chasing.

---

### T-I2 · Public speaker directory — P1

**Rubric:** EMB-05 (w2 — partial today, the detail page is fully built), EMB-12 (w2), EMB-04 (w3 with T-I3), EMB-13 (w1 — accept back-nav, don't build a modal), feeds unowned **EMB-14 (w3)** by making the fifth enumerable public surface.

**Build:** a real `/speakers` public page (reuse `PublicShell`), grid cards linking to the existing `/p/:slug` detail; `q` search input (server-side name/company matching already exists — it's a missing input, not a missing capability); make the embed's speaker cards actual links.

---

### T-I3 · Headshot seeding + public rendering — P1 (three blockers, one ticket)

**Rubric:** completes EMB-04 (w3) + EMB-12 (w2); also the visible half of SPK-08's public payoff.

**Build:** (1) seed **deliberately synthetic** avatars (deterministic monogram/geometric SVG, committed as static assets) for the ~30 published speakers, leaving 2–3 photo-less — EMB-12 explicitly rewards the graceful fallback, and the seed's no-real-photos rule stays intact; (2) `headshotUrl` on `PublicSpeakerSummary` + `parseSpeakers`; (3) `<img>` with initials fallback on directory cards, embed speaker kinds, `/p/:slug`. **Don't wire the R2 media origin for this** (production blast radius, zero rubric gain). The real-product path — speaker-uploaded photos flowing to the public site via an inline-image route — is post-deadline follow-up tied to T-D2.

---

### T-K · Embeds as an organizer area — P1 (w3, and the first step takes minutes)

**Rubric:** EMB-15 (w3). Partial floor already cleared (four widget kinds, filters, branding, copyable snippet).

**Build, strictly in this order:** (1) **sidebar "Embeds" row in `route-table.ts` — ship first, alone if needed**: EMB-S3 is organizer-persona and currently has no admin path to `/embed/config` (it lives two hops away on the public site); (2) JSON output format in the builder's picker — the anonymous public API already exists, this is ~10 lines — and restore the `Agenda data ↗` feed link that was removed between `13a77cb` and `4b2dc09`; (3) iCal format (doubles as the public add-to-calendar answer); (4) saved-embed CRUD on the existing, deliberately-empty `embeds` table (migration 0007's comment is the design note): naming, enable/disable, list. **Skip XML** — rubric-chasing nobody consumes.

**Human lens:** named, toggleable embeds are finishing an intended design (the table is waiting), not gaming a rubric — a marketer with five embeds across pages eventually needs to turn one off without editing HTML.

---

### T-L · Batch publish in the agenda builder — P1 (small)

**Rubric:** AIA-07 (w2). Per-record publish exists but the seed leaves exactly one unpublished session — near-unfindable. Build a builder-level **batch** publish: persistent counter in the chrome ("23 live · 1 not yet public"), select-unpublished → publish N with a diff preview (titles/times/rooms/speakers about to go public), success state, link to the public agenda. **Keep the `status='accepted'` guard** — the reversal-safety comment at the publish route explains why (a stage-based test would publish a withdrawn speaker; this exact class of bug was caught pre-merge once already). Auto-schedule (AIA-08): **WON'T** — 0.56 overall points; if ever revisited, it's a per-slot *proposal* driven by the existing conflict engine, not an apply.

---

### T-J · Personal attendee schedule — WON'T (for the eval window)

EMB-10 + EMB-11 total 1.14 overall points; both are kit-flagged "(inferred — a faithful clone would lack it)". It's the largest new subsystem in the public cluster for the smallest reward. **Carve-out that ships:** single-session "Add to calendar" ICS on `/s/:slug` (~30 lines, reuse the invite VEVENT builder) — the thing a real attendee actually wants, and plausible partial EMB-11 credit. The full favorites/My-Schedule feature is genuinely beloved product (Sessionize's most-used attendee feature) — build it *after* the deadline, localStorage-first, no login wall.

---

### T-Z · Wave 0: verification + free wins — P0, ships first, hours not days

The cheapest points on the board, most of them minutes each. One PR (or two small ones), no schema, no risk:

1. **Verify the headshot upload fix on live** (~15 min, browser session against `marquee.stage11.dev`): `1fc2e2e` (MRQ-92) fixed the browser→R2 PUT path and the public form uses it — but nobody has exercised the public CFP file field post-fix. It cost 43 of CFP-S2's 70 turns and 20 of CFP-S3's. **If it's not actually fixed, everything else is noise. Do this before anything.**
2. **Regenerate `submissionNotes` truthfully** — remove `/site`, `/settings/webhooks`, fix `/comms`→`/communications`, move `/agenda` to public and name `/agenda-builder` as the builder. Then build the generator: script in `scripts/checks/` emitting the ROUTES block from `route-table.ts` + `app.tsx`'s public predicate, failing the PR gate on drift (hand-maintained notes have now lied twice).
3. **Sidebar rows:** "Embeds" → `/embed/config` (de-risks EMB-15 w3); `sidebar: true` for `/submissions` ("Abstracts & sessions" — the rubric's two w3 items say "the organizer's submissions list"); an entry for `/submissions/new`.
4. **Restore the `Agenda data ↗` feed link** removed between `13a77cb` and `4b2dc09`.
5. **`?status=accepted` escape hatch:** when the stage filter yields 0 while `accepted_any` > 0, render "0 in Ready to place · N accepted overall — view all accepted" with the param-swap link.
6. **De-dress the fake event switcher** (`Sidebar.tsx:11` renders class `event-switcher` around a plain `/dashboard` link) — label it as what it is until T-M makes it real.

### T-H · The public form saves drafts truthfully — P1 (small; owns PublicForm.tsx so T-Z doesn't collide)

**Rubric:** CFP-07 (w1) plus the judge-flagged credibility major (the false indicator made the run-1 judge hallucinate a localStorage mechanism from our own copy, then report the contradiction).

**Build:** (1) **Delete the "Draft saved locally · just now" lie** (`PublicForm.tsx:469` renders it whenever no resume token exists; `ensureDraft()`'s only caller is `handleFile`) — reserve the status line's space so removal doesn't shift the row. (2) "Save draft" control in the footer next to Submit. **Trap:** `ensureDraft()` hard-requires an email, but CFP-S2 enters *only a title* — ask for the address inline at the moment of saving instead of erroring. (3) Truthful states after save ("Saved HH:MM"); the existing autosave effect takes over once a resume token exists. (4) **Show the resume link on screen**, copyable — the judge cannot read mail, and a human whose mail is slow has no other way back. (5) Fix the "this conference can review up to four participants" copy vs the single co-speaker slot — make the copy true. The entire draft backend (create/patch drafts, resume tokens, `draft_resume` mail, resumed banner) already ships; this is a finished feature with no button.

### T-M · Multi-event — P1 (1–2 days, not a week; ≈ +3.0 overall points)

**Rubric:** CFP-17 (w2) + CFP-18 (w2), both scored `not_found` (in the denominator — real zeros, not coverage drag). Moving both to pass ≈ +14.9pp on the CFP area ≈ **+3.0 overall**, and doubles the `scoping` type row — the kit's own "strongest signal."

**Why it's small:** the schema is fully event-scoped (composite FKs and all), authorization already resolves per-event per-request, and the demo organizer already holds an **org-wide** owner membership (`event_id: null` in the seed) — no membership plumbing.

**Build:** (1) `POST /api/v1/events` + `GET /api/v1/events` (org-scoped). (2) An event context in `AppShell` replacing the **16 hardcoded `evt_aie-ny-2026` default props** (no `createContext` exists in `src/ui/` yet — add one, thread it; mechanical). (3) A real event switcher where the fake one sits. (4) **A created event must render a working empty shell** — CFP-S1 step 12 opens the second event's submissions area; a 500 scores worse than absence. Seed minimal valid state, ideally "start from AIE NYC 2026" (copy formats/tracks/form/task templates). (5) **Mark events created in the demo org as `demo_mode=1`** (or T-O's reset sweeps the org) — otherwise the judge's "Forward Summit 2028" survives every reset, permanently, in the judge-visible workspace.

**Human lens:** conferences are serial — AIE runs four a year. "Create next year's event from this one" is the single highest-value organizer action Marquee could ship, and the schema is already shaped for it. That's the honest version of a rubric line about a second event existing.

### T-N1 · Shell truth: name, branding, IA — P0 (low risk, parallel-safe)

**Build:** wire `eventName` from the API in the existing boot path (`useIdentity`/`useSeat` already fetch there) and make the prop **required** — the default is currently the only value that ever exists; same for `DeliveryHealthShell`. Reconcile all **five** stale brand strings (landing footer + hero note hardcoded "AIE NYC 2026" on the run's highest-traffic page; seeded form name "2026 CFP" collides with conference-year vocabulary — rename to "Call for Speakers"). Add `AIE NYC 2026` as a forbidden literal outside seed/fixtures in `scripts/checks/` so it can't grow back.

**Rubric:** protects CFP-03 (w3), kills two judge defect lines, and closes the "renamed the conference but the shell disagrees" trust hole (the judge recorded it as "a stale cached label bug" — a human organizer concludes their save failed).

### T-N2 · Bound form options — P1 (own ticket; touches the public submit path)

**Rubric exposure: 8 weighted points** (CFP-01 w3, CFP-06 w3, CFP-15 w2) **plus a live data-loss trap**: the server binds format/track by *name at submit time* and hard-rejects on mismatch — rename a format in Settings and every in-flight public form rejects submissions with "Choose a format from the list" pointing at a dropdown that visibly contains it. Run 1 dodged this only because the agent edited both sides in one session.

**Build:** first-class bound field — `form_fields.config.source: "formats" | "tracks"`; the builder renders "Options come from Conference settings → Formats" (read-only, linked) instead of a comma text box; the public form renders live rows; migrate the seeded format/tracks fields. Keep free-text options for genuinely custom selects. **Not in the same PR as string fixes** — different blast radius, different reviewer attention.

**Also in this ticket (same surface, biggest turn payoff in the sweep):** collapse the form-builder's add-a-field loop from ~9–10 agent turns to ~3 — one inline row (type + label + required + options, single save), stable element refs across re-renders. Run 1 spent ~30 of CFP-S1's 70 turns adding three fields; the steps that died at the cap (7–12) carry ~9 weighted points. Nine turns per field is also nine interactions for a human building a 20-field CFP — the agent cap and the human's patience are the same measurement.

### T-N3 · Admin create-submission pickers — P1 (half a day; the resilience surface)

No rubric item names this screen — it's **the fallback the judge reaches when the public path fails**, and its quality decides how much of a run is salvageable (10 weighted points of run-1 damage flowed through it). **Build:** track multi-select and format select from the existing settings endpoints; **submitter person typeahead with required choice** (+ inline create-person) — the blank field the triage missed is what made "AIE Program Committee" the speaker of record across CFP-06/13/15; field-level 422 surfacing to replace `api-client.ts:89`'s blanket "That change would leave the program in a state it cannot be in."

**Also:** give agenda-builder slots real accessible roles/labels (CFP-S4 burned 9 turns because drop targets expose no refs; costs CFP-15 w2 and every AIA item).

### T-O · Eval run discipline + manual verification pass — P0 process, human-in-the-loop

**Corrected mechanics (the triage had the list and the mechanism wrong):**
- The non-auto set is **17 items** (2 `manual`: CFP-08, SPK-16; 15 `auto-partial`), not 11 — the misses include two w3s (SPK-07 portal scoping, EMB-16 cross-surface consistency). Prioritize by weight: SPK-07, EMB-15, EMB-16 first.
- Auto-partials are auto-scored; a manual verdict **replaces** (upside ≈ 0.5×weight each; ~14 weighted points across the set). `cannot_judge` items resolved manually add full weight to the denominator *and* coverage — the thing guarding the 60% cliff.
- **The checklist is generated per run** — 5 of run-1's 7 pending CFP items were turn-cap artifacts. Walk it after each run from the run's own `manual-checklist.md`.
- Evidence format: `manual-results.json` keyed by item ID, `{"verdict": "pass|partial|fail|not_found", "notes": "..."}`, then `pnpm run finalize -- --run runs/<dir>`. Gotchas: unknown IDs are ignored with a warning; a typo'd verdict silently leaves the item pending.
- **Before any run:** verify the configured `personaEmails` (`benevolent.futures+sbek-*@gmail.com`) actually deliver — CFP-08/14, SPK-06/13/16, CNT-08 all need a live inbox. Note Marquee's own `/communications` outbox satisfies several pass criteria ("a logged in-app message with correct recipient also passes").
- **Reset via the sidebar "↻ Reset demo" button**, not `npm run reset:demo` (localhost-only; 401s against prod without the worker secret). Standing post-run step. Coordinate with T-M so agent-created events don't survive resets.

## 4. Sequencing, collisions, and the shape of the work

**Dependency spine:** T-Z (verify + free wins) → T-A (reviewer seat unlocks ABS validation) → T-B (schema for criteria capture) → T-C. Everything else parallelizes: T-D1/D2/D3, T-E, T-F1(→F2/F3), T-G, T-I/I2/I3, T-K, T-L, T-M, T-N1/N2/N3 are mutually independent given the file-ownership rules below.

**File-ownership rules (the only cross-ticket contracts):**
1. `EvaluationPage.tsx`: T-A owns the committee dialog, T-B the round cards/scorecard dialog, T-C the committee card. Land A → B → C, or coordinate; the file is one-line-per-component JSX where merge conflicts resolve *cleanly and wrongly*.
2. `ReviewerPage.tsx`: T-B owns it; T-C2's recusal button lands after B or rebases. (The original "B gets scorecard region, C gets toolbar" rule is unworkable — rejected.)
3. `uploads.routes.ts`: T-D2 owns read/serve handlers; T-F owns sign/complete. Disjoint handlers.
4. Attachments SQL: **only T-F1 writes it** — ships `listVersionsFor` + `FileVersions`; T-D2 consumes both. (The original "D renders existing shape, F upgrades underneath" rule was a trap — rejected; F1 needs no migration at all.)
5. `PublicAgendaPage.tsx`: T-I owns the render tree and emits per-card hooks; any future star/schedule work is a script module against those hooks.
6. `route-table.ts`: touched by Z, D1, F1, K, N — trivial conflicts, rebase freely.
7. History component: T-G builds it (lifted from the portal's `historyFor`); T-D1 consumes it on the speaker record.
8. T-M ↔ T-O: created events must be reset-sweepable (demo_mode flag or org sweep) — named in both tickets.

**Points-per-hour, blended across all six validators:**

| Rank | Work | Payoff |
|---|---|---|
| 1 | T-Z (verify upload fix; notes; sidebar rows; string lies) | gates everything + ~4 w3 de-risks, hours |
| 2 | T-A reviewer provisioning | ~19 item-weight of ABS becomes gradeable; ABS-05 w3 winnable |
| 3 | T-E task authoring | 16/31 of CNT unblocked |
| 4 | T-F1 files library | 7/31 of CNT + CNT-02 w3 rescue |
| 5 | T-N2 bound options + field-loop ergonomics | 8 wpts protected + ~9 wpts of turn recovery |
| 6 | T-B → T-C review depth/results | ABS-01/03/07/10/08/13 |
| 7 | T-D1/D2/D3 speaker roster | ~9 overall pts |
| 8 | T-I/I2/I3 public cards/directory/headshots | EMB-01/03/04/05/09/12 |
| 9 | T-M multi-event | +3.0 overall, doubles `scoping` |
| 10 | T-K embeds, T-G content editing, T-L publish, T-N3 pickers | w3+w2 singles |
| — | T-O every run | up to ~14 wpts + coverage above the 60% cliff |

**Ruled out, with reasons:** room-column agenda grid (EMB-06 passes on the list; grid earns zero); auto-schedule (0.56 pts); personal attendee schedule pre-deadline (1.14 pts for the largest new subsystem — build it after; it's genuinely great product); XML embed format (nobody consumes it); facet modals; a `versions` table (data already exists); widening the comms audience engine for reviewers (wrong shape); per-round membership rows (committee-attach is the honest cheap door).

**The human thread through all of it:** the eval judge is an LLM driving the UI under a turn budget — which makes it a proxy for exactly the things humans feel: findable surfaces, honest labels, controls that don't lie, loops that close. Nothing in this plan is rubric-chasing that a human would resent; everywhere the cheap fix and the honest fix diverged (ABS-13's fake export button, stock-photo headshots, a recusal that silently drags averages, a "saved" badge that saves nothing), the tickets specify the honest one.
