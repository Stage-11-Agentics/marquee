# Marquee — User Stories (canonical)

**Status:** Phase-3 canonical artifact, minted 2026-08-08 · Amendments 1–9 applied (see tail sections). **76 stories · 249 live acceptance criteria** (250 IDs allocated; AC-239 is struck and retired).
**Authority:** This file supersedes `research/user-stories-draft.md` for all build purposes. The draft is retained unchanged as the research archive.
**Upstream:** `PHILOSOPHY.md` · `sequence/PRODUCT-DEFINITION.md` · `research/competition-requirements.md` (R1–R50) · `research/stakeholders.md` (15 seats) · `research/landscape-features.md` (D1–D15) · `research/seams-feasibility.md`.

---

## The AC ID contract

**AC IDs are permanent.** `AC-1` … `AC-250` are allocated once, here, and are never renumbered, never reused, and never reordered. Reordering stories does not move AC IDs — `AC-225`–`AC-229` belong to a Tier B rank-8 story and `AC-230` to a rank-3 story, which is expected: **ID order is allocation order, not build order.** If a criterion is deleted it is struck, not recycled. **The next amendment appends from `AC-251`.** Every downstream artifact — SPEC, test names, PR descriptions, the evaluation harness — cites these IDs.

**Story IDs (`US-nn`)** are carried over unchanged from the draft corpus so the archive stays cross-referenceable. They are *not* sequential in this file: they appear in build order, not numeric order. `US-68`–`US-71` were minted at consolidation; `US-72`–`US-73` at the contract-review fold; `US-74`–`US-76` by amendment.

**Criterion style.** Every live AC is pass/fail. A criterion that is inherently experiential — a judgement about feel that no assertion settles — is tagged **(candidate-felt)** and belongs to design review and the prototype stage, not the test suite. **There are 5 of them.** The other 244 live criteria are mechanically testable; AC-239 is struck and has no test.

**Tags.** `[R-nn]` traces to the requirements register. `(new)` marks stories minted at consolidation or later; `*(appended <date>)*` marks a criterion added to a pre-existing story.

---

## Scope at a glance

| Tier | Stories | ACs | Count | Meaning |
|---|---|---|---|---|
| **A — the walkthrough loop** | 27 | AC-1 – AC-90, **AC-231, AC-234, AC-240, AC-244–246** | 96 | Binding. Any one failing loses the competition regardless of the rest — no waivers (`EVALUATION.md` gate 18) |
| **B — ordered differentiators** | 28 | AC-91 – AC-169, **AC-225 – AC-230, AC-232, AC-235–238, AC-241–243, AC-247–250** | 97 | Built in the order listed; the cut line moves up from the bottom |
| **Cut-line criterion on a Tier A story** | — | **AC-233** | 1 | Speaker Handbook. Hosted on US-39, *outside* Tier A's no-waiver set; may be cut if the cut is named (gate 19) |
| **Post-competition** | 21 | AC-170 – AC-224 | 55 | Modeled where cheap, not built by Wednesday |

**Tier A + Tier B = 55 stories = the Wednesday target.** Totals: **76 stories · 249 live criteria** (250 allocated IDs; one struck).

> **Note for gate 18.** Tier A's no-waiver set is `AC-1 – AC-90` **plus AC-231, AC-234, AC-240, and AC-244–246** (Turnstile; multi-track; scheduled/published legibility; reviewer detail, recommendation path, and track authorization). AC-232/235–238/241–243/247–249 are Tier B; AC-239 is struck; AC-233 is explicitly cuttable. The AC range and the tier are not the same thing; read the table and the amendment sections, not the numbering.

### What changed at consolidation (2026-08-08)

1. **US-30 (multi-round) promoted from deferred into Tier B**, at reduced scope: two rounds, funnel promotion, per-round scorecard. Flagged in the draft as the riskiest deferral — brief item 4 says *"across multiple rounds"* verbatim. Signed.
2. **Three agent-native stories minted** — `US-68` (REST API the UI rides on), `US-69` (`marquee` CLI), `US-70` (shipped `SKILL.md`) — from PHILOSOPHY principle 3. Tier B, explicitly framed so they cannot eat the loop.
3. **`US-71` minted** — comparison-mode triage as an optional round-1 evaluation mode. Tier B, low.
4. `US-66` (Sessionize mid-CFP migration) and `US-67` (global quick-search) stay where the follow-up pass placed them.

### Amendment 1 — contract-review fold (2026-08-08)

Closes four `SPEC.md` flags that identified contract items with no acceptance criterion. Appended per this file's own rules: no renumbering, new IDs from AC-225.

| # | Change | IDs | Closes |
|---|---|---|---|
| 1 | **`US-72` minted** — genuine two-way Airtable mirror. Initially Tier B rank 7, directly after the API story it rides on; final rank **8** after Amendment 8 inserted US-76. | AC-225 – AC-229 | **F-1** (gate 9 uncovered) |
| 2 | **`US-73` minted** — reset the demo. Tier B **rank 3**. | AC-230 | **F-5** (gate 13 uncovered) |
| 3 | Turnstile verified server-side, appended to `US-14`. | AC-231 | **F-6** (guardrail G8) |
| 4 | Upload allowlist / magic-byte sniff / rate caps / separate origin, appended to `US-41`. | AC-232 | **F-6** (guardrail G8) |
| 5 | Speaker Handbook page, appended to `US-39`, below the cut line. | AC-233 | **F-3** |

Tier B ranks 3–23 shifted down to 4–25 to open the two slots. **No AC ID moved.** Flags **F-2** (seed scale vs AC-3), **F-4** (prototype toast affordances), **F-7** (KV TTL, spec'd at 30s), and **F-8** (5s SWR poll) are not AC changes and remain where `SPEC.md` records them.

---

# Tier A — the walkthrough loop

The judge's test script is the walkthrough video: someone opens the deployed URL and tries to do, in order, what swyx did on camera. These 27 stories are that sequence. Ordered by loop step, not by value — because the loop is a chain, and a chain has no most-important link.

## Loop step 1 · Land and self-serve

### US-01 · A judge lands on a working, populated product
**As a** prospective buyer evaluating ~30 submissions, **I want** the deployed URL to hand me a working, already-populated demo and a login immediately, **so that** I can start evaluating instead of setting up.

- **AC-1** The landing page states what the product is and offers organizer and speaker demo entry without a form, a signup, or a request-demo gate. A first-time viewer understands what Marquee is and how to get in, unaided. **(candidate-felt)**
- **AC-2** Both demo entry points work on first click and land on a populated screen; neither can reach an empty state.
- **AC-3** The seeded event contains ≥800 submissions, ≥150 accepted speakers, and a populated agenda, so lists, filters, and sorts are exercised at real scale.
- **AC-4** Every screen reachable from either demo entry renders real content — no stub, no placeholder copy, no dead link.

`[R-25, R-46]` · Source: dossier §3 — *"shipping an empty database is the single most likely way to lose"*

## Loop step 2 · Configure the event

### US-03 · Configure the event
**As a** program lead, **I want** an event settings screen for name, dates, venue, timezone, and branding, **so that** every downstream surface inherits the right details.

- **AC-5** Event name, start/end dates, timezone, venue, and logo are editable and persist across reload.
- **AC-6** Changing the event timezone changes rendered times on the agenda and in outbound calendar invites, with no per-session edit.
- **AC-7** Saving confirms in place without a full page reload.

`[R-10]` · Source: walkthrough [02:40]

### US-04 · Define session formats with default durations
**As a** program lead, **I want** to define the formats my event accepts and give each a default duration, **so that** agenda blocks are the right length without setting each one.

- **AC-8** Formats are user-defined with a name and default duration; the seeded event carries AIE's four (Workshop 1–2h, Stage Talk 15–20m, Lightning 5–10m, Online 5–55m).
- **AC-9** A session created with a format inherits that duration and can be overridden per session.
- **AC-10** Format appears as a selectable field on submission forms and as a filter on submission lists.

`[R-44, R-5]` · Source: sessionize.com/aienyc2026

### US-05 · Define tracks and rooms
**As a** program lead, **I want** tracks and rooms defined up front, **so that** submissions are categorized on intake and scheduled without re-keying.

- **AC-11** Tracks and rooms can be created, renamed, and reordered from event settings.
- **AC-12** A track carries a color applied consistently across agenda views and the public program.
- **AC-13** A room carries a capacity, surfaced when scheduling into it.

`[R-5, R-1]` · Source: learn.sessionboard.com/sessions/agenda

## Loop step 3 · The program dashboard

### US-06 · Land on a dashboard that says what to do next
**As a** program lead opening the product mid-CFP, **I want** submissions by status, review progress, days to close, and outstanding onboarding on one screen, **so that** I know the state of the program without hunting.

- **AC-14** The dashboard shows counts by submission status and by format/track, updating without manual refresh.
- **AC-15** Every dashboard number is clickable and lands on the filtered list behind it.
- **AC-16** The dashboard renders in under 1s against the seeded dataset, and reads as an operator's home surface rather than a report. **(candidate-felt)**

`[R-11, R-6, R-7]` · Source: walkthrough [03:17]; the navigation failure at [03:58]

## Loop step 4 · Build the CFP form

### US-07 · Build a submission form
**As a** program lead, **I want** a form builder where I add, order, and configure fields, **so that** I can ask for exactly what my event needs.

- **AC-17** Fields can be added, reordered by drag, edited, and deleted; order persists to the public form.
- **AC-18** Field types include at minimum: short text, long text, single select, multi select, URL, email, file upload, number.
- **AC-19** The builder shows a live preview matching what a submitter sees.
- **AC-20** A form can be duplicated, carrying its fields and settings.

`[R-13, R-28]` · Source: walkthrough [04:49] — *"a very fancy form builder"*

### US-08 · Target a form at abstracts or at sessions
**As a** program lead, **I want** to choose at build time whether a form collects **abstracts** or **sessions**, **so that** submissions land on the right side of the review pipeline.

- **AC-21** The form carries an explicit abstract-vs-session target, set at build time and visible in the form list.
- **AC-22** Abstract submissions enter the evaluation pipeline; session submissions can reach the agenda with no evaluation and render as complete, not as missing data.
- **AC-23** The two entity types are distinguishable wherever they are listed together.

`[R-9, R-13]` · Source: walkthrough [03:21], [04:35] · Moat M1

### US-09 · Set real, enforced validation per field
**As a** program lead, **I want** validation rules that actually fire, **so that** I don't receive garbage and submitters aren't surprised at the end of a long form.

- **AC-24** Required, min/max length, numeric range, URL format, and email format are configurable per field.
- **AC-25** Validation fires client-side on blur *and* is enforced server-side on submit; a crafted request bypassing the client cannot persist an invalid record.
- **AC-26** A failed submit moves focus to the first invalid field and states the problem in language a non-technical submitter understands. **(candidate-felt)**

`[R-14, R-32, R-41]` · Source: walkthrough [05:08] — *"looks like it doesn't even have full validation"*

### US-10 · Set speaker and sponsor limits with sane defaults
**As a** program lead, **I want** min/max speakers and sponsors per submission, defaulted sanely, **so that** the form matches how my event actually works.

- **AC-27** Minimum and maximum speakers per submission are configurable; the shipped default minimum is 1.
- **AC-28** Maximum sponsors per submission is configurable.
- **AC-29** The public form enforces both limits and states them before the submitter begins adding people.

`[R-15, R-30]` · Source: walkthrough [06:46] — *"Obviously, I should not have a minimum of two speakers"*

### US-13 · Configure the form's lifecycle settings
**As a** program lead, **I want** a welcome screen, close date, per-submitter limit, draft-saving, a pre-close reminder, a thank-you email, and named form admins, **so that** the form runs itself once open.

- **AC-30** Welcome/intro messaging is customizable per form and shows before the first field.
- **AC-31** After the close date the public link shows a closed message, not an error, and rejects submission attempts server-side.
- **AC-32** A per-submitter submission limit is configurable as a per-form number (AIE uses 3 at Code Summit, 1–5 at NYC — it is not a product constant).
- **AC-33** Drafts save and resume; a reminder email fires before close; a thank-you email fires on submit; named form admins are notified of new submissions.

`[R-29, R-34, R-35, R-36, R-37, R-38, R-40, R-48]` · Source: walkthrough [04:39]–[05:44]

## Loop step 5 · Submit from incognito

### US-14 · Publish a public form link that works logged-out
**As a** program lead, **I want** a shareable public URL that works with no account, **so that** anyone can submit from a tweet.

- **AC-34** The form URL loads and submits successfully in a private window with no session.
- **AC-35** The public form is operable end to end at 375px width.
- **AC-36** The form page reaches interactive in under 1s on a cold load.
- **AC-231** Turnstile is verified **server-side** before any public write commits and before any upload presign is issued; a request with a missing, replayed, or invalid token is rejected without side effects. *(appended 2026-08-08)*

`[R-19, R-7]` · Source: walkthrough [06:02] · AC-231 from SPEC flag **F-6**, guardrail G8 — R19 puts an open write endpoint on the public internet for four days with a public repo pointing at it

### US-17 · Submit an abstract in one sitting
**As a** speaker, **I want** to complete and submit an application without an account, **so that** applying costs me minutes, not a signup.

- **AC-37** A submission completes end to end with no pre-existing account.
- **AC-38** On submit the submitter sees a confirmation screen and receives a confirmation email containing a link back to their submission.
- **AC-39** The submitted record appears in the admin list without an intermediate processing step.

`[R-19, R-38]` · Source: walkthrough [06:24]–[06:43]

### US-19 · Save a draft and come back
**As a** speaker writing a long abstract, **I want** my progress saved, **so that** a closed tab doesn't cost me the submission.

- **AC-40** Progress is recoverable after closing the browser, via an emailed resume link.
- **AC-41** The form displays when it last saved.
- **AC-42** A draft is visually and textually distinct from a submitted record; the submitter can tell which state they are in without guessing.

`[R-37]` · Source: walkthrough [05:32]

## Loop step 6 · The speaker portal

### US-38 · See my status without asking anyone
**As a** speaker, **I want** my current status visible the moment I log in, **so that** I stop refreshing my inbox.

- **AC-43** Status is the most prominent element of the speaker portal, shown per submission.
- **AC-44** Pre-decision status states the next wave date rather than rendering blank or "pending".
- **AC-45** A status change made in the admin is reflected in the speaker's portal on their next page load, with no admin publish step.

`[R-16]` · Source: walkthrough [07:01] — *"whether or not you have been accepted or not… that's a key part"*

### US-39 · See exactly what I owe and by when
**As an** accepted speaker, **I want** a task list with deadlines, **so that** I can finish my obligations in one visit.

- **AC-46** Tasks show title, description, due date, and completion state, ordered by due date.
- **AC-47** Task types include at minimum: acknowledge, upload a file, and complete a form.
- **AC-48** Completing a task updates the organizer's dashboard with no admin action.
- **AC-49** Overdue tasks are visually distinct from upcoming ones.
- **AC-233** ⚠️ *Below the Tier B cut line — see the scope note.* A Speaker Handbook page, authored as static markdown per event, renders inside the speaker portal. *(appended 2026-08-08)*

`[R-17, R-6]`, brief item 8 · Source: walkthrough [07:12] · Moat M3 · AC-233 from SPEC flag **F-3**
**Scope note on AC-233.** It is hosted on a Tier A story because the portal is where it renders, but it is **not** part of Tier A's no-waiver guarantee, which is `AC-1 – AC-90` plus **AC-231, AC-234, AC-240, and AC-244–246** (the set stated in the tier table above, in `EVALUATION.md` §1.4 and gate 18, and in `BUILDPLAN.md` §9 — read those, not this sentence, if they ever diverge). AC-233 sits below the Tier B cut line and may be cut — under `EVALUATION.md` gate 19, cutting it is acceptable only if the cut is **named** in the gate report with its AC ID and reason. Silently missing is a failure; deliberately cut is not.

### US-40 · Edit my own biography and headshot
**As a** speaker, **I want** to update my bio and headshot myself, **so that** the program is accurate and nobody emails me about it.

- **AC-50** A speaker can edit bio, headshot, title, company, and social links from their portal at any time.
- **AC-51** Changes propagate to the public speaker gallery and session pages with no admin step.
- **AC-52** Headshot upload accepts common image formats, validates minimum dimensions at upload time, and shows a crop preview before saving.

`[R-18, R-2]` · Source: walkthrough [07:29] — *"a very important part"*

## Loop step 7 · Evaluation plan and committee

### US-24 · Create an evaluation plan
**As a** program lead, **I want** to build an evaluation plan with a scorecard and instructions, **so that** my committee scores against the same rubric.

- **AC-53** A plan has a name, instructions, a scoring scale, and a set of submissions.
- **AC-54** The scorecard supports at minimum a numeric rating, a free-text comment, and an optional weighted rubric whose criteria sum to 100%.
- **AC-55** Evaluators can be assigned without first closing the plan, and no step in plan creation is order-dependent in a way the UI does not state.

`[R-4, R-20]` · Source: walkthrough [07:43]; AC-55 deliberately inverts Sessionboard's *"the plan must be **closed** to assign them"*

### US-25 · Assign submissions to a committee, not just individuals
**As a** program lead, **I want** to assign a batch of submissions to a team of evaluators, **so that** I manage groups instead of hundreds of individual assignments.

- **AC-56** Evaluators can be grouped into named committees, and a committee can be assigned a filtered set of submissions.
- **AC-57** Assignment supports at minimum: everyone reviews everything, and N reviewers per submission distributed across the committee.
- **AC-58** The plan shows per-evaluator and per-submission progress against the target review count.

`[R-21]` · Source: walkthrough [07:52]

## Loop step 8 · Work the review queue

### US-26 · Work a review queue fast
**As a** reviewer with 300 submissions assigned, **I want** a queue that shows one submission at a time and advances on score, **so that** I can clear a large batch in one sitting without losing my place.

- **AC-59** Scoring a submission advances to the next unreviewed one with no full page load.
- **AC-60** The queue shows position and remaining count, and resumes at the correct position after leaving and returning.
- **AC-61** Keyboard shortcuts cover score and advance.
- **AC-62** Median time from score submitted to next card interactive is under 300ms against the seeded dataset.

`[R-22, R-7, R-46]` · Source: walkthrough [08:02]

### US-28 · Review blind
**As a** program lead, **I want** to hide submitter and speaker identity from reviewers, **so that** scoring is on the content.

- **AC-63** Anonymized review is an admin setting per plan or per round; no reviewer-side control can toggle it.
- **AC-64** With it on, no reviewer-visible surface exposes name, company, email, bio, or headshot — including API responses and exports.
- **AC-65** Admins continue to see identity throughout.

`[R-50]` · Source: learn.sessionboard.com/evaluations/setting-up-round-based-evaluations; docs.pretalx.org/user/organisers/

## Loop step 9 · Accept, and push to the agenda

### US-33 · Accept a batch mid-CFP
**As a** program lead, **I want** to select many submissions and accept them in one action while the CFP is still open, **so that** wave dates are an afternoon, not a week.

- **AC-66** A filtered list supports select-all-matching and acting on the whole selection.
- **AC-67** A bulk accept sets status, triggers configured notifications, and returns a per-record success/failure summary.
- **AC-68** Accepting a batch neither closes the form nor blocks further submissions.
- **AC-69** A bulk action over 100+ records completes without timing out and without blocking the UI.

`[R-43, R-46]` · Source: AIE's three waves run *while* the CFP is open; Sessionboard documents no bulk path

### US-50 · Push accepted sessions into the agenda without re-entry
**As a** program lead, **I want** accepted sessions to be schedulable directly, **so that** nothing is typed twice.

- **AC-70** Accepted sessions appear in an unscheduled pool ready to place.
- **AC-71** Only accepted submissions are schedulable by default; which statuses qualify is configurable.
- **AC-72** Title, speakers, format, and track carry through from the submission with no re-entry.

`[R-23, R-5]` · Source: walkthrough [08:17]

## Loop step 10 · Build the agenda

### US-51 · Drag and drop to schedule
**As a** program lead, **I want** to drag a session onto a day, time, and room, **so that** building the schedule is direct manipulation.

- **AC-73** A session can be dragged from the unscheduled pool onto a slot and back off it.
- **AC-74** Dropping sets date, start time, and room; duration defaults from the session's format and is resizable.
- **AC-75** Drag feedback tracks the cursor without perceptible lag and the change persists with no save button. **(candidate-felt)**

`[R-5, R-44]` · Source: brief item 5

### US-52 · Catch conflicts automatically
**As a** program lead, **I want** overlapping rooms and double-booked people flagged the moment they happen, **so that** I don't discover it on stage.

- **AC-76** Two sessions in the same room at overlapping times are flagged.
- **AC-77** A person double-booked across two sessions is flagged across **every** participation role — speaker, co-speaker, moderator, chairperson — not just primary speakers.
- **AC-78** Conflicts are visible on the agenda itself, and a list of all current conflicts is reachable in one click.
- **AC-79** A conflict warns; it does not block the placement.

`[R-5]` · Source: brief item 5; learn.sessionboard.com/sessions/agenda · Depends on the participation triple (see Cross-cutting)

### US-53 · See the schedule five ways, including by track
**As a** program lead, **I want** list, day, week, track, and room views, **so that** I can check balance from whichever angle the question comes from.

- **AC-80** All five views exist and are switchable without losing scroll position or active filters.
- **AC-81** The **track** view is a genuine swimlane per track, not a color overlay.
- **AC-82** An edit made in any view is reflected in every other view without a reload.

`[R-5]` · Source: brief item 5 verbatim · Moat M5 — Sessionboard ships list/day/week/**month**/rooms with no track view

## Loop step 11 · Publish and embed

### US-57 · Publish a public agenda
**As a** program lead, **I want** a public agenda page for the finished program, **so that** attendees can see what's on.

- **AC-83** A logged-out public agenda shows sessions with times, rooms, tracks, and speakers.
- **AC-84** Sessions and speakers have permalinked pages, cross-linked to each other.
- **AC-85** The page is operable at 375px and reaches interactive in under 1s.
- **AC-86** Only published statuses appear; no unpublished record is reachable by URL guessing.

`[R-24, R-7]` · Source: walkthrough [08:22], [08:37]

### US-58 · Embed the schedule and speaker gallery on our own site
**As a** marketing/web lead, **I want** copyable embed code for the schedule and speaker gallery, **so that** our conference site stays in sync without me touching it.

- **AC-87** An embed configuration screen produces a copyable snippet with a live preview.
- **AC-88** A schedule itinerary and a speaker gallery are both embeddable, filterable by track and status.
- **AC-89** A change to source data appears in the embed within 60 seconds (against Sessionboard's 60-*minute* refresh).
- **AC-90** The embed is responsive and inherits configured colors.
- **AC-273** *(Amendment 18)* A flat **session-list** embed format renders published sessions with title, track, and time, filterable by track and status exactly like the agenda embed, and selectable in the same embed dialog.
- **AC-274** *(Amendment 18)* The speaker embed offers **cards** and **list** layouts, chosen in the embed dialog and carried in the snippet URL; both layouts satisfy AC-90's responsiveness.

`[R-24]`, dossier Q2 · Source: walkthrough [08:25]; learn.sessionboard.com/sessions/embeds

---

# Tier B — ordered differentiators

Built top to bottom. **The cut line moves up from the bottom** — if Tuesday runs short, the last entries go, and nothing above them is compromised to save something below.

**Framing constraint on the agent-native cluster (US-68, US-69, US-70):** these must not eat the loop. US-68 is an architectural discipline adopted from the first commit at near-zero marginal cost; US-69 and US-70 are additive surfaces built only after Tier A is green. If any of the three would delay a Tier A story, it yields.

## Rank 1

### US-44 · Chase the stragglers from one screen
**As an** ops coordinator the week before the event, **I want** a real-time dashboard of who is missing what, filtered to overdue, with one-click reminders, **so that** chasing 40 speakers is one sitting instead of forty emails.

- **AC-91** A dashboard lists every accepted speaker against every assigned task, with a completion state per cell.
- **AC-92** It filters to "overdue", "incomplete", and by task type, and sorts by how far overdue.
- **AC-93** A reminder can be sent to a filtered set in one action from a template, and each send is recorded against the speaker.
- **AC-94** The view updates live as speakers complete tasks — no report to run, no field to configure first.

`[R-6, R-3]` · Moat M2 — **nobody ships this**; Sessionboard's answer is a filtered table plus a Monday-7am digest

## Rank 2

### US-47 · Deliver a calendar invite to the speaker's own calendar
**As a** speaker, **I want** my session in my actual calendar with room and time, **so that** I show up in the right place — and get the update when it moves.

- **AC-95** A scheduled session generates an invite that Gmail, Outlook, and Apple Calendar render as a real invite (`METHOD:REQUEST`), not an attachment requiring manual import, plus Add-to-Google and Add-to-Outlook links.
- **AC-96** The invite carries correct timezone (with VTIMEZONE), room/location, session title, and a link to the session page.
- **AC-97** Rescheduling sends a `SEQUENCE`-bumped update that replaces the existing entry rather than duplicating it; un-accepting sends a `CANCEL`.

`[R-3]` · Source: brief item 3 verbatim · Moat M4 — **market hole**: Sessionboard ships 26 email triggers and zero calendar

## Rank 3

### US-73 · Reset the demo *(new — amendment 2026-08-08)*
**As a** judge, or as the operator behind a queue of judges, **I want** the demo restorable to its seeded state in one action, **so that** the second judge inherits nothing from the first.

- **AC-230** `npm run reset:demo` — available both as a command and as a button in the product — restores the seeded demo to its known state, is idempotent under repeat invocation, and is safe to run mid-judging: it never leaves the instance in a partially-reset state visible to a concurrent visitor.

`[R-25]`, dossier §3 · `EVALUATION.md` gate 13 · SPEC flag **F-5**
**Why this ranks third.** It costs one command and it protects the demo value of every other story in the file. The judging model is ~30 deployed sites reviewed shallow and fast; a judge who mutates the seeded event — bulk-accepts a wave, un-accepts a talk, reschedules the agenda — hands the next judge a broken program. Without this, the demo degrades monotonically across exactly the audience we are being scored by.

## Rank 4

### US-30 · Run a two-round funnel *(promoted, reduced scope)*
**As a** program lead, **I want** a screening round that feeds a decision round, **so that** a small committee decides on a shortlist instead of the whole pile.

- **AC-98** A plan supports at least two ordered rounds, each with its own scorecard and its own evaluator set.
- **AC-99** Submissions are explicitly promoted from round 1 to round 2 (funnel), in bulk from a filtered list.
- **AC-100** A submission's per-round scores are visible together on its record.

`[R-4]` · Source: brief item 4 verbatim — *"across multiple rounds"* · Signed 2026-08-08
**Scope note:** two rounds and funnel promotion only. Parallel mode, per-round anonymity variation, and round-specific reviewer visibility layers are post-competition. The schema is round-aware from the first migration, so a third round is data rather than a migration.

## Rank 5

### US-67 · Find anything from anywhere
**As an** organizer, **I want** one search box, always present, that finds any submission, speaker, session, or form by name, **so that** I never have to remember which module something lives in.

- **AC-101** A search affordance is present on every admin screen and opens from the keyboard (`/` or ⌘K) with no page load.
- **AC-102** It searches submissions, speakers, sessions, and forms in one result list, each result labelled by type.
- **AC-103** Results return in under 200ms against the seeded dataset, updating as the query is typed.
- **AC-104** Selecting a result navigates straight to that record; partial and misspelled queries still match on name and title.

`[R-7, R-11, R-46]` · Source: walkthrough [03:58] and [04:01] — he got lost **twice on camera** · PHILOSOPHY 1, "never lost"

## Rank 6

### US-68 · Every capability reachable over a real API *(new)*
**As a** developer or agent operating Marquee, **I want** a documented HTTP API that the product's own UI is built on, **so that** nothing is UI-only and anything a human can do, a program can do.

- **AC-105** Every write the admin UI performs goes through the same public API; no endpoint exists that is reachable only from the first-party UI.
- **AC-106** The API is documented in a machine-readable schema (OpenAPI or equivalent), and the docs are reachable from the running app.
- **AC-107** Programmatic clients authenticate with API tokens, issued and revocable from the UI, independent of browser sessions.
- **AC-108** Listing the seeded event's submissions over the API returns the same records the UI list shows, paginated, with filter parameters matching the UI's filters.

`[R-25]` · PHILOSOPHY 3 — *"A real API — the UI is built on it; nothing is UI-only"*
**Sequencing note:** ranked here for *ordering*, not value. Adopted from the first commit it is nearly free, because the UI needs those endpoints anyway; retrofitted after Tier A it is a refactor of everything. It is the one Tier B item whose cost rises sharply if deferred.

## Rank 7

### US-72 · Genuine two-way Airtable mirror *(new — amendment 2026-08-08)*
**As an** ops coordinator who lives in spreadsheets, **I want** our program data mirrored into Airtable and my edits there reflected back, **so that** my team keeps the view it already works in without paying Airtable's latency on every page load.

- **AC-225** A local change to a mirrored record appears in Airtable within 60 seconds of the change committing.
- **AC-226** An edit made in Airtable to an allowlisted field applies to the local record within one webhook cycle; edits to non-allowlisted fields are ignored and logged, never partially applied.
- **AC-227** Echo suppression holds: a write that originated from the mirror does not bounce back and re-trigger the opposite direction, and no record enters a sync loop under sustained two-way editing.
- **AC-228** Settings → Airtable displays the base link, the row count on both sides, the last successful sync time, and the current outbox depth.
- **AC-229** The webhook keepalive cron survives 7 days without manual re-registration, and expiry is visible on the Settings → Airtable page before it causes silent data loss.

`[R-45]`, dossier §5 and Q1 · `EVALUATION.md` gate 9 · SPEC flag **F-1** · Architecture decision 3
**Why it sits directly after the API.** Airtable is the competition's *larger* stack bonus — the brief awards it "bonus" against Cloudflare's "mild bonus" — and the parenthetical says why: *"because those are what we use on our team."* The bonus is an adoptability signal, not an aesthetic one. The mirror rides on the same write path US-68 establishes, so building it immediately after the API is when it is cheapest; deferred, it becomes a second write path bolted onto a finished one.
**Non-negotiable from the seams pass:** Airtable is never read on a request path. D1 remains the source of truth; the mirror is queue-driven and asynchronous, which is what lets AC-225's 60-second budget coexist with R7's speed requirement rather than fight it.

## Rank 8

### US-66 · Switch without losing an open CFP
**As a** program lead whose call for speakers is open *right now*, **I want** to import my existing submissions, speakers, and review state from Sessionize, **so that** adopting Marquee mid-CFP costs an import instead of a restart.

- **AC-109** An import accepts Sessionize's exported sessions and speakers spreadsheets, with a column-mapping step showing a preview of the first rows before anything is written.
- **AC-110** Submissions arrive with status preserved — including **undecided** ones, not only accepted — along with speaker profiles, bios, headshots, custom fields, and session↔speaker relationships.
- **AC-111** Existing evaluation scores and reviewer comments import as historical review data, attributed where the reviewer matches by email and explicitly marked unattributed where not.
- **AC-112** The import is idempotent and re-runnable: re-importing an updated export updates matched records and inserts new ones without duplicating, so both systems can run in parallel while the CFP stays open.
- **AC-113** The import reports per-row outcomes (created / updated / skipped / failed with reason) and is undoable as a single batch.

`[R-43, R-45, R-46, R-9]` · Source: AIE's CFP is live on Sessionize until Sep 12; the NYC pilot lands ~9 weeks after the deadline — any real adoption is mid-CFP by construction
**Why spreadsheets, not the API:** Sessionize's API is read-only and *"By default… shows only accepted sessions whose speakers have been informed of being accepted"* — mid-CFP, the ~1,000 undecided submissions are exactly what it omits. The Export page carries sessions, speakers, evaluation results, and team comments as spreadsheets. Build against the export.
**Visibility requirement:** a named "Import from Sessionize" entry point on the empty-event screen **and** a README section. A capability nobody finds scores zero. Fallback if cut: README plus a documented CSV schema, no UI.

## Rank 9

### US-34 · Reject with a template, kindly and at scale
**As a** program lead rejecting 85–95% of submissions, **I want** templated rejections that merge in the submission title, **so that** everyone gets a real answer.

- **AC-114** A rejection template supports merge fields for speaker name and submission title.
- **AC-115** Rejections send in bulk, with a rendered preview of one real recipient's version before sending.
- **AC-116** Rejected submitters see the outcome in their portal as well as by email.
- **AC-117** Sending is idempotent — a repeated bulk action cannot notify the same submission twice.

`[R-43, R-3, R-16]` · Source: sessionize.com/aienyc2026 (5–15% acceptance)

## Rank 10

### US-22 · Enter a submission manually as an admin
**As a** program lead, **I want** to create a submission or session directly in the admin, **so that** invited talks and sponsor slots live in the same system as everything else.

- **AC-118** An admin can create a submission without the public form, choosing abstract or session.
- **AC-119** An admin-created session can be marked as bypassing evaluation and still reach the agenda.
- **AC-120** Admin-created records are visually distinguishable from public submissions in lists.

`[R-12, R-9]` · Source: walkthrough [03:53] · Makes moat M1 visible rather than theoretical

## Rank 11

### US-36 · Un-accept a talk after a speaker drops
**As a** program lead whose speaker just cancelled, **I want** to reverse an acceptance and see everything that reversal touches, **so that** the agenda, the public site, and the portal don't keep telling the old story.

- **AC-121** An accepted submission can be moved to withdrawn or rejected at any point.
- **AC-122** Reversing acceptance removes the session from the agenda and from all public surfaces and embeds, and the vacated slot is visible to the scheduler.
- **AC-123** The system states what else is affected — portal tasks, scheduled emails, calendar invites — and offers to cancel or retain each, rather than silently continuing.
- **AC-124** Any already-sent calendar invite receives a cancellation.

`[R-43, R-3, R-23]` · PHILOSOPHY 2 — *"the unglamorous path is designed, not discovered"*

## Rank 12

### US-46 · Automate the recurring messages
**As an** ops coordinator, **I want** the routine emails to fire on their own, **so that** the system does the reminding.

- **AC-125** Automated triggers cover at minimum: submission confirmation, submission-closing reminder, added-to-a-submission, acceptance, rejection, task assigned, task overdue.
- **AC-126** Each trigger can be enabled or disabled and its template edited.
- **AC-127** The pre-close reminder fires on a configurable schedule relative to the form's close date.

`[R-3, R-35, R-38]` · Source: learn.sessionboard.com/communications/automated-emails

## Rank 13

### US-45 · Send a templated email to a filtered group
**As an** ops coordinator, **I want** to email a filtered set of speakers from a template with merge fields, **so that** I never paste a list into BCC again.

- **AC-128** Templates support merge fields for speaker name, session title, room, and time.
- **AC-129** Recipients are chosen by filter (status, track, format, task state), with the resulting count shown before send.
- **AC-130** A preview renders one real recipient's version before sending.
- **AC-131** Every send is logged per recipient and visible on their record.

`[R-3]` · Source: brief item 3

## Rank 14

### US-11 · Add conditional logic to a form
**As a** program lead, **I want** fields that appear only when an earlier answer warrants them, **so that** submitters see a short form and I still collect what I need for special cases.

- **AC-132** A field can carry a show/hide condition based on one or more prior answers.
- **AC-133** Hidden fields are neither required nor submitted; revealing a field applies its validation.
- **AC-134** Conditions are visible in the builder without opening each field.

`[R-1]` · Source: brief item 1; dossier Q5

## Rank 15

### US-12 · Route submissions by category
**As a** program lead, **I want** a submission's category, track, or format to route it to the right evaluation plan or reviewer pool automatically, **so that** intake sorts itself and policy isn't a human's memory.

- **AC-135** A rule maps a field answer (track / format / vendor flag) to an evaluation plan or reviewer pool.
- **AC-136** Routing applies at submission time and the applied rule is visible on the submission record.
- **AC-137** A vendor-content flag can route a submission away from a mainstage pool and toward workshop/expo review.

`[R-1, R-47]` · Source: sessionize.com/aienyc2026 — *"WE WILL NOT ACCEPT VENDOR-ONLY TALKS"* on mainstage

## Rank 16

### US-69 · Drive the core workflows from a terminal *(new)*
**As an** operator or an agent, **I want** a `marquee` CLI covering the core workflows, **so that** conference operations are scriptable and composable.

- **AC-138** The CLI covers at minimum: create/seed an event, list and filter submissions, accept or reject in bulk, list outstanding speaker tasks, send a templated reminder, and export the agenda.
- **AC-139** Every command supports `--json`, emitting parseable output with no decorative text on stdout.
- **AC-140** The CLI authenticates with an API token and can target any Marquee instance by URL.
- **AC-141** `marquee --help` lists every command with a one-line description, and each subcommand has its own help.

`[R-25]` · PHILOSOPHY 3 — *"every workflow drivable from a terminal, scriptable, composable"* · Rides entirely on US-68

## Rank 17

### US-70 · Ship a skill file that teaches an agent to run a conference *(new)*
**As a** coding agent handed a Marquee instance, **I want** a `SKILL.md` in the repo that teaches me the workflows, **so that** I can operate a conference without a human translating the docs.

- **AC-142** `SKILL.md` ships in the repo and covers: seed an event, triage a review queue, chase outstanding tasks, build an agenda, and publish.
- **AC-143** Each workflow names the concrete CLI commands or API calls that perform it.
- **AC-144** Its vocabulary matches the product's — Abstract, Session, Evaluation plan, Committee, Portal, Task, Agenda.
- **AC-145** An agent given only `SKILL.md` and a running instance completes seed → triage → accept → schedule end to end with no further instruction.

`[R-25, R-27]` · PHILOSOPHY 3 · A distinctive signal for *this* judge — the AI Engineer team — without touching the AI-review trap (R-27)

## Rank 18

### US-41 · Upload my slides and supporting documents
**As a** speaker, **I want** to upload my deck and materials to the portal, **so that** they're in the right place and I'm told they arrived.

- **AC-146** File upload accepts PDF/PPTX/KEY up to a stated size limit, with the limit shown before upload begins.
- **AC-147** Upload shows progress and confirms success; a failure is recoverable without redoing the form.
- **AC-148** The organizer sees the upload against the speaker's task without a refresh.
- **AC-232** Uploads are constrained by an extension **and** MIME allowlist at presign, magic-byte sniffed on completion with a mismatch rejected and the object deleted, rate-limited per IP and per submission, and served from an origin separate from the app with `Content-Disposition: attachment`. *(appended 2026-08-08)*

`[R-2, R-17]` · Source: brief item 2 · AC-232 from SPEC flag **F-6**, guardrail G8 — a separate origin plus attachment disposition is what stops an uploaded file executing as same-origin script

## Rank 19

### US-21 · Add a co-speaker to a submission
**As a** speaker proposing a panel, **I want** to add co-speakers by name and email, **so that** the panel is represented correctly from the start.

- **AC-149** Co-speakers are added within the form up to the configured maximum.
- **AC-150** Each co-speaker receives an email stating they've been added, by whom, to what, and how to complete their own profile.
- **AC-151** A co-speaker can supply their own bio and headshot without editing the abstract.

`[R-30, R-15]` · Source: Sessionboard's dedicated *"Added to a submission"* trigger

## Rank 20

### US-37 · Speaker confirms or declines their slot
**As a** speaker who has been accepted, **I want** to confirm or decline, **so that** the program knows whether I'm actually coming.

- **AC-152** An accepted speaker sees a confirm/decline action in their portal and the program lead sees the response.
- **AC-153** A person holding multiple roles on one submission confirms each role separately.
- **AC-154** Declining notifies the program lead and flags the agenda slot.

`[R-16, R-17]` · Source: *"Each participant answers for every role they hold on a submission"*

## Rank 21

### US-18 · Submit from a phone
**As a** speaker who read the CFP on my phone, **I want** to complete the form on that phone, **so that** I don't lose the intention by deferring to a desk.

- **AC-155** Every field type, including file upload, is operable at 375px width.
- **AC-156** No horizontal scrolling occurs and no focused field is obscured by the on-screen keyboard.
- **AC-157** A partially completed mobile form resumes on desktop via the draft link.

`[R-19, R-37]`

## Rank 22

### US-27 · Review on a phone
**As a** volunteer reviewer, **I want** to work my queue on my phone, **so that** the review actually gets done.

- **AC-158** The review queue is fully operable at 375px: read the abstract, score, comment, advance.
- **AC-159** No admin chrome is present on the reviewer surface.

`[R-22, R-7, R-46]` · "Clear 40 reviews on the train" — no incumbent offers it

## Rank 23

### US-02 · An operator stands up their own instance
**As an** organization that wants to own its program tooling, **I want** to deploy Marquee and seed my own event from a documented path, **so that** adopting it is an evening, not a project.

- **AC-160** The README documents deploy, environment config, and seeding as a numbered sequence completable without asking questions.
- **AC-161** A fresh install with no data renders every screen with an empty state that states the next action.
- **AC-162** Extension points (registration-platform sync, Airtable mirror, calendar OAuth) are named in the README even where unimplemented.

`[R-25]`, dossier §2 item 7 · A judged deliverable, not a nicety

## Rank 24

### US-71 · Comparison-mode triage *(new)*
**As a** reviewer facing a large round-1 queue, **I want** to rank three submissions at a time with ties allowed, **so that** I can triage faster and more consistently than absolute scoring lets me.

- **AC-163** Comparison mode is selectable per round as an alternative to scorecard scoring; the scorecard remains the default.
- **AC-164** Each comparison presents exactly three submissions and accepts a ranking in which ties are permitted.
- **AC-165** Aggregate ordering derives from a win count across all recorded comparisons and is visible to the review chair.
- **AC-166** Switching a round's mode does not discard scores already recorded in the other mode.

`[R-4, R-22]` · Landscape L2 — the survey pass's favorite steal · Optional round-1 mode, never the only path

## Rank 25

### US-32 · Optional AI first-pass scoring
**As a** program lead facing 3,000 submissions, **I want** an optional AI first pass that flags obvious mismatches, **so that** human reviewers spend attention where it counts — and I can turn it off entirely.

- **AC-167** AI assistance is off by default and labelled as an aid, never as a decision.
- **AC-168** No submission's status changes from AI scoring without a human action.
- **AC-169** The feature is absent from the default demo path.

`[R-4]` (AI clause), `[R-27]` · Source: walkthrough [09:23] — *"I don't care about the AI workflow thing"* · Satisfies the brief clause; never led with

---

# Cross-cutting requirements

Not stories — preconditions that gate every story above. They have no AC IDs of their own because they are asserted inside the ACs that depend on them.

- **Speed (R7).** Every list, filter, and transition in the demo path stays fast against ~1,000 seeded submissions. Three unprompted complaints in a ten-minute video; graded whether or not anyone writes it down. Asserted in AC-3, AC-16, AC-36, AC-62, AC-85, AC-103.
- **Navigability (R8, dossier §6.5 item 4).** Every module one click from the dashboard. Asserted in AC-15, AC-101.
- **Seeded demo data (dossier §3).** A precondition for all of Tier A. Asserted in AC-3.
- **Participation as a `(person, session, role)` triple.** One table at the first migration; expensive to retrofit. Gates AC-77 (conflict detection across all roles), AC-153 (per-role confirmation), US-21, US-23, US-65.
- **Round-aware schema from the first migration.** Gates US-30 and its post-competition extensions.
- **Outbox + demo-safe email mode.** Resend's free tier is 100/day against ~800 seeded speakers; every send-related AC (AC-93, AC-115, AC-117, AC-125, AC-131) assumes an outbox that can be inspected without delivering.

---

# Post-competition

Modeled where the data model makes it cheap; not built by Wednesday. Ordered roughly by value. AC IDs are minted now and are as permanent as the rest.

### US-31 · See where the review actually stands
**As a** review chair, **I want** coverage and score distribution at a glance, **so that** I find unreviewed submissions before the wave deadline, not after.
- **AC-170** A view lists submissions below their target review count, sortable and filterable by track.
- **AC-171** Per-evaluator completion is visible, so a stalled reviewer is identifiable.
- **AC-172** A ranked list by normalized score is exportable.
`[R-4, R-21, R-46]`

### US-29 · Declare a conflict and abstain
**As a** reviewer, **I want** to abstain from a submission I have a conflict on, with an optional reason, **so that** my committee's scores stay honest.
- **AC-173** Abstaining removes the submission from that reviewer's queue and from its score contribution.
- **AC-174** The abstention and its reason are visible to the review chair.
- **AC-175** An abstained submission is redistributed so its target review count is still met.
`[R-4, R-50]`

### US-35 · Hold submissions between waves
**As a** program lead, **I want** a waitlist status distinct from accept and reject, **so that** a strong submission survives Wave 1 without being decided.
- **AC-176** Statuses include at minimum: submitted, in review, accepted, waitlisted, rejected, withdrawn.
- **AC-177** Waitlisted submissions are excluded from the agenda by default but remain in the pipeline for later waves.
- **AC-178** Status changes are timestamped and attributed.
`[R-43]` · **Cheap now:** the status enum ships complete from day one even though the UI is later.

### US-42 · Give my travel and accommodation details
**As an** accepted speaker whose flights are covered, **I want** a structured intake for travel and hotel preferences, **so that** the organizer isn't emailing me for my passport spelling.
- **AC-179** A travel task collects arrival/departure dates, origin city, name-as-on-ID, and hotel nights needed.
- **AC-180** The form states policy limits (economy flights; 2 nights domestic / 3 international) inline.
- **AC-181** Responses are exportable as a single table for the travel booker.
`[R-49, R-17]` · The most AIE-specific story in the corpus — promote if any slack appears.

### US-43 · Add a co-speaker to my accepted session
**As an** accepted speaker whose panel changed, **I want** to invite an additional speaker for organizer approval, **so that** the program is right without an email thread.
- **AC-182** A portal action requests an additional participant with name, email, and role.
- **AC-183** The request enters an organizer approval queue; it does not silently add the person.
- **AC-184** On approval the new participant receives portal access and their own task list.
`[R-30, R-17]`

### US-48 · Send from our own domain
**As an** organization, **I want** outbound mail from our conference domain, **so that** speakers trust it and it doesn't land in spam.
- **AC-185** Sending domain and from-name are configurable per organization or event.
- **AC-186** Setup documents SPF/DKIM/DMARC requirements.
- **AC-187** Replies route to a configured address, not a no-reply black hole.
`[R-3]` · Competition ships from `marquee@stage11.systems` (decision 6).

### US-49 · See what a speaker has been sent
**As an** ops coordinator picking up a thread, **I want** the message history on a speaker's record, **so that** I don't re-send or contradict a colleague.
- **AC-188** Each speaker record shows every message sent, with timestamp, template, and delivery outcome.
- **AC-189** Bounces and failures are visible without leaving the product.
`[R-3, R-6]`

### US-54 · Filter and slice the agenda
**As a** program lead, **I want** to filter the agenda by track, format, room, and day, **so that** I can review one strand at a time.
- **AC-190** Filters apply across all views and are reflected in the URL so a filtered view is shareable.
- **AC-191** Filtering the seeded dataset re-renders in under 200ms.
`[R-5, R-7, R-46]`

### US-55 · Keep an eye on program balance
**As a** program lead, **I want** counts by track, format, and day as I schedule, **so that** I notice a lopsided program while I can still fix it.
- **AC-192** Live counts by track and format are visible alongside the agenda.
- **AC-193** Unscheduled accepted sessions are counted and reachable in one click.
`[R-5, R-11]`

### US-56 · Move a session and have everyone told
**As a** program lead, **I want** rescheduling to notify affected people, **so that** a change in the tool is a change in the world.
- **AC-194** Changing a scheduled session's time or room offers to notify its participants.
- **AC-195** Notification includes an updated calendar invite replacing the previous entry.
- **AC-196** Published public surfaces and embeds reflect the change with no manual republish.
`[R-3, R-5, R-24]`

### US-59 · Take the data in a format I choose
**As a** web developer, **I want** the program as JSON and iCal as well as HTML, **so that** I can build my own front end.
- **AC-197** Public program data is available as JSON and as an iCal feed.
- **AC-198** Both formats are documented in the README with a working example.
`[R-24]` · Nearly free once US-68 and US-57 exist — promote if cheap.

### US-60 · Build a personal itinerary
**As an** attendee, **I want** to star sessions and get my own schedule, **so that** I know where I'm going.
- **AC-199** An attendee can select sessions and view only those, with no account required.
- **AC-200** A personal itinerary is exportable to a calendar.
- **AC-201** Conflicting personal selections are visible to the attendee.
`[R-24]`, dossier Q2 — track the ruling.

### US-61 · Run the room from a phone
**As a** production coordinator, **I want** a per-room run-of-show with speaker contact details on my phone, **so that** I can find people and keep time.
- **AC-202** A room view lists the day's sessions in order with times, speakers, and contact details.
- **AC-203** It is operable at 375px.
- **AC-204** It is legible in low ambient light at arm's length. **(candidate-felt)**
`[R-5, R-6]`

### US-62 · Check in speakers
**As a** production coordinator, **I want** to mark a speaker as arrived, **so that** the team knows who is still missing 20 minutes before their slot.
- **AC-205** A speaker can be marked arrived/not arrived per session day.
- **AC-206** Unarrived speakers with a session in the next hour are surfaced.
`[R-6]`

### US-63 · Make a last-minute change that reaches everyone
**As a** program lead, **I want** a day-of change to propagate to the public agenda, the embeds, and the affected speakers within a minute, **so that** the printed sheet isn't the source of truth.
- **AC-207** A session edit is reflected on public surfaces and embeds within 60 seconds.
- **AC-208** Affected participants can be notified in one action from the agenda.
`[R-24, R-3, R-5]`

### US-64 · Collect what comes after the talk
**As an** ops coordinator, **I want** to request slides and recording permissions after the event as ordinary portal tasks, **so that** post-event collection uses the same machinery as onboarding.
- **AC-209** Tasks can be assigned after the event date and appear normally in speaker portals.
- **AC-210** Post-event completion appears on the same dashboard as pre-event tasks.
- **AC-211** Uploaded post-event files attach to the session record.
`[R-2, R-6, R-17]`

### US-65 · Carry a speaker forward to the next event
**As an** organization running four events a year, **I want** a person's profile, history, and contact details to persist across events, **so that** a returning speaker doesn't start from zero.
- **AC-212** A person exists at the organization level; their participation is per event.
- **AC-213** A returning speaker's bio and headshot prefill on a new submission, editable per event.
- **AC-214** Cross-event reviewer access is *not* inherited — reviewer scope is per event by construction.
`[R-45, R-50]` · AC-214 is the one permission bug in this domain that leaks unpublished work; enforce it even though the UI is later.

### US-15 · Optionally password-protect a form
**As a** program lead running an invite-only call, **I want** to put a password on a form, **so that** the link can be shared narrowly.
- **AC-215** Password protection is an optional per-form setting, off by default.
- **AC-216** With it on, the public URL prompts before rendering any field.
`[R-42]` · dossier Q8, low confidence

### US-16 · Promote the call with a live block
**As a** marketing/web lead, **I want** the open call, deadline, and formats as an embeddable block, **so that** our conference site stays accurate without me editing it.
- **AC-217** An embeddable "call for speakers" block renders deadline, formats, and a link to the form.
- **AC-218** The embed reflects the form's close date automatically, including switching to a closed state.
`[R-24, R-34]` · **Promoted to live in-scope (Amendment 18, 2026-08-11)** — the CFP block is the third widget family in the embed dialog, alongside agenda/sessions and speakers.

### US-20 · Submit more than once, up to the limit
**As a** speaker, **I want** to propose several topics up to the event's cap, **so that** I don't have to guess which one the program wants.
- **AC-219** A submitter can create multiple submissions up to the configured per-form limit.
- **AC-220** At the limit the form explains the cap rather than failing opaquely.
- **AC-221** All of a submitter's submissions are listed together in their portal.
`[R-36, R-48]` · **Nearly free** given AC-32 ships the limit — promote if the enforcement path is already built.

### US-23 · Submit on behalf of someone else
**As a** comms manager submitting for an executive, **I want** to be recorded as submitter while the executive is the speaker, **so that** correspondence reaches me and the program is right.
- **AC-222** Submitter and speaker are distinct roles on a submission and can be different people.
- **AC-223** Confirmation and status emails go to the submitter; task and profile requests go to the speaker.
- **AC-224** Both appear on the submission record with their role labelled.
`[R-9, R-30]` · Free given the participation triple; only the UI is deferred.

---

## Candidate-felt criteria

**Five criteria are judgements about feel rather than assertions.** They are owned by design review and the prototype stage, and they are not test-suite failures:

**AC-1** a first-time viewer orients unaided · **AC-16** the dashboard reads as an operator's home rather than a report · **AC-26** error language a non-technical submitter understands · **AC-75** drag feedback without perceptible lag · **AC-204** legible in low ambient light.

**Six further criteria have a felt dimension but are settled by a hard number**, so they stay in the test suite and are *not* tagged: **AC-36** and **AC-85** (<1s to interactive) · **AC-62** (<300ms card advance) · **AC-103** and **AC-191** (<200ms) · **AC-89** (<60s embed propagation). Each has a threshold that decides pass/fail; "does it feel instant?" is the separate design-review question behind it, and if the answer is no while the number passes, the number was wrong — amend the threshold rather than reclassify the criterion.

The remaining **244 live criteria are mechanically testable** with no felt component — including all nine added at the contract-review fold (AC-225 – AC-233) and every live amendment criterion through AC-250. AC-239 is struck and excluded.

---

## Traceability

Every requirement in the register that is not an explicit SKIP maps to at least one story here.

| R# | Requirement | Stories |
|---|---|---|
| R1 | CFP forms, conditional logic, category routing | US-07, US-11, US-12 |
| R2 | Speaker portal (bios, headshots, slides, docs) | US-40, US-41 |
| R3 | Templated comms + calendar invites | US-45, US-46, US-47, US-48, US-49, US-56 |
| R4 | Evaluation & scoring, multi-round, optional AI | US-24, US-25, US-30, US-32, US-71 |
| R5 | Drag-drop agenda, conflicts, five views | US-51, US-52, US-53, US-54, US-55 |
| R6 | Real-time onboarding dashboard | US-06, US-44, US-49 |
| R7 | Speed is judged | AC-3, AC-16, AC-36, AC-62, AC-85, AC-103 |
| R9 | Abstracts vs Sessions | US-08, US-22, US-23 |
| R10–R13 | Event settings, dashboard, manual entry, form builder | US-03, US-06, US-22, US-07, US-08 |
| R14–R15 | Real validation, sane speaker minimums | US-09, US-10 |
| R16–R19 | Status, tasks, bio editing, logged-out form | US-38, US-39, US-40, US-14 |
| R20–R23 | Plans, committees, evaluator queue, agenda handoff | US-24, US-25, US-26, US-50 |
| R24 | Public agenda + embeds | US-57, US-58, US-59, US-60, US-16 |
| R25 | Self-serve, no demo gate | US-01, US-02, US-68, US-69, US-70, US-73 |
| — | Public-write guardrails (no R-number; SPEC G8) | AC-231 (US-14), AC-232 (US-41) |
| R29–R41 | Form option enumeration | US-13, US-09, US-10, US-15 |
| R43 | Multi-wave acceptances | US-33, US-34, US-35, US-36, US-66 |
| R44 | Formats with default durations | US-04 |
| R45 | Multi-event; Airtable mirror | US-65, US-66, US-72 |
| R46 | Volume tolerance | AC-3, AC-69, AC-62, US-26, US-31 |
| R47 | Vendor-talk policy routing | US-12 |
| R48 | Per-submitter proposal cap | US-13, US-20 |
| R49 | Travel intake | US-42 |
| R50 | Blind review | US-28, US-65 |

**Explicit SKIPs** (no story, by decision): R33 payment · R39 multi-language · R8 CRM/marketing/CMS · SMS · AI agenda builder · attendee ticketing.

---

## Amendment 2 — Discord day-1 rulings (2026-08-08 night, orchestrator)

Source: swyx's day-1 Discord answer thread (dossier §7.5, commit 98e7e89).

**AC-234** *(appended to US-12, Tier A binding set — it changes a Tier A form surface)*: A submission carries **one or more tracks** (multi-select on the public form; at least one required; the first selected is primary). Routing rules and reviewer track scoping match if **any** carried track qualifies; list track-filters match any; the agenda swimlane places a session by its primary track. *(Ruling: "talks are submitted to one or more tracks, and reviewers review one or more tracks.")*

### US-74 · Feedback travels with the decision *(new, Tier B — inserted directly after US-72; final rank 9 after Amendment 8; from ruling R51)*

**As a** program lead deciding submissions, **I want** to attach feedback to an accept/decline and email a speaker directly from the review flow, **so that** decisions carry their reasoning without a separate comms step.
- **AC-235**: An accept or decline action can carry an optional feedback note; the note renders in the decision email via a merge field and appears on the submission in the speaker's portal.
- **AC-236**: From a submission's record or review view, an admin can send a one-off templated email to its speaker(s); the send is logged on the record like any other message.

*Next amendment appends from AC-237.*

## Amendment 3 — full-brief recovery (2026-08-08 night, orchestrator)

Source: `sequence/research/sources/competition-brief-full.pdf` (the complete 37-page brief; original capture was partial) via Discord Intel batch 2, dossier §1.6.

**AC-237** *(appended to US-40's story area, Tier B — insert beside the portal editing cluster)*: A speaker can edit their **talk's title and description** (not just their profile) from the portal, under organizer control: editable while the CFP is open by default, plus an organizer toggle to re-open editing per submission after close. Edits update the record immediately and are stamped in its history. *(Gap found by triangulation: AC-50 covers profile only; swyx's "finalize talk description" task example and the incumbent's behavior both point here. If a Discord ruling contradicts the default semantics, amend.)*

*Next amendment appends from AC-238.*

## Amendment 5 — client v1.2 review feedback (2026-08-09, orchestrator)

Source: Atin driving v1.2 (scheduled/published legibility; multi-track demo visibility; program board).

### US-75 · The program board *(new, Tier B — insert after US-74; Kanban overview)*

**As a** program lead, **I want** a board view of every submission as a card in its lifecycle column, **so that** I can see the whole program's flow — across all tracks — on one screen and move work with a drag.
- **AC-238**: A board view renders every submission as a card in its lifecycle column (the pipeline's seven stages, derived states included), filterable by track, format, and wave; cards show title, speakers, track chips, and time-in-stage; it stays fast at the full seed.
- ~~**AC-239**: Dragging a card between columns performs the legal status transition…~~ **STRUCK 2026-08-09 by client ruling** — *"important items should be made from the detail screen, not easy drag-and-drop."* Replaced by AC-243; ID retired, never recycled.

**AC-240** *(appended to US-50/US-57 area — scheduled/published legibility)*: Wherever a scheduled session is listed (submissions list, record, portal, board), its slot — **day · time · room** — is visible; a scheduled-but-unpublished item carries a "Not yet public" marker with a publish affordance; and the pipeline's Scheduled and Published stage cards carry clarifying sub-labels ("placed on the working agenda" / "live on the public site").

*Seed addendum (SPEC §6): ≥15% of submissions carry two or more tracks, including at least three accepted-and-scheduled sessions, so multi-track chips are demonstrably visible on the form, lists, board, and agenda; `check:seed` asserts it.*

*Next amendment appends from AC-241.*

## Amendment 6 — API comparison fold (2026-08-09, orchestrator)

Source: `sequence/research/api-comparison.md` (Sessionboard's public API docs crawled and diffed; R53 API bonus is the frame).

**AC-241** *(appended to US-68's area, Tier B — build only after Tier A is green)*: Signed outbound webhooks: endpoint CRUD per event, a test-delivery action, and a deliveries log; only six event types (**SPEC Amendment 16, ratified 2026-08-11**): `submission.created`, `submission.status_changed`, `evaluation.completed`, `speaker_task.completed`, `agenda.published`, `speaker.confirmed`; deliveries queued with retry/backoff, HMAC-signed over `id.timestamp.body`, replay-idempotent.

**AC-242** *(appended to US-68, Tier B)*: API tokens are issued with named scopes (`program:read/write`, `review:write`, `speaker:write`, `agenda:write`, `comms:send`, `mirror:write`) and optional event restriction; effective authority is the intersection of the token's grants and the issuer's membership; the secret is shown once and stored only as a hash; revocation is immediate.

Semantic pins (SPEC Amendment 7, no new ACs): event discovery (`GET /events`), event people reads, full submission-file lifecycle, pinned list/pagination semantics, `ETag`/`If-Match` optimistic concurrency, one error envelope, standard rate-limit headers, durable bulk `operation_id` results, OpenAPI as the single source for docs/CLI/SKILL.

## Amendment 7 — board fork + reviewer detail (2026-08-09, orchestrator)

**AC-243** *(RATIFIED by client 2026-08-09, replacing struck AC-239)*: The program board is a read-only overview: no card drags, no lifecycle action on cards; click/Enter/Space opens the submission record, which owns every stage-appropriate action with the standard confirmation/cascade previews; board filters compose (free-text, type, any track, format, wave) with a one-click reset. *Client rationale: consequential actions belong on the detail screen, deliberately — not behind an easy drag.*

**AC-244** *(appended to US-26, Tier A — the reviewer queue is loop step 8)*: From the review queue, a reviewer can open the full submission — every evaluator-visible field, the complete abstract, and attached files, honoring blind-mode redaction — without losing queue position; closing the detail returns to the same card. *(Client feedback while driving v1.3: "we need to be able to click and open the paper.")*

*(Superseded pointer — see the canonical line at file end.)*


## Amendment 8 — context-coverage closure (2026-08-09, client)

Source: client approval of the v1.3 context-gap audit against `/Users/atin/Downloads/CONTEXT.md`. Month view was only a reference-image label, not a stated requirement; generalized CMS support was optional and remains outside product scope.

**AC-245** *(appended to US-26, Tier A — simple reviewer path)*: Every review card offers the exact recommendations **Approve**, **Maybe**, and **Deny**. A reviewer can submit one without entering numeric scores; when a scorecard is configured, scores remain available but optional for this path. The recommendation is saved with reviewer identity and time, restores on revisit, and maps to organizer-facing accepted, waitlisted, or rejected decision proposals without changing lifecycle status until an authorized program lead acts.

**AC-246** *(appended to US-25, Tier A — reviewer responsibility and authorization)*: Each reviewer is assigned one or more explicit track scopes. Their queue includes a submission when any carried track intersects that scope. The same rule is enforced server-side for record, file, export, and review-write access; out-of-scope records cannot be opened by guessing an ID. A committee manager can inspect and edit the scopes.

### US-76 · Return to the exact slice of work *(new, Tier B — insert after US-67)*

**As a** program operator handling hundreds of submissions, **I want** reusable table views, relevant columns, and a first-class draft queue, **so that** recurring triage does not begin by reconstructing filters or hunting incomplete proposals.
- **AC-247**: A user can create, name, apply, rename, and delete personal event-scoped saved views containing free text, filters, sort, and visible-column order. Built-in views are immutable. Reloading and returning later preserve the active saved view; another event or user cannot see the personal view.
- **AC-248**: The submissions table's column chooser can show, hide, and reorder Type, ID, Title, Speakers, Status, Tracks, Score, Submitted, Last updated, Origin, and Missing fields. Title is mandatory. The chosen order renders immediately, persists per event and user, and is captured when a saved view is created or updated.
- **AC-249**: A built-in **Drafts needing attention** queue shows its live count and each draft's last-saved time, submitter contact, and missing required fields. Opening a draft never submits it or changes status. Only form administrators and program staff can use the queue.

---

## Amendment 9 — agent-composed sends (2026-08-09, orchestrator; client-directed)

*(Originally minted as AC-245, which collided with Amendment 8's closure mint; renumbered to AC-250 — the struck-never-recycled rule applied to a collision.)*

**AC-250** *(appended to US-45/US-68, Tier B — rides the comms and API tickets)*: Every send surface (API `POST .../comms/send`, CLI `marquee remind`) accepts **either** a stored template **or** caller-supplied subject/body; merge fields render in both; ad-hoc sends are logged in the outbox and on recipient records identically to templated ones; demo-safe mode and `comms:send` scope apply unchanged. *Client intent: an external LLM/agent may compose nudge text; Marquee provides the rails and builds no LLM features itself.*

---

## Amendment 10 — per-item reviewer assignment (2026-08-09, orchestrator; client review question)

**AC-251** *(appended to US-25, Tier B high — table stakes per the landscape matrix; UI tagged [beyond v1.5 prototype — acknowledged divergence])*: A submission record's evaluation panel lists its current reviewers per round with coverage counts; an admin can assign or remove a specific reviewer there (writing `round_assignments`), with the affected reviewer's queue updating accordingly and track-scope rules still enforced. The API/CLI equivalent is `/rounds/:id/assignments` CRUD.

---

## Amendment 11 — venue model: buildings, AV, room notes (2026-08-09, client review)

**AC-252** *(appended to US-05; Tier B high, hosted on a Tier A story)*: Buildings are first-class: an event supports multiple buildings, each with a name and address, managed from Event Settings; every room belongs to a building. The seeded demo uses the Sheraton-coherent building set defined in SPEC §6 *(amended 2026-08-09, operator-delegated venue ruling; supersedes the earlier "real 2025 four")*. Room displays that schedulers and day-of staff read (agenda room headers, room view, public session pages, ICS `LOCATION`) render "Room · Building".

**AC-253** *(appended to US-05, same placement)*: A room carries editable **AV capabilities** (tag list — e.g. projector, confidence monitor, mic count, livestream) and free-text **notes**, set in Event Settings and visible where placement decisions happen (room header tooltip/panel in the agenda) without cluttering public surfaces.

---

*Canonical as of 2026-08-09 (Amendments 1–9 applied). Changes to this file are amendments: new criteria append from AC-254; deletions are struck, never recycled. Next inputs — the Sunday clarification video (requirements freeze), remaining Discord rulings, and Phase-4 client review.*


## Amendment 14 — geography as a constraint (2026-08-10, client-directed)

*Three stories minted: **US-77**, **US-78**, **US-79**. Nine criteria minted: **AC-255 – AC-263**. Extends Amendment 11's venue model; design reasoning in `sequence/venue-map-ux.md`, binding prototype v1.7.*

### US-77 · Tell the system where the conference actually is *(new, Tier B — insert after US-72)*

**As a** program operator running a conference across more than one building, **I want** each building to carry a real location and the instructions for getting into it, **so that** every downstream surface can answer "where is this and how do I get in" without me repeating myself.
- **AC-255**: A building carries latitude, longitude, minutes-to-get-in, and an entrance note. Coordinates are nullable and a null is a first-class state — a streamed or remote venue never takes a pin and is never given a fabricated one. Entrance instructions belong to the building; every room in it inherits them, and no room note is required to carry door, ID, or security text.
- **AC-256**: Buildings and rooms are created, edited, and removed on `/settings/venues`, beneath the site map their coordinates drive. `/settings` contains no venue editors and links to Venues with a count. Both screens persist through one shared writer, so neither save path writes fields the operator cannot see on that screen.
- **AC-257**: The site map renders from stored coordinates: one pin per pinned building, walking lines labelled in minutes, and visible map attribution. The box is fixed-aspect and reserved, so arriving tiles never move the page. When tiles fail to load, pins and lines still render over the grid and the map is never blank. No map asset loads from a third-party CDN and no map API key exists anywhere in the repository.

### US-78 · Catch the schedule that cannot physically be walked *(new, Tier B — insert after US-77)*

**As a** program operator building a multi-building agenda, **I want** the schedule to know how long it takes to get between rooms, **so that** I find out a speaker cannot make their next session while I can still move it.
- **AC-258**: Two scheduled sessions sharing a speaker, in different pinned buildings, whose gap is smaller than the walking time plus the destination's minutes-to-get-in, raise a **Transit** conflict. It warns and never blocks. Sessions in the same building, in a building without coordinates, or at an online venue raise none. The conflict joins the existing count on the dashboard, the conflicts drawer, and the affected tiles without a second code path.
- **AC-259**: Walking time is haversine distance × 1.3 street-grid detour ÷ 80 m/min, floored at one minute. The conflict message names the walking minutes, the access minutes, the gap required, and the gap available. The class is called **Transit** on every surface — object `kind`, drawer, tile flag, dashboard label, API conflict type, and copy — and never "Travel", which already means flights and accommodation in the speaker task set. `check:seed` proves the seed can actually produce one: at least two buildings far enough apart to yield a real walking time, a non-zero access time on one, and at least one live Transit conflict visible on load.

### US-79 · Arrive at the right door, on time *(new, Tier B — insert after US-78)*

**As an** accepted speaker, **I want** to be told where my session is, when to leave, and how to get in, **so that** I am not solving a wayfinding problem ten minutes before I am due on stage.
- **AC-260**: The speaker portal shows the room, building, street address, and entrance note for a scheduled session, with a leave-by time derived from that speaker's own previous session that day, falling back to the primary building when they have none. When the session is unscheduled or its venue has no pin, the card degrades honestly and states that instead of implying a location.
- **AC-261**: `{{session.room}}`, `{{session.building}}`, `{{session.address}}`, `{{session.accessNote}}`, and `{{session.leaveBy}}` resolve per recipient in both the template preview and delivered mail, and an insertable field reference exists in the template editor.
- **AC-262**: The calendar invite carries a real `LOCATION` — room, building, and street address, ICS-escaped — and `GEO:lat;lng` for a pinned building, omitting `GEO` when there is no pin. Existing `METHOD:REQUEST`, `UID`, `SEQUENCE`, and cancellation semantics are unchanged.
- **AC-263**: With fewer than two pinned buildings, the "· Building" room-label suffix, walking times, Transit conflicts, and the agenda building band are all absent, and the embedded site map renders collapsed. Address, entrance note, and minutes-to-get-in remain present at any building count, including one.

---

## Amendment 15 — the states a forward-only model forgot (2026-08-10, client-directed)

*Two stories minted: **US-80**, **US-81**. Six criteria minted: **AC-264 – AC-269**. Source: `sequence/research/state-model-gaps.md`, verified against the shipped schema and the v1.7 prototype. Binding prototype v1.8.*

*Why these two exist together: both are the same defect seen twice — the model drew every edge that moves a record forward, and none of the edges that undo, stop, or fail to arrive. AC-123 already required the first; nothing required the second.*

### US-80 · Stop the homework when the talk stops existing *(new, Tier A — insert after US-33)*

**As a** program lead who has reversed an acceptance, **I want** the speaker's outstanding homework to stop existing, **so that** neither of us is chased for work on a talk that is not happening.
- **AC-264**: Reversing an acceptance and choosing to cancel stamps a cancellation time on every **open** task for that submission. Tasks already complete are untouched — their completion time is never written, cleared, or overwritten by a cancellation, and they still read as done. Nothing is deleted: a cancelled task is a tombstone, which is what "retained for records" already means.
- **AC-265**: A cancelled task is out of the speaker's **active** task list and out of its progress count, shown instead beneath a stated reason given **once at the submission level** rather than repeated per row; out of the chase board's severity ordering, per-task-type counts, and overdue totals, so a speaker whose only outstanding tasks are cancelled leaves the board; and invisible to every automated trigger and filtered-recipient selector — in particular **no `task overdue` mail is ever sent for a cancelled task**. A speaker who still holds another accepted session keeps their chase row for that session's work.
- **AC-266**: Acceptance runs **one idempotent task-set reconciliation** — for each template in the assigned set, restore the existing row if there is one, create it if there is not — so first acceptance, re-acceptance after a reversal, and acceptance after the template set changed all take the same path and running it twice changes nothing. Restoration clears the cancellation and preserves the original due date; completed tasks are never re-opened and their completed work is never in the write set.
- **AC-267**: The reversal dialog's two branches produce observably different states — cancelled-and-silent versus open-and-still-chased — and both, plus any later restoration, appear in the record's history timestamped and attributed. The dialog names which branch it is about to take before it is confirmed.

### US-81 · Find the decision the speaker never heard *(new, Tier A — insert after US-80)*

**As a** program lead, **I want** to see which decisions have not reached their speaker, **so that** I find out before the speaker does.
- **AC-268**: An immutable built-in view, **Decided · not notified**, lists every submission carrying a decision whose notification has not been sent, and names which of exactly three reasons applies: **changed in Airtable** (the mirror deliberately does not run the acceptance cascade, AC-226), **not delivered** (the message is in the outbox `queued`, `suppressed`, or `failed`, with its reason), or **no valid address** (nothing could be queued). The count also appears on the pipeline dashboard's attention strip; when it is zero the row states that every decision has reached its speaker rather than disappearing.
- **AC-269**: Notifying from that view is one action. It writes a **new** outbox row against the **existing** decision row and never rewrites the decision, so the speaker is told what was decided rather than told a new thing. Records with no valid address are excluded from the action and the count on the button says so. A record that is decided and notified cannot appear in the view.

---

### Drafted, not minted — the submitter/speaker split

*`US-82` and `AC-270 – AC-272` are drafted in `sequence/research/state-model-gaps.md` Part 2 and are **deliberately unminted** (ruled 2026-08-10): the build is extra credit, and minting would add criteria to every count the auditor reconciles for work that is not scheduled. **AC-223 and AC-224 already specify the correct behaviour** and sit in the post-competition band; the limitation is named in `EVALUATION.md` gate 19 and `SPEC.md` §10 so it is a documented deferral rather than a live discovery. Mint from **AC-270** if the if-capacity band opens.*

---

## Amendment 18 — public widgets widened (2026-08-11, client-directed)

*Source: collaborator note relayed 2026-08-11 — the competition rubric weights "Public Widgets" as a joint-heaviest area, while embeds sat in the cuttable Tier B band. Ruled by Atin: protect and widen. Binding prototype **v1.10** (embed dialog, public agenda → `Get embed code`).*

Three moves, no renumbering:

1. **US-16 promoted to live in-scope.** AC-217 and AC-218 (already minted, previously uncounted) enter the live set. The CFP block is the third widget family: it renders deadline, formats, and a form link, and flips to its closed state automatically — the widget a conference site wants *before* the program exists.
2. **US-58 gains AC-273 and AC-274** — a flat session-list format and a cards/list layout choice on the speaker embed. Together with the shipped agenda and speaker-gallery kinds these cover the incumbent's five embed formats with variants of two renderers.
3. **AC-87 – AC-90 leave the cuttable band** (recorded in `EVALUATION.md`): MRQ-22 is merged, so a cut would remove working code from a judged area. Q2 closes as resolved-built.

**AC-270 – AC-272 remain reserved** for the drafted submitter/speaker split above; this amendment deliberately mints from **AC-273** so a later if-capacity opening does not collide. Next mint: **AC-275**.

---

## Amendment 19 — the cold start, from the true step zero (2026-08-12, client-directed)

*Four stories minted: **US-83 – US-86**. Thirteen criteria minted: **AC-275 – AC-287**. Source: the cold-start design interview (rulings D1–D8, `prototypes/cold-start/DECISIONS.md`), binding prototype **v1.11**, human-side contract `docs/GETTING-STARTED.md`, agent-side contract `prototypes/cold-start/SKILL-SETUP-CHAPTER.md`.*

*Why these exist: the product's cold start began at "Create the conference," silently presuming a deployed instance, an org row, and an authenticated owner — and the only auth is a magic link that needs mail, which is itself a setup output. Nothing designed how a person becomes the owner, and nothing in the build lets a conference be created at all. These stories are the **post-deadline band**: they join no Wednesday gate count, and are built by MRQ-105 (see `EVALUATION.md` §2.4). Being outside the gate count is a scoring fact, not a schedule one — nothing about the band gates when it merges.*

*US-82 and AC-270 – AC-272 remain reserved for the submitter/speaker split; this amendment mints stories from **US-83** and criteria from **AC-275**.*

### US-83 · Become the owner of a fresh install *(new, post-deadline)*

**As a** technical organizer who has just deployed Marquee to my own Cloudflare account, **I want** the deploy to hand me a one-time claim link that makes me the owner, **so that** I can get into my own instance before mail exists, without a signup page a stranger could find first.

- **AC-275**: A CLI command (registry name to be reconciled at build time; the contract calls it `setup claim-link`) mints a single-use claim token against an instance with an empty `people` table, storing only its hash and printing the claim URL once. Re-running it invalidates any unused prior token and prints a fresh one — the stated, permanent recovery path for a locked-out instance. It prints nothing secret beyond the URL itself.
- **AC-276**: Opening a valid claim link and confirming name and email creates the organization row if none exists, the owner person, an org-wide `owner` membership, and a session — in one flow, with the token consumed inside the same statement that reads it. A used, expired, or unknown token renders one inert page that names the CLI re-run as the recovery and reveals nothing about the instance's state. The email is deliberately unverified: claiming must not depend on mail.
- **AC-277**: An instance with no `owner` membership renders the unclaimed landing at `/` — it states that setup is agent-run and that the deploy terminal prints the claim link, and it exposes no other data or route that would confirm or deny anything to a stranger. Once claimed, the unclaimed landing is unreachable. `POST /api/v1/auth/magic-link`'s response behaviour is unchanged in every mode.
- **AC-278**: Immediately after claiming, the owner is offered a scoped API token for their agent — minted through the existing `api_tokens` path (no new token kind), shown once, named, and revocable in Settings → API tokens. Declining the offer is first-class: every subsequent step is reachable through the screens without it.

### US-84 · Start a conference on my own instance *(new, post-deadline)*

**As an** instance owner, **I want** to create a conference through the API or the screens, **so that** my first conference is mine — not a hand-edited copy of someone else's demo.

- **AC-279**: `POST /api/v1/events` (owner or program lead) creates a conference from name, dates, timezone, and venue, generating its slug. The new conference appears in the event switcher, and every event-scoped screen renders its honest empty state against it (AC-161 semantics) rather than erroring or borrowing another event's data.
- **AC-280**: `/conferences/new` and the event switcher's `＋` drive that same endpoint. On an already-claimed, already-configured instance the flow is conference-scoped exactly as prototype v1.11 draws it: no claim step, no instance-level steps, the five-step checklist scoped to the new conference, and the prior conference one click away.
- **AC-281**: The CLI gains the setup verbs the SKILL chapter names (create the conference; set tracks, formats, rooms; draft the call for speakers; set the evaluation plan), each driving the same routes as the screens, and `SKILL.md` gains the setup chapter **through `renderSkill()`** so the byte-equality gate still passes. The chapter's sequence instructs handing the claim link to a human and **stops before publish** — no CLI path in the chapter opens intake.

### US-85 · Invite the second organizer *(new, post-deadline)*

**As an** instance owner, **I want** to invite co-organizers with a link and manage who has access, **so that** my team can get in before mail is configured and a leaver's access ends the moment I remove them.

- **AC-282**: An owner or program lead mints a single-use, expiring org invite link. The recipient opens it, confirms their name and email, and receives a person row, an org membership, and a session — the claim-link mechanics reused, not reimplemented. Pending invites are listed and revocable; a revoked or used link renders the same inert page as a dead claim link.
- **AC-283**: The organizers surface lists every member and pending invite. Removing an organizer revokes their sessions immediately and preserves every record they authored, still attributed. The last remaining owner cannot remove themself. With mail configured, the invite can also be sent through the outbox; without mail, the copy-the-link path is complete and states that mail sending unlocks later.

### US-86 · An instance that tells the truth about itself *(new, post-deadline)*

**As an** operator on a half-configured install, **I want** the instance to say what is configured and warn me at the exact moment a gap becomes dangerous, **so that** missing mail is a known state instead of a trap my submitters find for me.

- **AC-284**: An instance-status read (admin scope) reports mail, uploads, spam protection, and domain as configured-or-not from the real presence of their bindings and secrets — never from a stored flag that can drift. The Instance panel renders one row per concern in fixed positions; an unconfigured row carries the exact command that fixes it.
- **AC-285**: Publishing a form on a mail-less instance interposes one explicit acknowledgment that names the consequences (no confirmations, no decision mail, no invites; sends queue honestly in the outbox). Acknowledging proceeds and is recorded; it never hard-blocks. With mail configured, no dialog appears.
- **AC-286**: Removing the demo is one action: it deletes exactly the `is_demo`-scoped rows, flips `demo_mode` to 0, is idempotent, and leaves every non-demo row byte-untouched. It is confirmable in the UI with the same consequences-first dialog language as every other destructive action.
- **AC-287**: The shipping PR closes the documentation loop: `docs/GETTING-STARTED.md`'s status banner and the README's "lands with the cold-start build" caveat are removed in the same change that makes them true, asserted by a static scan so the docs cannot describe a future that has already arrived.

## Amendment 20 — Evaluation is an open seat *(2026-08-12, operator-directed; post-deadline)*

Marquee ships no built-in AI reviewer. It ships the seat an external agent sits in: the organizer's
own model, prompt, and rubric, on the organizer's own credential. Binding design:
`sequence/agent-evaluator-design.md`. Built by MRQ-134.

### US-87 · Seat an agent on my review committee *(new, post-deadline)*

**As a** program chair, **I want** to add an agent to my review committee the same way I add a
person — with its own credential, its own track responsibilities, and its judgments clearly marked
as its own — **so that** I can take a first pass from whatever model I trust this year without
handing the committee's judgment to a vendor's idea of a good reviewer.

- **AC-288**: An organizer creates an agent evaluator seat from the committee surface with a name
  and track responsibilities; one transaction produces the `kind='agent'` person, its reviewer
  membership, its track scopes, its committee row, and a `review:write` credential bound to it,
  shown once through the existing shown-once secret panel. A credential bound to that seat then
  records an evaluation — score, per-criterion scores, and reasoning comment — on a submission
  assigned to it, and the recorded row is attributed to the seat and readable by the chair.
- **AC-289**: Negative authority holds on every path. Binding a credential to a `kind='human'`
  person is rejected at issue **and** re-checked at resolution, so a row edited under a live
  credential fails closed. An unbound bearer credential still receives 403 on the reviewer record
  and evaluation-write routes and an empty queue. A bound seat lacking the track scope, or lacking
  an assignment for that round and submission, receives the same 403 as a human in that position —
  `authorizeReviewerScope`'s checks are unchanged, and this is asserted by call-site enumeration,
  not by behaviour alone.
- **AC-290**: A bound credential carries the seat's authority and only the seat's: it cannot reach
  an organizer route the issuing human could reach, its named scopes are constrained to
  `review:write` at issue, and the seat holds no `owner`, `program_lead`, or `ops` membership.
  Revoking the credential returns 401 immediately and deletes no evaluation — the seat's recorded
  judgments and their attribution survive revocation.
- **AC-291**: A human evaluation on the same round and submission coexists with the agent's rather
  than replacing it; both are readable, each is distinctly attributed, and a re-submit from either
  side updates only its own row. Marquee never invokes a model: no scheduled job, queue consumer, or
  in-product control causes an agent evaluation to be written, asserted by a static scan.
- **AC-292**: An agent evaluation does not move the aggregate score a chair reads for human review,
  and is rendered as its own labelled line; the same agent evaluation **does** count toward its
  round-assignment coverage, because a chair who assigned the seat meant its work to count.
- **AC-293**: `e2e:` on a freshly reset demo, the chair opening *"Taming 40-Minute CI"* sees an
  agent-attributed score with substantive rationale specific to that abstract and a human review on
  the same submission, side by side, each carrying its badge, with no row reflow between a
  human-reviewed and an agent-reviewed row. The public claim that evaluation is open ships in the
  same change as this evidence, never ahead of it.

**Next mint: AC-294.**

## Amendment 21 — the organization is a record, and an invite carries its seat *(2026-08-14, client-directed; post-deadline)*

*Two stories minted: **US-88 – US-89**. Eight criteria minted: **AC-294 – AC-301**. Source: the organization-settings design interview (rulings O1–O8, `sequence/org-settings-design.md`), binding prototype **v1.15** (`prototypes/pipeline-v1.1/index.html`, the four `#org` tabs). Built by MRQ-207.*

*Amendment numbers this round are shared across `SPEC.md`, `USER_STORIES.md` and `EVALUATION.md` so two concurrent folds cannot collide. **AC-302 – AC-307, US-90 – US-91 and Amendment 22 belong to MRQ-204** and are not used here; the marker at the end of this section reads AC-302 because that is what was unclaimed when this section was written, and MRQ-204's own marker supersedes it once both land.*

### US-88 · A home for who can run this, and what every conference starts from *(new, post-deadline)*

**As an** organization owner, **I want** one place that says who can sign in and what a new conference inherits, **so that** access management is a steady-state surface rather than something I can only reach during first-run setup, and I am not re-typing the same timezone and the same appearance into every conference I create.

- **AC-294**: The organization carries a profile and defaults — name, default timezone, default theme, communication defaults, branding — readable and writable by organization-wide organizers only. Every default may be null, and null means *this organization has not said*, which is a distinct state from having chosen the value the product would have used anyway: an unset default follows the product when the product changes its mind, and a set one does not. A partial write moves only the fields it names; passing null clears a default back to unset. A conference-scoped seat is refused the surface entirely.
- **AC-295**: Appearance resolves in three layers and the order is the ruling: a `?theme=` comparison link, then this person's own stored choice, then the organization's default, then Marquee Light. A person's choice outranks the organization's default permanently once made — an organization sets what someone gets *before* they choose, never instead of choosing — and the organization changing its default afterwards never re-dresses someone who has chosen. The default is available to the pre-paint script, so an organization theme costs no flash on load.
- **AC-301**: Organization settings is its own surface with four tabs — Organization · Organizers · Server · API tokens — reached from a ⚙ row closing the Organization group, mirroring how the conference group ends in its own Settings row. API tokens moves here because `api_tokens` is an organization-scoped row with a nullable event scope; the old `/settings/api` path still resolves rather than 404ing, and Conference settings keeps Webhooks and Airtable, which are genuinely event-scoped. Tabs hold fixed positions and fixed widths — selecting one moves nothing.

### US-89 · End someone's access completely, or end only their way in *(new, post-deadline)*

**As an** organizer, **I want** removing somebody to close every door at once, and to be able to revoke a login without ending a talk, **so that** a leaver's access ends the moment I say so and a misconduct case does not force me to cancel a session I still intend to run.

- **AC-296**: An invite carries the seat it will mint — a role and a scope that is either the whole organization or one conference — chosen by the inviter at mint. The exchange creates the membership with exactly that role and that `event_id`, on the organization that minted the invite; the recipient supplies their name and email and nothing else, and a role in their request is ignored. A conference-scoped invite never yields an organization-wide seat. `owner` is not offerable by link. A reviewer invite must name a conference, refused at mint with a message the inviter can act on rather than a failure at the recipient's door.
- **AC-297**: The same single-use row is reachable by a speakable short code as well as by its URL, for the registration desk on a hostile venue network. Both credentials are stored only as hashes and returned exactly once; the code is accepted however a human retypes it (case, separators) and refused for anything that was not minted. Spending either form spends the row: the other is dead immediately after. A malformed, unknown, expired, or spent code renders the identical inert page as a dead link.
- **AC-298**: Removing an organizer ends, in one transaction: every organizer seat they hold (organization-wide **and** conference-scoped), their live sessions, the unexpired sign-in links already in their inbox, and exactly the API tokens they minted that the confirming human named. Tokens they did not mint are untouched however they are named in the request; tokens of theirs left unchecked keep working, because some power integrations the organization keeps. Already-spent and already-expired links are not re-dated. A speaker seat the same human holds survives. Their person row and every action attributed to them survive. The last remaining owner cannot be removed.
- **AC-299**: Removing a person from a conference ends every participation they hold there across all roles and sessions, cancels their open tasks through the same `cancelled_at` machinery an acceptance reversal uses, drops any conference-scoped seat, and revokes their access credentials — in one transaction, and idempotently. Finished work stays finished and nothing is deleted. A published session they were on **stays published and keeps its agenda slot**; they simply leave its public listing. The confirmation is shown everything first: every participation, each published session named, and loudly any session where they are the only speaker, since removal leaves it speakerless on the public site. Their CRM record, submissions, annotations, and every participation at every other conference are untouched.
- **AC-300**: Revoking portal access alone ends their live sessions and consumes every unexpired person-bound link — sign-in, task, co-speaker, draft-resume — and touches nothing else. Participations, tasks, submissions, memberships, and history are all exactly as they were: this is the misconduct case, where the talk may still be happening and the login must not be.

**Next mint: AC-302.**

## Amendment 22 — Delete conference: one irreversible, contract-first cascade *(2026-08-14, merge-captain allocation)*

*Two stories minted: **US-90 – US-91**. Six criteria minted: **AC-302 – AC-307**. The binding design is the Danger zone and confirmation modal in `prototypes/pipeline-v1.1/index.html` (`settingsView` and its `bindSettings` delete handler), with T2 in `sequence/sidebar-fold-tickets.md` as the cascade contract. This is a post-deadline band; `EVALUATION.md` §2.7 owns its verification rows. AC-294 – AC-301 belong to MRQ-207 and are not reused here.*

### US-90 · Delete a conference without deleting the CRM

**As an** organizer, **I want** to permanently delete a conference from Conference settings, **so that** an abandoned event stops exposing stale intake, agenda, portal, site, and delivery state while the organization’s people history remains intact.

- **AC-302**: The Danger zone confirmation modal keeps **Delete conference** disabled until the organizer types the exact conference name, after trimming surrounding whitespace. A wrong name, different case, empty input, or any extra/missing character keeps the button disabled; the exact name unlocks it. The operation is organizer-only (`owner` or `program_lead`) at the API boundary as well as in the UI.
- **AC-303**: Before confirmation, the modal discloses the ruled consequences verbatim: **“Dies with the conference”** — “Abstracts and sessions · forms and their public links · agenda and conference site · speaker portal access · queued calendar invites”; **“Stays”** — “People, notes, tags, and outreach — organization-level, untouched.” The Danger zone card also says: “Deleting removes everything scoped to this conference. People, notes, tags, and outreach are organization-level and stay in the CRM.”
- **AC-304**: A successful deletion lands on another conference in the organization when one exists; otherwise it lands on the fresh-install landing at `/dashboard` with no conference selected. The deleted conference is no longer selectable or addressable.
- **AC-305**: The modal states **“This removes the conference and everything scoped to it. It cannot be undone.”** The delete is one transactional operation: its audit row is written with the acting organizer, and a failed transaction leaves the conference and its rows present. There is no restore or soft-delete path.

### US-91 · Give agents the same destructive operation

**As an** agent acting for an organizer, **I want** the CLI and demo-removal operation to use the same conference-deletion primitive, **so that** a human confirmation and an agent run cannot drift into different data-lifetime rules.

- **AC-306**: `DELETE /api/v1/events/:id` and the shared cascade remove every event-scoped row, counted per table before and after: both submission kinds and their answers/tracks/participations/decisions, forms/fields/admins and their public links, agenda slots and published schedule/site material, portal magic links, all event outbox mail and calendar invites, embeds, evaluations/reviewer state, tasks/uploads, imports, venues/taxonomy, event settings, webhooks, and mirror rows. Organization-scoped `people`, `person_events` notes/tags, and non-event attachment subjects are byte-identical; the deletion audit row survives with actor identity.
- **AC-307**: `marquee event delete <event-id>` is documented in `SKILL.md` and calls the same route. `POST /api/v1/admin/remove-demo` is the seeded-demo policy of that same cascade, with only its explicitly broader `is_demo` people cleanup; it is not a parallel deletion list. The legacy `attachments.event_id` wart is handled narrowly by detaching surviving `person_headshot` rows; no second attachment ownership model is introduced.

---

## Amendment 25 — connecting Airtable is a thing the product does (client-directed, 2026-08-15)

**The finding this closes.** MRQ-217 merged the outbound mirror with no reachable on switch. Its D1 triggers fire only when `mirror_state` carries a non-empty `airtable_table_id`, the drain resolves that same field per table, and the only `INSERT INTO mirror_state` in the tree is the reset sentinel — which writes NULL. Every test in that PR passes because it inserts `mirror_state` as a fixture. Setting `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID` as Wrangler secrets changes nothing: no trigger fires, no outbox row is ever written. `SPEC.md` §3.9 never specified a connect flow because it quietly assumed the base was configured out of band, and the shipped `delivery-health.ts` comment says so outright — *"the mirror is configured where the conference is hosted, not from a screen inside Marquee."* That assumption is now retired.

**Credential ruling (Atin, 2026-08-15): the personal access token is stored in D1, encrypted at rest.** A Wrangler secret would mean only somebody with deploy access can turn the mirror on, which contradicts *own your conference* and makes "setup is an item in Settings" untrue for every self-hosted organizer. The cost is accepted and named: an Airtable credential now lives in the database of a public open-source product, so encryption at rest, the never-echo-it-back rule, and a visible revoke path are load-bearing rather than nice — AC-309 exists to make each of them mechanical.

**AC-228 moves to this story** from US-72. The Settings → Airtable screen is one surface and should have one owner; US-72 keeps the sync mechanics, this story owns the screen and the door to it.

### US-92 · Connect Airtable without a deploy *(new)*

**As an** organizer, **I want** to connect our Airtable base from inside Marquee, **so that** the mirror can be switched on by the person who wants it rather than by whoever holds deploy access.

- **AC-308** The connect flow verifies the token and base against Airtable before persisting anything; a rejected credential stores nothing and says which of the two failed.
- **AC-309** The stored token is encrypted at rest, is never returned or logged on any path, and disconnect removes it and stops all mirror traffic.
- **AC-310** From an unconfigured deployment, completing the connect flow is sufficient for a local change to reach Airtable — no fixture, no SQL, no deploy.
- **AC-311** Every surface that says what this deployment is connected to names Airtable with its true state, and System health's row links to the settings screen once one exists.
- **AC-312** `SKILL.md` and the setup guide document the flow, and an agent can complete it end to end through the API with no screen opened.
- **AC-313** Connect, status, and disconnect are scoped under `mirror:write`; status is readable under a read scope and no scope ever returns the token.

`EVALUATION.md` §2.8 owns the verification rows. Built by MRQ-223 (the Airtable finisher — one ticket for connect, inbound, the door, and the agent surface). Post-deadline band; no gate count changes.

**Next mint: AC-314.**

---

## Amendment 26 — one named mail-idempotency seam *(2026-08-15, plumbing fold)*

The outbox's idempotency grain is now one named, frozen registry rather than a
scattering of inline expressions. This is a post-deadline addition; it does not
change the live competition count or tier arithmetic.

**AC-314** *(appended to US-45/US-68, post-deadline)*: A manual ad-hoc send
repeated with the same durable `Idempotency-Key` produces exactly one outbox row
per recipient, while a genuinely new nudge with no key produces a new row even
when recipient and copy are identical; first-party compose clients retain that
key across a retry and expose it in the API contract. Draft-resume requests keep
the newly minted submission id as their grain: the old repeated-submission
premise is not reproducible, and the plain id preserves the delivery-to-history
join. The registry inventory proves unchanged idempotency-key bytes across the
pure refactor, and a type-level guard rejects raw-string `entityId` values at the
outbox boundary.

`EVALUATION.md` §2.9 owns the verification row. Built by MRQ-226.

**Next mint: AC-315.**
