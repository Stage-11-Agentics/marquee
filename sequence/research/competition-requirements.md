# Marquee — Competition Requirements Dossier

**Competition:** "Kill My SaaS 1 — $10,000 to kill my SaaS" (swyx / Latent.Space / AI Engineer)
**Target to clone:** [Sessionboard](https://www.sessionboard.com/) — speaker & session management for conference organizers
**Deadline:** Wednesday 2026-08-12, 10:00 PM PT
**Maintainer of this file:** Brief Research agent (Marquee Initiation → Brief Research)

---

## Update log

| When | What landed |
|---|---|
| 2026-08-08 ~16:10 EDT | Brief decoded (incl. embedded `[image1]` → `sources/brief-image1.png`, which is the Sessionboard product mega-menu, **not** a pricing screenshot). |
| 2026-08-08 ~16:11 EDT | Walkthrough video transcript pulled and timestamped → `sources/walkthrough-transcript.txt` (9:55, auto-captions). |
| 2026-08-08 ~16:12 EDT | Origin tweet recovered verbatim via X syndication API (WebFetch is 402-walled). Attached image decoded → `sources/tweet-image.png` = **AIE's internal budget proposal**. Major find. |
| 2026-08-08 ~16:14 EDT | Luma event page: **647 registered**. Sessionboard sitemap (497 URLs) + knowledge base sitemap (226 URLs) harvested → `sources/sessionboard-kb-urls.txt`. |
| 2026-08-08 ~16:16 EDT | AIE's real workflow reconstructed: they run **4 events/yr on Sessionize today**; AIE NYC 2026 CFP is public and live. |
| 2026-08-08 ~16:18 EDT | Sessionboard KB deep-read: forms, evaluations (round-based), agenda/conflicts, automated emails, portal tasks, roles. First full pass complete. |
| 2026-08-08 evening | **Discord batch 1** (Atin paste; Discord Intel agent). swyx answers day-1 threads: **Q1 answered** (mirror permitted, bonus = Airtable as source of truth), **Q5 answered** (conditional fine; routing = tracks↔reviewers, *one or more* on both sides), review-workflow floor set (`unreviewed → approve/maybe/deny`), agenda floor narrowed (day/room + DnD + conflicts "enough"), onboarding task list enumerated, emails/ICS "should work on an MVP basis," Accelevents skip re-confirmed, **another follow-up video promised "today" covering email/calendar depth**. R4/R5 notes amended; **R51–R52 added**; §7 updated; rulings log added below §7. |
| 2026-08-08 night | **Full brief PDF recovered** → `sources/competition-brief-full.pdf` (37 pp, ~40 annotated screenshots — the original text-only capture missed the entire SCREENSHOTS appendix and one rules page). Lead: a competitor's consolidated context doc (archived → `sources/competitor-context-doc-2026-08-08.md`) referenced content we didn't hold. **New explicit brief bonuses: speed/performance, API, Forge hosting (teeny)** → R7 re-sourced, **R53–R54 added**; submission deliverables confirmed (form + repo + deployed site — **no entrant walkthrough video**); swyx's in-screenshot annotations captured (§1.6); Q2 evidence updated; batch-2 rulings-log entry added. |

**Requirements status: STILL MOVING.** Two more videos are promised (Saturday = *today*, Sunday = *tomorrow*), after which requirements FREEZE. Nothing below is frozen yet. See [Timeline](#timeline--logistics).

---

## 0. Executive read

Six things matter more than the rest, and three of them are not in the brief's numbered list:

1. **Speed is a graded feature.** swyx complains about Sessionboard being slow **three separate times**, unprompted, and explicitly names it as the reason he thinks we can beat them. This is the single most-repeated sentiment in the entire source corpus.
2. **"I don't care about the AI workflow thing."** Verbatim, at 09:23. The brief's "optional AI-assisted review" is genuinely optional and possibly a *trap* — competitors will over-invest here.
3. **The Program module only.** CRM, Marketing, and CMS are explicitly out. The brief's mega-menu image makes the full Sessionboard surface look enormous; ~75% of it is irrelevant.
4. **Judged by the AIE team, not swyx**, as prospective customers, by driving a deployed site against the walkthrough.
5. **There is a real, dated deployment target.** AIE NYC 2026 (Oct 12–14) is the pilot the $9,999 quote was written for. The winner's software plausibly runs a real conference in ~9 weeks.
6. **Abstracts vs. Sessions is the core data model**, stated only in the video. Getting this wrong misshapes everything downstream.

---

## 1. Requirements register

Classification: **MUST** (explicit brief item or unambiguous video requirement) · **SHOULD** (stated preference, softer wording) · **BONUS** (explicit bonus, or inferred differentiator) · **SKIP** (explicitly waved off).

Tags: **[BRIEF]** in the written brief · **[VIDEO-ONLY]** stated only in the walkthrough — *high differentiator value, competitors will miss these* · **[INFERRED]** my reconstruction, not stated by the leads.

### 1.1 The spine — the brief's six active features

| # | Requirement | Class | Source |
|---|---|---|---|
| **R1** | **Custom call-for-papers submission forms** with *conditional logic* and *category-based routing*. | MUST | [BRIEF] item 1 |
| **R2** | **Self-service speaker portal** for bios, headshots, slides, and supporting documents. | MUST | [BRIEF] item 2 |
| **R3** | **Automated, templated speaker communications**, including reminders **and calendar invites delivered directly to each speaker's own calendar (Gmail, Outlook, iCal)**. | MUST | [BRIEF] item 3 |
| **R4** | **Submission evaluation and scoring workflows**, including *optional* AI-assisted review, **across multiple rounds**. | MUST (AI part optional) | [BRIEF] item 4 |
| **R5** | **Drag-and-drop schedule and agenda building**, with *automatic conflict detection across rooms and tracks*, viewable by **list, day, week, track, or room**. | MUST | [BRIEF] item 5 |
| **R6** | **Real-time dashboard** showing which speakers still have outstanding onboarding tasks. | MUST | [BRIEF] item 6 |

> Verbatim, R1: *"Custom call-for-papers submission forms with conditional logic and category-based routing"*
> Verbatim, R3: *"Automated, templated speaker communications, including reminders and calendar invites delivered directly to each speaker's own calendar (Gmail, Outlook, iCal)"*
> Verbatim, R5: *"Drag-and-drop schedule and agenda building, with automatic conflict detection across rooms and tracks, viewable by list, day, week, track, or room"*

**Note on R5's view list.** The brief says list / day / week / **track** / room. Sessionboard's own product ships list / day / week / **month** / rooms — it has *no* track view (tracks are a color overlay). The brief asking for a track view is therefore a deliberate ask for something the incumbent lacks. Build the track swimlane view; it is cheap and it is a visible win.

**Note on R4's floor (Discord ruling, 2026-08-08).** swyx: *"minimum workflow is just go from 'unreviewed' -> 'approve/maybe/deny'. bonus is being able to email speaker from inside the app to ask for changes/attach feedback when sending the approve/deny decision."* The brief's scoring/rounds language still stands as stated preference, but the ruled floor is a three-way disposition. Our scorecards/committees/rounds build is a superset — safe. The **"maybe"** state maps to our `waitlist` disposition; consider surfacing the word "maybe" (or "shortlist") somewhere a judge would recognize. The feedback-email bonus is minted as **R51** below.

**Note on R5's floor (Discord ruling, 2026-08-08).** Asked *"is day/room + drag-and-drop + conflict detection enough?"* swyx: *"yes that is enough."* The five-view list (list/day/week/track/room) remains in the brief and stays a differentiator — but it is now confirmed **bonus surface, not floor**. Cut-pressure may take views before anything in the loop.

**Note on R3's calendar invites.** Sessionboard's full automated-email documentation lists ~25 email triggers and **contains no calendar-invite feature at all**. R3 is very likely a documented pain point rather than a clone target — i.e. the brief is asking for something they wanted and could not get. Treat ICS generation + Google/Outlook add-to-calendar links as a **high-visibility, low-cost win**. ([INFERRED] from absence in `learn.sessionboard.com/communications/automated-emails`.)

### 1.2 Product-shape requirements — VIDEO-ONLY

These are stated only in the walkthrough and are the highest-leverage differentiators.

| # | Requirement | Class | Timestamp / quote |
|---|---|---|---|
| **R7** | **Performance is a judged feature.** The product must feel fast. **Now confirmed as an explicit written bonus** — brief p.3: *"Bonus points for speed/performance — we do not want slow SaaS pls."* | MUST + BONUS | [BRIEF p.3] + [03:50] *"part of this I also don't love is that it's kind of slow"*; [03:58] *"this slowness is part of why I think you guys can probably do a better job than Sessionboard"*; [07:16] *"oh my god, this is so slow"* |
| **R8** | **Program side only.** Do not build CRM, Marketing, or CMS. | SKIP (scope) | [02:06] *"we are probably only going to use the program side of these things and we're probably not really using the marketing side, not really using the CRM side… we're just going to pay attention to the program side."* |
| **R9** | **Two distinct submission entities: Abstracts vs Sessions.** *Abstracts* (or videos) are applications to speak; *Sessions* are people effectively guaranteed to speak (e.g. sponsors) and bypass the competitive path. | MUST | [03:21] *"the main lifecycle is that you have submissions… which can either be abstracts or videos which are sort of applications to speak, and sessions which are people who are pretty much guaranteed to speak, let's say because they're a sponsor"* |
| **R10** | **Event settings / event details** configuration screen. | MUST | [02:40] *"you should probably have some settings where you can set up the event details"* |
| **R11** | **Program dashboard** as the admin landing surface. | MUST | [03:17] *"here this is like a little dashboard thing"* |
| **R12** | **Admin manual entry** of submissions, alongside the public form. | SHOULD | [03:53] *"here you can enter in manually or you can also look for the submission functionality"* |
| **R13** | **The form builder is the centerpiece.** A form targets either abstracts or sessions, chosen at build time. | MUST | [04:49] *"you have like a form builder is what you're being asked to build here. This is just a very fancy form builder. That's all it is."*; [04:35] *"you want abstracts or you want sessions, you can choose down here"* |
| **R14** | **Real, enforced field validation** — Sessionboard's is incomplete and he noticed. | MUST | [05:08] *"and looks like it doesn't even have full validation. Very nice."* (sarcastic) |
| **R15** | **Configurable min/max speakers per submission, with sane defaults.** He tripped over a min-of-2-speakers default and called it out. | MUST | [06:46] *"that was stupid. Obviously, I should not have a minimum of two speakers. That's not something that we do."* |
| **R16** | **Speaker sees their acceptance status** in the portal. Called out as key. | MUST | [07:01] *"this is an important part of it — whether or not you have been accepted or not. I think that's a key part"* |
| **R17** | **Post-acceptance task list** for the speaker. | SHOULD (he says "optional" but "very very handy") | [07:12] *"once you've been accepted, what tasks do you have to complete? That also is kind of optional, but it is very very handy"* |
| **R18** | **Speaker edits their own biography.** Explicitly "very important." | MUST | [07:29] *"as well as you being able to update your own biography. This is a very important part of the overall submissions"* |
| **R19** | **Public form link works logged-out** (verified in incognito in the video). | MUST | [06:02] *"I'm going to show you how in incognito we can access this… and you can submit that form"* |
| **R20** | **Evaluation plans** created admin-side / conference-committee side. | MUST | [07:43] *"we can create evaluation plans on the admin side, on the conference committee side"* |
| **R21** | **Assign submissions to evaluation committees (teams), not just individuals.** | MUST | [07:52] *"we can assign sessions to be evaluated by conference committees… this team is evaluating whatever numbers of submissions"* |
| **R22** | **Evaluator review interface** — work through an assigned queue. | MUST | [08:02] *"as an evaluator I can look through all these things"* |
| **R23** | **Accepted sessions flow into the agenda** without re-entry. | MUST | [08:17] *"once things have been evaluated, accepted… then we can add the accepted sessions in here for the agenda"* |
| **R24** | **Public agenda display, and embeddable elsewhere with copyable embed code.** ⚠️ *This contradicts descoped brief item 9.* | SHOULD | [08:22] *"for the agenda on putting out publicly, as well as obviously showing them or embedding them in some external environment where you can get the code"*; [08:37] *"a very standard sort of event display with everything all linked"* |
| **R25** | **Self-serve, immediately explorable product.** He resents Sessionboard's demo gate. | SHOULD | [01:53] *"You cannot do a self-guided tour. You have to request a demo, which is part of the enterprise sales tactics I don't really want."* |
| **R26** | **Judge on job-to-be-done, not visual fidelity to Sessionboard.** | (rubric) | [09:16] *"it's not about the fidelity to Sessionboard. It's about filling the job to be done that fits it."* |
| **R27** | **AI is explicitly de-prioritized.** | (rubric) | [09:23] *"I don't care about the AI workflow thing. I just care that we have an accepted industry standard tool that we have open source and we can clone it in a weekend."* |
| **R28** | **Higher fidelity on form options = more useful**, but own judgment is allowed. | SHOULD | [05:44] *"just show us the rough format. Again, the higher fidelity, the more usefulness. You are allowed to use your own judgment as to what this is."* |

### 1.3 CFP form-builder detail — VIDEO-ONLY enumeration

swyx walks the Sessionboard form builder option-by-option at [04:27]–[05:53]. Each of these is an implied requirement.

| # | Form capability | Class | Timestamp |
|---|---|---|---|
| **R29** | Welcome screen with custom messaging | MUST | [04:39] |
| **R30** | Limits on number of speakers **and sponsors** per submission | MUST | [04:55] |
| **R31** | Speaker biography field | MUST | [05:01] |
| **R32** | Standard validation rules per field | MUST | [05:04] |
| **R33** | Payment / paid submissions | **SKIP** | [05:15] *"we don't really care about payment, so you can skip this one if you're cloning it"* |
| **R34** | Submission close date | MUST | [05:21] |
| **R35** | Reminder email before close | MUST | [05:26] |
| **R36** | Submission limit (per submitter) | MUST | [05:28] |
| **R37** | Multiple / saved draft submissions | MUST | [05:32] |
| **R38** | Thank-you (confirmation) email | MUST | [05:33] |
| **R39** | Multi-language | **SKIP** — *"We only care about English"* | [05:36] |
| **R40** | Form admins (who gets notified / can manage) | SHOULD | [05:38] |
| **R41** | Required-field enforcement on the public form | MUST | [06:18] |
| **R42** | Optional password protection on a form | COULD | [06:12] — he hits a password prompt; ambiguous whether it's a form feature or his browser. Low confidence. |

### 1.4 Bonus / inferred requirements from AIE's real operating reality

Not stated by the leads, but reconstructed from AIE's live public CFP pages. Marked **[INFERRED]** — these are bets, not rulings. See [§6](#6-the-organizers-actual-workflow) for evidence.

| # | Requirement | Class | Basis |
|---|---|---|---|
| **R43** | **Multi-wave / rolling acceptances.** AIE NYC 2026 runs Wave 1 (Aug 15), Wave 2 (Sep 1), Final (Sep 15) while the CFP stays open until Sep 12. Accept/reject must be batchable *mid-CFP*, repeatedly. | BONUS (high value) | [INFERRED] from sessionize.com/aienyc2026 |
| **R44** | **Session formats with default durations** — Workshop 1–2h, Stage Talk 15–20m, Lightning 5–10m, Online 5–55m. Format should drive the default block length in the agenda. | BONUS | [INFERRED] from AIE CFP; matches Sessionboard's "Default Duration Based on Session Format" |
| **R45** | **Multi-event support** under one org. AIE runs 4 events/yr concurrently overlapping. | BONUS | [INFERRED] from budget image + ai.engineer |
| **R46** | **Volume tolerance: ~1,000–3,000 submissions per event.** 100–150 speakers at a stated 5–15% acceptance rate. Lists, filters, and bulk actions must not fall over — and this is exactly where Sessionboard's slowness bit him. | BONUS (high value) | [INFERRED] from AIE CFP acceptance rate + budget headcounts |
| **R47** | **Vendor-talk policy flag** — AIE hard-rejects vendor-only mainstage talks but allows them in workshops/expo. A routing/flag field maps directly onto R1's "category-based routing." | BONUS | [INFERRED] from AIE CFP |
| **R48** | **Up to N proposals per submitter** (AIE uses 3). Concretises R36. | BONUS | [INFERRED] from AIE Code Summit CFP |
| **R49** | **Travel/accommodation intake as onboarding tasks** — AIE covers flights + 2–3 hotel nights, so they must collect this per accepted speaker. Natural content for R6's task dashboard. | BONUS | [INFERRED] from AIE CFP speaker benefits |
| **R50** | **Blind / anonymized review.** Industry-standard, Sessionboard ships it, and AIE's "all submissions receive human review" at 5–15% acceptance implies real review rigor. | BONUS | [INFERRED] + Sessionboard KB |

### 1.5 Discord-ruled requirements — [DISCORD], 2026-08-08 evening batch

Stated by swyx in Discord answer threads (pasted by Atin; quotes verbatim from the paste).

| # | Requirement | Class | Source |
|---|---|---|---|
| **R51** | **Email the speaker from inside the review flow** — request changes, and/or attach feedback to the accept/deny decision email. | BONUS (named by swyx) | [DISCORD] *"bonus is being able to email speaker from inside the app to ask for changes/attach feedback when sending the approve/deny decision"* |
| **R52** | **Submissions target one or more tracks; reviewers review one or more tracks.** Track is the routing key on both sides, and both sides are stated as *plural-capable*. | SHOULD | [DISCORD] *"yes talks are submitted to one or more tracks, and reviewes review one or more tracks"* — ⚠️ SPEC `submissions.track_id` is a single FK. **Softening evidence:** the brief's own screenshots show Sessionboard's form Track field as a single-select dropdown and single track chips per abstract row — the incumbent is single-track. Reviewer-side plurality is the firmer half. |
| **R53** | **API is an explicit written bonus.** Brief p.3: *"Bonus points for API"*, linking Sessionboard's own API docs (`sessionboard.mintlify.app`) as the reference. Directly validates the agent-native bet (US-68 REST API, CLI, skill). | BONUS (explicit) | [BRIEF p.3] |
| **R54** | **Forge hosting, teeny bonus.** Brief p.3: *"Very teeny bonus points for hosting source code/site on Forge instead of GitHub (because this is my side project)"* — Forge is swyx's own product. | BONUS (very teeny) | [BRIEF p.3] |

### 1.6 The brief's screenshot annotations — [BRIEF pp.3–37], recovered 2026-08-08 night

swyx annotated the 40-screenshot Sessionboard appendix directly. These are requirements-grade signals from the primary source:

| Screenshot | Annotation | Reads as |
|---|---|---|
| Payments & Fees form step | **"NOT NEEDED"** | Confirms R33 SKIP |
| Form close date | **"kinda impt"** | Confirms R34, slightly softer than MUST |
| Customize success-page message (post-submit confirmation, auto-redirect to portal after 10 s) | **"make sure this works"** | Post-submit confirmation page is load-bearing; per-form custom message expected |
| Submitter confirmation email | **"must have"** | Confirms R38 MUST |
| Admin notifications (new/updated submission) | **"nice to have"** | Confirms R40 SHOULD |
| Speaker profile page | **"update your own bio data"** | Confirms R18 |
| Dashboard module heading | **"optional but nice to have, best efforts"** | The analytics/widget dashboards are best-effort; brief item 6 (speaker-task tracking) remains MUST but widget-builder depth is explicitly not required |
| CMS > Embeds heading | **"(OPTIONAL)"** | New Q2 evidence — see §7 Q2 |
| Portal > Tasks heading | *"For speakers to complete after admission"* — examples: Hotel and Travel Reservations (contact-scoped), Presentation Upload (session-scoped) | Matches Discord task enumeration; tasks scope to contact vs session |
| Abstracts list Options menu | Red arrow at **Import Sessions / Export .CSV / Export .XLSX / Download files bundle** | Import/export surface is pointed at deliberately |

Unannotated but load-bearing screenshot facts: the incumbent's status tabs are `All · Accepted · Accept Queue · Pending · Decline Queue · Declined · Withdrawn · Drafts` (Accept/Decline Queue confirmed as real intermediate states); agenda views are `List · Day · Week · Month · Rooms · Conflicts` (a dedicated Conflicts tab; still no track view); the public CFP is a 5-step wizard (`Welcome → Account → Submission → Participant → Review` — account creation happens *mid-flow*, before submission); form fields Title (locked, 255) and Description (**wysiwyg**, 5,000) with Format/Tags/Track/Level dropdowns; participant roles carry per-role min/max; file requests are "stored, not attached" with central download/export; event details include slug, type, website URL, theme, logo + background image, and exhibitor/sponsor group toggles; the dashboard builder ships prebuilts (Submissions Pipeline funnel, Speaker Tracking, Review Progress, Evaluation Plans by Tracks, Schedule Health) plus an "AI prompt" builder.

---

## 2. Explicitly descoped

The brief lists three struck-through items. **Descoped ≠ forbidden** — the leads struck them to reduce our scope, not to penalise them.

| Brief # | Struck item | Verdict |
|---|---|---|
| 7 | *"Native, one-way integration with Accelevents (our existing registration platform) to eliminate manual data re-entry"* | **Leave it out.** Genuinely expensive, needs a vendor account we don't have, and unverifiable by a judge. Note it in the README as a designed-for extension point (a webhook/export seam) — that costs nothing and reads as maturity. |
| 8 | *"Resource and wiki pages within the speaker portal, including HTML embed support for existing reference material"* | **Cheap differentiator — consider building.** A markdown/HTML page attached to a portal is hours of work. Sessionboard ships this (`portals/assign-pages`). If the portal looks empty next to task lists, one "Speaker Handbook" page fills it convincingly. |
| 9 | *"Embeddable, mobile-friendly speaker gallery and schedule itinerary we can post to our website"* | **⚠️ Build it anyway — this one is contradicted by the video.** At [08:22] swyx describes publishing the agenda publicly *and* "embedding them in some external environment where you can get the code," and at [08:37] shows the public event display as "roughly how it should look." Sessionboard's own site hosts live examples at `/embeds/embed-speaker-gallery` and `/embeds/embed-schedule-itinerary`. The struck-through text and the video disagree; the video is later and more specific. **Open question Q2.** |

Also waved off, from the video rather than the strikethroughs:

- **Payment / paid submissions** — [05:15] "we don't really care about payment."
- **Multi-language** — [05:36] "We only care about English."
- **CRM, Marketing, CMS modules** — [02:06], the entire non-Program three-quarters of Sessionboard.
- **AI workflows** — [09:23] "I don't care about the AI workflow thing." Note this *softens* brief item 4's AI clause but does not delete it; item 4 already said "optional."

---

## 3. Evaluation reality

**Who judges.** The AIE team — explicitly *not* swyx. Brief: *"Pass AIE team (not swyx) independent evaluation."* The tweet frames them as *"my team (your prospective customer)"*. So: practitioners who actually run these conferences, evaluating as buyers, not as hackathon judges scoring novelty.

**The mechanism.** Three artifacts are required:
1. A submitted form (to be sent out; not yet distributed as of this writing).
2. An **open-source repo** — *"so that you walk away with something regardless."*
3. A **deployed site we can test out with the walkthrough shown.**

That third clause is the whole rubric. The walkthrough video *is* the test script. Someone will open our URL and try to do, in order, what swyx did on camera: configure an event → build a form → open it in incognito → submit as a speaker → log in as that speaker and see status/tasks/bio → set up an evaluation plan → evaluate → push accepted sessions to an agenda → view the public agenda.

**What "passing" looks like operationally** ([INFERRED], but tightly constrained by the above):

- **The whole walkthrough loop completes end-to-end on the deployed site, with no dead ends.** A judge who hits a stub screen mid-flow stops evaluating. Depth in one module cannot compensate for a broken link in the chain.
- **A judge can self-serve with zero briefing.** R25 — he resents the demo gate. There must be a working, seeded demo they can poke immediately: pre-populated event, pre-built form, submissions already in the system, an agenda with real sessions on it. **Shipping an empty database is the single most likely way to lose**, because every "you'd normally have data here" moment burns a judge's patience.
- **It has to feel fast** (R7). Three separate complaints. Page transitions and list rendering are being graded whether or not anyone writes it down.
- **Two seats must both work**: the organizer/admin side *and* the speaker side, including the logged-out public form and the speaker's own login. The video spends ~40% of its runtime on the speaker's view.
- **Judge count is the hidden constraint.** 647 registered on Luma. Even at a 5% real-submission rate that is ~30 deployed sites to evaluate. Assume the first evaluation pass is **shallow and fast** — minutes, not an hour. Front-load legibility: the landing page should orient a judge in ten seconds and hand them a demo login.

**Field size.** 647 registered (Luma, event marked full, waitlist open). This is not a small field.

---

## 4. Timeline & logistics

All times PT. **Today is Saturday 2026-08-08.**

| When | What |
|---|---|
| Thu 2026-08-06 (evening PT) | Origin tweet posted (`created_at` 2026-08-07T00:05:04Z). 406 likes, 86 replies. |
| Fri 2026-08-07 | Brief + Discord + Luma go out. Luma fills to 647. |
| **Sat 2026-08-08** | Hasty walkthrough video published (YouTube upload date 20260808). **A more polished walkthrough is promised for today.** |
| **Sun 2026-08-09** | Second clarification video, *"clarifying requirements based on your feedback."* |
| **After Sun 2026-08-09** | **REQUIREMENTS FREEZE** — *"after which we will FREEZE adding any requirements so that you can have some certainty/polish."* |
| **Wed 2026-08-12, 10:00 PM PT** | **Submission deadline.** ~104 hours from now. |

Brief verbatim: *"Timeline: aim to be done in a weekend, but you may need more time esp because we are starting late, so: you have until Wednesday Aug 12 10PM PT to submit!"*

**Operational consequence.** Roughly one third of our remaining calendar time elapses before requirements stop moving. Architect for the six spine features now — they will not change — and hold the flexible budget for whatever the Sunday video adds. **Someone must watch for both videos and re-run this dossier against them.** That is the single highest-value tracking task on this project.

**$500 token reimbursement.** *"people who SUBMIT valid attempts can ask for reimbursement for up to $500 in token cost (will ask for proof, and will subjectively judge if there was a real attempt made). This includes people just using their codex subscriptions."* Note the shrink: the tweet originally floated *"i cover $1000 in tokens for you"*; the brief halves it to $500 and makes it reimbursement-on-request, because signups blew past expectations. **Action item: keep token-spend evidence from day one** — it is claimable, subscription usage counts, and reconstructing proof after the fact is painful.

**Prize.** $10,000 cash + a walkthrough/interview call written up on latent.space. The writeup has real distribution value for Stage 11 independent of the cash.

**Discord.** https://discord.gg/XYXaapF4q — *"all updates and questions and communication here."* swyx: *"I will be available to you in the Discord in order to answer any questions."* This is the only channel where requirements get resolved. Rulings pasted here by Atin get folded into this dossier.

---

## 5. Stack signals

Brief verbatim:
> - Choose whatever coding agents you want
> - Choose whatever language/tools/frameworks you want
>   - **Mild bonus points for deploy to Cloudflare infra**
>   - **Bonus points for persistence/DB to Airtable**
>   - **(Because those are what we use on our team)**

Reading between the lines:

- **The parenthetical is the real signal.** "Because those are what we use" means the bonus isn't aesthetic — it is *adoptability*. They are scoring how plausibly they could take this over on Monday. A stack their team already operates lowers the cost of the winner becoming their actual tooling. This connects directly to the AIE NYC 2026 pilot in §6: they are shopping, not just judging.
- **Airtable outranks Cloudflare** ("bonus" vs "mild bonus"). That ordering is informative and slightly counterintuitive — Airtable-as-database is technically the *worse* engineering choice (rate limits, no transactions, weak relational integrity, painful at the ~1,000–3,000 submissions of R46). They want it anyway, because **Airtable is where their non-engineers can see and edit the data.** The underlying need is *"our ops people must be able to open the data directly."*
  - **[INFERRED] strategic read:** Airtable-as-primary-store fights R7 (speed) and R46 (volume) head-on. A defensible middle path is a real database as the source of truth with a genuine Airtable sync/mirror, presented as "your team keeps its Airtable view, without paying Airtable's latency on every page load." That claims the bonus *and* the speed win rather than trading one for the other. This is a judgment call for the architecture stage, not a settled requirement.
- **Cloudflare infra** (Workers/Pages/D1/R2/KV) is a "mild" bonus and is cheap for us to satisfy. D1 + R2 also happen to answer R2's file uploads (headshots, slides) and R7's latency cleanly. Low cost, real credit.
- **No constraint on coding agents, language, or framework.** Nothing to optimise for here except our own velocity.
- **Custom email domain** appears as a $500 line item *twice* in AIE's budget (§6) — they were willing to pay for it, so branded outbound email is a thing they care about. Sending R3's mail from a plausible custom domain is a small touch that reads as real to this specific buyer.

---

## 6. The organizers' actual workflow

This section is reconstructed from the tweet's budget image, ai.engineer, and AIE's live Sessionize CFP pages. It is the most load-bearing context in this dossier: it tells us what the judges will unconsciously compare our product against.

### 6.1 Who they are and what they run

AI Engineer (`ai.engineer`, swyx's conference org) runs **four owned events a year**, plus a partner-conference network (AIEi Miami, Singapore, Melbourne, Paris, Shanghai, Sydney).

### 6.2 Scale — from AIE's own internal budget

The tweet's attached image is AIE's **internal budget proposal for Sessionboard**, partially redacted. Decoded (`sources/tweet-image.png`):

**NYC 2026 pilot (recommended):**

| Item | Cost |
|---|---|
| Pro, AIE NYC 2026 ▓▓▓ | $9,999 |
| Custom email domain setup (one-time) | $500 |
| **Total pilot investment** | **$10,499** |

**All-events annual estimate ("from August 6 email — reference only, not the pilot ask"):**

| Event | ▓▓▓ *(redacted column — almost certainly speaker or session count)* | Estimated Cost |
|---|---|---|
| AIE New York | ~150 | $9,999 |
| AIE Code Summit | ~75 | $4,999 |
| AIE Europe | ~150 | $9,999 |
| AIE World's Fair | ~400 | $17,999 |
| Custom email domain (one-time) | N/A | $500 |
| **Estimated annual total** | | **$42,997** |

Footnote in the image: *"This annual figure is a rough, same-day estimate rather than a formal multi-event quote, and the Code Summit line does not appear to reflect its smaller size relative to New York or Europe. We recommend using it for planning purposes only."*

Findings:
- **$42,997 is the ">$40k/year" from the brief and tweet.** Confirmed, not rhetorical.
- **~775 speakers/sessions per year across four events.** Individual events run 75–400.
- **The immediate purchase is a pilot for AIE NYC 2026 alone** ($10,499) — not the full annual contract. So the concrete, dated thing we are replacing is *one event*: **AIE NYC 2026, October 12–14, 2026, Sheraton New York Times Square, ~150 speakers, 1,000–1,500 in person.* That's ~9 weeks after the deadline.
- The redacted column header is unrecoverable from the image; ~150/~75/~150/~400 with "N/A" on the email-domain row makes a per-event **speaker or session count** near-certain. Marked [INFERRED].
- The prose register ("We recommend using it for planning purposes only") indicates this was written by a team member *for* swyx, i.e. there is a program/ops person driving this evaluation. **That person, not swyx, is likely our actual judge.**

### 6.3 The tool they use today: Sessionize

**This is the most important operational fact in this dossier, and it is in none of the competition materials.** AIE's current CFP tooling is **Sessionize** — their live call for speakers sits at `sessionize.com/aienyc2026/`.

swyx names it in the video at [01:36]: *"there are other competitor platforms like Sessionize — they only do the program, but Sessionboard also does CRM, also does marketing, also does CMS."*

Read carefully, that sentence is him explaining *why they were shopping past Sessionize* — and then §1.2/R8 has him saying they only want the program side anyway. **The AIE team's real position is: Sessionize does the part they need, Sessionboard does more than they need for $43k, and neither is right.** Marquee's actual competitive frame is therefore *"Sessionize's scope, self-hosted, owned, faster, plus the post-acceptance workflow Sessionize lacks"* — not *"a cheaper Sessionboard."*

Where Sessionize stops and their pain begins: it handles CFP intake and review, but not speaker onboarding tasks, templated comms, calendar invites, or agenda conflict detection. That is *precisely* brief items 3, 5, and 6.

### 6.4 Their live CFP process (AIE NYC 2026)

From `sessionize.com/aienyc2026` and `ai.engineer/nyc`:

- **Opens** Jul 17, 2026 · **Closes** Sep 12, 2026 (11:59 PM EDT)
- **Wave 1 acceptances** Aug 15 · **Wave 2** Sep 1 · **Final wave** Sep 15 — *acceptances happen in waves while the CFP is still open* (→ R43)
- **Session formats:** Workshop (1–2h), Stage Talk (15–20m), Lightning Talk (5–10m), Online Talk (5–55m, prerecorded) (→ R44)
- **Acceptance rate: 5–15%**, and *"all submissions receive human review"* (→ R46, R50)
- **Hard content policy:** *"WE WILL NOT ACCEPT VENDOR-ONLY TALKS"* on mainstage; vendors permitted in workshops/leadership/expo (→ R47)
- **Up to 3 proposals** per submitter (Code Summit) (→ R48)
- **Speaker benefits:** free attendance, economy flights, 2 nights domestic / 3 nights international hotel, professional recording published to YouTube/X/LinkedIn (→ R49)
- **Program structure:** Day 1 workshops + welcome reception; Days 2–3 keynotes, breakouts, expo. Mainstage theme for NYC 2026 is AI in Financial Services.

### 6.5 Where Sessionboard hurt

Direct from the video, in his words:

1. **Slow** — three times, unprompted ([03:50], [03:58], [07:16]). The dominant complaint.
2. **Incomplete validation** — [05:08] *"looks like it doesn't even have full validation."*
3. **Bad defaults** — [06:46] a minimum of two speakers per submission, which does not match how they run events.
4. **Discoverability** — [03:58] *"I don't know where this form thing is"*; [04:01] *"which I can't really tell where it is."* He got lost inside the admin UI on camera, twice.
5. **Demo-gated** — [01:53] no self-guided tour, must request a demo, *"enterprise sales tactics I don't really want."*
6. **Priced for someone else** — [01:23] *"people pay anywhere between $500 to $200,000 a year… or potentially per event."* $43k for four events he can't customise.
7. **Not customisable / not owned** — from the tweet: *"enterprise saas we have never used and will never be able to customize."*

Items 1, 2, 3, and 4 are all **craft** complaints, not feature complaints. That is the shape of the win: this buyer is not missing features, he is missing a tool that respects him. Marquee should be *fast, correctly validated, sanely defaulted, and navigable* before it is feature-complete.

---

## 7. Open questions

Ranked by how much a wrong guess costs us. Each carries the default we proceed on if unanswered.

**Q1 — Is Airtable expected as the actual primary datastore, or is a synced mirror enough for the bonus? — ✅ ANSWERED (Discord, 2026-08-08)**
Asked near-verbatim by a competitor (*"main database and Airtable as a synced team view, or did you want Airtable itself to be the database?"*). swyx: ***"up to you but yes the bonus points would be airtable as source of truth."***
*Consequence:* The mirror architecture is **permitted** — no forced change to stack decision 3, which was signed anticipating either answer. But the earlier strategic read in §5 ("claims the bonus *and* the speed win") is now **wrong on the bonus half**: the bonus as swyx defines it attaches to Airtable-as-primary. README/positioning must present the mirror honestly ("your team keeps its Airtable view without paying Airtable's latency") rather than claiming the source-of-truth bonus. Whether to accept partial-or-no bonus credit in exchange for the R7/R46 speed win is a client-level positioning call — the architecture itself stands.

**Q2 — The embeddable speaker gallery / schedule itinerary is struck through in the brief but described in the video at [08:22]. Which governs?**
*Why it matters:* It is a visible, demo-able surface, and the two primary sources disagree.
*New evidence (2026-08-08 night):* the brief's own screenshot appendix titles the embeds section **"CMS > Embeds (OPTIONAL)"**. Tally: struck in the feature list, OPTIONAL in the screenshots, described approvingly in the video. Reading: genuinely optional, but a real surface they use (formats: Agenda, Session List, Schedule Itinerary, Speaker List, Speaker Gallery — auto-updating).
*Default (unchanged):* Build it in Tier B order; it is now safely cuttable under pressure without contradicting any source.

**Q3 — What is the expected submission volume the deployed demo should hold, and will judges test at scale?**
*Why it matters:* Governs whether we seed 20 submissions or 2,000, and whether list virtualization is required. Bears directly on the slowness complaint that is the emotional core of this competition.
*Default:* Seed ~800–1,000 realistic submissions for AIE NYC 2026 and make list/filter/bulk operations stay fast at that size. It is also the most persuasive possible answer to R7 — being visibly fast on their real data volume, using their real event.

**Q4 — Multi-event, or single-event?**
*Why it matters:* Multi-tenancy/multi-event shapes the data model from the first migration. Retrofitting is expensive; over-building costs scarce hours.
*Default:* Model events as first-class from the start (every entity keyed to an event), but ship a UI that presents one event well. Cheap insurance, no demo cost.

**Q5 — What exactly must "conditional logic and category-based routing" (R1) do? — ✅ ANSWERED (Discord, 2026-08-08)**
swyx: *"conditional fine for now"* (basic conditional logic suffices) and routing = *"talks are submitted to one or more tracks, and reviewes review one or more tracks."*
*Consequence:* Our default was right on both halves — per-field conditions + track→reviewer mapping. One new wrinkle: **both sides are plural** (R52). Our routing_rules cover reviewers-across-tracks; submission-side multi-track is not in the schema (single `track_id`). See rulings log.

**Q6 — Is "optional AI-assisted review" scored at all? — reinforced (Discord, 2026-08-08).** Asked *"is a small useful agent enough since admin ui is the priority?"* swyx: *"yes correct admin ui is the priority."* Default below stands, now with a ruling behind it.
*Why it matters:* Determines whether to spend hours on AI scoring. The brief and the video pull in opposite directions, and many of the 647 competitors will over-invest here.
*Default:* Ship a small, honest AI first-pass scorer behind a clearly optional toggle — enough to satisfy brief item 4 — and spend the saved time on speed and the walkthrough loop. Do not lead with it.

**Q7 — What does the submission form ask for, and is there a demo login convention judges expect?**
*Why it matters:* Pure logistics, but a fumbled submission wastes the whole build. The form has not been sent out yet.
*Default:* Prepare a public repo, a deployed URL, seeded demo credentials for both an organizer and a speaker seat, and a short README walkthrough mapped section-by-section to the video's flow. Watch Discord for the form.

**Q8 — Was the password prompt at [06:12] a form-level password feature or swyx's browser autofill?**
*Why it matters:* Small, but it is a real Sessionboard feature if it exists.
*Default:* Implement optional per-form password protection. It is roughly an hour and closes the question.

**Q9 — Is calendar-invite delivery (R3) expected as ICS attachments, or genuine two-way calendar API integration?**
*Why it matters:* ICS is hours; Google/Microsoft OAuth calendar write is a day-plus with consent screens that may not be approved in time.
*Default:* ICS attachment + "Add to Google / Outlook" links. Sessionboard itself ships nothing here (§1.1 note), so ICS already beats the incumbent — and OAuth verification cannot realistically complete before Wednesday.

---

## 7.5 Discord rulings log

Every material item from Atin's pastes, one row each, newest batch first. Severity is against the finalized-draft contract (SPEC/EVALUATION/BUILDPLAN/USER_STORIES, 2026-08-08 night).

### Batch 1 — day-1 answer threads, pasted 2026-08-08 (timestamps as shown in paste)

| Item | Ruling (verbatim where quoted) | Impact | Severity |
|---|---|---|---|
| **Airtable (Q1)** | *"up to you but yes the bonus points would be airtable as source of truth"* | Mirror permitted; bonus reserved for Airtable-as-primary. Stack decision 3 stands; README positioning must stop short of claiming the bonus. | **PLAN-CHANGE** (positioning; client reconfirm) |
| **Multi-track (R52)** | *"talks are submitted to one or more tracks, and reviewes review one or more tracks"* | SPEC `submissions.track_id` is a single FK. If multi-track is honored it must land **before/with the first migration** (fleet M-02). Cheap now, expensive later. | **PLAN-CHANGE** (time-sensitive, schema) |
| **Review floor** | *"minimum workflow is just go from 'unreviewed' -> 'approve/maybe/deny'"* | Our scoring/committees/rounds are a superset. `waitlist` ≈ "maybe" — consider label surfacing. | NOTE |
| **Decision-feedback email (R51)** | *"bonus is being able to email speaker from inside the app to ask for changes/attach feedback when sending the approve/deny decision"* | No AC covers it. Cheap Tier B candidate: message field on accept/decline actions + per-submission compose. | **PLAN-CHANGE** (candidate, orchestrator routes) |
| **Onboarding tasks enumerated** | Must-show: *"1) hotel stay requirement form, 2) flight reimbursement form"*; optional: finalize description, finalize bio/photos, announce participation, invite colleagues w/ discount | AC-179/180 already cover 1–2. Seed should lead with these task types and plausibly include the optional four. | NOTE (seed content) |
| **Emails/ICS real** | *"yes they should work on an MVP basis (it's easy to setup with cloudflare email or resend)"* | Confirms real Resend+ICS build (Q9 default). Not stubbable. | NOTE (confirms) |
| **Agenda floor** | *"is day/room + drag-and-drop + conflict detection enough?" → "yes that is enough"*; separately: agendas = *"sessions assigned to tracks/rooms/time slots — yeah thats about it"* | R5's five views confirmed bonus surface, not floor. Track swimlane stays a differentiator. | NOTE |
| **Accelevents** | *"skip accelevents its fine, like i said its not required"* | Confirms descope verdict on brief item 7. | NOTE |
| **Sending domain** | *"set something up for the demo. try to get it to work… but if you can't its ok"* | Our verified `marquee@stage11.systems` beats the bar. | NOTE (confirms) |
| **Cloudflare lock-in** | *"its fine as far as i'm concerned… it is just a nice to have since our other internal tools are on cloudflare"* | Confirms stack bet. | NOTE (confirms) |
| **Follow-up video** | *"i will try to record a followup video today showing this further"* (context: email/calendar depth) | The Saturday video will likely demo comms/calendar expectations. Watch for the link — highest-priority artifact. | NOTE (watch) |
| **Recruiting/maintainability** | swyx *"this is somewhat of a recruiting exercise also"*; agrees (*"yep"*) with a commenter that code must be maintainable by a non-technical team's dev, and the suggestion to *"shortlist winning submissions, have your team request an update/change and have them demo implement that change"* | Code legibility and a possible "implement a change" round may factor into judging. Favors clean repo, README quality, and our agent-native story (an agent that can drive changes). | NOTE |
| **Field intel** | Competitors: one reports a live pilot w/ "367 automated tests and 30 browser journeys"; stacks skew CF Workers + D1/DO; names announced elsewhere: `opensession`, `Program Cue`, `SuperStage` | Color only. Field is moving fast; no course change. | NOTE |

**Unanswered in this batch** (asked by competitors, no swyx reply in the paste): edit-after-submit, sponsor/exhibitor groups, rich text, Accept/Decline Queue semantics, blind-vs-open reviewer scores, drafts counting toward submission limit, file-request central page. *(The recovered brief screenshots — §1.6 — answer three of these at the incumbent level: Accept/Decline Queue are real intermediate statuses, file requests are central "stored, not attached" pages, and descriptions/bios are wysiwyg rich text.)*

### Batch 2 — competitor CONTEXT.md verification + full-brief recovery, 2026-08-08 night

A competitor shared a consolidated context doc in Discord (archived → `sources/competitor-context-doc-2026-08-08.md`). Verification against primary sources, which its screenshot claims led us to recover:

| Claim | Verdict | Impact |
|---|---|---|
| Submission requires "…and a walkthrough" | **REFUTED** — brief p.2 lists exactly: form + open-source repo + deployed site *"we can test out with the walkthrough shown."* No entrant video. | Our no-entrant-video decision confirmed. NOTE |
| "Very small bonus points for hosting on Forge instead of GitHub" | **CONFIRMED** — brief p.3, "very teeny," Forge is swyx's side project (R54). | Repo decision 4 (GitHub public push) may want a Forge mirror. NOTE → client call |
| Speed and API "earn bonus consideration" | **CONFIRMED** — both explicit on brief p.3 (R7 re-sourced, R53 minted). | API bonus strengthens the case for US-68's Tier B rank. PLAN-CHANGE candidate |
| Airtable: "does not require sophisticated two-way sync… records land in Airtable so new-row automations run… periodic/on-load reads" | **UNSOURCED** — not in the brief, video, or any pasted swyx message; in tension with the doc's own open question. Plausibly from an unseen Discord reply. | If real, it *softens* US-72 (our mirror over-delivers) and hints AIE runs new-row automations (outbound direction matters most). Verify in Discord. NOTE |
| Submitters can edit submissions after submit; edit-lock optional ("customer does not actively use it") | **UNSOURCED** but consistent with the incumbent (public wizard supports drafts; portal shows submissions). No AC lets a speaker edit talk title/description post-submit — AC-50 covers profile fields only; swyx's "finalize talk description" task example points the same direction. | Coverage gap regardless of provenance. PLAN-CHANGE candidate |
| Review scoring/rounds demoted to "useful enhancements" | Consistent with the ruled floor (batch 1). Our superset stands. | NOTE |
| Doc's 12-step evaluation path ends "trigger and resolve a scheduling conflict" | Consistent with our loop; the seed's two live double-bookings serve exactly this. | NOTE (confirms) |
| Portal resource/wiki pages rated "Important or strongly desired" | Author's judgment, not a ruling. Our AC-233 sits below the cut line. | NOTE — revisit only at cut time |
| Competitor names announced: `opensession`, `Program Cue`, `SuperStage` (+ author's `OpenSessionBoard`) | Field intel. No collision with Marquee. | NOTE |

---

## 8. Source inventory & gaps

**Primary sources held locally** (`sequence/research/sources/`):

| File | What it is |
|---|---|
| `competition-brief.md` | The official brief (Google Doc export), with base64 image — **text-only capture; superseded by the PDF below for the appendix** |
| `competition-brief-full.pdf` | **The complete brief** — 37 pages incl. the bonus-rules page (speed/API/Forge) and the ~40-screenshot annotated Sessionboard appendix (§1.6). Recovered 2026-08-08 night via Google Doc PDF export |
| `competitor-context-doc-2026-08-08.md` | Competitor's consolidated context doc from Discord (third-party synthesis; verification in §7.5 Batch 2) |
| `brief-image1.png` | Decoded from the brief — Sessionboard product mega-menu (Program / CRM / Marketing / CMS + AI Agents). Note: swyx's own email `swyx@ai.engineer` is visible in the subscribe field, confirming he captured it while logged in. |
| `walkthrough-transcript.txt` | Timestamped, deduped transcript of the walkthrough (9:55) |
| `walkthrough.en-orig.vtt`, `walkthrough.en.vtt` | Raw auto-caption files |
| `tweet-image.png` | AIE's internal Sessionboard budget proposal, from the origin tweet |
| `sessionboard-kb-urls.txt` | 226 Sessionboard knowledge-base URLs, for targeted follow-up |

**Origin tweet, verbatim** (recovered via X syndication API; posted 2026-08-07T00:05:04Z, 406 likes, 86 replies):

> \#\# eval competition idea: Help kill my SaaS
>
> my team is proposing to pay >$40k/year for enterprise saas we have never used and will never be able to customize.
>
> as a smol business owner, this feels shitty.
>
> thinking of doing a small remote hackathon:
> - i cover $1000 in tokens for you
> - you do your best to clone this SaaS in a weekend
> - my team (your prospective customer) evals it
> - winner gets $10,000 cash & @latentspacepod writeup
> - all code is open sourced
>
> everyone wins except high margin low moat saas.
> we keep doing this with increasingly ambitious saas things for SMBs until we find the boundary of what saas is still hard to kill in a weekend.
>
> does that work?

**Video metadata:** "Kill my SaaS 1 Walkthrough / Briefing/Requirements - Sessionboard", Shawn Wang (swyx), uploaded 2026-08-08, 9:55, 144 views at time of capture. Description links the brief Google Doc, the Discord, and `luma.com/ls-06v7`.

**Gaps and caveats:**

- **X thread replies unread.** 86 replies exist on the origin tweet. WebFetch is 402-walled on x.com and the syndication endpoint returns only the root tweet. swyx may have elaborated in-thread. *Low-to-moderate risk* — the brief and video supersede a two-day-old thread. Recoverable if Atin can view the thread logged-in.
- **Discord unread.** No agent access. This is where rulings actually happen and is the largest live gap. Awaiting Atin's pastes.
- **Both clarification videos outstanding** (Sat + Sun). These will materially change this dossier and must be captured. *Highest-priority gap.* **The walkthrough video is unlisted** — it does not appear on swyx's YouTube channel listing, so the new videos cannot be caught by polling the channel. They will be announced in **Discord only**, which means Atin is our sole path to them. Relaying those two links is the highest-value thing anyone can hand this agent.
- **Transcript is auto-generated**, so proper nouns are unreliable (e.g. "session eyes" → Sessionize). Timestamps are accurate; exact wording of rare terms is not. Quotes above are lightly de-filled (removed "um", stutters) — no words changed.
- **Sessionboard pricing page returned $249/month for all three tiers** (Professional / Enterprise / Tailored), which contradicts the $9,999-per-event quote in AIE's budget. Almost certainly a parse artifact from a toggle-driven page. Treat public pricing as unknown; **AIE's actual quote of $9,999/event is the reliable number** and is what matters.
- **The redacted column in the budget table** is inferred as speaker/session count. Not certain.
- **Sessionize's actual form fields** could not be retrieved — the submission form requires authentication and the public API needs a per-event key. The CFP landing page content was captured instead.

---

*Living document. Re-saved on every new source. Next expected inputs: Saturday + Sunday clarification videos, Discord rulings from Atin, the submission form.*
