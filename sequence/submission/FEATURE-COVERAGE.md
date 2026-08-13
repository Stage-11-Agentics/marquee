# Feature coverage — the brief's nine items, honestly graded

The brief's six active features and three struck ones, each with a status, where
to see it on the live site, and the requirement numbers it traces to
(`sequence/research/competition-requirements.md`). Verified against build
`30b53f5ae78e`, 2026-08-12.

Statuses: **shipped** · **partial** (works, with named gaps) · **not built**.

---

## The six active features

### 1. Custom CFP forms with conditional logic and category-based routing — **shipped** (R1, R13–R15, R29–R42)

Nine field types, per-field validation enforced client- *and* server-side, any
field type can drive conditional visibility, and routing rules assign incoming
submissions by track with the applied rule named on the record. Welcome
screens, close dates with reminder emails, per-submitter limits, saved drafts
with private resume links, confirmation emails, and admin notifications.
Abstracts and Sessions are two distinct form kinds (R9) — Sessions bypass
evaluation.

**See it:** [/forms](https://marquee.stage11.dev/forms) (organizer seat) ·
[/f/cfp](https://marquee.stage11.dev/f/cfp) logged out.

**Gaps:** no rich-text/WYSIWYG editor (markdown-shaped text fields only) and no
section-header elements inside a form, both of which the incumbent has.

### 2. Self-service speaker portal — **shipped** (R2, R16–R18)

Acceptance status with its wave, the speaker's scheduled slot with room,
building, address, and arrival plan, self-managed bio and headshot, file
uploads, per-role confirm/decline, and the onboarding task list.

**See it:** [/signin](https://marquee.stage11.dev/signin) → Enter as speaker.

**Gaps:** no dedicated pronouns field, social links are freeform rather than
discrete labelled fields, and there is no admin↔portal impersonation toggle.

### 3. Automated, templated communications including calendar invites — **shipped** (R3, R35, R38, R51)

Thirteen template keys cover the lifecycle (acceptance, rejection, submission
confirmation, task assignment, overdue nudges, form-closing reminders, reviewer
reminders, magic-link login, and more). Nine of them are the organizer's to
edit and appear in Communications; the other four are reviewer and auth mail
the product sends on its own. Decision feedback is written once and
rendered into both the email and the portal (R51 — the bonus named in
Discord). Calendar invites are real ICS with `METHOD:REQUEST` and attendee,
Google/Outlook deep links, room *and* building in the location, `SEQUENCE`
bumps on change, and `METHOD:CANCEL` on reversal — a lifecycle, not a link.

**See it:** [/communications](https://marquee.stage11.dev/communications)
(organizer) — every queued message with its full render.
**Code:** `src/jobs/mail/templates.ts`, `src/jobs/calendar/ics.ts`.

**Honest note:** the live demo runs demo-safe mail — an allowlist in the single
queue consumer means judges can press Send without emailing real people; the
outbox shows exactly what would have been delivered. Calendar OAuth write
(pushing into a calendar without ICS) is a documented extension point, per the
Discord ruling that ICS is enough.

### 4. Submission evaluation and scoring workflows, multi-round — **shipped** (R4, R20–R22, R50, R52)

Evaluation plans with funnel rounds, each round with its own scorecard and
reviewer pool; committees as assignment targets; 3-reviews-per-submission
distribution; blind review stripped in the query layer; weighted rubric
criteria; comparison mode; conflict-of-interest recusal; reviewer seats scoped
to one or more tracks and enforced at the API (an out-of-scope request 403s).
The ruled floor — unreviewed → Approve/Maybe/Deny — is the reviewer's primary
path, in exactly those words, with numeric scoring optional. Agent evaluator
seats let a committee include an AI reviewer with its own credential, prompt,
and rubric.

AI-assisted review beyond that is deliberately not built (R27: "I don't care
about the AI workflow thing").

**See it:** [/evaluation](https://marquee.stage11.dev/evaluation) (organizer) ·
Enter as reviewer for the queue.

### 5. Drag-and-drop agenda with conflict detection, five views — **shipped** (R5, R23, R44)

Drag accepted sessions into day/time/room; format defaults set duration;
placement persists without a save button. All five asked-for views — list,
day, week, **track** (the one view the incumbent lacks), room. Three conflict
classes warn live without blocking: room overlap, speaker double-booking, and
building-to-building transit time computed from the speaker's own previous
session. Batch publish behind a review gate that lists exactly what goes
public.

**See it:** [/agenda-builder](https://marquee.stage11.dev/agenda-builder)
(organizer). The seeded agenda ships with live conflicts to inspect.

### 6. Real-time dashboard of outstanding speaker onboarding tasks — **shipped** (R6, R17, R49)

The onboarding board is a speaker × task-type matrix, severity-ordered, with
live counts, filter chips, a per-speaker drawer with message history, and
compose-and-nudge in place. Task templates with due dates and overdue
automation feed it. The program dashboard also surfaces "decisions not
notified" — decided submissions whose speakers have not yet been told.

**See it:** [/onboarding](https://marquee.stage11.dev/onboarding) (organizer) ·
[/dashboard](https://marquee.stage11.dev/dashboard).

---

## The three struck items

### 7. Accelevents integration — **not built** (by design)

Skipped per the strikethrough and the Discord confirmation ("skip accelevents
its fine"). The seam it would use — the REST API plus the import boundary — is
real and documented in the README's extension-points table.

### 8. Portal resource/wiki pages — **not built**

Struck in the brief; not built. The portal's content today is the task list,
schedule, and profile.

### 9. Embeddable speaker gallery and schedule — **built anyway** (R24)

Struck in the brief but described approvingly in the video, so it exists: a
public agenda and speaker directory, an embed builder with copyable embed code
([/embed/config](https://marquee.stage11.dev/embed/config)), saved embeds with
a kill switch, and 30-second cache freshness (the incumbent refreshes hourly).
Plus surfaces nobody asked for: attendees can star sessions into a personal
schedule on a shareable short link and subscribe to it as a calendar feed.

**See it:** [/agenda](https://marquee.stage11.dev/agenda) ·
[/speakers](https://marquee.stage11.dev/speakers) — both work logged out.
