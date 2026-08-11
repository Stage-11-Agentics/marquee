# Marquee ↔ Sessionboard — feature gap analysis

**Date:** 2026-08-10
**Sources read in full:** `realgenekim/kill-my-saas-reference` (brief, walkthrough transcript, swyx's Discord clarifications, **all 40 annotated screenshots**) · `prototypes/pipeline-v1.1/index.html` at **v1.7** · `SPEC.md`, `SITEMAP.md`, `USER_STORIES.md`, `DESIGN.md` · the 60 Lattice tickets · `sequence/research/landscape-features.md` (Sessionboard KB deep pass).

**What "we have" means here.** The binding artifact is the **v1.7 prototype plus the signed contract**. The build is early — 13 of 60 tickets are `done` (platform, schema, seed, submissions list, auth/demo/reset, email core, API core + OpenAPI, uploads, design system, spikes, venue migration); every feature screen below is `backlog` or `in_progress`. So read List B as *designed and contracted*, not *deployed*. Where something is spec'd but not even demonstrated in the prototype, it says so.

**How List A is ordered.** By (judge visibility × cost of absence) ÷ cost to build — not by module. Tier 1 is on the walkthrough path and cheap. Tier 2 is real capability a program lead would hit in week one. Tier 3 is known and accepted; it's listed so nobody re-litigates it at 2am on Tuesday.

**Capacity reality this lands in.** As of Sunday 2026-08-10: deadline Wednesday 22:00 PT, 16 of 65 tickets done, fleet mid-handover Kimi → Claude. Every adopted item flows through the contract path — prototype first (it is the binding design artifact), then SPEC/AC mint, then ticket. The **Decided scope** section at the end of List A is the adoption gate; nothing outside its "contract now" band gets built without a new ruling.

---

## List A — what Sessionboard has that we do not

### Tier 1 — on the walkthrough path, visible in the brief's own screenshots, cheap

**1. Rich text (WYSIWYG) everywhere it matters.**
Sessionboard puts a full editor — bold/italic/underline, super/subscript, links, ordered and unordered lists, indent, alignment, **image insert** — on at least six screens in the brief: the form welcome message, section Description & Instructions (abstract *and* participant), the success-page message, the portal-form confirmation email, the file-request instructions, and the speaker's own Biography. The abstract `Description` field is typed literally `Wysiwyg · Max 5,000 chars`, and so is `Biography`.
We have `long_text` and markdown (`welcome_md`, `body_md`). No editor anywhere.
**Verdict: build — as a markdown-backed toolbar, not HTML-WYSIWYG.** *(Ruled by Atin, 2026-08-10.)* This is the single most-repeated visual in the screenshot appendix, and a plain textarea where the incumbent has a toolbar reads as "unfinished" in the first ten seconds. But our entire format stack is markdown (`welcome_md`, `body_md`, `feedback_md`, bio), and these fields render into the public form, the portal, *and* outbound email — introducing contenteditable HTML would mean a second storage format plus a sanitizer that has to be right on a public write surface, days before judging. Instead: a toolbar (bold / italic / links / lists) whose buttons insert markdown syntax, with a rendered preview. Same visual signal, zero new format, zero XSS surface. **Image insert: skip.**

**2. A reusable field library, and section elements inside the form.**
Two distinct things, both in the screenshots. (a) Adding a field opens **`Search fields…`** over an existing library (`Client Session ID · text`, `Description · wysiwyg`, `Format · dropdown`, `Language · dropdown`, `Level · dropdown`, `Tags · dropdown`) with `Create Field` as the fallback — fields are event-level or global objects reused across forms, not per-form rows. (b) **`Add Section Element`** inserts a **section header** (255 char), a **form divider**, or a **rich-text block** between any two fields.
Ours: `form_fields` are per-form, eight types, no library, no non-input elements. A long CFP is an undifferentiated wall of inputs.
**Verdict: build the section elements (cheap, purely presentational); model the library as "copy a field from another form on this event" — copy, not reference.** Shared field objects bring update-propagation semantics (edit the field in form A, form B silently changes) that are a trap under deadline; copy semantics give the same builder affordance with none of it.

**3. Tags, Level, and Language as real taxonomy.**
The abstract field list screenshot shows five dropdowns in the baseline form: Format, **Tags**, Track, **Level**, and (in the column chooser and field library) **Language**. Program settings own them alongside rooms, tracks, formats, criteria and personas. Tags appear as chips on every submission row and on the dashboard's recent-submissions table.
Our schema has `tracks`, `formats`, `rooms`, `buildings`, `waves` — and **no tags, no levels, no languages**. The prototype paints Level and Tags chips with nothing behind them.
**Verdict: build Tags and Level; skip Language.** *(Ruled by Atin, 2026-08-10.)* Two tables that look exactly like `tracks`, plus form field types that already exist — and prototype fidelity already demands them, since the chips are painted. Language is cut under R39's ruling ("We only care about English"); a Language taxonomy would be dead UI in the AIE demo.

**4. Auto-redirect to the speaker portal, 10 seconds after submit.**
"After 10 seconds on the confirmation page. If off, submitters use Continue to portal." swyx annotated this exact card **"make sure this works."**
Ours: a confirmation screen, plus an on-screen magic link in demo mode. No countdown, no automatic hand-off.
**Verdict: build.** It is annotated by the customer, it is the seam between walkthrough steps 5 and 6, and it is a `setTimeout` and a line of copy.

**5. Three separate names for a form, and per-section headings.**
`Internal Form Name` (255) · `External Form Title` (255) · `Page Heading` (15 char max) — and every section repeats the pattern with `Section Title` + `Page Heading` + `Description & Instructions`.
Ours: one `forms.name` and one `welcome_md`.
**Verdict: build.** Ops teams run twenty forms; the internal/external split is why they can tell them apart. It's three columns.

**6. Event-level submission limit that a form-level limit overrides.**
The Form Settings screenshot: `Set Submission Limit` off, with a chip reading **`Event max: 3 · Applies when no form-level limit is set`**, and the note that the limit "Includes saved drafts and submitted sessions."
Ours: `forms.per_submitter_limit` only, defaulting to 3. No event-level default, and the drafts-count-toward-the-limit rule is unstated.
**Verdict: build.** One `event_settings` key and one resolution rule. **Drafts question settled: drafts count toward the limit** *(ruled by Atin, 2026-08-10)* — matches the incumbent's stated rule ("Includes saved drafts and submitted sessions") and prevents draft-spam.

**7. Per-role participant min/max, roles beyond Speaker, and conditional participant limits.**
"Choose which roles submitters can add. Optionally set minimum and maximum counts per role, **and overall limits across all roles**." Sessionboard's roles are Session Submitter / Speaker / **Chairperson** / **Moderator**, with per-role min/max plus a total, and limits that can be **overridden conditionally by a session field's value**. This is also where swyx's loudest craft complaint lives — the min-of-2-speakers default that "was stupid" (R15).
`SPEC.md` models `participations.role ∈ speaker|co_speaker|moderator|chairperson|submitter|sponsor_contact`, but the builder exposes only `min_speakers` / `max_speakers` / `max_sponsors`, and the prototype contains **zero** occurrences of "chairperson" or "moderator".
**Verdict: build the per-role min/max editor — but cost it honestly as moderate, not Tier-1-cheap.** The roles already exist in the schema and already gate conflict detection (AC-77) and per-role confirm (AC-153), so the schema half is free — but the editor ripples across three surfaces (builder UI, public-form rendering, validation). Overall-limit-across-roles and conditional limits can wait.

**8. The participant profile fields we don't collect.**
Sessionboard's portal profile: Salutation, First, Last, **Honorific**, **Pronouns**, **Gender**, Mobile Phone, Biography (wysiwyg), and discrete **LinkedIn / X (Twitter) / Facebook / Website** URL fields. The reference README captions this screen "bio, headshot, **pronouns**, and social links the speaker self-manages."
Ours: name, title, company, bio, headshot, `social_links` JSON.
**Verdict: build pronouns at minimum** — it's named in the reference's own caption, it's one column, and a conference product that can't record a speaker's pronouns is conspicuous. For socials, present discrete LinkedIn / X / Website fields in the UI backed by the existing `social_links` JSON — the discrete-field experience with zero migration.

**9. XLSX export and a download-files bundle.**
The Options menu — **red-arrowed by swyx** — is `Import Sessions · Export .CSV · Export .XLSX · Download files bundle…`.
Ours: Sessionize import and CSV export. No XLSX, no ZIP of every uploaded file.
**Verdict: build the files bundle; XLSX: skip** (CSV opens in Excel). The bundle is literally how an ops person gets 150 slide decks and headshots off the platform the week of the show — and swyx pointed an arrow at it. **Feasibility caveat for the ticket:** zipping ~150 decks + headshots out of R2 inside a Worker runs into CPU/memory limits — scope it as a streamed or chunked zip, not an afternoon.

**10. "Copy from…" — clone a form or a task set from another event.**
Present on both the Submission Forms `+ Add` menu and the Tasks `+ Add` menu. A team running four events a year sets up event two by copying event one.
Ours: `POST /forms/:id/duplicate`, within one event.
**Verdict: skip for the competition; post-competition roadmap item.** *(Ruled by Atin, 2026-08-10, reversing the earlier "cheap, build" call.)* The demo ships one event, so "Copy from another event…" would be a menu item with nothing to copy — exactly the dead control #22 condemns. The schema is already event-scoped, so the copy is cheap whenever multi-event UI ships; note it in `ROADMAP.md` as a future feature.

**11. Admin → portal impersonation, one click each way.**
`View Portal` sits in the global top bar on every admin screen; inside the portal, the user menu offers **`Back to Admin Mode`**.
Ours: two separate demo logins from the landing page.
**Verdict: build.** ~40% of the walkthrough video is the speaker's view. A judge who can flip seats without logging out evaluates twice as much of the product in the same minutes.

### Tier 2 — real capability a program lead hits in week one

**12. File requests as first-class objects with an approval state.**
A separate module (`Portals → File Requests`), typed Contacts / Groups / Submissions, with a central list, and — critically — a completion state that includes **"yellow clock = pending file-request approval."** Someone reviews the uploaded file. The drawer states the model plainly: *"Files are stored, not attached. Uploaded files live on this File Request and can be downloaded or exported. They are not attached to the contact, group, or session record."*
Ours: file is one of three task *kinds*; an upload completes the task immediately. There is no approve/reject step.
**Verdict: build the approval state.** A speaker uploading a 40MB screenshot as their "headshot" is the ordinary case, and the organizer needs to bounce it without deleting the task.

**13. A central Files repository.**
`Program → Files` and `Portals → Files` are standalone modules — every uploaded file, listed, searchable, exportable, versioned (Sessionboard's KB documents files up to 1.95 GB with versioning).
Ours: `attachments` rows keyed to an owner. No screen that answers "show me every file anyone has uploaded."
**Verdict: build a thin one.** It's one list over an existing table and it pairs with #9.

**14. Portal forms as their own typed builder, plus Resources / Wiki pages and assignable Files.**
Sessionboard separates the **CFP form builder** from the **portal form builder** (Form Setup → Form Questions → Settings; typed Contacts / Groups / Submissions; its own confirmation email; a lock icon per field). Alongside them, portals carry **Resources** — "dynamic, editable pages hosted within the portal that allow for real-time updates" — and static **Files**.
Ours: task kind `form` reuses the CFP builder, and the Speaker Handbook (AC-233) is static per-event markdown sitting **explicitly below the Tier B cut line**.
**Verdict: keep the shared builder (ours is better factored), but move AC-233 above the cut line.** Brief item 8 was struck, yet the portal looks empty next to a task list without it, and it's hours of work.

**15. Multiple portals, filtered and branded.**
Three defaults (People / Exhibitor / Sponsor) plus custom portals scoped by contact role, session type or sponsor tier — each with its own welcome message, accent colour, logo and background image.
Ours: one speaker portal, inheriting the event accent.
**Verdict: skip the multiplicity; add the branding.** Logo + accent + a welcome line on the portal is nearly free and is what a judge means by "does it feel like ours."

**16. Evaluation controls we don't expose.**
Four distinct misses: (a) **field-level hiding from evaluators** — choose exactly which session and speaker fields a reviewer sees; (b) **plan intake filters** — restrict which submissions enter a plan by standard or custom session field; (c) **custom evaluation questions** beyond the rubric; (d) **max evaluations per submission**.
We have anonymized review (stronger than theirs — stripped in the query layer, byte-scanned) and weighted rubric criteria, but no per-field visibility control and no plan-level intake filter.
**Verdict: build (b) at least.** "This plan reviews only the Agents track, Workshops excluded" is how a committee actually gets scoped, and our `routing_rules` engine is 80% of the machinery already.

**17. Parallel round mode, and rating-scale styles.**
Sessionboard's rounds run **Funnel** (explicit promotion) *or* **Parallel** ("reviewed across all rounds simultaneously — no promotion required"), each round with its own timeline, scorecard, anonymization and evaluator pool. Rating icons configurable as faces/numbers 1–5 or stars/hearts 1–20.
Ours: a two-round funnel, `round_promotions`, scale_min/scale_max.
**Verdict: parallel mode is a `mode` column and a branch in one query — worth it. Rating icons: skip.**

**18. The Evaluation Summary widgets.**
Total evaluations, sessions with ≥1 evaluation, active plans, unique evaluators, highest/lowest-scoring sessions, average score per plan as a bar chart, a **Completion Status Chart**, and **"Thought-Provoking Sessions"** — submissions with the widest spread between their highest and lowest evaluator score.
Ours: metric boxes plus a score-distribution sparkline.
**Verdict: steal "Thought-Provoking Sessions."** One `MAX(score) - MIN(score)` ordering, and it surfaces exactly the submissions a committee needs to argue about. Best idea-per-line in the whole incumbent.

**19. Table machinery: filter operators, per-plan rating columns, and the unified Preferences drawer.**
The column chooser is a **Preferences** drawer with four tabs — **Columns (18/25) · Sort · Filter · Drafts** — split into **Fields** and **Reporting Fields**, offering **39 session fields**, drag-to-reorder on the selected side, and `Reset to Default`. One of the selected columns is **`Ratings: My Evaluation Plan`** — a score column *per evaluation plan*. Filter operators are `contains / does not contain / is / is not / is empty / is not empty / starts with / ends with`.
Ours: saved views over the fixed AC-248 registry with Title mandatory, and equality-shaped list filters.
**Verdict: build the per-plan rating column and 2–3 text operators.** A ratings column you can sort by is how anyone actually picks the top 60 of 1,000. The 25-column cap and Reporting Fields split can go.

**20. Session fields we don't model.**
`Capacity` (attendee cap, shown while scheduling), `CEU Credits`, **`Client Session ID`** (the customer's own external identifier, editable and visible), `Location` (free text), `Language`, and `Starts At` / `Ends At` directly on the record via the Add Abstract drawer.
Ours: `rooms.capacity` exists but not per-session; `external_ref` exists but only as an import-matching key, never shown or edited.
**Verdict: surface `external_ref` as an editable "Client session ID" and add per-session capacity.** Both are one line each and both are how a program team reconciles against the registration platform they still run.

**21. Notification state as visible, re-drivable data.**
The abstracts grid carries a **`Notified`** column, because in Sessionboard "changing a session status does not automatically email the submitter or speakers" — notification is a separate act with its own state.
We deliberately made status change *be* the notification (a genuine win — see List B #4). But we therefore have no column that answers *"did this person actually get told, and when?"* — the answer lives in `outbox` and nowhere on the record's list row.
**Verdict: build the column, keep our cascade.** Best of both: automatic notification *and* a visible receipt. `outbox.sent_at` joined onto the list.

**22. Groups — exhibitors and sponsors as records.**
Event Settings has a toggle card: "Which group types do you want to manage for this event? [Exhibitors] [Sponsors]", with their own portals, tasks, file requests, forms and group fields.
We skip this under R8 — reasonably. But note the inconsistency: our form builder ships **`max_sponsors`** with no sponsor entity behind it, and `participations.role` includes `sponsor_contact`.
**Verdict: skip groups; drop the `max_sponsors` control from the builder UI, keep the schema column.** *(Ruled by Atin, 2026-08-10.)* A field with no writer and no reader is exactly what `SPEC.md` §3 says must not ship; dropping the control is the simplest honest state.

**23. Personas** — audience segments / attendee types as a library object, used for filtering and as AI evaluator personas. **Verdict: skip.** No demonstrable use in our loop.

**24. Event Team and role administration; multi-org switcher.**
`Event Team` is a top-level nav item; the logo menu offers **"View all my organizations."** Sessionize (the tool AIE actually runs on) ships six granular roles.
Ours: five roles in `memberships`, enforced everywhere, with **no UI to administer them** except committee membership. Multi-event is modeled, single-event ships.
**Verdict: nice-to-have, cut-under-pressure.** Judges drive the walkthrough solo, and committee membership UI already covers the part that's on the path. A minimal Event Team screen is cheap because the authorization layer is done — but it earns its slot only if the loop tickets are all green.

**25. A global History module.** Org-wide activity log as a nav item. We have `audit_log` and per-record history. **Verdict: cheap — one filtered list over an existing table.**

**26. Branded outbound mail** *(reframed from Sessionboard's "Email Themes" module)* — the need isn't a Themes settings screen; it's that outbound mail isn't naked. **Verdict: bake one branded wrapper (event logo + accent) into the email layout; skip the Themes UI.** A judge who receives an unstyled email notices; nobody will miss the settings screen.

**27. Integrations surface** (Cvent, Swoogo, Zoom…). **Verdict: skip**, but the README should name the webhook/export seam — the descoped Accelevents item (brief #7) is the same shape, and saying "here is the extension point" costs nothing and reads as maturity.

**28. The agenda's List view carries the full table toolbar** — Saved Views / Columns / Sort / Filter / **Drafts** / Options / Add Session, identical to the submissions grid. Ours: chronological rows. **Verdict: low priority**, but reusing our own submissions-table component here is nearly free and makes the product feel coherent.

### Tier 3 — known, accepted, or deliberately declined. Listed so it stays decided.

**29. The dashboard builder.** Multiple named dashboards (Today · Review Progress · Speaker Tracking · Submissions Pipeline), `Add Dashboard` from a gallery of six prebuilts (Event Overview, Submissions Pipeline, Speaker Tracking, Review Progress, Evaluation Plans by Tracks, Schedule Health), `Add Widget`, per-dashboard Settings, and an **AI prompt** builder. swyx annotated the whole module **"optional but nice to have, best efforts."**
Ours: one fixed Program pipeline dashboard.
**Verdict: do not build the builder.** This is the largest surface-area difference in the product and it is explicitly best-effort; brief item 6 (speaker-task tracking) is the MUST, and we beat them on it outright.

**30. Submission pacing with edition-over-edition comparison.** — *the one Tier-3 item I'd promote.*
Cumulative submissions in the run-up to the event, a **Days-before-event vs Calendar-date** axis toggle, `vs prior (T-65d)`, `This week vs prior +4`, and *"Pick a prior event to compare submission pacing edition-over-edition."*
For a team running four events a year this is the only analytic that drives a real decision: **do we extend the CFP?** Our wave planner shows targets and progress but no curve.
**Verdict: build this one widget** onto the existing dashboard. Not the builder — the chart. **Data dependency the ticket must carry:** the comparison half needs a prior edition's curve, and we seed one event. We hold the real AIE Summit NYC Feb-2025 program (`sequence/research/seed-source-2025.md`), so a plausible prior-edition pacing curve is fabricable as *aggregate reference data* — which doesn't violate the "zero fabricated accepted people" seed ruling.

**31. Month agenda view.** Ruled out in `SPEC.md` §8 as reference-image vocabulary. Sessionboard has it (and its own KB admits "track colors don't display in month view"). **Verdict: stays out.** Our Track swimlane is the trade, and it's the better one.

**32. Invoices / Payments & Fees.** swyx annotated the form step **"NOT NEEDED"** and said on camera "we don't really care about payment." **Verdict: stays out.**

**33. Speaker CRM — year-round cross-event submission collection.** A banner on the forms list: accept submissions year-round, let people pick which events, move them in later. **Verdict: out of scope**, but it's the shape our org-level `people` table already anticipates.

**34. Participant validation by HTTP lookup against an external membership system.** **Verdict: out.**

**35. Weekly portal summary digest** (Mondays 07:00 UTC). This is Sessionboard's *entire* answer to "real-time dashboard of outstanding tasks." **Verdict: out — we replace it with the live board.** Worth a sentence in the README: their real-time is a Monday email.

**36. CRM · Marketing · CMS · Program Site builder (custom HTML/CSS/JS, login methods) · Awards · Studio · AI evaluator personas · SMS.** ~75% of Sessionboard's navigation. R8 and R27 remove all of it. **Verdict: stays out**, and the fact that we *don't* have it is the point — swyx: "we're just going to pay attention to the program side."

### Decided scope — the adoption gate (ruled by Atin, 2026-08-10)

This is the settled answer to "which of List A do we actually build before Wednesday." Nothing outside the **contract now** band gets built without a new ruling; the bands exist so this argument is already over at 2am Tuesday.

**Contract now** — flows prototype → SPEC/AC → ticket immediately:
- The six (below): #1 markdown-toolbar rich text · #3 Tags + Level · #4 auto-redirect · #11 impersonation · #19 per-plan ratings column + text operators · #30 pacing chart.
- The two one-liners: #2b section headers/dividers · #21 `Notified` column.
- The cheap adds: #5 internal/external form name + section headings · #6 event-level submission limit (drafts count) · #8 pronouns + discrete social fields over `social_links` · #20 Client Session ID + per-session capacity · #22 drop the `max_sponsors` control.

**If capacity** — only after the walkthrough-loop tickets (through MRQ-20/21) are green:
- #7 per-role min/max editor · #12 file-request approval state · #13 Files repository · #14 Speaker Handbook above the cut line · #15 portal branding · #16b plan intake filters · #26 branded email wrapper.

**Parked** — a "build" verdict above records that the item is worth building; this band records that it is not worth building *before Wednesday*. Post-competition candidates, no new ruling needed to revive them afterward: #2a field copy · #9 files bundle · #10 copy-from-event (→ `ROADMAP.md`) · #17 parallel rounds · #18 Thought-Provoking Sessions · #24 Event Team · #25 History · #27 (README extension-point sentence only — that part costs nothing and should still land) · #28 agenda list toolbar. All of Tier 3 stays as verdicted.

---

## List B — what we have that Sessionboard does not

**1. A real-time speaker-onboarding chase board.** Brief item 6, named verbatim, and the incumbent's answer is embarrassing: Sessionboard's own KB tells you to go to Contacts, add task-reporting fields via "Columns," and build a filtered view — with a Monday-morning digest email as the closest thing to real-time. Ours is a speaker × task-type matrix sorted by severity, with live counts, filter chips, per-speaker drawer with message history, and compose-and-nudge in place. **Nobody in the field ships this** — not Sessionboard, not Sessionize, not pretalx.

**2. Calendar invites to the speaker's own calendar.** Brief item 3, verbatim ("Gmail, Outlook, iCal"). Sessionboard has **26 automated email triggers and zero calendar anything**. Ours: ICS `METHOD:REQUEST` with `ATTENDEE`, `SEQUENCE` bumped on every material change, `METHOD:CANCEL` + `STATUS:CANCELLED` on reversal, a stable `/i/{uid}.ics`, Google/Outlook deep links, and `LOCATION` + `GEO` carrying room *and* building. swyx ruled ".ics good enough" and "yes room details if we have them" — we have them.

**3. The track swimlane agenda view.** The brief asks for list / day / week / **track** / room. Sessionboard ships list / day / week / **month** / rooms and has no track view at all — tracks are a colour overlay, and their KB notes the colours don't even render in month view. Neither does Sessionize. Neither does pretalx. The brief is asking for the one view the entire market lacks, and ours is a true swimlane with lane totals and a day band.

**4. Status change *is* the notification.** Sessionboard, verbatim from its KB: *"Changing a session status does not automatically email the submitter or speakers."* Ours: accepting cascades to portal status, acceptance email, task-set assignment and calendar-invite offer — with every downstream effect **enumerated in the confirmation modal before you press the button**, including the honest line about records with no valid speaker email.

**5. A decision record that renders once into both the email and the portal.** `submission_decisions` carries approve/maybe/deny plus optional `feedback_md`, written by *both* the one-at-a-time action and the bulk wave accept, and rendered from that single row into the outbox and the speaker's portal. They cannot diverge. This is R51 — the bonus swyx named himself: *"being able to email speaker from inside the app to ask for changes/attach feedback when sending the approve/deny decision."*

**6. An un-accept cascade.** Reversing an acceptance opens a dialog enumerating the portal tasks, scheduled emails and calendar invites it will touch, with cancel/retain per item. Nobody ships reversal. Every product in this market treats acceptance as one-way and leaves the cleanup to the ops person's memory.

**7. Conditional logic that beats "question rules."** Sessionboard's documented limits: only **Checkbox, Dropdown and Number** fields can trigger a rule; all fields must be saved first; rules attach to the *conditional* question, not the trigger; **first matching rule wins, no cascading**; rules confined to a single step. Ours: any field type triggers, conditions are visible in the builder list without opening a field, hidden ⇒ not required *and* not persisted, and one shared evaluator (`isFieldApplicable`) serves the public form, the builder preview, server-side validation, and the draft queue's missing-fields computation. swyx said "conditional fine for now" — beating the incumbent visibly here is cheap.

**8. Category-based routing as a rule engine.** `routing_rules` maps track / format / vendor-affiliation → evaluation plan or committee, applied at submit, with the applied rule **named on the record**. Sessionboard does plan-level submission filters; Oxford Abstracts does bulk-by-category; pretalx does track-scoped teams. Nobody does rules. This is the half of brief item 1 that competitors will read as "a dropdown."

**9. Multi-track submissions and multi-track reviewer scope, enforced by one helper.** swyx: *"talks are submitted to one or more tracks, and reviewers review one or more tracks."* Sessionboard's form Track field is a single-select and its rows carry single chips. Ours: `submission_tracks` with an explicit primary, `reviewer_track_scopes`, and a single intersection predicate that queue reads, submission detail, file reads, exports and evaluation writes all call — with an out-of-scope probe returning 403 and leaking no metadata.

**10. Waves — rolling, mid-CFP acceptance as a modeled object.** AIE's real process is Wave 1 Aug 15 · Wave 2 Sep 1 · Final Sep 15 while the CFP stays open until Sep 12. We model waves with decision dates, targets and progress, stamp them on accepted submissions, and surface "Accepted · Wave 2" in the speaker's portal and a concrete next-wave date **before** any decision (never the bare word "pending"). Sessionboard has Accept Queue / Decline Queue as staging statuses — useful, but not waves.

**11. Speed treated as a designed constraint with numbers.** swyx complains about Sessionboard's slowness **three separate times, unprompted**, and names it as the reason he thinks we can beat them; the brief makes it an explicit written bonus. We carry per-surface p95 budgets enforced by `check:speed` — 1,000-row list first-interactive ≤1s, filter/sort re-render ≤200ms, agenda view switch ≤200ms, review advance ≤300ms over 20 advances — against a ~1,000-submission seed on their real event.

**12. A self-serve, seeded, resettable demo.** Sessionboard is demo-gated; swyx called it out on camera: *"You cannot do a self-guided tour. You have to request a demo, which is part of the enterprise sales tactics I don't really want."* Ours: one-click organizer and speaker entry from the landing page, ~1,000 realistic submissions on the real AIE NYC 2026 shape, deliberate ugly data (diacritics, truncating titles, a 4-person panel, a speaker on three submissions, two live double-bookings on load), and a ≤20s idempotent reset that's safe mid-judging.

**13. Open source, Apache-2.0, self-hostable.** The entire premise of the competition. One Cloudflare Worker + D1 + R2, README-driven self-host proven by an acceptance criterion. Sessionboard quoted AIE **$9,999 for one event** and $42,997 a year.

**14. Agent-native by construction.** A real REST API where the admin SPA is *a client of the same routes* — `check:api` replays a full loop and fails on any request path missing from the public OpenAPI document. Plus a `marquee` CLI, a shipped `SKILL.md`, scoped API tokens, `ETag`/`If-Match` concurrency so an agent and a human can operate simultaneously, one error envelope, `RateLimit-*` headers, and durable `operation_id`s on bulk actions. The brief lists **"Bonus points for API"** explicitly; Sessionboard has API docs but no CLI, no agent surface, and no guarantee that the UI can't do things the API can't.

**15. A genuine two-way Airtable mirror that never touches a request path.** Outbound within 60s via `performUpsert`, inbound via signed webhook against an explicit field allowlist, echo suppression so no record can loop, and a Settings → Airtable page showing both row counts "as of last sync," outbox depth, Sync now, and a webhook-expiry warning *before* it can cause silent data loss. Nobody in this market does this; it's the competition's larger stack bonus, claimed honestly (we say plainly in the README that D1 is the source of truth and we traded the full bonus for the speed win).

**16. A live public agenda and embeds.** Sessionboard's embeds refresh **every 60 minutes**. Ours: 30-second KV TTL with explicit purge on publish, measured to reflect a source change within 60 seconds. "Change it, refresh the embed, it's already there" is a five-second demo against an hour-long cache.

**17. Venue geography as a product primitive.** *(v1.7 — our most distinctive feature, and it is in no brief and no competitor.)* Buildings with coordinates, addresses and entrance instructions; access minutes; a **Transit** conflict class sitting alongside room-overlap and speaker double-booking; a "leave by 10:14" computed from **the speaker's own previous session's building**, not a generic anchor; `LOCATION` + `GEO` on the real calendar invite; a building band grouping the agenda's room columns; and five zooms of disclosure — token, relation, instruction, panel, overview — that fold to nothing on a one-building conference while keeping the entrance instructions, which are useful at any size. No product in this market knows where anything is.

**18. The program board.** A read-only Kanban across the seven lifecycle stages, filters composing across text / type / track / format / wave with a one-click reset, cards that open the exact record, and the three derived columns (Onboarding, Scheduled, Published) stating their entry action. Deliberately undraggable — consequential actions live on the record, with the confirmation cascade. Sessionboard has status tabs.

**19. The pipeline as the home screen.** Seven numbered stages — Submitted → In Review → Waved → Accepted → Onboarding → Scheduled → Published — each a live count that clicks into exactly the work behind it, with an attention strip (next wave / unreviewed by track / speakers overdue) and review pressure by track. Compare swyx getting lost in Sessionboard's admin **twice on camera** looking for the form builder: *"I don't know where this form thing is."* Our whole nav is the lifecycle he narrated.

**20. A cold start.** `?empty=1` on any route enters a fresh-install walk: no conference → create one (from scratch or **by importing a Sessionize export**) → taxonomy → build the CFP → scorecard and committee → publish, as a sticky 5-step checklist. Sessionboard drops you into a configured event; there is no first-run experience to screenshot. This is also what makes the open-source claim real: a stranger cloning the repo has a path.

**21. Honest empty, loading and error states as a tested contract.** AC-161 tests every route on a fresh install; AC-4 crawls for stub screens and zero-child list containers; a failed save says so; the public form's submit failure preserves every entered value. Plus craft rules that are asserted, not aspired to: elements never jump, state is carried by text and never colour alone, figures are tabular.

**22. The Drafts-needing-attention queue.** An immutable, role-gated view of abandoned drafts with live count, last-saved time, submitter contact, and **the missing required fields computed against what's *currently applicable* to that submitter** — through the same condition evaluator, so a draft is never marked incomplete for a field its submitter cannot see. Sessionboard has a Drafts tab showing a number. Ours tells you who to nudge and about what.

**23. Blind review that leaks nothing, anywhere.** Identity is stripped **in the query layer** for reviewer-scoped reads, so API responses and exports are covered by construction rather than by template discipline, and AC-64 byte-scans every reviewer-visible response and export for seeded identity strings. Reviewers also get a scoped CSV export of their own queue, and a reviewer shell with no admin chrome and no reachable admin route — not the admin shell with items hidden.

**24. Per-role confirm/decline.** `participations.confirmation_status` is per `(person, submission, role)` row, so someone who is both a speaker on one session and a moderator on another confirms each independently. Sessionboard confirms per session.

**25. Demo-safe outbox.** Every message is rendered at enqueue and shown in full in the comms log with an honest "not delivered — demo mode" label; the allowlist check lives in the single queue consumer that every send passes through, with exactly two audited call sites permitted to bypass it. A judging-integrity feature more than a product feature — but it's what lets a stranger poke the accept button on 60 seeded speakers without mailing 60 real people.

**Parity, not advantage — worth knowing:** Abstracts vs Sessions as two entities (R9) is the one place Sessionboard is genuinely ahead of the rest of the market, and we match it (`kind` + `bypass_evaluation`). Committees-not-just-individuals, multi-round evaluation, blind review, drag-and-drop scheduling, room-overlap and double-booking detection, bulk accept/decline, and public embeds are table stakes both products clear. **Spec'd but not yet demonstrated in the prototype:** comparison evaluation mode (rank three at a time with ties — Sessionize has it, Sessionboard does not) and the optional AI first-pass scorer, which swyx explicitly de-prioritized (*"I don't care about the AI workflow thing"*) and which is a trap for the other 646 entrants.

---

## If you only act on six things

1. **Markdown-toolbar rich text** on the six screens that show a toolbar in the brief (A#1).
2. **Tags / Level** as taxonomy + form fields — two tables shaped like `tracks`; Language cut under R39 (A#3).
3. **Auto-redirect to the portal after submit** — the card swyx annotated "make sure this works" (A#4).
4. **`View Portal` / `Back to Admin Mode` impersonation** — doubles how much of the product a judge sees per minute (A#11).
5. **A sortable per-plan ratings column** on the submissions grid — how anyone picks 60 out of 1,000 (A#19).
6. **The submission-pacing chart with edition-over-edition comparison** — the one dashboard widget that drives a decision, without building their dashboard builder (A#30).

Plus two one-liners with outsized honesty value: **section headers/dividers in the form builder** (A#2b) and **the `Notified` column** (A#21), which gives us their receipt on top of our automatic cascade.

The full ruled adoption — these six, the two one-liners, the cheap adds, and the if-capacity band — is the **Decided scope** section above.
