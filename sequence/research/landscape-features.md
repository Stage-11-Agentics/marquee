# Marquee — Competitive Feature Landscape

**Agent:** Landscape Features (Marquee Initiation → Landscape Features)
**First full pass:** 2026-08-08
**Companion doc:** [`competition-requirements.md`](competition-requirements.md) — the R1–R50 register this document keys to.

---

## Update log

| When | What landed |
|---|---|
| 2026-08-08 ~17:0x EDT | Sessionize deep pass (features page, playbook, pricing, speaker experience, evaluation modes, embeds, roles). |
| 2026-08-08 ~17:1x EDT | Sessionboard Program-module deep pass (~20 KB articles: form builder, field types, conditional logic, evaluations incl. rounds + AI, agenda, portals/tasks/pages/forms, automated emails, program settings, event details, roles, embeds, program site, acceptance). |
| 2026-08-08 ~17:2x EDT | pretalx deep pass (user guide: CfP, reviews, scheduling, sessions, emails, FAQ; API; plugin registry; release notes; hosted feature page). Indico + survey tier. |
| 2026-08-08 ~17:3x EDT | Survey tier: Sched, Oxford Abstracts, EasyChair, HotCRP, OpenReview, PaperCall, frab, Swapcard/Bizzabo/Cvent. Matrix + classification + threat read written. |

---

## 0. Executive read — six findings that change the plan

**1. The dossier's most important price fact is missing, and it reframes the pitch.**
Sessionize — the tool AIE actually runs on today — costs **$499 USD per event** for the Professional tier, with *all features* included, and **free** for community events ([sessionize.com/pricing](https://sessionize.com/pricing)). Sessionboard quoted AIE **$9,999 for one event**. So AIE is not currently overpaying; they are being *asked* to overpay by 20×. Marquee cannot win on "cheaper than Sessionboard" — Sessionize already is, by an order of magnitude, and the judges know it. **The winning frame is: everything Sessionize does, plus the post-acceptance workflow it doesn't do, self-hosted and owned, and fast.** Sessionboard's actual value proposition to AIE was never the CFP — it was the portal, the tasks, and the comms. That is exactly the ground Marquee must take.

**2. Three dossier claims about Sessionize need correcting.** ([§6.3](competition-requirements.md#63-the-tool-they-use-today-sessionize) says Sessionize lacks "speaker onboarding tasks, templated comms, calendar invites, or agenda conflict detection.")
- **Conflict detection: WRONG.** Sessionize ships "Individual session scheduling with **collision preview**" ([features](https://sessionize.com/features)) and the playbook confirms "**schedule collision detection**" ([platform overview](https://sessionize.com/playbook/overview/platform-overview)).
- **Calendar invites: WRONG as stated.** Sessionize ships "**Send automated calendar placeholders to scheduled speakers**" ([features](https://sessionize.com/features)). No playbook article details it, so depth is unverified — but the capability is claimed on the sales page. *Sessionboard* is the one with zero calendar anything.
- **Templated comms: HALF RIGHT.** Sessionize has group mailing with merge variables and test-send, but **no trigger-based automated email templates** ([group mailing](https://sessionize.com/playbook/group-mailing)) — the article explicitly has no templates, no automation, no triggers. Sessionboard, by contrast, ships **26 automated triggers** ([automated emails](https://learn.sessionboard.com/communications/automated-emails)).
- **Onboarding tasks: CORRECT and it is the cleanest gap in the market.** See finding 4.

**3. Sessionboard's agenda has conflict detection but no track view — the dossier's read on R5 holds and sharpens.**
Verbatim, Sessionboard ships five views: "List view — Default — sessions in a table / Day view — Hourly timeline for a single day / Week view — Seven-day calendar / Month view — Full-month calendar layout / Rooms view — Sessions organized by room" ([agenda](https://learn.sessionboard.com/sessions/agenda)). **No track view.** "Tracks assigned to sessions determine their color in day, week, and room views." Conflict detection *does* exist and is good: it flags "overlapping sessions and double-booked participants (speakers, chairpersons, moderators)" via a dedicated **Conflicts tab** and red-dot indicators. So on R5: conflict detection = table stakes, **track swimlane = the differentiator**, and it is genuinely absent from all three majors.

**4. R6 — the real-time outstanding-tasks dashboard — is the single cleanest differentiator in the entire brief.**
Sessionboard, the clone target, has no such dashboard. Verbatim from its own help centre: tracking is done by going to the Contacts/Speakers module and "add task reporting fields to your view by selecting 'Columns'", then "create filters to quickly find contacts, groups, or sessions based on task completion status" ([tracking task completion](https://learn.sessionboard.com/faq/how-to-track-task-completion-in-the-event-portal)). The nearest thing to real-time is a **"Weekly portal summary — Weekly digest of portal tasks, sent Mondays at 7 AM UTC"** ([automated emails](https://learn.sessionboard.com/communications/automated-emails)). Sessionize has no task system at all. pretalx has no task system in core. **Nobody ships a one-glance "who is behind" dashboard.** The brief asks for it by name.

**5. Calendar invites (R3) are a genuine market hole.** Sessionboard: 26 automated email triggers, zero calendar/ICS. pretalx: iCal attachments only on schedule *release* notification ([scheduling](https://docs.pretalx.org/user/schedule/)). Sessionize: "calendar placeholders," undocumented. Oxford Abstracts, Sched, EasyChair: nothing found. Confirmed as a **high-visibility, low-cost win** exactly as the dossier predicted.

**6. pretalx is the threat, and it is stronger than the dossier assumes — but it misses five R-numbers structurally.**
It is Apache-2.0, mature (8,224 commits, 100% test-coverage CI gate), and ships a genuinely excellent review model and the best schedule-warning taxonomy in the field. A competent competitor forking it can be on a deployed URL in hours. What it *cannot* be made to do in a weekend: the abstracts-vs-sessions split (R9), conditional form logic (R1), a speaker task system with an organizer dashboard (R6/R17), calendar invites (R3), and a track swimlane (R5). See [§6 Threat read](#6-threat-read).

---

## 1. Feature matrix

**Legend:** ● ships it well · ◐ ships it, poorly or partially · ○ lacks it · — out of scope for that product

Columns: **SZ** = Sessionize · **SB** = Sessionboard (Program module) · **PX** = pretalx · **Other** = best notable third party · **MQ** = Marquee target

### 1.1 R1 — CFP submission forms

| Capability | R# | SZ | SB | PX | Other | MQ |
|---|---|---|---|---|---|---|
| Public CFP form, custom fields | R1 | ● | ● | ● | Oxford Abstracts ● | ● |
| Visual form builder (drag/reorder, sections, dividers, rich text) | R13 | ◐ | ● | ◐ | — | ● |
| Conditional logic (show field on prior answer) | R1 | ● | ◐ | ○ | — | ● |
| Category-based routing (category → committee/plan) | R1, R47 | ◐ | ● | ◐ | HotCRP ● | ● |
| Form targets abstracts *or* sessions, chosen at build time | R9, R13 | ○ | ● | ○ | — | ● |
| Welcome screen w/ custom messaging | R29 | ◐ | ● | ● | — | ● |
| Min/max speakers per submission (sane defaults) | R15, R30 | ◐ | ● | ◐ | — | ● |
| Per-role min/max (speaker / moderator / chair) | R30 | ○ | ● | ○ | — | ◐ |
| Sponsor limits per submission | R30 | ○ | ● | ○ | — | ◐ |
| Enforced field validation | R14, R32, R41 | ● | ◐ | ● | — | ● |
| Submission close date | R34 | ● | ● | ● | — | ● |
| Per-track / per-type deadlines | R43 | ○ | ○ | ● | — | ◐ |
| Reminder email before close | R35 | ○ | ● | ● | — | ● |
| Submission limit per submitter | R36, R48 | ● | ● | ○ | — | ● |
| Saved drafts / multiple submissions | R37 | ● | ● | ● | — | ● |
| Thank-you / confirmation email | R38 | ● | ● | ● | — | ● |
| Form admins / notification recipients | R40 | ◐ | ● | ◐ | — | ● |
| Works logged-out (public link) | R19 | ◐ | ● | ◐ | PaperCall ● | ● |
| Optional form password / access code | R42 | ◐ | ◐ | ● | — | ● |
| Multi-language | R39 | ● | ● | ● | — | — SKIP |
| Payment on submission | R33 | ○ | ● | ○ | Oxford Abstracts ● | — SKIP |
| Admin manual entry of submissions | R12 | ● | ● | ● | — | ● |

### 1.2 R2 — Self-service speaker portal

| Capability | R# | SZ | SB | PX | Other | MQ |
|---|---|---|---|---|---|---|
| Speaker sees their own submissions | R2 | ● | ● | ● | — | ● |
| Speaker sees acceptance status | R16 | ● | ● | ● | — | ● |
| Speaker edits own biography | R18 | ● | ● | ● | — | ● |
| Speaker edits session after submit (org-controlled) | R2 | ● | ● | ● | — | ● |
| Headshot upload (with size/type limits) | R2 | ● | ● | ● | — | ● |
| Slides / supporting document upload | R2 | ◐ | ● | ● | — | ● |
| Speaker confirms/declines participation | R16 | ● | ● | ● | — | ● |
| Post-acceptance task list for speaker | R17 | ○ | ● | ○ | — | ● |
| Task types: action / file request / form | R17, R49 | ○ | ● | ○ | — | ● |
| Task due dates + required flag | R17 | ○ | ● | ○ | — | ● |
| Resource/wiki pages in portal | brief #8 | ○ | ● | ◐ | — | ● |
| Branded portal (logo, accent, welcome) | R2 | ○ | ● | ◐ | — | ◐ |

### 1.3 R3 — Automated, templated speaker communications

| Capability | R# | SZ | SB | PX | Other | MQ |
|---|---|---|---|---|---|---|
| Templated emails with merge variables | R3 | ● | ● | ● | — | ● |
| Trigger-based automated emails | R3 | ○ | ● | ● | — | ● |
| Draft/outbox review before send | R3 | ◐ | ◐ | ● | — | ● |
| Bulk / group mailing with filters | R3 | ● | ● | ● | — | ● |
| Accept / decline emails with individual feedback | R3 | ● | ◐ | ● | — | ● |
| Email send log / history | R3 | ● | ● | ● | — | ● |
| **Calendar invite to speaker's own calendar (ICS/Google/Outlook)** | **R3** | **◐** | **○** | **◐** | **—** | **●** |
| Custom sending domain | §5 | ◐ | ● (paid add-on) | ◐ | — | ● |
| SMS | — | ○ | ● | ○ | — | — SKIP |

### 1.4 R4 — Evaluation and scoring workflows

| Capability | R# | SZ | SB | PX | Other | MQ |
|---|---|---|---|---|---|---|
| Evaluation plans created admin-side | R20 | ● | ● | ● | — | ● |
| Multiple scoring modes | R4 | ● | ● | ◐ | — | ◐ |
| Weighted rubric / multi-criteria | R4 | ◐ | ● | ● | — | ● |
| **Multiple rounds** | **R4** | ○ | ● | ● | — | ● |
| Funnel (promote) vs parallel rounds | R4 | ○ | ● | ◐ | — | ◐ |
| Assign to **committees/teams**, not just individuals | R21 | ○ | ● | ● | HotCRP ● | ● |
| Assign individual reviewers (manual + bulk) | R21 | ● | ● | ● | HotCRP ● | ● |
| Automatic/optimal reviewer assignment | R21 | ◐ | ○ | ○ | HotCRP ● | ○ |
| Evaluator queue UI ("save & next") | R22 | ● | ● | ● | — | ● |
| Blind / anonymized review | R50 | ● | ● | ● | OpenReview ● | ● |
| Field-level hiding from evaluators | R50 | ● | ● | ● | — | ● |
| Conflict-of-interest / abstain | R50 | ◐ | ● | ◐ | HotCRP ● | ◐ |
| Aggregate stats, ranking, exports | R4 | ● | ● | ● | — | ● |
| Reviewer progress tracking | R4 | ● | ● | ● | — | ● |
| AI-assisted review | R4, R27 | ○ | ● | ◐ (plugin) | — | ◐ toggle |
| Bulk accept/decline; pending states for batch notify | R43 | ● | ● | ● | — | ● |

### 1.5 R5 — Schedule / agenda building

| Capability | R# | SZ | SB | PX | Other | MQ |
|---|---|---|---|---|---|---|
| Drag-and-drop schedule builder | R5 | ● | ● | ● | Sched ● | ● |
| Accepted sessions flow in without re-entry | R23 | ● | ● | ● | — | ● |
| Room-overlap conflict detection | R5 | ● | ● | ● | — | ● |
| Speaker double-booking detection | R5 | ◐ | ● | ● | — | ● |
| Speaker availability constraints | R5 | ○ | ○ | ● | — | ◐ |
| Room availability constraints | R5 | ○ | ○ | ● | — | ○ |
| Dedicated conflicts panel/tab | R5 | ○ | ● | ◐ | — | ● |
| **List view** | R5 | ◐ | ● | ● | — | ● |
| **Day view** | R5 | ● | ● | ● | — | ● |
| **Week view** | R5 | ○ | ● | ◐ | — | ● |
| **Track view (swimlanes)** | **R5** | **○** | **○** | **○** | **○** | **●** |
| **Room view** | R5 | ● | ● | ● | — | ● |
| Service / break / plenum blocks | R5 | ● | ● | ● | — | ● |
| Session format → default duration | R44 | ◐ | ● | ● | — | ● |
| Resize by dragging tile edge | R5 | ● | ◐ | ● | — | ● |
| Schedule versioning + release + changelog | — | ○ | ○ | ● | — | ○ |
| AI draft agenda | — | ○ | ● | ○ | — | ○ SKIP |

### 1.6 R6 — Real-time onboarding-task dashboard

| Capability | R# | SZ | SB | PX | Other | MQ |
|---|---|---|---|---|---|---|
| **Real-time dashboard of outstanding speaker tasks** | **R6** | **○** | **○** | **○** | **○** | **●** |
| Per-task completion state on a speaker record | R6 | ○ | ● | ○ | — | ● |
| Filter/segment speakers by task status | R6 | ○ | ● | ○ | — | ● |
| Nudge/remind from the dashboard | R6 | ○ | ◐ (weekly digest) | ○ | — | ● |
| Program dashboard as admin landing surface | R11 | ◐ | ◐ | ◐ | — | ● |

### 1.7 Video-only / product-shape requirements

| Capability | R# | SZ | SB | PX | Other | MQ |
|---|---|---|---|---|---|---|
| **Feels fast** | R7 | ● | ○ *(judged complaint)* | ● | — | ● |
| Program scope only (no CRM/marketing/CMS bloat) | R8 | ● | ○ | ● | — | ● |
| **Abstracts vs Sessions as two entities** | **R9** | **○** | **●** | **○** | **○** | **●** |
| Event settings/details screen | R10 | ● | ● | ● | — | ● |
| Public agenda display | R24 | ● | ● | ● | Sched ● | ● |
| Embeddable agenda w/ copyable code | R24, brief #9 | ● | ● | ● | — | ● |
| Embeddable speaker gallery | brief #9 | ● | ● | ◐ | — | ● |
| iCal / JSON / XML feed | R24 | ● | ● | ● | — | ● |
| Self-serve, no demo gate | R25 | ● | ○ | ● | PaperCall ● | ● |
| Multi-event under one org | R45 | ● | ● | ● | — | ◐ |
| Volume tolerance ~1–3k submissions | R46 | ● | ◐ | ● | EasyChair ● | ● |
| Team roles / granular permissions | — | ● | ● | ● | — | ◐ |
| Airtable persistence | §5 | ○ | ○ | ○ | — | ● bonus |
| Cloudflare deploy | §5 | ○ | ○ | ○ | — | ● bonus |
| Open source | tweet | ○ | ○ | ● | frab ●, Indico ●, OpenReview ●, HotCRP ● | ● |

---

## 2. Per-product profiles

### 2.1 Sessionize — the judges' unconscious baseline

**What it is.** A single-purpose CFP + speaker + schedule tool. Used by AIE for all four of their events today ([sessionize.com/aienyc2026](https://sessionize.com/aienyc2026)). 83,000+ public speaker profiles; 120+ countries. **$499/event professional, free for community events, bulk pricing at 5+/yr** ([pricing](https://sessionize.com/pricing)).

**Scope boundaries, stated by them.** From [platform overview](https://sessionize.com/playbook/overview/platform-overview): not an attendee-management or ticketing service — "We don't handle anything that has to do with your event's audience"; not a live-streaming platform; not a video host; not a webpage builder — "you will have to build one separately."

**CFP and forms.** "From login to functional submission form in a few minutes." Opens/closes automatically. Custom session and speaker fields (text, files, links, consents). **"Conditional logic: questions dynamically change based on previous answers."** Limit submissions per speaker; limit co-speakers per session; secret link for late submitters; optional public list of submitted sessions; submit-as-someone-else agent mode; per-submission email notification. ([features](https://sessionize.com/features))

**Evaluations — the best-designed part of the product.** Three modes: **Stars rating**, **Yes/No**, and **Comparison**. Comparison mode is the standout and has no analogue in Sessionboard or pretalx: "your job is to compare and rank **three sessions at a time**"; ties are encouraged — "You're free to rank two or even all three sessions the same"; a "Strong opinion" dropdown offers "Top session," "Doesn't fit at all," "No opinion (ignore)"; and aggregation is algorithmic — "Ratings come not only from direct comparisons but also from indirect ones across different sessions," which is why "the percentage increase might slow down or in extremely rare situations even go backward" ([comparison guide](https://sessionize.com/playbook/comparison-evaluation-mode-guide)). Unlimited evaluation plans; anonymous mode; fields hideable from evaluators; assigned evaluators manually or in bulk with random distribution ("choose the desired number of evaluators per session, our system will randomly assign the selected number of evaluators") — but **assigned evaluators works only with Stars and Yes/No, not Comparison** ([assigned evaluators](https://sessionize.com/playbook/assigned-evaluators)). **No rounds. No committees/teams** — assignment is individual-only.

**Schedule builder.** Drag-and-drop, session list left / grid right, hamburger to hide the sidebar. Micro-interactions are the best in the field: resize by "grab the bottom edge of its tile and pull it to the desired length"; unschedule by dragging back to the panel; **"The quickest way to switch places between two sessions is to drag them precisely on top of each other"**; and when moving between rooms "the moved session will automatically adjust its duration to align with the duration of a session scheduled in a different room, but in the same time slot." Service sessions (registration, breaks, meals) and **plenum sessions that span all rooms visually**. Multi-day events get separate date tabs. ([schedule builder](https://sessionize.com/playbook/schedule-builder)) Collision detection is claimed on the features page and platform overview but not detailed anywhere.

**Communications.** Group mailing to accepted speakers/session owners: filter by session status/category and speaker category, manual select/deselect, bulk-add from Sessions or Speakers pages, merge variables, "Send test to me," send or "Save only." **No templates, no triggers, no automation** ([group mailing](https://sessionize.com/playbook/group-mailing)). "Unlimited group mailings to accepted speakers." Data collection is done by attaching a form to a mailing: the speaker gets an "Open Form" button and uploads their presentation ([collecting presentations](https://sessionize.com/playbook/collecting-and-sharing-presentations)). Files download as a ZIP from the Export page. **"Send automated calendar placeholders to scheduled speakers"** appears on the features page only.

**Speaker experience.** Speakers keep a persistent cross-event profile. Dashboard shows status as "In Evaluation", "Accepted", or "Declined"; **Banners** tab for social graphics post-acceptance; **Feedback** tab for post-event attendee ratings; **Inbox** for all organizer messages, organized by event; **Active Sessions** reusable across events ([speaker dashboard](https://sessionize.com/playbook/speaker-dashboard), [getting started for speakers](https://sessionize.com/playbook/getting-started-speakers)). **No task list. No file-request task. No due dates. No wiki pages.**

**Roles.** Organizer (unrestricted), Content Owner (everything but event settings/API), Content Manager (sessions/speakers/evaluations only), Content Viewer (read + evaluate), Evaluator (evaluate only), Developer (API/embed page only) ([team roles](https://sessionize.com/playbook/team-roles-explained)). Unlimited members at every level.

**Embeds/API.** Four embed views: "Schedule grid, List of sessions, List of speakers, Speaker wall" ([embedding](https://sessionize.com/playbook/embedding)). One-line script tag: `https://sessionize.com/api/v2/[eventID]/view/[viewtype]`. JSON/XML/plain-text/iCalendar/HTML+CSS outputs, WordPress plugin. **Read-only API.** Custom fields are off by default in API and embed endpoints.

**Where it stops (sharpened, replaces dossier §6.3):**
1. **No speaker task system whatsoever** — no tasks, file requests, due dates, or completion tracking. → R6, R17, R49.
2. **No trigger-based automated comms** — group mailing is manual-composed each time. → R3.
3. **No evaluation rounds and no committee-level assignment** — individual assignment only, no funnel. → R4, R21.
4. **No abstracts-vs-sessions distinction** — one submission entity. → R9.
5. **No track swimlane view.** → R5.
6. **Not self-hostable, not customisable, closed source.** → the tweet's core complaint.
7. Calendar support is a single unexplained sales-page bullet. → R3 still winnable, but do not claim Sessionize has *nothing*.

### 2.2 Sessionboard (Program module) — the clone target

**Vocabulary to adopt.** Sessions 2.0 · Submission form · **Abstract vs Session** · Participant (not just Speaker) · Participant roles: Session Submitter / Speaker / Chairperson / Moderator · Evaluation plan · Round · Scorecard · Rubric · Persona · Portal · Task / File request / Form · Wiki page · Program Site · Agenda · Conflicts · Track / Tag / Level / Format / Language · Program settings · Record settings.

**Submission Setup and the seven-step form builder.** Steps: **Submission Setup → Welcome Screen → Session Information → Participant Information → Payments & Fees → Form Settings → Notifications** ([building your submission form](https://learn.sessionboard.com/applications/building-your-submission-form)). Step 1 chooses the entity — **"Abstract: For content undergoing review before session acceptance"** vs **"Session: For proposals becoming sessions directly."** This is R9, and it is the load-bearing data-model decision. Participant roles get per-role min/max plus an overall total, and **conditional participant limits** can override the defaults based on a session field's value. Max **20 forms per event**; max **15 speakers per session**; Title field locked and required, Description optional ([submission forms](https://learn.sessionboard.com/sessions/submission-forms)).

**Layout affordances worth copying.** Between any two fields a blue **+** inserts a **Section header** (255 char max), a **Form divider**, or a **Rich text box** (images, hyperlinks, formatting). Form ellipsis actions: "Edit, View Submissions, View Draft Submissions, View Form, Duplicate, and Delete." Warning worth designing around: "Editing a field affects all forms that use it, and deleting a form is permanent."

**Conditional logic — and exactly how to beat it.** Called **"question rules."** "Yes, conditional logic (referred to as 'question rules' in Sessionboard) can be used when creating your session submission form or portal form." Its documented limits: only **Checkbox, Dropdown, and Number** fields can trigger a rule; "All form fields must be created and saved before applying question rules"; "Rules are applied to the conditional question itself, not the triggering question"; "**First matching conditional rule wins (no cascading)**"; and rules "remain confined to single steps." ([conditional logic FAQ](https://learn.sessionboard.com/faq/does-sessionboard-offer-conditional-logic), [form builder](https://learn.sessionboard.com/applications/building-your-submission-form)) Any-field triggers with cascading rules is a cheap, visible superiority.

**Field model.** Three families — **Session fields**, **Speaker/Individual fields**, **Group fields** — each landing in a different module (Sessions / Contacts / Sponsors-Exhibitors). Text = 255 chars, Text area = 5,000 chars, both customisable ([field types](https://learn.sessionboard.com/concepts/field-types)). Fields are event-level or global (reusable across events). **Cross-field character limits** are a genuinely thoughtful feature: a named rule caps combined characters across several text fields with a custom error message.

**Form settings.** Timezone-aware close date; submission limit per user; auto-redirect to portal after 10 seconds; customisable success page; **reminder emails automatically at 5 days and 1 day before close**; membership/access restriction; participant validation by HTTP lookup against an external system.

**Evaluations — the strongest module.** Plans live at **Sessions → Evaluation → Evaluation Plans → Add Plan**. Name + instructions; open now with a due date or later; **anonymized review "hides speaker names"**; three evaluator role types (Evaluators, Evaluator Session Managers, Admin Users); rating icons as faces/numbers 1–5 or stars/hearts 1–20; **weighted rubric criteria totalling 100%**; max-evaluations-per-submission cap; filter which submissions enter the plan by standard or custom session fields; choose which session and speaker fields evaluators see; custom evaluation questions. Hard constraints: **"Grading options cannot be edited once the plan is created"** and evaluators can only be assigned while the plan is **closed** ([evaluation plans](https://learn.sessionboard.com/evaluations/evaluation-plans)).

**Rounds — the feature to match.** "Instead of one review pass, you can build a multi-stage process that mirrors how peer review actually works, for example: Initial Screen → Peer Review → Committee Decision." **"Each round has its own timeline, scorecard, anonymization settings, and evaluator pool."** Two advance modes: **Funnel** — "Submissions must be explicitly promoted from one round to the next"; **Parallel** — "Submissions are reviewed across all rounds simultaneously — no promotion required." ([round-based evaluations](https://learn.sessionboard.com/evaluations/setting-up-round-based-evaluations)) This maps directly onto AIE's Wave 1 / Wave 2 / Final structure (R43).

**Evaluator UX.** Emailed invite → list of assigned plans → per-session detail with session and speaker info (unless blind) → "Rate each session based on the criteria that they meet (selections will auto-save)" → optional admin-visible comments → **"Abstain from grading if a submission is a conflict of interest"** → blue **"Save & Next"** → progress meter to 100% ([how to evaluate](https://learn.sessionboard.com/evaluations/evaluators-how-to-evaluate-sessions)).

**Evaluation summary.** Top-level stats (total evaluations, sessions with ≥1 evaluation, active plans, unique evaluators); highest/lowest scoring sessions; average score per plan as a bar graph; top 10 by average; a **"Completion Status Chart"**; and **"Thought-Provoking Sessions" — submissions with "a wide range of evaluator feedback from the highest and the lowest score"** ([evaluation summary](https://learn.sessionboard.com/evaluations/evaluation-summary)). That last widget is a genuinely good idea and cheap to copy.

**AI evaluations.** "AI-generated scoring, summaries, and feedback, using customizable **virtual evaluator personas**" — "a technical expert, a first-time attendee, an executive decision-maker." Blue icon marks AI plans. "There's no limit on plans, personas, or attempts." ([AI evaluations](https://learn.sessionboard.com/evaluations/ai-evaluations)) Given R27, note this and skip it.

**Acceptance.** Five statuses: **Accepted, Accepted queue, Pending, Decline queue, Declined**. Bulk status updates from the Sessions module. Critical craft failure worth exploiting: **"Changing a session status does not automatically email the submitter or speakers"** — admins must "Create and send accept/decline emails" as a separate act ([accept/decline](https://learn.sessionboard.com/sessions/accept-decline)). Participant acceptance is per-role: a **Confirm** button per session in the portal's My Sessions widget, a dialog to accept or decline, colour-coded status "🟨 Pending · 🟩 Accept · 🟧 Decline", customisable "Confirmation Needed" label up to 60 chars, and an optional **Withdraw** ([speaker acceptance](https://learn.sessionboard.com/speakers/speaker-acceptance)).

**Portals — the module Sessionize doesn't have.** "A centralized hub to access event information and complete tasks." Three default portals (Default People / Default Exhibitor / Default Sponsor) plus custom portals filtered by contact role, session type, or sponsor tier. Four assignable content types: **Tasks** (general action item), **File requests** (uploads required), **Forms** (structured responses), and resources — **Files** (static downloads) and **Wiki pages** ("dynamic, editable pages hosted within the portal that allow for real-time updates"). Branding: welcome message, accent colour, logo, background image. Portal sections when acceptance is on: **Invited Sessions / My Submissions / Confirmed Participation**. ([portals 101](https://learn.sessionboard.com/portals/portals-101), [wiki pages](https://learn.sessionboard.com/portals/assign-pages))

**Tasks in detail.** "A general action item within the portal that a user or group must complete by a specified deadline." Task target types: Contacts / Groups / Sessions. Per-assignment config: alias, required toggle, due date with extended-completion option, view-only after completion, and up to three session filters. Completion iconography: **green check = complete · yellow clock = pending file-request approval · orange checklist = manually assigned, incomplete · blue circle = portal-assigned, incomplete · grey plus = unassigned** ([assign tasks](https://learn.sessionboard.com/portals/assign-tasks)). Portal forms cover real cases: "Submit Event Audio/Visual Needs," "Accept/Decline Speaker Invitations," "Agree to Event Terms & Conditions," "Confirm Speaker Details" ([portal forms](https://learn.sessionboard.com/portals/create-assign-forms)).

**Agenda.** Five views (list/day/week/month/rooms), **no track view**; tracks are colour only, and "Track colors don't display in month view." Drag-and-drop "to assign dates, times, or rooms depending on the view"; Rooms view zooms and can put rooms on the x-axis. Conflicts: overlapping sessions + double-booked participants, surfaced in a **Conflicts tab** and as red dots that "refresh upon page reload" — click **Open** to launch the session editor. By default only Accepted submissions appear. ([agenda](https://learn.sessionboard.com/sessions/agenda))

**Program settings.** "criteria, personas, rooms, tracks, tags, levels, formats, languages, files, roles, and statuses." Agenda settings cover day start/end times, snap intervals, session-based vs abstract-based display, which statuses show, room visibility, and **"Program format & default duration — preset durations per session format"** (R44 confirmed). Rooms hold capacity up to 100,000; files up to 1.95 GB with versioning. ([program settings](https://learn.sessionboard.com/sessions/program-settings))

**Event details / record settings.** Event Name, Event Slug (`app.sessionboard.com/acme-conference-2025`), Event Type, Website URL, Location, Timezone, Starts/Ends At, Theme, Logo (300×300), Background (1500×500). Record settings: submission limit across all forms, auto-provision portal access, collect additional contacts, enable primary speakers, **Enable Participant Acceptance**, headshot limitations, logo limitations, and 3–6 char record ID prefixes ([event details](https://learn.sessionboard.com/events/event-details)). This is R10's checklist, verbatim.

**Automated emails — all 26 triggers.** Account/sign-in: reset password, two-factor code, 2FA reset by admin, organization invite, event invite, org portal magic link, Live Transcribe magic link. Sessions: submission confirmation, submission closing reminder (5 days + 1 day), new submission (admin), submission revised (admin), added to a submission, invoice receipt. Intake: intake/application confirmation, new-or-revised intake (admin), follow-up form confirmation. Portal: portal assignment notification, **weekly portal summary (Mondays 07:00 UTC)**, new message/mention. Evaluations: evaluation plan opened, evaluation reminder & weekly summary. Files/exports: report ready, session content export ready, scheduled report delivery, document request comment. AI: virtual evaluations ready. **Zero calendar/ICS anywhere.** ([automated emails](https://learn.sessionboard.com/communications/automated-emails))

**Embeds.** Five types: **Schedule Itinerary, Speaker Gallery, Agenda, Session List, Speaker List**. Outputs: styled HTML (one-line JS), basic HTML, JSON/XML, **iCal ("calendar links showing approved sessions as events")**. Custom colours, custom CSS, field selection, track/status filters. "The feed refreshes automatically — no manual sync or push required," auto-updating every 60 minutes with manual cache refresh ([embeds](https://learn.sessionboard.com/sessions/embeds)). Note the **60-minute staleness** — a live-updating public agenda is a free win.

**Program Site.** "The central hub for your event content: one URL for every program interaction, for submitters, reviewers, and anyone engaging with your event." Aggregates CFP forms, submission forms, awards, interest/pipeline forms and reviewer access; "forms open in their native interface in a new window (nothing is recreated)." Custom slug, landing page, login methods, custom HTML/CSS/JS. ([program site](https://learn.sessionboard.com/site/program-site)) This is their answer to R25 — and note the admission that forms open in a *separate window* rather than being unified.

**Dashboards — the gap.** "Sessionboard doesn't offer traditional dashboards with metrics/widgets" outside the evaluation summary; module views are configurable tables — max 25 columns, filter operators "contains / does not contain / is / is not / is empty / is not empty / starts with / ends with", sort asc/desc, saved views. Documented sore spot: "In the Contacts and Speakers modules, these fields are available to display but not to filter or sort by: [Session] Track, [Session] Language, Sessions." ([dashboard views](https://learn.sessionboard.com/reporting/dashboard-views))

**Where it hurts (from the KB, adding to the video's list).** Grading options frozen after plan creation; evaluators only assignable while the plan is closed; conditional logic restricted to three field types and one step, first-match-only, no cascade; status change does not notify; embeds stale up to 60 minutes; no track view; task tracking is a build-your-own filtered table; 20-form cap.

### 2.3 pretalx — the strongest open-source answer

**What it is.** Apache-2.0, Python 3.12+ / Django / PostgreSQL / Redis, Docker or manual deploy, 930 stars, 8,224 commits, **100% test-coverage CI gate**, "used by many events" ([GitHub](https://github.com/pretalx/pretalx)). Hosted at pretalx.com — free to test, pay only when the event goes public ([features](https://pretalx.com/p/features)). Powers a large share of European FOSS conferences.

**CfP.** Three deadline mechanisms — opening date, global deadline, and **per-session-type deadlines** that override the global one for staggered closures. Built-in fields: Title (mandatory, unremovable), Session type, Abstract, Description, Track, Duration, Content locale, Additional speakers. Speaker profile: Name, Biography, Profile picture, **Availability**. Custom fields come in three scopes — **per-session, per-speaker, and reviewer** — with types "Text (one-line), Multi-line text, Number, URL, Date, Date and time, Yes/No, File upload, Choose one from a list, Choose multiple from a list." Configuration: restrict to specific tracks or session types; required modes (always optional / always required / **required after a specified deadline**); **freeze-after** date; publish answers publicly and/or show to reviewers; social-media icons on URL fields. **Access codes** extend the deadline or gate a track/type, with expiry, max uses, and organiser notes; when a track requires a code, speakers without it "cannot see those options in the submission form." ([CfP](https://docs.pretalx.org/user/cfp/))
**Missing vs R1:** no answer-dependent conditional show/hide. Scoping is by track/type only.

**Reviews — the best-designed model in the field.** **Review phases**: "At any given time, exactly one review phase is active, and its settings control reviewer permissions, visibility, and speaker editing rights." Each phase has dates and toggles for whether reviewers may write reviews, change proposal states, tag proposals, or allow speaker edits. **Score categories**: numeric values with optional labels, required or optional, deactivatable; combined by **weighted sum**; aggregated across reviewers by **median or mean**; **independent categories** — "Sometimes you want to collect a score that informs decisions but shouldn't affect the ranking"; track-specific categories; plus reviewer-target custom fields. **Assignment**: teams with the Reviewer role, optionally track-restricted, plus individual assignment via dashboard or **CSV import** — with the honest caveat "Reviewers are not automatically notified when assigned to proposals." **Anonymisation**: hide speaker names; redact identifying text into an anonymised version reviewers see; proposal visibility "All proposals" vs "Assigned only"; seeing other reviews "Always / After submitting own review / Never"; reviewer names hideable from peers. **Dashboard**: sortable, filterable table at Review → Review. **Writing**: detail view with "Save and next" as the primary workflow, plus a bulk table view. Ships three worked example configurations (small / medium / large). ([reviews](https://docs.pretalx.org/user/review/))

**Sessions.** States: Submitted → Accepted → Confirmed, plus Rejected and Withdrawn, plus **pending states** so a team can batch decisions and notify simultaneously. Organisation: **Tracks** (coloured, gate reviewer permissions, can require access codes), **Session types** (default durations, own deadlines, can require access codes), **Tags** (internal-only), **Featured sessions** at `/{event}/featured/`. Comments (organiser/reviewer, never speaker-visible) are separate from reviews. ([sessions](https://docs.pretalx.org/user/sessions/))

**Scheduling — the best correctness model.** Rooms with reorderable display, optional attendee descriptions and speaker-only technical notes. **Availabilities on both rooms and speakers**: "Availabilities serve as constraints for scheduling: pretalx will warn you when a session is scheduled outside the available times of its room or any of its speakers" — speaker availability is collected at submission via a calendar widget. Drag-and-drop grid, rooms as columns, sessions dragged from a left sidebar, snapping to **5/15/30/60-minute** intervals, condensed mode for many rooms. **Four warning classes**, verbatim: a session outside its room's availability; a session when a speaker is unavailable; "Two sessions in the same room overlap in time"; "A speaker is double-booked." Schedule contents: sessions, **Breaks** (public, speakerless) and **Blockers** (internal-only). Empty rooms are hidden from the public schedule. **Versioned releases** with a WIP schedule, unique version names, a public changelog, RSS, and — critically for R3 — **"Optionally notify speakers via email with iCal attachments."** Embedding via a `<pretalx-schedule>` custom element plus one script tag, multi-event on one page. ([scheduling](https://docs.pretalx.org/user/schedule/))

**Emails.** Draft-first: "Almost every email pretalx generates on your behalf lands here first, as a draft, rather than being sent immediately" — exceptions are submission confirmations and team emails. Eight default templates: acknowledge submission, accepted, rejected, add speaker (new account), add speaker (existing account), custom-fields reminder, draft-proposal reminder, new schedule published. Placeholders like `{proposal_title}`; automatic dedup so a speaker with several matching proposals "receive only one copy"; custom SMTP. Documented weakness: on hosted pretalx "The `From` header on outgoing emails is always set to the system address, which is `noreply@pretalx.com`" ([emails](https://docs.pretalx.org/user/emails/), [FAQ](https://docs.pretalx.org/user/faq/)).

**Speaker-facing.** Speaker profile pages with organiser-provided **information and downloads**, scopeable to specific tracks or proposal types. Submissions carry file/link **resources**. **No task list, no due dates, no completion tracking, no organiser view of who is behind.**

**API.** REST, versioned (v2 = 2026.2.0, v1 = 2025.1.0), pagination/expansion/search/filter/file upload. Historically read-only — "The API provides no write capabilities" — but v2 has begun adding writes: 2026.1.0 added "adding and removing resources (files or links) from submissions via the API" and a feedback endpoint. Stability caveat: "This API is not yet considered stable." ([API](https://docs.pretalx.org/api/), [2026.1.0 changelog](https://docs.pretalx.org/changelog/v2026.1.0/))

**Known limitations, from their own FAQ.** "pretalx does not currently offer a PDF export of the schedule"; poster sessions can't be grouped into one block; Gmail is unsuitable as an SMTP relay; "there is no direct integration between pretix and pretalx yet." ([FAQ](https://docs.pretalx.org/user/faq/))

**Plugin ecosystem (~30, community wiki).** Relevant ones: **pretalx-speaker-checklist — "provides checklists to speakers"** (listed on the wiki; I could not locate a public repo, so treat maturity as unverified), **pretalx-hitlax** (speaker travel and expense management), **samaware** (on-site speaker management), **pretalx-public-voting**, **pretalx-halfnarp** (attendee voting to schedule by popularity), **pretalx-llm** (semantic similar-submission detection), **pretalx-pages** (static pages), **pretalx-salesforce**, **pretalx-webhook-plugin**, **pretalx-slack**, **pretalx-badge**, **pretalx-openmetrics**, **prtx-faq**, **pretalx-social-auth / -oidc-auth**. ([plugin wiki](https://github.com/pretalx/pretalx/wiki/Plugins))

**Why pretalx doesn't already win this competition.** Six structural misses, in descending order of cost-to-fix:
1. **R9 abstracts vs sessions** — pretalx has exactly one submission entity. A sponsor who is "pretty much guaranteed to speak" must be hand-entered as a proposal and force-accepted. This is a data-model change, not a setting.
2. **R6 + R17 speaker tasks and the outstanding-task dashboard** — absent from core. The closest core feature is static "information and downloads" on speaker pages. The checklist plugin is community-listed and unverified, and even if it works it gives speakers a checklist, not organisers a dashboard.
3. **R1 conditional logic** — no answer-dependent field visibility. Track/type scoping is not the same thing, and a judge following the walkthrough will look for it.
4. **R3 calendar invites** — only iCal attachments at schedule-release time. No per-speaker invite on acceptance, no Google/Outlook add-to-calendar links.
5. **R5 track view** — the public and editor grids are room-columned. No swimlanes.
6. **Stack bonus** — Python/Django/Postgres/Redis. No Airtable, no Cloudflare. Zero of §5's bonus points.

Plus two softer ones the judges will feel: the UI is competent-utilitarian rather than 2026-polished, and the vocabulary is FOSS-conference-native ("proposal", "CfP", "devroom" culture) rather than the commercial-events vocabulary the AIE ops person reads in Sessionboard.

### 2.4 Indico (CERN) — brief

Open source, hugely broad: event organisation, archival and collaboration, with abstracts, contributions, timetable, sessions, tracks, surveys, registration, payments, **room booking**, video-conference integration, OAuth, and a plugin architecture ([docs.getindico.io](https://docs.getindico.io/en/stable/)). Built for scientific conferences and institutional events; the abstract-review and timetable modules are real and battle-tested at CERN scale. **Not a threat here**: the surface area is enormous, the UX is institutional, the vocabulary is academic ("contributions"), and nothing in it maps to the speaker-onboarding-task workflow the brief centres. Someone forking Indico in four days would drown.

### 2.5 Survey tier

**Sched.** Attendee-first scheduling and event app: agenda creation and room scheduling, "Empower your speakers to take control of their sessions," an automated speaker submission process ("automates the process — no more Google Forms"), registration and ticketing, check-in, badges and certificates, analytics, PD-hour tracking, lead retrieval, and an AI event planner ([sched.com](https://sched.com/)). *Notable:* the attendee-facing schedule is the reference for polish and mobile behaviour, and the "speakers manage their own session page" model is worth copying. *No real review/evaluation workflow* — submissions are collected, not scored in rounds.

**Oxford Abstracts.** The academic-conference commercial standard. Customisable submission forms, review and scoring with auto-save, decision management, instant abstract-book generation, program builder, poster gallery, session bookmarking, customisable email templates, **scheduled reminder emails to reviewers and submitters**, **bulk reviewer assignment based on categories**, reporting and progress tracking, certificates, ticketing via Stripe/PayPal. **Free / $890 per event / $2,290 per event**; "1,000+ events per year" ([oxfordabstracts.com](https://oxfordabstracts.com/)). *Notable:* category-driven bulk reviewer assignment is the cleanest existing implementation of R1's "category-based routing," and reviewer reminder scheduling is a cheap idea to steal.

**EasyChair.** Six products — Conference Management System, Registration, Publishing, Smart CFP, Smart Slide, Smart Program — claiming "4.8 million users and 124,980 conferences" ([easychair.org](https://easychair.org/)). Its paper-assignment algorithm is the most-praised part. *Notable:* proof that the assignment algorithm is what academic organisers value most. Its UI is famously dated; nobody would hold it up as a design target.

**HotCRP.** Open source, the CS-conference standard for review only. "Customizable review forms" with LaTeX math, "multiple rounds of reviewing," offline reviewing, "review delegation and external reviewer invitation," feedback on review quality, "PC conflict collection" at submission with "flexible conflict management," and — the standout — "assign papers by hand, in bulk, or automatically" with **"globally-optimal automatic review assignments"** driven by "per-paper PC preferences" ([hotcrp.com](https://hotcrp.com/)). *Notable:* the best conflict-of-interest and assignment engine anywhere. No scheduling, no speaker portal, no comms beyond review.

**OpenReview.** Nonprofit, AGPL-3.0, "a configurable platform for peer review that generalizes over many subtle gradations of openness," with reviewer–paper matching at thousands-of-submissions scale, COI management, and post-publication discussion ([openreview.net/about](https://openreview.net/about)). *Notable:* the openness gradient (who can see which artifact when) is a more sophisticated visibility model than anything in the events tier. No scheduling, no speaker management.

**PaperCall.** Free CFP tool for the developer-conference world: customisable event landing pages, automated CFP scheduling, **anonymous submissions to reduce bias**, direct organiser↔speaker messaging, a shared speaker database, and a weekly CFP newsletter ([papercall.io](https://papercall.io/)). Still active. *Notable:* the closest thing to a self-serve, zero-friction CFP — the R25 reference point. It stops dead at acceptance.

**frab.** MIT, Ruby on Rails, the pentabarf successor; collects submissions, manages talks and speakers, builds a schedule. Used by FrOSCon since 2011 and by Chaos Communication Congress. **"Not under heavy development anymore"** ([frab.github.io](http://frab.github.io/frab/), [github.com/frab/frab](https://github.com/frab/frab/wiki/Manual)). *Notable:* its schedule XML/JSON/XCal format became a de-facto standard — pretalx exports "frab compatible" formats. A competitor forking frab is a weaker threat than one forking pretalx.

**Swapcard / Bizzabo / Cvent (program modules only).** Full-stack event platforms whose program modules are the weakest part of their offering — evidenced by Sessionboard *selling integrations into all three* and publishing a comparison table that scores them on website builder, mobile app, badge printing, virtual hosting, registration and networking — **not on CFP, review, or speaker onboarding** ([event platform comparison](https://learn.sessionboard.com/apps/event-platform-comparison), [Bizzabo + Sessionboard](https://www.sessionboard.com/solutions/bizzabo-event-content-management)). These platforms tie speaker workflow to agendas so changes propagate, but they do not run competitive CFPs at 5–15% acceptance. **Not a threat, and useful evidence:** the incumbent's own marketing concedes that the big platforms don't own this workflow.

---

## 3. Classification — table stakes vs differentiator vs skip

### TABLE STAKES — absence reads as broken

Every serious product ships these. Shipping them *badly* is how you lose; shipping them well earns nothing.

| Capability | R# | Why it's table stakes |
|---|---|---|
| Public CFP form with custom fields | R1 | All eight products |
| Enforced required-field validation | R14, R32, R41 | Universal — and swyx caught Sessionboard failing it on camera |
| Submission close date + reminder | R34, R35 | SZ, SB, PX, Oxford |
| Saved drafts / multiple submissions | R37 | SZ, SB, PX |
| Submission limit per submitter | R36, R48 | SZ, SB |
| Confirmation email on submit | R38 | Universal |
| Speaker portal: own submissions, edit bio, upload headshot | R2, R18 | SZ, SB, PX |
| Speaker sees acceptance status | R16 | SZ, SB, PX |
| Speaker confirms/declines | R16 | SB, PX |
| Evaluation plans, scoring, evaluator queue with save-and-next | R20, R22 | SZ, SB, PX, HotCRP, Oxford |
| Blind / anonymised review | R50 | SZ, SB, PX, OpenReview |
| Aggregate scores, ranking, export | R4 | Universal |
| Bulk accept/decline | R43 | SZ, SB, PX |
| Drag-and-drop schedule builder | R5 | SZ, SB, PX, Sched |
| Room-overlap and speaker double-booking detection | R5 | SB, PX (SZ partial) |
| Accepted sessions flow into agenda without re-entry | R23 | SZ, SB, PX |
| List / day / room views | R5 | SZ, SB, PX |
| Public agenda + copy-paste embed code | R24 | SZ, SB, PX |
| Templated emails with merge variables; send log | R3 | SZ, SB, PX |
| Event settings screen | R10 | SZ, SB, PX |
| Team roles / permissions | — | SZ, SB, PX |

### DIFFERENTIATOR — rare, or done badly everywhere

Ranked by (judge visibility × rarity ÷ cost). This is the build list.

| # | Capability | R# | State of the art | Why it wins |
|---|---|---|---|---|
| **D1** | **Real-time outstanding-task dashboard** | **R6** | **Nobody.** SB makes you build a filtered column view; its "real-time" is a Monday 07:00 UTC email | Named explicitly in the brief; the incumbent's answer is embarrassing; one screen the judge will remember |
| **D2** | **Calendar invites to the speaker's own calendar (ICS + Google/Outlook links)** | **R3** | SB: nothing across 26 triggers. PX: iCal only at schedule release. SZ: one undocumented bullet | Named verbatim in the brief; hours of work; instantly demonstrable |
| **D3** | **Track swimlane view** | **R5** | **Nobody.** SB has list/day/week/month/rooms; PX and SZ are room-columned | The brief lists "track" among five views and the incumbent lacks it — a deliberate ask |
| **D4** | **Speed at AIE's real volume** | **R7, R46** | SB is the graded complaint (3× unprompted). PX and SZ are fine but not fast-feeling | The emotional core of the competition. Seed ~1,000 submissions and stay instant |
| **D5** | **Abstracts vs Sessions as first-class entities** | **R9** | Only SB. Absent from SZ, PX, and every open-source option | Stated only in the video; competitors forking pretalx structurally cannot have it |
| **D6** | **Post-acceptance task system: action / file request / form, due dates, required flag** | **R17, R49** | Only SB | Where Sessionize stops and AIE's pain begins — the actual reason they were shopping |
| **D7** | **Conditional logic that beats question rules** | **R1** | SB: three trigger types, one step, first-match-only, no cascading. PX: none | Cheap to beat visibly; the judge who read the brief will test it |
| **D8** | **Status change *is* the notification** | **R3** | SB: "Changing a session status does not automatically email the submitter or speakers" | A craft fix that reads as respect; supports wave acceptances (R43) with one action |
| **D9** | **Category-based routing → evaluation plan / reviewer pool** | **R1, R47** | Oxford does bulk-by-category; PX does track-scoped teams; SB does plan filters. Nobody does a rule engine | Makes R1 more than a form builder; maps onto AIE's vendor-talk policy |
| **D10** | **Multi-round evaluation, funnel mode** | **R4, R43** | Only SB (Funnel/Parallel). PX approximates with phases. SZ: none | Maps 1:1 onto Wave 1 / Wave 2 / Final. Match it or lose to SB on their own turf |
| **D11** | **Live-updating public agenda + embeds** | **R24, brief #9** | SB embeds are cached 60 minutes | "Refresh and it's already there" is a five-second demo |
| **D12** | **Submit without an account, claim by magic link** | **R19, R25** | SZ, SB, and PX all require an account. PaperCall is closest | [INFERRED] Removes the highest-friction step in the whole funnel; judge feels it in the incognito test |
| **D13** | **Self-serve seeded demo, zero briefing** | **R25** | SB is demo-gated — swyx called it out | The dossier's §3 is emphatic. This is a landing-page decision, not a feature |
| **D14** | **Airtable mirror + Cloudflare deploy** | §5 | Nobody in the field | Pure bonus points and an adoptability signal |
| **D15** | **Open source and self-hosted** | tweet | PX, Indico, frab, HotCRP, OpenReview — but none of them do D1/D2/D5/D6 | The whole premise; only earns points combined with the above |

Two smaller ones worth stealing outright: SB's **"Thought-Provoking Sessions"** widget (widest score spread) and **cross-field character limits**; SZ's **Comparison evaluation mode** (rank three at a time) as the fastest way to triage 1,000 submissions, and its **drag-one-tile-onto-another to swap** interaction.

### SKIP

| Capability | Why |
|---|---|
| Payment / paid submissions (R33) | Waved off on camera. SB has 100+ gateways; irrelevant here |
| Multi-language (R39) | "We only care about English" |
| CRM / Marketing / CMS (R8) | ~75% of Sessionboard's surface. Explicitly out |
| SMS | SB ships it; nobody asked |
| AI agenda builder | SB ships it; R27 kills it |
| AI evaluation personas | SB's showpiece; R27 explicitly de-prioritises. Ship a small toggle at most (R4 says "optional") |
| Awards module, sponsor/exhibitor intake, print agendas, live transcribe, clips/recaps | Adjacent SB modules, all out of scope |
| Attendee ticketing / registration | Sessionize says it plainly: "We don't handle anything that has to do with your event's audience" |
| Attendee mobile app | SZ and Sched both ship one; not in the brief; enormous |
| Schedule versioning + release changelog | PX's best hygiene feature; invisible to a judge on a fresh demo |
| Room/speaker availability constraints | PX-only, genuinely good, but a modelling burden with no demo payoff in four days |
| Automatic optimal reviewer assignment | HotCRP's crown jewel; academic-scale problem AIE doesn't have |
| PDF/print schedule export | PX explicitly doesn't; nobody asked |
| Accelevents integration (brief #7) | Descoped; note the webhook seam in the README |

---

## 4. Best-in-class notes — feeds prototype design

### 4.1 Schedule builder → copy Sessionize's hands, pretalx's brain, and add the swimlane

**Sessionize has the best hands.** Two-pane layout, session list left / grid right, hamburger to collapse the sidebar for many-room events. Resize by grabbing the bottom edge of a tile. Unschedule by dragging back to the panel. **Swap two sessions by dragging one precisely on top of the other.** When you move a session to a different room in the same time slot it auto-adjusts its duration to match what's there. Plenum sessions render across all room columns. Multi-day events get date tabs. ([schedule builder](https://sessionize.com/playbook/schedule-builder))

**pretalx has the best brain.** Four named warning classes — room-availability violation, speaker-availability violation, same-room overlap, speaker double-booking — surfaced both on the grid and in the session editor overlay. Configurable snap interval via a **60m/30m/15m/5m dropdown**. Condensed mode for many rooms. Breaks (public) and Blockers (internal) as distinct non-session block types. ([scheduling](https://docs.pretalx.org/user/schedule/))

**Sessionboard has the best view menu and the best conflicts panel** — five views plus a dedicated **Conflicts tab** with red-dot indicators and a click-through **Open** into the session editor ([agenda](https://learn.sessionboard.com/sessions/agenda)). Its weakness is that conflicts "refresh upon page reload."

**Marquee's target.** Sessionize's micro-interactions + pretalx's four warning classes (drop the availability model; keep overlap and double-booking) + Sessionboard's conflicts panel, made **live** rather than reload-gated + **the track swimlane nobody ships**. Ship list / day / week / **track** / room, exactly the brief's five. Snap interval dropdown. Format-driven default durations (R44) so a Lightning Talk drops as a 10-minute block.

### 4.2 Form builder → Sessionboard is the reference; beat its three documented ceilings

**Copy:** the seven-step wizard with a live preview; the blue **+** between fields inserting section headers / dividers / rich-text blocks; per-role min/max participants with an overall total; conditional participant limits driven by a session field; cross-field character limits with a named rule and custom error message; event-level vs global reusable fields; the "editing a field affects all forms that use it" warning; form-level ellipsis actions (Edit / View Submissions / View Drafts / View Form / Duplicate / Delete); and the **Abstract vs Session** choice at step 1 (R13's "you want abstracts or you want sessions, you can choose down here"). ([building your submission form](https://learn.sessionboard.com/applications/building-your-submission-form))

**Beat:** (a) let *any* field type trigger a rule, not just Checkbox/Dropdown/Number; (b) allow **cascading** rules instead of first-match-wins; (c) allow rules to cross steps instead of being confined to one. All three are documented Sessionboard limits, all three are cheap, and together they turn "we have conditional logic too" into "ours actually works."

**Borrow from pretalx:** required-after-a-deadline and freeze-after-a-date as per-field modes; per-field "show to reviewers" and "publish publicly" toggles; access codes that gate a track or extend a deadline. ([CfP](https://docs.pretalx.org/user/cfp/))

**Validation is graded** (R14). Enforce on the client *and* server, show the error next to the field, never let a submit button lie.

### 4.3 Review flow → pretalx's structure, Sessionboard's rounds, Sessionize's triage mode

**pretalx has the best structure.** Review phases as the single switch controlling what reviewers can do right now; weighted score categories with median-or-mean aggregation; **independent categories** that inform without affecting rank; track-scoped reviewer teams; the visibility matrix (all vs assigned-only, see-others'-reviews always/after-own/never, hide reviewer names); and three published example configurations so an organiser doesn't have to invent one. ([reviews](https://docs.pretalx.org/user/review/))

**Sessionboard has the best round shape for AIE.** Funnel vs Parallel, each round with "its own timeline, scorecard, anonymization settings, and evaluator pool." Initial Screen → Peer Review → Committee Decision maps onto Wave 1 / Wave 2 / Final without translation. ([rounds](https://learn.sessionboard.com/evaluations/setting-up-round-based-evaluations))

**Sessionize has the best triage UX.** Comparison mode — three at a time, ties allowed and encouraged, a "Strong opinion" escape hatch, algorithmic aggregation from direct *and* indirect comparisons. At 1,000–3,000 submissions (R46) this is dramatically faster than scoring each one. It is also the single most interesting UX idea in the whole landscape, and it is *not* in the clone target.

**Evaluator screen:** everyone converges on one-proposal-per-screen with a primary **"Save & Next"**, auto-save on selection, a progress meter, and an abstain/conflict path. Copy that literally — swyx will click through it (R22).

**Admin screen:** copy Sessionboard's evaluation summary — total evaluations, sessions with ≥1 review, active plans, unique evaluators, highest/lowest, top 10, completion chart, and **"Thought-Provoking Sessions"** (widest score spread). ([evaluation summary](https://learn.sessionboard.com/evaluations/evaluation-summary))

**Fix the craft bug:** in Sessionboard, "Changing a session status does not automatically email the submitter or speakers." Make accept/decline a single action that queues the mail into a reviewable outbox (pretalx's draft-first pattern) and sends on confirm.

### 4.4 Speaker portal → Sessionboard is the only real one; make it fast and add the calendar

Sessionboard is the reference and there is no second place. Copy:

- **Portal sections** driven by acceptance state: **Invited Sessions / My Submissions / Confirmed Participation** ([portals 101](https://learn.sessionboard.com/portals/portals-101)).
- **Three task kinds** — Task (action item), File request (upload), Form (structured response) — each with due date, required toggle, alias, and view-only-after-completion ([assign tasks](https://learn.sessionboard.com/portals/assign-tasks)).
- **Real task content**, straight from their examples: A/V needs, accept/decline invitation, agree to terms, confirm speaker details (name, title, company, headshot, bio) ([portal forms](https://learn.sessionboard.com/portals/create-assign-forms)). Add AIE's own: **travel and accommodation intake** (R49) — flights, 2–3 hotel nights — and slide upload.
- **Wiki pages** — "dynamic, editable pages hosted within the portal" — one "Speaker Handbook" page fills the portal convincingly (brief #8, cheap).
- **Per-role confirmation** with the 🟨/🟩/🟧 status vocabulary and a rewordable "Confirmation Needed" label.
- **Status iconography** for task state, which is what makes D1's dashboard legible at a glance.

Add what nobody has: **an "Add to calendar" button and an ICS attachment the moment a session is scheduled** (D2), and a **completion meter** at the top of the portal so the speaker sees "3 of 5 done" — the mirror image of the organiser's D1 dashboard.

Borrow from Sessionize: the **Banners** tab (auto-generated social graphic for an accepted session) is a delightful, hour-scale touch that makes the portal feel finished.

---

## 5. Vocabulary crib

For prototype copy. Sessionboard's terms are what the judges saw on camera; pretalx's are what a forking competitor will accidentally ship.

| Concept | Sessionboard (judges' words) | Sessionize | pretalx | Marquee should say |
|---|---|---|---|---|
| A thing submitted for review | **Abstract** | Session | Proposal | **Abstract** |
| A thing guaranteed to run | **Session** | Session | Session | **Session** |
| Person presenting | **Speaker** / Participant | Speaker | Speaker | **Speaker** |
| Person who submitted | **Session Submitter** | Speaker | Submitter | **Submitter** |
| Review configuration | **Evaluation plan** | Evaluation plan | Review phase + score categories | **Evaluation plan** |
| Review stage | **Round** | — | Phase | **Round** |
| Scoring form | **Scorecard / Rubric** | Evaluation mode | Score categories | **Scorecard** |
| Reviewer group | **Conference committee** | (individuals only) | Reviewer team | **Committee** |
| Speaker's logged-in area | **Portal** | Speaker dashboard | Speaker profile | **Portal** |
| Post-acceptance to-do | **Task / File request / Form** | — | — | **Task** |
| Reference page in portal | **Wiki page** | — | Information | **Handbook page** |
| Schedule | **Agenda** | Schedule | Schedule | **Agenda** |
| Non-session block | (service) | **Service session** | **Break / Blocker** | **Break** |
| Public front door | **Program Site** | Call for Speakers page | CfP page | **Event site** |

---

## 6. Threat read

### 6.1 What the strongest competitor submits

**The pretalx fork.** Someone clones pretalx, reskins it, seeds an AIE NYC 2026 event, deploys, and writes a README saying "Apache-2.0, self-hostable, already runs hundreds of real conferences." They arrive with, working and battle-tested: a real CfP with 10 custom field types and per-track deadlines; review phases with weighted rubrics and anonymisation; a drag-and-drop schedule editor with four warning classes; eight email templates behind a draft-first outbox; a widget embed; iCal export. That is a *lot* of R-numbers covered on day zero, and it will look more finished than anything built from scratch in four days.

**Why it loses, and this is the whole strategic read:** the brief's most distinctive asks are precisely the things pretalx does not have and cannot grow in a weekend.
- **R9** — no abstracts/sessions split. A judge who watched the video will look for the sponsor path and not find it.
- **R6** — no outstanding-task dashboard. The brief's sixth bullet, unanswerable.
- **R17** — no speaker tasks. The portal is a profile page.
- **R3** — no calendar invites on acceptance.
- **R1** — no conditional logic.
- **R5** — no track view.
- **§5** — zero stack bonus.
- **R7** — Django server-rendered; fine, but nobody will call it *fast*, and the judged complaint is about feel.

A fork also carries a rhetorical cost: the judges asked people to **build** a replacement, and the tweet says "you do your best to clone this SaaS in a weekend." A submission that is 95% someone else's upstream will read as sidestepping the exercise even when it scores well on features — and the write-up prize is a story about killing SaaS, not about `git clone`.

**Second-order threats.** frab (weaker, unmaintained), Indico (too big to reshape), and — the more likely real competition — **40+ teams building from scratch on Next.js/Supabase or Cloudflare**. Against those, pretalx-derived polish isn't the risk; the risk is another from-scratch team that also read the video carefully.

### 6.2 What beats it

1. **Cover the five R-numbers pretalx structurally cannot** — R9, R6, R17, R3, R5. These are the fork-proof moat, and each is hours not days.
2. **Complete the walkthrough loop with zero dead ends.** Per dossier §3, a judge who hits a stub stops evaluating. Depth in one module cannot buy back a broken link in the chain.
3. **Be visibly fast at ~1,000 seeded submissions** on AIE NYC 2026's real data. R7 is graded whether or not anyone writes it down, and it is the one axis where a from-scratch modern stack beats a mature Django app on feel.
4. **Speak the judges' vocabulary** (§5 crib). "Abstract", "Evaluation plan", "Portal", "Task" — a fork will say "Proposal", "Review phase", "CfP".
5. **Land the stack bonus** (Airtable mirror + Cloudflare). No incumbent and no fork has it; it is the adoptability signal §5 identifies as the real reason it's on the list.
6. **Self-serve in ten seconds.** Landing page hands the judge an organizer login and a speaker login. R25 is a resentment, not a preference.

---

## 7. Open questions this pass raised

**L1 — Does Sessionize's "automated calendar placeholders" already solve R3 for AIE?**
If AIE already gets calendar placeholders from Sessionize today, D2 is a smaller differentiator than the dossier assumes — it beats *Sessionboard*, not their current tool. No playbook article documents the feature. *Default:* build ICS + Google/Outlook links anyway (hours of work, R3 is named verbatim in the brief), but do not headline it as "nobody has this" — headline it as "the tool you're being asked to pay $9,999 for has 26 automated emails and not one of them puts anything on your calendar."

**L2 — Does the judging team use Sessionize's Comparison mode today?**
If so, a scoring-only review UI will feel like a downgrade at 1,000+ submissions. *Default:* ship stars + a rubric, and if time allows add a three-at-a-time triage mode as round 1 of the funnel. Worth a Discord question.

**L3 — Is a track swimlane what the brief means by "track" view, or does it mean "filter by track"?**
Sessionboard's tracks are a colour overlay; the brief lists track as a peer of day/week/room, which reads as a layout. *Default:* build the swimlane (tracks as columns/rows, sessions in lanes) and *also* provide track filtering on every other view. Both are cheap; the swimlane is the visible win.

**L4 — Does the brief's "category-based routing" mean routing to *forms* or routing to *reviewers*?**
Oxford Abstracts routes reviewers by category; Sessionboard routes submissions into plans by field filters; pretalx scopes reviewer teams by track. *Default:* submission category/track → evaluation plan + reviewer pool, which covers AIE's vendor-talk policy (R47). Aligns with dossier Q5's default.

---

## 8. Source inventory

**Sessionize** — [home](https://sessionize.com/) · [features](https://sessionize.com/features) · [pricing](https://sessionize.com/pricing) · [developers](https://sessionize.com/developers) · [playbook index](https://sessionize.com/playbook/) · [platform overview](https://sessionize.com/playbook/overview/platform-overview) · [schedule builder](https://sessionize.com/playbook/schedule-builder) · [team roles](https://sessionize.com/playbook/team-roles-explained) · [group mailing](https://sessionize.com/playbook/group-mailing) · [collecting presentations](https://sessionize.com/playbook/collecting-and-sharing-presentations) · [speaker dashboard](https://sessionize.com/playbook/speaker-dashboard) · [getting started for speakers](https://sessionize.com/playbook/getting-started-speakers) · [evaluations index](https://sessionize.com/playbook/evaluations) · [comparison mode guide](https://sessionize.com/playbook/comparison-evaluation-mode-guide) · [assigned evaluators](https://sessionize.com/playbook/assigned-evaluators) · [embedding](https://sessionize.com/playbook/embedding) · [AIE NYC 2026 CFP](https://sessionize.com/aienyc2026)

**Sessionboard KB** — [submission forms](https://learn.sessionboard.com/sessions/submission-forms) · [building your submission form](https://learn.sessionboard.com/applications/building-your-submission-form) · [conditional logic](https://learn.sessionboard.com/faq/does-sessionboard-offer-conditional-logic) · [field types](https://learn.sessionboard.com/concepts/field-types) · [participant roles](https://learn.sessionboard.com/concepts/participant-roles) · [evaluation plans](https://learn.sessionboard.com/evaluations/evaluation-plans) · [round-based evaluations](https://learn.sessionboard.com/evaluations/setting-up-round-based-evaluations) · [evaluator guide](https://learn.sessionboard.com/evaluations/evaluators-how-to-evaluate-sessions) · [evaluation summary](https://learn.sessionboard.com/evaluations/evaluation-summary) · [AI evaluations](https://learn.sessionboard.com/evaluations/ai-evaluations) · [agenda](https://learn.sessionboard.com/sessions/agenda) · [program settings](https://learn.sessionboard.com/sessions/program-settings) · [accept/decline](https://learn.sessionboard.com/sessions/accept-decline) · [speaker acceptance](https://learn.sessionboard.com/speakers/speaker-acceptance) · [embeds](https://learn.sessionboard.com/sessions/embeds) · [portals 101](https://learn.sessionboard.com/portals/portals-101) · [assign tasks](https://learn.sessionboard.com/portals/assign-tasks) · [portal forms](https://learn.sessionboard.com/portals/create-assign-forms) · [wiki pages](https://learn.sessionboard.com/portals/assign-pages) · [automated emails](https://learn.sessionboard.com/communications/automated-emails) · [dashboard views](https://learn.sessionboard.com/reporting/dashboard-views) · [event details](https://learn.sessionboard.com/events/event-details) · [program site](https://learn.sessionboard.com/site/program-site) · [AI agenda builder](https://learn.sessionboard.com/studio/ai-agenda-builder) · [event platform comparison](https://learn.sessionboard.com/apps/event-platform-comparison) · [task completion tracking](https://learn.sessionboard.com/faq/how-to-track-task-completion-in-the-event-portal)

**pretalx** — [user guide](https://docs.pretalx.org/user/) · [CfP](https://docs.pretalx.org/user/cfp/) · [reviews](https://docs.pretalx.org/user/review/) · [scheduling](https://docs.pretalx.org/user/schedule/) · [sessions](https://docs.pretalx.org/user/sessions/) · [emails](https://docs.pretalx.org/user/emails/) · [FAQ](https://docs.pretalx.org/user/faq/) · [API](https://docs.pretalx.org/api/) · [2026.1.0 changelog](https://docs.pretalx.org/changelog/v2026.1.0/) · [GitHub](https://github.com/pretalx/pretalx) · [plugin wiki](https://github.com/pretalx/pretalx/wiki/Plugins) · [hosted features](https://pretalx.com/p/features) · [DemoCon public schedule](https://pretalx.com/democon/schedule/)

**Survey tier** — [Indico docs](https://docs.getindico.io/en/stable/) · [Sched](https://sched.com/) · [Oxford Abstracts](https://oxfordabstracts.com/) · [EasyChair](https://easychair.org/) · [HotCRP](https://hotcrp.com/) · [OpenReview](https://openreview.net/about) · [PaperCall](https://papercall.io/) · [frab](http://frab.github.io/frab/) · [frab manual](https://github.com/frab/frab/wiki/Manual) · [Sessionboard × Bizzabo](https://www.sessionboard.com/solutions/bizzabo-event-content-management)

**Gaps and caveats.**
- **Sessionize's calendar placeholders** are a single sales-page bullet with no supporting article. Depth unverified. See L1.
- **Sessionize's collision detection** is asserted on the features page and platform overview but absent from the schedule-builder article, which describes only duration auto-alignment. Its strength is unknown; it may be room-overlap only.
- **`pretalx-speaker-checklist`** is listed on the pretalx plugin wiki but I could not locate a public repository. Existence is sourced to the wiki only; maturity unverified.
- **No authenticated access to any product.** Everything here is from public docs, help centres, and marketing. Actual in-app UX may differ from documented behaviour — Sessionboard's own docs promise "full validation" that swyx found absent on camera.
- **No first-hand performance measurements.** R7 claims rest on swyx's three complaints plus architectural inference (Django/server-rendered vs SPA). Nobody benchmarked anything.
- **Sessionboard pricing remains unresolved** (dossier §8). Sessionize's $499 is confirmed and is the number that matters for the reframe in §0.1.
- **Swapcard's own product pages 404'd**; that tier rests on Sessionboard's comparison table and third-party roundups, which are interested sources. The load-bearing inference — that the big platforms don't own this workflow — is supported by Sessionboard selling integrations into all three.

---

*Living document. Re-run against the Saturday and Sunday clarification videos when they land; a requirements change to R1, R5, or R6 changes the differentiator ranking in §3.*
