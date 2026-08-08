# Marquee — User Stories (DRAFT corpus)

**Owner:** Stakeholder Stories agent (Marquee Initiation → Stakeholder Stories)
**Status:** First pass, 2026-08-08. **65 stories across 13 lifecycle phases.** Companion to `stakeholders.md`; ground truth is `competition-requirements.md` (R1–R50).

## Conventions

- **Story IDs (`US-nn`) are draft handles for this document only.** They exist so the consolidation conversation has something to point at; renumber freely.
- **Every acceptance criterion is marked `DRAFT`.** Stable AC IDs get minted at consolidation with the client — none are minted here, on purpose.
- **Trace** cites the R-number(s) from the dossier register; **Source** cites a walkthrough timestamp or an external URL where the story rests on outside evidence rather than the register.
- **Seats** are the ones defined in `stakeholders.md` §2–3.
- `[INFERRED]` marks a story with no direct requirement behind it — my read of the seat's job. These are the ones most worth arguing about.

---

## Phase 0 · Deploy & adopt

*Seat: Self-hoster / Deploying Operator (Seat 14) — which is also the judge, in their first two minutes.*

### US-01 · A judge lands on a working, populated product
**As a** prospective buyer evaluating ~30 hackathon submissions, **I want** the deployed URL to hand me a working, already-populated demo and a login within ten seconds, **so that** I can start evaluating instead of setting up.
- `DRAFT` The landing page states what the product is and offers organizer and speaker demo logins without a form or a request-demo gate.
- `DRAFT` Both demo logins work on first click and land on a populated screen — never an empty state.
- `DRAFT` The seeded event contains a realistic submission volume (target: ~800–1,000) so lists, filters, and sorts are exercised at real scale.
- `DRAFT` No screen reachable from the demo logins is a stub or a dead link.
**Trace:** R25, R46, dossier §3 · **Source:** dossier §3 — *"shipping an empty database is the single most likely way to lose"*

### US-02 · An operator stands up their own instance
**As an** organization that wants to own its program tooling, **I want** to deploy Marquee and seed my own event from a documented path, **so that** adopting it is an evening, not a project.
- `DRAFT` README documents deploy, environment config, and seeding in a numbered sequence a reader can follow without asking questions.
- `DRAFT` A fresh install with no data still renders every screen with an honest empty state that says what to do next.
- `DRAFT` Extension points (registration-platform sync, Airtable mirror) are named in the README even where unimplemented.
**Trace:** R25, dossier §2 item 7, §5 · **Source:** origin tweet — *"enterprise saas we have never used and will never be able to customize"*

---

## Phase 1 · Event setup

### US-03 · Configure the event
**As a** program lead, **I want** an event settings screen for name, dates, venue, timezone, and branding, **so that** every downstream surface (forms, emails, agenda, embeds) inherits the right details.
- `DRAFT` Event name, start/end dates, timezone, venue, and logo are editable and persist.
- `DRAFT` Changing the event timezone changes how times render on the agenda and in outbound calendar invites, without editing sessions.
- `DRAFT` Saving returns to the settings screen with a confirmation, not a full reload.
**Trace:** R10 · **Source:** walkthrough [02:40] — *"you should probably have some settings where you can set up the event details"*

### US-04 · Define session formats with default durations
**As a** program lead, **I want** to define the formats my event accepts and give each a default duration, **so that** the agenda blocks are the right length without me setting each one.
- `DRAFT` Formats are user-defined (e.g. Workshop 1–2h, Stage Talk 15–20m, Lightning 5–10m, Online 5–55m) with a name and a default duration.
- `DRAFT` A session created with a format inherits that duration; it can be overridden per session.
- `DRAFT` Formats appear as a selectable field on submission forms and as a filter on submission lists.
**Trace:** R44, R5 · **Source:** sessionize.com/aienyc2026 (AIE's four formats)

### US-05 · Define tracks and rooms
**As a** program lead, **I want** to define tracks and rooms up front, **so that** submissions can be categorized on intake and scheduled without re-keying.
- `DRAFT` Tracks and rooms are created, renamed, and reordered from event settings.
- `DRAFT` A track carries a color used consistently on the agenda and public program.
- `DRAFT` A room carries a capacity, and the agenda surfaces it when scheduling.
**Trace:** R5, R1 · **Source:** learn.sessionboard.com/sessions/agenda — *"Tracks assigned to sessions determine their color"*

### US-06 · Land on a program dashboard that says what to do next
**As a** program lead opening the product mid-CFP, **I want** a dashboard showing submissions by status, review progress, days to close, and outstanding onboarding, **so that** I know the state of the program without hunting.
- `DRAFT` The dashboard shows counts by submission status and by format/track, updating without a manual refresh.
- `DRAFT` Every dashboard number is clickable and lands on the filtered list behind it.
- `DRAFT` The dashboard renders in under one second against the seeded ~1,000-submission dataset.
**Trace:** R11, R6, R7 · **Source:** walkthrough [03:17]; the "I don't know where this form thing is" navigation failure at [03:58]

---

## Phase 2 · CFP form design

### US-07 · Build a submission form
**As a** program lead, **I want** a form builder where I add, order, and configure fields, **so that** I can ask for exactly what my event needs.
- `DRAFT` Fields can be added, reordered by drag, edited, and deleted; order persists to the public form.
- `DRAFT` Field types cover at minimum: short text, long text, single select, multi select, URL, email, file upload, and number.
- `DRAFT` The builder shows a live preview matching what a submitter will see.
- `DRAFT` A form can be duplicated, so next year's CFP starts from last year's.
**Trace:** R13, R28 · **Source:** walkthrough [04:49] — *"a form builder is what you're being asked to build here… a very fancy form builder"*

### US-08 · Target a form at abstracts or at sessions
**As a** program lead, **I want** to choose at build time whether a form collects **abstracts** (applications to speak) or **sessions** (guaranteed slots), **so that** submissions land on the right side of the review pipeline.
- `DRAFT` The form carries an explicit abstract-vs-session target, set at build time and visible in the form list.
- `DRAFT` Abstract submissions enter the evaluation pipeline; session submissions can reach the agenda without an evaluation and do not read as incomplete.
- `DRAFT` The two entity types are distinguishable everywhere they are listed.
**Trace:** R9, R13 · **Source:** walkthrough [03:21], [04:35] — *"you want abstracts or you want sessions, you can choose down here"*

### US-09 · Set real, enforced validation per field
**As a** program lead, **I want** validation rules that actually fire, **so that** I don't receive garbage and my submitters don't get surprised at the end of a long form.
- `DRAFT` Required, min/max length, numeric range, URL format, and email format are configurable per field.
- `DRAFT` Validation fires client-side on blur *and* is enforced server-side on submit — a crafted request cannot bypass it.
- `DRAFT` A failed submit scrolls to the first invalid field and names the problem in plain language; no field silently rejects input.
**Trace:** R14, R32, R41 · **Source:** walkthrough [05:08] — *"and looks like it doesn't even have full validation. Very nice."* (sarcastic)

### US-10 · Set speaker and sponsor limits with sane defaults
**As a** program lead, **I want** min/max speakers and sponsors per submission, defaulted to one speaker minimum, **so that** the form matches how my event actually works.
- `DRAFT` Minimum and maximum speakers per submission are configurable; the default minimum is 1.
- `DRAFT` Maximum sponsors per submission is configurable.
- `DRAFT` The public form enforces both limits and states them before the submitter starts adding people.
**Trace:** R15, R30 · **Source:** walkthrough [06:46] — *"that was stupid. Obviously, I should not have a minimum of two speakers."*

### US-11 · Add conditional logic to a form
**As a** program lead, **I want** fields that appear only when an earlier answer warrants them, **so that** submitters see a short form and I still collect what I need for special cases.
- `DRAFT` A field can be given a show/hide condition based on one or more prior answers.
- `DRAFT` Hidden fields are not required and are not submitted; revealing a field applies its validation.
- `DRAFT` Conditions are visible in the builder without opening each field.
**Trace:** R1 · **Source:** brief item 1 — *"with conditional logic and category-based routing"* (see Q5)

### US-12 · Route submissions by category
**As a** program lead, **I want** a submission's category, track, or format to route it to the right evaluation plan or reviewer pool automatically, **so that** intake sorts itself and policy rules aren't a human's memory.
- `DRAFT` A rule maps a field answer (track / format / vendor flag) to an evaluation plan or reviewer pool.
- `DRAFT` Routing is applied at submission time and is visible on the submission record.
- `DRAFT` A vendor-content flag can route a submission away from a mainstage pool and toward workshop/expo review.
**Trace:** R1, R47 · **Source:** sessionize.com/aienyc2026 — *"FOR MAINSTAGE KEYNOTES, WE WILL NOT ACCEPT VENDOR-ONLY TALKS"*

### US-13 · Configure the form's lifecycle settings
**As a** program lead, **I want** a welcome screen, close date, submission limit per submitter, draft-saving, a reminder before close, a thank-you email, and named form admins, **so that** the form runs itself once it's open.
- `DRAFT` Welcome/intro messaging is customizable per form and shows before the first field.
- `DRAFT` A close date is set; after it passes the public link shows a closed message rather than an error, and no submission is accepted.
- `DRAFT` A per-submitter submission limit is configurable (AIE uses 3 at Code Summit, "1–5 topics" at NYC — so it is a per-form number, not a constant).
- `DRAFT` Drafts save and resume; a reminder email fires before close; a thank-you email fires on submit; form admins are notified of new submissions.
**Trace:** R29, R34, R35, R36, R37, R38, R40, R48 · **Source:** walkthrough [04:39]–[05:44]; sessionize.com/aienyc2026

---

## Phase 3 · CFP open & promotion

### US-14 · Publish a public form link that works logged-out
**As a** program lead, **I want** a shareable public URL that works with no account, **so that** anyone can submit from a tweet.
- `DRAFT` The form URL loads and submits successfully in a private/incognito window with no session.
- `DRAFT` The public form is mobile-usable end to end at 375px width.
- `DRAFT` The form page renders in under one second on a cold load.
**Trace:** R19, R7 · **Source:** walkthrough [06:02] — *"I'm going to show you how in incognito we can access this"*

### US-15 · Optionally password-protect a form
**As a** program lead running an invite-only or embargoed call, **I want** to put a password on a form, **so that** the link can be shared narrowly.
- `DRAFT` Password protection is an optional per-form setting, off by default.
- `DRAFT` With it on, the public URL prompts for the password before showing any field.
**Trace:** R42 · **Source:** walkthrough [06:12] (ambiguous — dossier Q8; low confidence, low cost)

### US-16 · Promote the call with a live counter
**As a** marketing/web lead, **I want** the open call, its deadline, and its formats available as an embeddable block, **so that** our conference site stays accurate without me editing it. `[INFERRED]`
- `DRAFT` An embeddable "call for speakers" block renders deadline, formats, and a link to the form.
- `DRAFT` The embed reflects the form's close date automatically, including switching to a closed state.
**Trace:** R24, R34 · **Source:** learn.sessionboard.com/sessions/embeds (five embed types; 60-minute refresh — we should be faster)

---

## Phase 4 · Submission

### US-17 · Submit an abstract in one sitting
**As a** speaker, **I want** to complete and submit an application without an account, **so that** applying costs me minutes, not a signup.
- `DRAFT` A submission completes end to end with no pre-existing account.
- `DRAFT` On submit, the submitter sees a confirmation screen and receives a confirmation email containing a link back to their submission.
- `DRAFT` The submitted record appears in the admin list immediately.
**Trace:** R19, R38 · **Source:** walkthrough [06:24]–[06:43]

### US-18 · Submit from a phone
**As a** speaker who read the CFP on my phone, **I want** to complete the form on that phone, **so that** I don't lose the intention by promising to do it later at a desk. `[INFERRED]`
- `DRAFT` Every field type, including file upload, is operable at 375px width.
- `DRAFT` No horizontal scrolling and no field obscured by the on-screen keyboard.
- `DRAFT` A partially completed mobile form can be resumed on desktop via the draft link.
**Trace:** R19, R37

### US-19 · Save a draft and come back
**As a** speaker writing a long abstract, **I want** my progress saved, **so that** a closed tab doesn't cost me the submission.
- `DRAFT` Progress is recoverable after closing the browser, via an emailed resume link or an account.
- `DRAFT` The form shows when it last saved.
- `DRAFT` A draft is clearly not a submission — the submitter can tell which state they are in.
**Trace:** R37 · **Source:** walkthrough [05:32]

### US-20 · Submit more than once, up to the limit
**As a** speaker, **I want** to propose several topics up to the event's cap, **so that** I don't have to guess which one the program wants.
- `DRAFT` A submitter can create multiple submissions up to the configured per-form limit.
- `DRAFT` At the limit, the form explains the cap rather than failing opaquely.
- `DRAFT` All of a submitter's submissions are listed together in their portal.
**Trace:** R36, R48 · **Source:** sessionize.com/aienyc2026 — *"speakers encouraged to propose 1-5 topics"*

### US-21 · Add a co-speaker to a submission
**As a** speaker proposing a panel, **I want** to add co-speakers by name and email, **so that** the panel is represented correctly from the start.
- `DRAFT` Co-speakers are added within the form up to the configured maximum.
- `DRAFT` Each co-speaker receives an email telling them they've been added, by whom, to what, and how to complete their own profile.
- `DRAFT` A co-speaker can supply their own bio and headshot without editing the abstract.
**Trace:** R30, R15 · **Source:** learn.sessionboard.com/communications/automated-emails — the dedicated *"Added to a submission"* trigger

### US-22 · Enter a submission manually as an admin
**As a** program lead, **I want** to create a submission or session directly in the admin, **so that** invited talks and sponsor slots live in the same system as everything else.
- `DRAFT` An admin can create a submission without going through the public form, choosing abstract or session.
- `DRAFT` An admin-created session can be marked as bypassing evaluation and still reach the agenda.
- `DRAFT` Admin-created records are visually distinguishable from public submissions in lists.
**Trace:** R12, R9 · **Source:** walkthrough [03:53] — *"here you can enter in manually"*

### US-23 · Submit on behalf of someone else
**As a** comms manager submitting for an executive, **I want** to be recorded as the submitter while the executive is the speaker, **so that** correspondence reaches me and the program is right. `[INFERRED]`
- `DRAFT` Submitter and speaker are distinct roles on a submission and can be different people.
- `DRAFT` Confirmation and status emails go to the submitter; task and profile requests go to the speaker.
- `DRAFT` Both appear on the submission record with their role labelled.
**Trace:** R9, R30 · **Source:** learn.sessionboard.com/concepts/participant-roles — the Session Submitter *"may or may not present"*

---

## Phase 5 · Review rounds

### US-24 · Create an evaluation plan
**As a** program lead, **I want** to build an evaluation plan with a scorecard and instructions, **so that** my committee scores against the same rubric.
- `DRAFT` A plan has a name, instructions, a scoring scale, and a set of submissions.
- `DRAFT` The scorecard supports at minimum a numeric rating, a free-text comment, and an optional weighted rubric whose criteria sum to 100%.
- `DRAFT` Assigning evaluators does not require closing the plan first, and no step in plan creation is order-dependent in a way the UI doesn't state.
**Trace:** R4, R20 · **Source:** walkthrough [07:43]; learn.sessionboard.com/evaluations/evaluation-plans — *"the plan must be **closed** to assign them"* (an anti-pattern to avoid)

### US-25 · Assign submissions to a committee, not just individuals
**As a** program lead, **I want** to assign a batch of submissions to a team of evaluators, **so that** I manage groups instead of hundreds of individual assignments.
- `DRAFT` Evaluators can be grouped into named committees, and a committee can be assigned a filtered set of submissions.
- `DRAFT` Assignment supports at least: everyone reviews everything, and N reviewers per submission distributed across the committee.
- `DRAFT` The plan shows per-evaluator and per-submission progress against the target review count.
**Trace:** R21 · **Source:** walkthrough [07:52] — *"we can assign sessions to be evaluated by conference committees"*

### US-26 · Work a review queue fast
**As a** reviewer with 300 submissions assigned, **I want** a queue that shows one submission at a time and advances on score, **so that** I can clear a large batch in one sitting without losing my place.
- `DRAFT` Scoring a submission advances to the next unreviewed one without a full page load.
- `DRAFT` The queue shows position and remaining count, and resumes at the right place after leaving and returning.
- `DRAFT` Keyboard shortcuts cover score and advance.
- `DRAFT` Median time from score to next card is under 300ms against the seeded dataset.
**Trace:** R22, R7, R46 · **Source:** walkthrough [08:02] — *"as an evaluator I can look through all these things"*

### US-27 · Review on a phone
**As a** volunteer reviewer, **I want** to work my queue on my phone, **so that** the review actually gets done. `[INFERRED]`
- `DRAFT` The review queue is fully operable at 375px: read the abstract, score, comment, advance.
- `DRAFT` No admin chrome is present on the reviewer surface.
**Trace:** R22, R7, R46

### US-28 · Review blind
**As a** program lead, **I want** to hide submitter and speaker identity from reviewers, **so that** scoring is on the content.
- `DRAFT` Anonymized review is an admin setting per plan or per round; reviewers cannot toggle it.
- `DRAFT` With it on, no reviewer-visible surface exposes name, company, email, bio, or headshot — including exports and any submission text field flagged as identity-bearing.
- `DRAFT` Admins can still see identity throughout.
**Trace:** R50 · **Source:** learn.sessionboard.com/evaluations/setting-up-round-based-evaluations — *"Hides submitter and participant identity from evaluators"*; docs.pretalx.org/user/organisers/ — *"Always hide speaker names"*

### US-29 · Declare a conflict and abstain
**As a** reviewer, **I want** to abstain from a submission I have a conflict on, with an optional reason, **so that** my committee's scores stay honest.
- `DRAFT` Abstaining removes the submission from that reviewer's queue and from their contribution to its score.
- `DRAFT` The abstention and its reason are visible to the review chair.
- `DRAFT` An abstained submission is redistributed so its target review count is still met.
**Trace:** R4, R50 · **Source:** learn.sessionboard.com/evaluations/setting-up-round-based-evaluations (evaluators "can abstain with optional reasons")

### US-30 · Run more than one round
**As a** program lead, **I want** multiple evaluation rounds with their own scorecards, **so that** a screening pass can feed a committee decision pass.
- `DRAFT` A plan supports multiple ordered rounds, each with its own scorecard and evaluator set.
- `DRAFT` Advancement is configurable as funnel (explicit promotion between rounds) or parallel (all rounds at once).
- `DRAFT` A submission's per-round scores are visible together on its record.
**Trace:** R4 · **Source:** brief item 4 (*"across multiple rounds"*); learn.sessionboard.com — *"Initial Screen → Peer Review → Committee Decision"*

### US-31 · See where the review actually stands
**As a** review chair, **I want** coverage and score distribution at a glance, **so that** I find the unreviewed submissions before the wave deadline, not after.
- `DRAFT` A view shows submissions below their target review count, sortable and filterable by track.
- `DRAFT` Per-evaluator completion is visible, so a stalled reviewer is identifiable.
- `DRAFT` A ranked list by normalized score is exportable.
**Trace:** R4, R21, R46 · **Source:** stakeholders.md Seat 5

### US-32 · Optional AI first-pass scoring
**As a** program lead facing 3,000 submissions, **I want** an optional AI first pass that flags obvious mismatches, **so that** human reviewers spend their attention where it counts — and I can turn it off entirely.
- `DRAFT` AI assistance is off by default and clearly labelled as an aid, never as a decision.
- `DRAFT` No submission's status changes as a result of AI scoring without a human action.
- `DRAFT` The feature is absent from the default demo path.
**Trace:** R4 (AI clause), R27 · **Source:** walkthrough [09:23] — *"I don't care about the AI workflow thing"* (dossier Q6: satisfy the brief, do not lead with it)

---

## Phase 6 · Wave acceptances

*The phase the incumbents handle worst, and the one AIE runs three times per event while the CFP is still open.*

### US-33 · Accept a batch mid-CFP
**As a** program lead, **I want** to select many submissions and accept them in one action while the CFP is still open, **so that** wave dates are an afternoon, not a week.
- `DRAFT` Multi-select with filters supports selecting a filtered set and acting on all of it.
- `DRAFT` A bulk accept sets status, triggers the configured notification, and reports a per-record success/failure summary.
- `DRAFT` Accepting a batch does not close the form or block further submissions.
- `DRAFT` A bulk action over 100+ records completes without timing out or blocking the UI.
**Trace:** R43, R46 · **Source:** sessionize.com/aienyc2026 (Wave 1 Aug 15, Wave 2 Sep 1, Final Sep 15; CFP closes Sep 12); learn.sessionboard.com/speakers/speaker-acceptance documents **no** bulk path

### US-34 · Reject with a template, kindly and at scale
**As a** program lead rejecting 85–95% of submissions, **I want** templated rejections that merge in the submission title, **so that** everyone gets a real answer.
- `DRAFT` A rejection template supports merge fields for speaker name and submission title.
- `DRAFT` Rejections can be sent in bulk, with a preview of a rendered example before sending.
- `DRAFT` Rejected submitters see the outcome in their portal as well as by email.
- `DRAFT` Sending is idempotent — a submission cannot be notified twice by a repeated bulk action.
**Trace:** R43, R3, R16 · **Source:** sessionize.com/aienyc2026 (5–15% acceptance)

### US-35 · Hold submissions between waves
**As a** program lead, **I want** a waitlist/hold status distinct from accept and reject, **so that** a strong submission survives Wave 1 without being decided.
- `DRAFT` Statuses include at least: submitted, in review, accepted, waitlisted, rejected, withdrawn.
- `DRAFT` Waitlisted submissions are excluded from the agenda by default but stay in the pipeline for later waves.
- `DRAFT` Status changes are timestamped and attributed.
**Trace:** R43 · **Source:** three-wave structure implies a mid-state `[INFERRED]`

### US-36 · Un-accept a talk after a speaker drops
**As a** program lead whose speaker just cancelled, **I want** to reverse an acceptance and see everything that reversal touches, **so that** the agenda, the public site, and the speaker's portal don't keep telling the old story.
- `DRAFT` An accepted submission can be moved to withdrawn/rejected at any point.
- `DRAFT` Reversing acceptance removes the session from the agenda and from all public surfaces and embeds, and the empty slot is visible to the scheduler.
- `DRAFT` The system states what else is affected (portal tasks, scheduled emails, calendar invites) and offers to cancel or retain each, rather than silently continuing.
- `DRAFT` Any already-sent calendar invite receives a cancellation.
**Trace:** R43, R3, R23 · **Source:** learn.sessionboard.com/speakers/speaker-acceptance (admins can change status at any time — but nothing describes the cascade)

### US-37 · Speaker confirms or declines their slot
**As a** speaker who has been accepted, **I want** to confirm or decline, **so that** the program knows whether I'm actually coming.
- `DRAFT` An accepted speaker sees a confirm/decline action in their portal, and the program lead sees the response.
- `DRAFT` A person holding multiple roles on a submission (e.g. speaker *and* moderator) confirms each role separately.
- `DRAFT` Declining notifies the program lead and flags the agenda slot.
**Trace:** R16, R17 · **Source:** learn.sessionboard.com/speakers/speaker-acceptance — *"Each participant answers for every role they hold on a submission"*

---

## Phase 7 · Speaker onboarding

### US-38 · See my status without asking anyone
**As a** speaker, **I want** my current status visible the moment I log in, **so that** I stop refreshing my inbox.
- `DRAFT` Status is the most prominent element of the speaker portal, per submission.
- `DRAFT` Pre-decision status is honest about timing (e.g. the next wave date) rather than blank.
- `DRAFT` Status changes are reflected in the portal within seconds of the admin action.
**Trace:** R16 · **Source:** walkthrough [07:01] — *"this is an important part of it — whether or not you have been accepted or not… that's a key part"*

### US-39 · See exactly what I owe and by when
**As an** accepted speaker, **I want** a task list with deadlines, **so that** I can finish my obligations in one visit.
- `DRAFT` Tasks show title, description, due date, and completion state, ordered by due date.
- `DRAFT` Task types cover at minimum: acknowledge, upload a file, and complete a form.
- `DRAFT` Completing a task updates the organizer's dashboard without an admin action.
- `DRAFT` Overdue tasks are visually distinct from upcoming ones.
**Trace:** R17, R6 · **Source:** walkthrough [07:12] — *"once you've been accepted, what tasks do you have to complete?… very very handy"*; learn.sessionboard.com/portals/assign-tasks

### US-40 · Edit my own biography and headshot
**As a** speaker, **I want** to update my bio and headshot myself, **so that** the program is accurate and nobody has to email me about it.
- `DRAFT` A speaker can edit their bio, headshot, title, company, and social links from their portal at any time.
- `DRAFT` Changes propagate to the public speaker gallery and session pages without an admin step.
- `DRAFT` Headshot upload accepts common image formats, validates minimum dimensions on upload, and shows a crop preview.
**Trace:** R18, R2 · **Source:** walkthrough [07:29] — *"as well as you being able to update your own biography. This is a very important part"*

### US-41 · Upload my slides and supporting documents
**As a** speaker, **I want** to upload my deck and materials to the portal, **so that** they're in the right place and I get told they arrived.
- `DRAFT` File upload accepts PDF/PPTX/KEY up to a stated size limit, with the limit shown before upload.
- `DRAFT` Upload shows progress and confirms success; a failure is recoverable without redoing the form.
- `DRAFT` The organizer sees the upload against the speaker's task immediately.
**Trace:** R2, R17 · **Source:** brief item 2 (*"bios, headshots, slides, and supporting documents"*); learn.sessionboard.com/portals/portals-101 (file requests)

### US-42 · Give my travel and accommodation details
**As an** accepted speaker whose flights are covered, **I want** a structured intake for travel and hotel preferences, **so that** the organizer isn't emailing me for my passport spelling.
- `DRAFT` A travel task collects arrival/departure dates, origin city, name-as-on-ID, and hotel nights needed.
- `DRAFT` The form states the policy limits (e.g. economy flights; 2 nights domestic / 3 international) inline.
- `DRAFT` Responses are exportable as a single table for the travel booker.
**Trace:** R49, R17 · **Source:** ai.engineer/nyc — *"Economy flights and accommodation covered (up to 2 nights domestic, 3 nights international)"*

### US-43 · Add a co-speaker to my accepted session
**As an** accepted speaker whose panel changed, **I want** to invite an additional speaker for organizer approval, **so that** the program is right without an email thread.
- `DRAFT` A portal action requests an additional participant with name, email, and role.
- `DRAFT` The request goes to an organizer queue for approval; it does not silently add the person.
- `DRAFT` On approval the new participant receives portal access and their own task list.
**Trace:** R30, R17 · **Source:** learn.sessionboard.com/faq/how-to-allow-portal-users-to-add-speakers-to-their-accepted-session — the incumbent offers only reopening the form or a bespoke workaround form

### US-44 · Chase the stragglers from one screen
**As an** ops coordinator the week before the event, **I want** a real-time dashboard of who is missing what, filtered to overdue, with one-click reminders, **so that** chasing 40 speakers is one sitting instead of forty emails.
- `DRAFT` A dashboard lists every accepted speaker against every assigned task, with a completion state per cell.
- `DRAFT` It filters to "overdue," "incomplete," and by task type, and sorts by how far overdue.
- `DRAFT` A reminder can be sent to a filtered set in one action, using a template, and the send is recorded against each speaker.
- `DRAFT` The view updates live as speakers complete tasks — no report to run, no field to configure first.
**Trace:** R6, R3 · **Source:** brief item 6; pheedloop.com/blog/chasing-conference-speakers-photos-bios — organizers spend *"hours each day or week sending the same emails"*; contrast learn.sessionboard.com/portals/assign-tasks, where seeing completion requires adding "the task reporting field(s)" to a view

---

## Phase 8 · Communications

### US-45 · Send a templated email to a filtered group
**As an** ops coordinator, **I want** to email a filtered set of speakers from a template with merge fields, **so that** I never paste a list into BCC again.
- `DRAFT` Templates support merge fields for speaker name, session title, room, and time.
- `DRAFT` Recipients are chosen by filter (status, track, format, task state), with the count shown before send.
- `DRAFT` A preview renders one real recipient's version before sending.
- `DRAFT` Every send is logged per recipient, visible on their record.
**Trace:** R3 · **Source:** brief item 3

### US-46 · Automate the recurring messages
**As an** ops coordinator, **I want** the routine emails to fire on their own, **so that** the system does the reminding.
- `DRAFT` Automated triggers cover at minimum: submission confirmation, submission-closing reminder, added-to-a-submission, acceptance, rejection, task assigned, and task overdue.
- `DRAFT` Each trigger can be enabled/disabled and its template edited.
- `DRAFT` A reminder before the form's close date fires on a configurable schedule.
**Trace:** R3, R35, R38 · **Source:** learn.sessionboard.com/communications/automated-emails (~25 triggers; closing reminders at five days and one day before close)

### US-47 · Deliver a calendar invite to the speaker's own calendar
**As a** speaker, **I want** my session to land in my actual calendar with room and time, **so that** I show up in the right place — and get the update when it moves.
- `DRAFT` A scheduled session generates a calendar invite the speaker's client renders as a real invite, not an attachment they must import (`METHOD:REQUEST`), plus Add-to-Google and Add-to-Outlook links.
- `DRAFT` The invite carries correct timezone, room/location, session title, and a link to the session page.
- `DRAFT` Rescheduling sends an update that replaces the existing entry rather than creating a duplicate; un-accepting sends a cancellation.
**Trace:** R3 · **Source:** brief item 3 verbatim (*"calendar invites delivered directly to each speaker's own calendar (Gmail, Outlook, iCal)"*); dossier §1.1 note — Sessionboard's automated-email documentation **contains no calendar-invite feature at all**; dossier Q9

### US-48 · Send from our own domain
**As an** organization, **I want** outbound mail to come from our conference domain, **so that** speakers trust it and it doesn't land in spam.
- `DRAFT` The sending domain and from-name are configurable per organization or event.
- `DRAFT` Setup documents SPF/DKIM/DMARC requirements.
- `DRAFT` Replies route to a configured address, not to a no-reply black hole.
**Trace:** R3, dossier §5 · **Source:** AIE budgeted *"Custom email domain setup"* at $500 — twice `[DOSSIER §6.2]`

### US-49 · See what a speaker has been sent
**As an** ops coordinator picking up a thread, **I want** the message history on a speaker's record, **so that** I don't re-send or contradict a colleague. `[INFERRED]`
- `DRAFT` Each speaker record shows every message sent to them with timestamp, template, and delivery outcome.
- `DRAFT` Bounces and failures are visible without leaving the product.
**Trace:** R3, R6

---

## Phase 9 · Agenda build

### US-50 · Push accepted sessions into the agenda without re-entry
**As a** program lead, **I want** accepted sessions to be schedulable directly, **so that** nothing is typed twice.
- `DRAFT` Accepted sessions appear in an unscheduled pool ready to place.
- `DRAFT` By default only accepted submissions are schedulable; which statuses qualify is configurable.
- `DRAFT` A session's title, speakers, format, and track carry through from the submission with no re-entry.
**Trace:** R23, R5 · **Source:** walkthrough [08:17] — *"once things have been evaluated, accepted… then we can add the accepted sessions in here for the agenda"*

### US-51 · Drag and drop to schedule
**As a** program lead, **I want** to drag a session onto a day, time, and room, **so that** building the schedule is direct manipulation.
- `DRAFT` A session can be dragged from the unscheduled pool onto a slot and back off it.
- `DRAFT` Dropping sets date, start time, and room; duration defaults from the session's format and is resizable.
- `DRAFT` Drag feedback is immediate and the change persists without a save button.
**Trace:** R5, R44 · **Source:** brief item 5

### US-52 · Catch conflicts automatically
**As a** program lead, **I want** the agenda to flag overlapping rooms and double-booked people the moment they happen, **so that** I don't discover it on stage.
- `DRAFT` Two sessions in the same room at overlapping times are flagged.
- `DRAFT` A person double-booked across two sessions is flagged — covering every participation role (speaker, co-speaker, moderator, chairperson), not just primary speakers.
- `DRAFT` Conflicts are visible on the agenda itself, and a list of all current conflicts is reachable in one click.
- `DRAFT` A conflict does not block the placement; it warns.
**Trace:** R5 · **Source:** brief item 5 (*"automatic conflict detection across rooms and tracks"*); learn.sessionboard.com/sessions/agenda — *"double-booked participants (speakers, chairpersons, moderators)"*

### US-53 · See the schedule five ways, including by track
**As a** program lead, **I want** list, day, week, track, and room views, **so that** I can check balance from whichever angle the question comes from.
- `DRAFT` All five views exist and are switchable without losing scroll position or filters.
- `DRAFT` The **track** view is a genuine swimlane per track, not a color overlay.
- `DRAFT` Every view reflects an edit made in any other view immediately.
**Trace:** R5 · **Source:** brief item 5 verbatim; dossier §1.1 note — Sessionboard ships list/day/week/**month**/rooms with **no track view**, so this is a deliberate ask for something the incumbent lacks

### US-54 · Filter and slice the agenda
**As a** program lead, **I want** to filter the agenda by track, format, room, and day, **so that** I can review one strand at a time. `[INFERRED]`
- `DRAFT` Filters apply across all views and are reflected in the URL so a filtered view is shareable.
- `DRAFT` Filtering the seeded dataset re-renders in under 200ms.
**Trace:** R5, R7, R46

### US-55 · Keep an eye on program balance
**As a** program lead, **I want** counts by track, format, and day as I schedule, **so that** I notice a lopsided program while I can still fix it. `[INFERRED]`
- `DRAFT` Live counts by track and format are visible alongside the agenda.
- `DRAFT` Unscheduled accepted sessions are counted and reachable in one click.
**Trace:** R5, R11

### US-56 · Move a session and have everyone told
**As a** program lead, **I want** rescheduling to notify the affected people, **so that** a change in the tool is a change in the world.
- `DRAFT` Changing a scheduled session's time or room offers to notify its participants.
- `DRAFT` Notification includes an updated calendar invite that replaces the previous entry.
- `DRAFT` Published public surfaces and embeds reflect the change without a manual republish.
**Trace:** R3, R5, R24

---

## Phase 10 · Publish & embed

### US-57 · Publish a public agenda
**As a** program lead, **I want** a public agenda page for the finished program, **so that** attendees can see what's on.
- `DRAFT` A public, logged-out agenda shows sessions with times, rooms, tracks, and speakers.
- `DRAFT` Sessions and speakers have their own permalinked pages, cross-linked to each other.
- `DRAFT` The page is mobile-usable and loads in under one second.
- `DRAFT` Only published statuses appear; nothing unpublished leaks.
**Trace:** R24, R7 · **Source:** walkthrough [08:22], [08:37] — *"a very standard sort of event display with everything all linked"*

### US-58 · Embed the schedule and speaker gallery on our own site
**As a** marketing/web lead, **I want** copyable embed code for the schedule and speaker gallery, **so that** our conference site stays in sync without me touching it.
- `DRAFT` An embed configuration screen produces a copyable snippet, with a preview.
- `DRAFT` At minimum a schedule itinerary and a speaker gallery are embeddable, filterable by track and status.
- `DRAFT` The embed reflects source changes promptly — target near-immediate, and materially faster than the incumbent's 60-minute refresh.
- `DRAFT` The embed is responsive and inherits basic color configuration.
**Trace:** R24, dossier §2 item 9 / Q2 · **Source:** walkthrough [08:25] — *"embedding them in some external environment where you can get the code"*; learn.sessionboard.com/sessions/embeds

### US-59 · Take the data in a format I choose
**As a** web developer, **I want** the program as JSON and iCal as well as HTML, **so that** I can build my own front end.
- `DRAFT` Public program data is available as JSON and as an iCal feed.
- `DRAFT` Formats are documented in the README with a working example.
**Trace:** R24, dossier §2 item 7 · **Source:** learn.sessionboard.com/sessions/embeds (styled HTML / basic HTML / JSON / XML / iCal); sessionize.com/playbook/team-roles-explained (a dedicated `Developer` seat for API/embeds)

### US-60 · Build a personal itinerary
**As an** attendee, **I want** to star sessions and get my own schedule, **so that** I know where I'm going. `[INFERRED — struck brief item 9, but described in the video]`
- `DRAFT` An attendee can select sessions and view only those, with no account required (local persistence is acceptable).
- `DRAFT` A personal itinerary is exportable to a calendar.
- `DRAFT` Conflicting personal selections are visible to the attendee.
**Trace:** R24, dossier §2 item 9 / Q2

---

## Phase 11 · Day-of

### US-61 · Run the room from a phone
**As a** production coordinator, **I want** a per-room run-of-show with speaker contact details on my phone, **so that** I can find people and keep time.
- `DRAFT` A room view lists the day's sessions in order with times, speakers, and contact details.
- `DRAFT` It is usable at 375px and readable in low light.
- `DRAFT` It reflects last-minute changes without a refresh.
**Trace:** R5, R6 `[INFERRED]` · **Source:** stakeholders.md Seat 15

### US-62 · Check in speakers
**As a** production coordinator, **I want** to mark a speaker as arrived, **so that** the team knows who is still missing 20 minutes before their slot. `[INFERRED]`
- `DRAFT` A speaker can be marked arrived/not arrived per session day.
- `DRAFT` Unarrived speakers with a session in the next hour are surfaced.
**Trace:** R6

### US-63 · Make a last-minute change that reaches everyone
**As a** program lead, **I want** a change made day-of to propagate to the public agenda, the embeds, and the affected speakers within a minute, **so that** the printed sheet isn't the source of truth. `[INFERRED]`
- `DRAFT` A session edit is reflected on public surfaces and embeds within 60 seconds.
- `DRAFT` Affected participants can be notified in one action from the agenda.
**Trace:** R24, R3, R5

---

## Phase 12 · Post-event

### US-64 · Collect what comes after the talk
**As an** ops coordinator, **I want** to request slides and recording permissions after the event as ordinary portal tasks, **so that** post-event collection uses the same machinery as onboarding.
- `DRAFT` Tasks can be assigned after the event date and appear normally in speaker portals.
- `DRAFT` Post-event completion appears on the same dashboard as pre-event tasks.
- `DRAFT` Uploaded post-event files are attached to the session record.
**Trace:** R2, R6, R17 · **Source:** pheedloop.com/blog/chasing-conference-speakers-photos-bios (post-event recordings, slides, and resources are on the chase list); ai.engineer/nyc (professional recording published to YouTube/X/LinkedIn)

### US-65 · Carry a speaker forward to the next event
**As an** organization running four events a year, **I want** a person's profile, history, and contact details to persist across events, **so that** a returning speaker doesn't start from zero.
- `DRAFT` A person exists at the organization level, and their participation is per event.
- `DRAFT` A returning speaker's bio and headshot prefill on a new submission, editable per event.
- `DRAFT` Cross-event reviewer access is *not* inherited — reviewer scope is per event by construction.
**Trace:** R45, R50 · **Source:** dossier §6.2 (four events/yr, ~775 speakers); sessionize platform-overview (speaker profiles *"reusable across events"*); docs.pretalx.org/user/organisers/ — *"Create separate reviewer teams for each event to avoid accidentally exposing past or future submissions"*

---

# Priority cut

## The gate: the walkthrough loop must complete end-to-end

The dossier is unambiguous that evaluation is a judge driving the deployed site through the video's sequence, and that *"a judge who hits a stub screen mid-flow stops evaluating"* `[DOSSIER §3]`. So the MVP is defined by the loop first and by feature depth second.

**The loop, in order, with the stories that carry it:**

| # | Walkthrough step | Stories |
|---|---|---|
| 1 | Land, self-serve, get a login | US-01 |
| 2 | Configure event details | US-03, US-04, US-05 |
| 3 | See the program dashboard | US-06 |
| 4 | Build a CFP form (abstracts vs sessions) | US-07, US-08, US-09, US-10, US-13 |
| 5 | Open it in incognito and submit | US-14, US-17, US-19 |
| 6 | Log in as that speaker: status, tasks, bio | US-38, US-39, US-40 |
| 7 | Create an evaluation plan, assign a committee | US-24, US-25 |
| 8 | Evaluate a queue | US-26, US-28 |
| 9 | Accept, and push accepted sessions to the agenda | US-33, US-50 |
| 10 | Build the agenda, catch conflicts | US-51, US-52, US-53 |
| 11 | View the public agenda, copy the embed code | US-57, US-58 |

**Any one of those eleven steps failing loses the competition regardless of what else is built.**

## MVP — ship by Wednesday

**Tier A — the loop (non-negotiable):** US-01, US-03, US-04, US-05, US-06, US-07, US-08, US-09, US-10, US-13, US-14, US-17, US-19, US-24, US-25, US-26, US-28, US-33, US-38, US-39, US-40, US-50, US-51, US-52, US-53, US-57, US-58. **(27 stories)**

**Tier B — the visible wins, in this order.** Each is cheap relative to how much it differentiates:

| Order | Story | Why it earns a slot |
|---|---|---|
| 1 | **US-44** — chase from one screen | This is brief item 6, and it's the seat Sessionize doesn't serve at all. The single strongest "we understand your job" surface. |
| 2 | **US-47** — real calendar invites | Brief item 3, verbatim, and Sessionboard's own docs show **no** calendar feature exists. Hours of work, beats the incumbent outright. |
| 3 | **US-34** — templated rejection at scale | 85–95% of submitters experience this. Also proves bulk actions work at volume. |
| 4 | **US-22** — admin manual entry | Makes R9's Abstracts-vs-Sessions distinction *visible* rather than theoretical. |
| 5 | **US-36** — un-accept with cascade | The unglamorous story nobody builds. A judge who tries it and sees the cascade handled will remember it. |
| 6 | **US-46** — automated trigger emails | Without this, R3 is only half-built and the portal feels inert. |
| 7 | **US-45** — templated email to a filtered group | Ops's daily tool; makes the comms module real. |
| 8 | **US-11 / US-12** — conditional logic + category routing | Brief item 1 names both explicitly. Routing is what makes it more than a form builder (dossier Q5). |
| 9 | **US-41** — slide/document upload | Brief item 2 names slides. An empty portal reads as unfinished. |
| 10 | **US-21** — co-speaker on submission | R30/R15 both point here; makes panels work. |
| 11 | **US-37** — speaker confirms slot | Closes the acceptance loop; one screen. |
| 12 | **US-27 + US-18** — mobile reviewer and mobile submit | Responsive, not a second product. "Clear 40 reviews on the train" is a concrete answer to R7/R46 no incumbent offers. |
| 13 | **US-02** — README + deploy path | Judged deliverable, not a nicety `[DOSSIER §3]`. |
| 14 | **US-32** — optional AI first pass, off by default | Satisfies brief item 4's AI clause in an afternoon. Explicitly do not lead with it (R27). |

**MVP total: ~43 stories.**

## Cross-cutting requirements that are not stories but gate all of them

- **Speed (R7).** Every list, filter, and transition in the demo path must be fast against ~1,000 seeded submissions. This is graded whether or not anyone writes it down — three unprompted complaints in a ten-minute video.
- **Navigability (R8/§6.5 item 4).** swyx got lost in the incumbent's admin twice, on camera. Every module must be reachable from the dashboard in one click.
- **Seeded demo data (§3).** Not a story; a precondition for all of them.
- **Participation as a (person, session, role) triple.** One table at the first migration; expensive later. Gates US-21, US-23, US-37, US-52, US-65.

## Post-competition

**Deferred, in rough order of value:** US-30 (multi-round), US-31 (review coverage dashboard), US-29 (conflict/abstain), US-35 (waitlist), US-42 (travel intake), US-43 (co-speaker on accepted session), US-48 (custom sending domain), US-49 (message history), US-54 / US-55 (agenda filters and balance), US-56 (reschedule notifications), US-59 (JSON/iCal), US-60 (personal itinerary), US-61 / US-62 / US-63 (day-of), US-64 (post-event collection), US-65 (cross-event people), US-15 (form password), US-16 (CFP promo embed), US-20 (multi-submission limit — trivial, promote if cheap), US-23 (submit on behalf of).

**Judgment calls worth the client's attention:**
- **US-42 (travel intake)** is deferred but is the most AIE-specific story in the corpus — they cover flights and hotels for ~150 speakers `[SRC ai.engineer/nyc]`. If there is any slack, a single travel task template is a strong signal that we read their actual CFP.
- **US-30 (multi-round)** is explicit in brief item 4 (*"across multiple rounds"*). Deferring it is a real risk. Mitigation: build one round properly with the *data model* round-aware, so the demo doesn't claim what it can't do.
- **US-60 (personal itinerary)** sits inside dossier Q2, where the brief and the video disagree. Track the ruling.
- **US-59 (JSON/iCal export)** is nearly free once the public agenda exists and reads as maturity to a technical judge.

---

*Living document. Next inputs: Saturday + Sunday clarification videos (requirements freeze after Sunday), Discord rulings, and consolidation with the client — where stable AC IDs get minted and this corpus becomes the product definition.*
