# Marquee — Stakeholder Map

**Owner:** Stakeholder Stories agent (Marquee Initiation → Stakeholder Stories)
**Status:** First pass, 2026-08-08. Companion to `user-stories-draft.md`. Ground truth is `competition-requirements.md` (R1–R50).
**Purpose:** Name every seat that touches a conference program lifecycle, so the product definition can be argued about in terms of *whose* job gets better — not features.

## How to read this

- **Evidence tags.** `[SRC]` = cited primary source. `[DOSSIER]` = established in `competition-requirements.md`. `[INFERRED]` = my reconstruction; a bet, not a ruling. Every claim carries one.
- **Tiers** are about *this competition*, not about long-run importance. Tier 1 seats decide whether we win; Tier 3 seats must exist in the data model but can be thin in the UI.
- **AIE instance** grounds each abstract seat in the actual judging org, because the rubric is "would we buy this for AIE NYC 2026" (§3, §6 of the dossier), not "is this a good product."

---

## 1. The seat that decides the competition

Everything below is organized around one finding from the dossier (§6.2): the AIE budget memo was written *for* swyx by a team member, in careful vendor-evaluation prose ("We recommend using it for planning purposes only"). That authorship implies a **program/ops person who owns the Sessionboard evaluation and will own the replacement.** They are the likely first-pass judge.

That person is not a hackathon judge scoring novelty. They are someone with a live CFP open right now (AIE NYC 2026 closes Sep 12), ~150 speakers to land by Oct 12, and a spreadsheet-and-Sessionize workflow they already know the holes in. **Their unconscious question while clicking is: "could I run NYC on this?"** — which means the seats that must feel complete are theirs (Program Lead), their coordinator's (Ops), their committee's (Reviewer), and their speakers'.

Two corollaries that shape the whole map:

1. **The pain is craft, not features.** Four of swyx's seven Sessionboard complaints are slowness, missing validation, bad defaults, and getting lost in the nav — not absent capability `[DOSSIER §6.5]`. Every seat profile below therefore lists pains that are *about how the tool behaves*, not only what it lacks.
2. **They already have Sessionize.** AIE's live CFP runs on Sessionize `[SRC sessionize.com/aienyc2026]`. Sessionize covers intake + review + schedule and explicitly declines everything after acceptance — "We're here to help you with everything related to your sessions and speakers. We don't handle anything that has to do with your event's audience" `[SRC sessionize.com/playbook/.../platform-overview]`. So the seats where Marquee wins are the **post-acceptance seats**: the ops coordinator chasing materials, the speaker with a task list, the person building the run-of-show.

---

## 2. Seat roster at a glance

| # | Seat | Tier | Primary surface | In the demo loop? |
|---|---|---|---|---|
| 1 | **Program Lead / Content Director** | 1 | Admin: everything | ✅ the judge's own seat |
| 2 | **Ops / Production Coordinator** | 1 | Admin: onboarding dashboard, comms, portals | ✅ R6 dashboard |
| 3 | **Reviewer / Program Committee member** | 1 | Evaluation queue only | ✅ R22 |
| 4 | **Speaker — competitive path** | 1 | Public form + speaker portal | ✅ ~40% of walkthrough |
| 5 | **Review Chair / Track Lead** | 2 | Evaluation admin, scoped to a track | ⚠️ implied by R21 |
| 6 | **Speaker — invited / sponsor path** | 2 | Admin-created session; portal | ⚠️ R9 is the data model |
| 7 | **Co-speaker / panelist** | 2 | Portal, arrives by invitation | ⚠️ R15/R30 |
| 8 | **Attendee / public** | 2 | Public agenda + embeds | ✅ R24 |
| 9 | **Marketing / Web team** | 2 | Embed codes, speaker gallery | ✅ R24 embed code |
| 10 | **Organization Owner** | 3 | Org settings, multi-event, billing-shaped | ❌ model only (R45) |
| 11 | **Sponsor contact / Sponsor Success** | 3 | Group portal, guaranteed slots | ❌ model only (R47) |
| 12 | **Moderator / Chairperson** | 3 | Portal, confirms per role | ❌ model only |
| 13 | **Non-speaking Session Submitter** | 3 | Public form, then hands off | ❌ model only |
| 14 | **Self-hoster / Deploying Operator** | 2 | README, deploy, config | ✅ **the judge does this on Monday** |
| 15 | **Day-of Production / Stage Manager** | 3 | Run-of-show views, exports | ❌ post-competition |

Seats **5, 7, 12, 13, 14, 15** are extensions beyond the brief's expected list; each is justified in its profile.

---

## 3. Seat profiles

### Seat 1 — Program Lead / Content Director *(the buyer-judge)*

**Who.** Owns the program end to end: what the conference is about, who speaks, and what goes on stage when. Signs off on acceptances and on the final agenda. Equivalent to the "Programme Chair" in classic committee taxonomy — *"ensures that a well-balanced, high-quality technical programme is organised and presented"* `[SRC exordo.com/blog/whos-sits-on-a-conference-organizing-committee]`.
**AIE instance.** The author of the Sessionboard budget memo; runs 4 events/yr at 75–400 speakers each `[DOSSIER §6.2]`. `[INFERRED]` that program lead and evaluation owner are the same person at AIE's size.

**Goals**
- Land ~150 accepted speakers for NYC by Oct 12 without the program going sideways `[DOSSIER §6.2]`.
- Keep a 5–15% acceptance rate defensible — *"Every submission goes through real human review"* is a public promise they have to keep `[SRC sessionize.com/aienyc2026]`.
- Shape a balanced program: format mix (Workshop / Stage Talk / Lightning / Online), track balance, no vendor-pitch mainstage `[SRC sessionize.com/aienyc2026]`.
- Decide in **waves** while the CFP is still open, without freezing the pipeline `[DOSSIER R43]`.

**Top pains today**
- **Speed under volume.** The dominant complaint in the entire corpus, three unprompted times, and it hits hardest at exactly their scale `[DOSSIER §6.5, R7, R46]`.
- **Can't find things.** Got lost in Sessionboard's admin twice on camera — *"I don't know where this form thing is"* `[DOSSIER §6.5 / 03:58]`.
- **Bad defaults insult them.** A min-of-2-speakers default that doesn't match how they run events `[DOSSIER R15 / 06:46]`.
- **Two tools, one job.** Sessionize handles the CFP, then stops; the post-acceptance half lives in spreadsheets and email `[SRC platform-overview; DOSSIER §6.3]`.
- **Wave decisions are manual.** Nothing in the incumbents' docs describes bulk acceptance — Sessionboard's own acceptance doc covers only per-session status changes `[SRC learn.sessionboard.com/speakers/speaker-acceptance]`. At 1,000–3,000 submissions in three waves, that is the difference between an afternoon and a week.

**What they touch.** Event settings (R10), the program dashboard (R11), the form builder (R13), evaluation plans (R20), accept/reject (R43), the agenda (R5/R23), the published program (R24).

**Permissions.** Full admin, including the ability to see *and* override everything below them. Must be able to act as any lower seat to debug ("view portal as admin" is a real Sessionboard feature — `learn.sessionboard.com/faq/how-can-i-view-a-portal-as-an-admin`).

**Moments they show up.** Kickoff (event setup), form design, every wave decision, the agenda build, the day the program goes public, and any time a speaker drops.

---

### Seat 2 — Ops / Production Coordinator

**Who.** The person who turns "accepted" into "on stage." Chases headshots, bios, slides, travel details; runs the comms calendar; owns the onboarding dashboard. The Airtable native — the reason the brief awards Airtable a *bonus* while Cloudflare gets only a *mild* bonus is that this seat needs to open the data directly `[DOSSIER §5]`.
**AIE instance.** Whoever collects flight and hotel preferences for the speakers AIE covers (economy flights, 2 nights domestic / 3 international) `[SRC ai.engineer/nyc]`.

**Goals**
- 100% of accepted speakers complete every onboarding task before their deadline.
- Never be the reason a speaker's bio is wrong on the website.
- Stop being a human reminder service.

**Top pains today**
- **Chasing is the job.** Organizers spend *"hours each day or week sending the same emails to the same speakers and exhibitors reminding them to take care of the basic tasks"* `[SRC pheedloop.com/blog/chasing-conference-speakers-photos-bios]`. The materials chased: headshots, bios, contact info, website/social links, session descriptions, and post-event slides/recordings `[SRC ibid]`.
- **Speakers deprioritize.** Email offers no path to completion and no sense of a task being *done* `[SRC ibid]`.
- **Format-and-resize loop.** Materials arrive in the wrong resolution, get edited, get re-requested — *"an awkward song and dance through email"* `[SRC ibid]`.
- **No status at a glance.** Sessionboard makes this a manual configuration step: you must add "the task reporting field(s)" to a module view to see "who has completed the task and who hasn't" `[SRC learn.sessionboard.com/portals/assign-tasks]`. **R6 asks for this as a first-class real-time dashboard** — i.e. the brief is asking for the thing the incumbent buries.
- **Travel intake has no home.** Flights and hotel nights must be collected per accepted speaker `[DOSSIER R49]`, and none of the incumbents model it as anything but a generic form.

**What they touch.** Onboarding dashboard (R6), portal task assignment (R17), templated comms + reminders (R3), calendar invites (R3), file collection, the speaker list export.

**Permissions.** Full operational admin but arguably no need to change accept/reject decisions. Sessionboard's `Session Manager` role — assigned a *filter* that restricts "the sessions and speakers the team members will be able to see and manage" `[SRC learn.sessionboard.com/event-team/invite-manage-event-team-members]` — is the closest existing analogue.

**Moments.** The hour after each wave goes out; every reminder deadline; the week before the event (peak); the day after (recordings, slides).

> **This is the seat Sessionize does not serve at all.** It is the strongest single argument for Marquee's existence and should be the most finished non-speaker surface in the demo.

---

### Seat 3 — Reviewer / Program Committee member

**Who.** A volunteer or staffer who scores submissions in an assigned queue. Usually many of them, usually part-time, usually working under a deadline they didn't set.
**AIE instance.** `[INFERRED]` — AIE promises human review of every submission at 5–15% acceptance `[SRC sessionize.com/aienyc2026]`; at 1,000–3,000 submissions `[DOSSIER R46]` that is not one person's job.

**Goals**
- Get through a queue without losing the thread.
- Score consistently against a rubric, not vibes.
- Not review something they have a conflict on.

**Top pains today**
- **Queue length.** 1,000–3,000 submissions across a committee means hundreds each `[DOSSIER R46]`. This is precisely where the incumbent's slowness compounds: every list render is paid hundreds of times.
- **Context switching.** Sessionboard's own model shows how much configuration sits between a reviewer and a clean card: four separate layers control "visible submission fields, filterable fields, submission card content, and participant biographical information" `[SRC learn.sessionboard.com/evaluations/setting-up-round-based-evaluations]`.
- **Blind review is a toggle they don't control.** *"Enable Anonymized Review: Hides submitter and participant identity from evaluators"* `[SRC ibid]`; pretalx makes it a team-level permission, "Always hide speaker names" `[SRC docs.pretalx.org/user/organisers/]`.
- **Dead-end permissions.** Sessionboard evaluators *"only have access to complete evaluation plans assigned to them"* and *"cannot communicate with speakers"* `[SRC learn.sessionboard.com/faq/will-evaluators-have-the-same-access...; /evaluations/evaluation-plans]`. Correct for security, frustrating when they spot a factual problem in a submission and have nowhere to put it.

**What they touch.** One screen: their queue. Scorecard, abstain, internal comment. Nothing else.

**Permissions.** The narrowest seat in the product, and the one most likely to leak data if done carelessly. pretalx's guidance is the strongest prior art: *"Create separate reviewer teams for each event to avoid accidentally exposing past or future submissions"*, granting only "Is a reviewer" `[SRC docs.pretalx.org/user/organisers/]`.

**Moments.** One or two concentrated bursts per wave; then gone.

> **Design consequence.** The reviewer surface should be the *fastest* screen in the product and should work on a phone. A reviewer who can clear 40 submissions on a train is worth more to the program lead than any AI scoring feature.

---

### Seat 4 — Speaker, competitive path *(abstract submitter)*

**Who.** Someone applying to speak. Writes an abstract, waits, hopes. Statistically, they get rejected — 85–95% of them `[SRC sessionize.com/aienyc2026]`.
**AIE instance.** Encouraged to submit multiple: *"speakers encouraged to propose 1-5 topics"* on the NYC page, while the Code Summit CFP caps at 3 `[SRC sessionize.com/aienyc2026; DOSSIER R48]`. **The cap differs per event — so it must be a per-form setting, not a product constant.**

**Goals**
- Submit in one sitting, from whatever device is in hand.
- Know where they stand — *"whether or not you have been accepted or not… that's a key part"* `[DOSSIER R16 / 07:01]`.
- Reuse their bio and headshot instead of retyping them (Sessionize's speaker profiles are *"reusable across events"* `[SRC platform-overview]` — a real expectation this audience carries).
- Once accepted: know exactly what is owed and by when.

**Top pains today**
- **Forms that fail at the end.** Incomplete validation `[DOSSIER R14 / 05:08]` and nonsense minimums `[DOSSIER R15 / 06:46]` — swyx hit both on camera, as a speaker, in five minutes.
- **Silence.** Between submission and wave notification there is nothing. AIE's three-wave schedule means some speakers wait Jul 17 → Sep 15, two months `[SRC sessionize.com/aienyc2026]`.
- **Losing a draft.** Long-form abstracts written in a browser tab.
- **A second login.** Every conference has its own portal and its own password.

**What they touch.** The public form logged-out (R19), then their portal: status (R16), tasks (R17), bio (R18), sessions, files.

**Permissions.** Sessionboard calls this seat `Portal User` — *"assigned to all of your event contacts when they are created as a contact"* `[SRC .../invite-manage-event-team-members]`. Scope: their own submissions and their own profile, nothing else.

**Moments.** Submission day; each wave date; every task deadline; the week before; the day of.

---

### Seat 5 — Review Chair / Track Lead *(extension)*

**Who.** The person between the program lead and the reviewer pool: assigns submissions to committees, watches coverage, breaks ties, and owns one track's quality.
**Why it's a real seat and not a variant.** Three independent products model it. Sessionboard ships a distinct `Evaluator Session Manager` role that gets "assigned a filter" scoping which sessions and speakers they can see `[SRC .../invite-manage-event-team-members]`. Sessionize splits `Content Manager` (can manage evaluation plans) from `Evaluator` (restricted to the Evaluation page) `[SRC sessionize.com/playbook/team-roles-explained]`. pretalx offers **track restrictions** as a first-class team setting `[SRC docs.pretalx.org/user/organisers/]`. And the committee literature names it: programme committee members "take responsibility for distinct parts of the peer review process, or thematic areas known as tracks" `[SRC exordo.com]`.

**Goals.** Every submission in their track gets N reviews; no submission is orphaned; conflicts are handled; the recommendation list is ready before the wave date.
**Pains.** Coverage is invisible until it's late. Sessionboard's plan-assignment flow has a genuine footgun: *"Evaluators must first be added as an Evaluator to the event, and the plan must be **closed** to assign them"* `[SRC .../evaluation-plans]` — a modal sequencing constraint that is exactly the kind of thing that makes a tool feel hostile.
**Permissions.** Admin over evaluation within a scope (track / plan); read-only elsewhere.
**Moments.** Before each wave: assignment, then chasing reviewers, then the recommendation cut.

**Competition call:** `[INFERRED]` R21 ("assign submissions to evaluation **committees**, not just individuals") is this seat leaking into the requirements. Model it; give it a thin UI.

---

### Seat 6 — Speaker, invited / sponsor path *(the "Session" side of R9)*

**Who.** Someone who is speaking because of a relationship, not a competition: sponsor-entitled slots, invited keynotes, partner talks. swyx defines them as the entire reason `Sessions` exist as a separate entity — *"people who are pretty much guaranteed to speak, let's say because they're a sponsor"* `[DOSSIER R9 / 03:30]`.

**Goals.** Get their session on the agenda with correct details; never be asked to compete for a slot they already bought.
**Pains.** Being routed through a review queue they were never meant to enter; or, the opposite — living entirely outside the system in a spreadsheet, so their session is missing from the agenda until someone notices.
**What they touch.** No public form. An admin creates the session (R12, manual entry); the speaker gets a portal with tasks and bio, same as anyone else.
**Permissions.** Identical to Seat 4 in the portal. The difference is upstream, in how the record was created and whether it carries an evaluation.
**Moments.** Whenever sales closes the sponsorship — which is *continuous* and often after the CFP closes.

> **Model consequence.** Bypassing review must be a property of the *record*, not a hack. A Session should be able to reach the agenda with `evaluation: none` and not look broken. And AIE's vendor policy makes the reverse case real too: vendor content is banned from mainstage keynotes but *welcome* in "workshops, leadership, expo, and booth formats" `[SRC sessionize.com/aienyc2026]` — so sponsor-origin content still needs routing by format (R47 ↔ R1's category-based routing).

---

### Seat 7 — Co-speaker / panelist *(extension)*

**Who.** A person added to someone else's submission. They did not fill in the form; they may not know they've been submitted until an email arrives.
**Why it's a real seat.** Sessionboard's automated-email list contains a dedicated trigger — **"Added to a submission: Notifies speakers when added to sessions"** `[SRC learn.sessionboard.com/communications/automated-emails]` — which only exists because this person's onboarding starts at a different moment than the submitter's. R30 (limits on speakers per submission) and R15 (that min-2 default) are both about this seat.

**Goals.** Understand what they've been signed up for; supply their own bio/headshot; not have their name misspelled on the site.
**Pains.** Their materials are the ones that go missing, because the ops person's relationship is with the submitter. Panels are where headshot-chasing goes worst.
**Post-acceptance addition is a known gap.** Sessionboard has no clean path: either an admin reopens the whole submission form — *"This re-opens the form, allowing sessions to be edited until the new deadline"* — or the event team builds a bespoke portal form so *"portal users have a simple way to submit additional speaker requests"* `[SRC .../how-to-allow-portal-users-to-add-speakers-to-their-accepted-session]`. **Both are workarounds. A first-class "invite a co-speaker to my accepted session, admin approves" flow is a cheap, visible win.**
**Permissions.** Portal user scoped to the sessions they're on, and to their own profile.
**Moments.** The invitation email; onboarding; day-of.

---

### Seat 8 — Attendee / public

**Who.** Two populations at AIE, and they want different things: **1,000+ in person** and **150,000+ remote livestream** `[SRC ai.engineer/nyc]`.
**Goals.** Find what's on, when, and where; decide what to attend; build a personal itinerary; share a session link.
**Pains.** Agendas published as PDFs or stale HTML; no deep links to a session; unusable on a phone in a hallway; timezone confusion for remote viewers.
**What they touch.** The public agenda (R24), the speaker gallery, session detail pages, and — struck in the brief but described in the video — an embedded schedule itinerary `[DOSSIER §2 item 9, Q2]`.
**Permissions.** None. Logged-out, cacheable, fast.
**Moments.** Ticket purchase, the week before, and continuously during the event.

> `[INFERRED]` This seat is the cheapest place to look impressive. It is static-renderable, so it's where R7 (speed) is easiest to win outright, and it's the surface a judge screenshots.

---

### Seat 9 — Marketing / Web team

**Who.** Whoever owns the conference website and needs the program to appear on it without a copy-paste ritual. Sessionboard is explicit that this is a distinct audience: *"Web teams and developers implement the code on external websites"* `[SRC learn.sessionboard.com/sessions/embeds]`.

**Goals.** Drop the agenda and speaker gallery onto the marketing site; keep it on-brand; never manually sync it again.
**Pains.** Embeds that don't match the site's design; refresh lag (Sessionboard's embeds update on a **60-minute** cycle `[SRC ibid]` — which means a corrected speaker name is wrong on the public site for up to an hour); no data format for the ones who'd rather build their own.
**What they touch.** Embed configuration and the code snippet. Sessionboard's model is a good target: five embed types (schedule itinerary, speaker gallery, agenda, session list, speaker list) in styled HTML / basic HTML / JSON / XML / iCal, with "display options, colors, and optional custom CSS" plus filters by track or status `[SRC ibid]`.
**Permissions.** Sessionize gives them a literal `Developer` role — *"access to the API / Embed page"*, able to "create endpoints, fully configure your event's embeds and tap into the API" `[SRC sessionize.com/playbook/team-roles-explained]`. Notably it grants **no** content editing. Good precedent.
**Moments.** Program launch, each wave (gallery grows), day-of, and every time someone spots a typo on the public site.

---

### Seat 10 — Organization Owner

**Who.** The person who signs for the tool across all events. swyx, in this case — the one who balked at $42,997/yr for four events `[DOSSIER §6.2]`.
**Goals.** One place for all events; no per-event re-setup; speakers and reviewers carried across events; cost that isn't insulting; **the ability to customize** — from the origin tweet, *"enterprise saas we have never used and will never be able to customize"* `[DOSSIER §8]`.
**Pains.** Per-event pricing that scales with speaker count (AIE's quote: $4,999 for 75 speakers → $17,999 for 400 `[DOSSIER §6.2]`); four concurrent overlapping events `[DOSSIER R45]`; no ownership of the data.
**What they touch.** Org settings, event list, team membership across events. Sessionboard separates org-level from event-level invites (`speaker-crm/inviting-organization-team-members` vs `event-team/invite-manage-event-team-members`), and pretalx separates org permissions ("Can change organiser settings", "Can create events", "Can change teams and permissions") from event permissions `[SRC docs.pretalx.org/user/organisers/]`.
**Permissions.** The only seat above the event boundary.
**Moments.** Once, at adoption. Then almost never — which is why the UI can be thin (R45 default: model events as first-class, ship a one-event UI `[DOSSIER Q4]`).

---

### Seat 11 — Sponsor contact / Sponsor Success

**Who.** The sponsor-side person delivering on a speaking entitlement, plus the internal account manager who owns that relationship.
**Goals (sponsor).** Use the slot they paid for; get their speaker's details in on time; appear correctly in the program.
**Goals (internal).** Deliver contracted entitlements without letting a sponsor talk end up somewhere it violates policy.
**Pains.** AIE's policy is a hard content constraint — *"FOR MAINSTAGE KEYNOTES, WE WILL NOT ACCEPT VENDOR-ONLY TALKS"*, with vendor content welcome in "workshops, leadership, expo, and booth formats" `[SRC sessionize.com/aienyc2026]`. Today that's a human remembering a rule. `[INFERRED]` It should be a routing rule (R47 ↔ R1).
**What they touch.** A group portal. Sessionboard models sponsors and exhibitors as **groups**, not contacts — tasks assign to "Groups: Sponsors and Exhibitors Groups" as well as to individuals `[SRC learn.sessionboard.com/portals/assign-tasks]`. Worth copying: a sponsor is a company with several people, and tasks belong to the company.
**Permissions.** Group portal user; sees only their own sessions and tasks.
**Moments.** Contract signature (any time, including post-CFP-close), onboarding, day-of.

---

### Seat 12 — Moderator / Chairperson *(extension)*

**Who.** Sessionboard defines these as distinct participant roles with distinct jobs: a **Moderator** *"facilitates the session… Introduces speakers, keeps time, and manages audience Q&A"*; a **Chairperson** *"oversees the session from a leadership or organizational perspective… may coordinate speakers or confirm participant tasks"* `[SRC learn.sessionboard.com/concepts/participant-roles]`. Both are admin-assigned only, and neither appears in the Speakers module.
**Why it matters even at Tier 3.** Two hard requirements fall out of it. First, **conflict detection must cover them** — Sessionboard flags "double-booked participants (speakers, chairpersons, moderators)" `[SRC learn.sessionboard.com/sessions/agenda]`, so a person-level conflict check that only knows about speakers is wrong. Second, **a person can hold multiple roles on one submission**: *"Each participant answers for every role they hold on a submission, so someone who is both a speaker and a moderator confirms each one separately"* `[SRC .../speaker-acceptance]`.
**Model consequence.** Participation is a **(person, session, role)** triple, not a speaker list on a session. Getting this wrong at the first migration is expensive; getting it right costs one table.

---

### Seat 13 — Non-speaking Session Submitter *(extension)*

**Who.** The person who submits but doesn't present — a comms manager, an EA, a PR agency. Sessionboard makes them a first-class role: *"The person who submits the session proposal or abstract"*, who "may or may not present," provides the initial details, and "can receive emails and be assigned tasks" `[SRC learn.sessionboard.com/concepts/participant-roles]`.
**Why it matters.** At AIE's finance theme — Morgan Stanley, BlackRock, Capital One, Bloomberg, Jane Street `[SRC ai.engineer/nyc]` — enterprise speakers frequently arrive via a comms team. If the product assumes submitter == speaker, the confirmation email goes to the wrong person and the bio chase starts a week late.
**Cost to support.** Nearly zero if participation is the (person, session, role) triple above. Very expensive to retrofit.
**Moments.** Submission, and then all correspondence unless explicitly handed off.

---

### Seat 14 — Self-hoster / Deploying Operator *(extension — and a real judging surface)*

**Who.** The person who takes an open-source program platform and stands it up. For every other product in this landscape, this seat does not exist. For Marquee it is the *point*: the origin tweet's grievance is being unable to customize `[DOSSIER §8]`, and the competition requires an open-source repo *"so that you walk away with something regardless"* `[DOSSIER §3]`.
**Why Tier 2 despite being invisible in the walkthrough.** The judge's actual decision is "could we run NYC on this in nine weeks," and that decision includes standing it up. `[INFERRED]` but tightly constrained: the deliverables are literally a repo plus a deployed site, and the stack bonuses are justified as *"because those are what we use on our team"* `[DOSSIER §5]` — an adoptability signal, i.e. this seat is being scored.

**Goals.** Deploy in an evening. Understand the data model well enough to add a field. Keep their ops team's Airtable view working `[DOSSIER Q1]`. Own their data.
**Pains.** Open-source event software with a two-day setup; undocumented schemas; no seed data, so a fresh install looks broken.
**What they touch.** README, deploy path, config, seed script, export.
**Moments.** Evaluation (now), adoption (Monday), and every customization after.

> **Demo consequence.** This seat and the judge's first ten seconds are the same moment. The dossier is explicit that *"shipping an empty database is the single most likely way to lose"* `[DOSSIER §3]` — the seeded demo isn't a nicety, it's this seat's first user story.

---

### Seat 15 — Day-of Production / Stage Manager *(extension, post-competition)*

**Who.** Runs the room: who's on next, are they here, did the deck arrive, what's the AV setup. At AIE, across three days, multiple rooms, workshops on Day 1 and dual-format days after `[SRC ai.engineer/nyc]`.
**Goals.** A run-of-show per room. Speaker contact details on a phone. Instant visibility when something moves.
**Pains.** The agenda tool stops being useful the moment the event starts; everything migrates to a printed sheet and a group chat. (Sessionboard's answer is literally a print feature — `marketing/print-agendas`.)
**What they touch.** Room-view agenda, speaker contact sheet, last-minute changes.
**Competition call.** Out of scope for Wednesday. Worth one sentence in the README as a designed-for extension, because it signals we know what happens after the program is built.

---

## 4. Lifecycle × seat matrix

Who is actually in the product during each phase. **●** = primary actor · **○** = present · blank = absent.

| Phase | Prog Lead | Ops | Reviewer | Chair | Speaker | Co-spk | Sponsor | Attendee | Web | Owner | Self-host |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 · Deploy / adopt | ○ | | | | | | | | | ○ | ● |
| 1 · Event setup | ● | ○ | | | | | | | | ○ | ○ |
| 2 · CFP form design | ● | ○ | | ○ | | | | | | | |
| 3 · CFP open / promo | ● | ○ | | | ○ | | | ○ | ● | | |
| 4 · Submission | ○ | | | | ● | ○ | ○ | | | | |
| 5 · Review rounds | ○ | | ● | ● | | | | | | | |
| 6 · Wave acceptances | ● | ● | | ○ | ○ | ○ | ○ | | | | |
| 7 · Speaker onboarding | ○ | ● | | | ● | ● | ● | | | | |
| 8 · Communications | ○ | ● | ○ | | ○ | ○ | ○ | | | | |
| 9 · Agenda build | ● | ● | | ○ | | | ○ | | | | |
| 10 · Publish / embed | ● | ○ | | | ○ | ○ | ○ | ● | ● | | |
| 11 · Day-of | ○ | ● | | | ● | ● | ● | ● | | | |
| 12 · Post-event | ○ | ● | | | ○ | | ○ | ○ | ○ | ● | ○ |

**Reading the matrix.** Ops is the only seat present in every phase from 6 onward — the strongest argument for making the onboarding dashboard (R6) a real home screen rather than a report. The reviewer's two-cell footprint argues for a surface with almost no chrome. And phases 6–8 are where three seats collide at once; that's where a demo goes wrong if the wave-acceptance flow doesn't cascade into comms and tasks automatically.

---

## 5. Permission model synthesis

Three products, three answers:

| | Sessionboard | Sessionize | pretalx |
|---|---|---|---|
| **Shape** | Named roles + custom roles + field-level View/Lock/Hide + per-user data filters | 7 fixed roles, no customization | Teams holding boolean permission flags |
| **Roles / flags** | Admin, Evaluator, Session Manager, Evaluator Session Manager, Portal User, custom | Owner, Organizer, Content Owner, Content Manager, Content Viewer, Evaluator, Developer | can create events · can change teams & permissions · can change organiser settings · can change event settings · can work with and change proposals · is a reviewer · always hide speaker names · track restrictions |
| **Scoping** | Filters on sessions/speakers per user | None below role | Per-event teams + track restrictions |
| **Notable** | Field-level control ("limit sensitive data and keep teammates focused only on what they need") | Separate `Developer` seat for API/embeds | Reviewer teams are per-event *by design*, to avoid leaking other events' submissions |

Sources: `learn.sessionboard.com/event-team/invite-manage-event-team-members`, `sessionize.com/playbook/team-roles-explained`, `docs.pretalx.org/user/organisers/`.

### Recommended model for Marquee `[INFERRED — a proposal, not a ruling]`

Two axes, deliberately small:

**Axis A — team roles (org and event side).** Five, no custom-role builder for v1:

| Role | Can | Cannot |
|---|---|---|
| **Owner** (org) | Everything, across all events; create events; manage teams | — |
| **Program Admin** (event) | Everything within one event: settings, forms, evaluation plans, accept/reject, agenda, comms | Cross-event; org settings |
| **Coordinator** (event) | Portals, tasks, comms, files, agenda edits, exports | Change accept/reject; edit evaluation plans; event settings |
| **Review Chair** (event, optionally track-scoped) | Assign reviewers, see scores, recommend | Final accept/reject; comms to speakers |
| **Reviewer** (event, optionally track-scoped) | Their queue only: score, comment, abstain | See other tracks, other events, speaker identities when blind is on; contact speakers |

**Axis B — participation, which is *not* a role but a triple.** `(person, session, role ∈ {submitter, speaker, co-speaker, moderator, chairperson})`, each row independently confirmable `[SRC .../speaker-acceptance]` and independently task-assignable `[SRC .../portals/assign-tasks]`. Portal access derives from holding any participation row; sponsors additionally get a **group** portal.

**Three rules worth stating explicitly:**
1. **Reviewer scope is per-event by construction** — pretalx's warning is the one permission bug in this domain that leaks other people's unpublished work `[SRC docs.pretalx.org/user/organisers/]`.
2. **Blind review is set by the admin, enforced for the reviewer** — never a reviewer-side toggle.
3. **"View as" for admins** is a support feature, not a luxury; Sessionboard ships it and ops teams live on it.

**Competition scope call.** Only three of these need to be *visible* in the demo: Program Admin, Reviewer, Speaker (portal user). Model the rest; don't build screens for them.

---

## 6. Anti-personas — seats we deliberately do not serve

Naming these prevents scope creep and is itself a positioning statement.

| Not served | Why | Evidence |
|---|---|---|
| Attendee registration / ticketing | Sessionize declines it too — *"We don't handle anything that has to do with your event's audience."* AIE uses Accelevents. | `[SRC platform-overview]`, `[DOSSIER §2 item 7]` |
| Sales / speaker CRM pipeline | Explicitly out of scope | `[DOSSIER R8 / 02:06]` |
| Marketing / email campaign manager | Explicitly out of scope | `[DOSSIER R8]` |
| CMS / website builder | Out of scope; both Sessionize and we embed into someone else's site | `[DOSSIER R8]`, `[SRC platform-overview]` |
| Finance / invoicing | *"we don't really care about payment"* | `[DOSSIER R33 / 05:15]` |
| Non-English speakers | *"We only care about English"* | `[DOSSIER R39 / 05:36]` |
| Live-stream / video hosting | Adjacent industry; AIE's 150k remote viewers are served by a streaming vendor | `[SRC platform-overview; ai.engineer/nyc]` |

---

## 7. Open questions for the client

Ranked by cost of a wrong guess. Each carries the default I'd proceed on.

1. **Is the Coordinator a distinct seat in v1, or does the demo show one admin role?** *Default:* model it, ship one admin login for the demo — a second admin login is a second thing for a judge to get lost in. But the *dashboard* (R6) must look like a coordinator's home, not a report.
2. **Do we build the sponsor **group** portal, or treat sponsor speakers as ordinary participants?** *Default:* ordinary participants for the competition; keep `sponsor_origin` on the record so R47 routing works and the group portal is additive later.
3. **Does the reviewer seat get a mobile-first surface?** *Default:* yes — it's a responsive layout, not a second product, and "clear 40 reviews on your phone" is a demonstrable answer to R7/R46 that no incumbent offers.
4. **Do we surface a non-speaking Session Submitter distinctly in the UI, or only in the model?** *Default:* model only. The confirmation email goes to the submitter; participation rows drive everything else.
5. **How much of the Self-hoster seat is in scope as a deliverable?** *Default:* one-command deploy, a seed script, and a README that maps section-by-section to the walkthrough. That is the deliverable list from `[DOSSIER §3, Q7]` — it just also happens to be a persona.

---

## 8. Sources

**Primary (competition):** `sequence/research/competition-requirements.md` (R1–R50, §3 evaluation reality, §5 stack signals, §6 organizers' workflow) · `sequence/research/sources/walkthrough-transcript.txt` (timestamps cited as `[mm:ss]`).

**Sessionboard knowledge base** (`learn.sessionboard.com`): `concepts/participant-roles` · `event-team/invite-manage-event-team-members` · `faq/will-evaluators-have-the-same-access-to-my-event-that-i-do-as-an-admin` · `portals/portals-101` · `portals/assign-tasks` · `speakers/speaker-acceptance` · `evaluations/evaluation-plans` · `evaluations/setting-up-round-based-evaluations` · `communications/automated-emails` · `sessions/agenda` · `sessions/embeds` · `faq/how-to-allow-portal-users-to-add-speakers-to-their-accepted-session` · `faq/how-can-i-view-a-portal-as-an-admin`.

**Sessionize:** `sessionize.com/aienyc2026/` (AIE's live CFP) · `sessionize.com/playbook/team-roles-explained` · `sessionize.com/playbook/en_US/overview/platform-overview`.

**pretalx:** `docs.pretalx.org/user/organisers/`.

**AI Engineer:** `ai.engineer/nyc`.

**Domain prior art:** `exordo.com/blog/whos-sits-on-a-conference-organizing-committee` (committee taxonomy) · `pheedloop.com/blog/chasing-conference-speakers-photos-bios` (onboarding-chase pain).

*Living document. Next inputs: Saturday + Sunday clarification videos, Discord rulings, and the Landscape Features agent's feature matrix (which owns capability inventory — this file owns seats).*
