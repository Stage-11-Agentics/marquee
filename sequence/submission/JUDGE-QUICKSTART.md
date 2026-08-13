# Judge quickstart — the walkthrough loop in ten minutes

The loop below follows the briefing video's order, station by station, with the
exact URL and seat for each step. Every step was walked end to end against the
live site on 2026-08-12 (build `1f53732201aa` — `curl
https://marquee.stage11.dev/health` names the build you are on).

**Base URL: https://marquee.stage11.dev**
**Seats: https://marquee.stage11.dev/signin — organizer, reviewer, speaker.
One click each, no password, no signup.**
**Prefer typing an address? `organizer@demo.com`, `reviewer@demo.com` and
`speaker@demo.com` in the sign-in form open the same three seats directly — no
link to wait for.**

The demo is a populated instance of **AI Engineer New York 2026** (Oct 12–14,
Sheraton New York Times Square): 1,001 seeded submissions, a live review round,
a built agenda, a public program. Counts drift slightly upward as visitors
submit test proposals — that is the demo working, not corruption.

---

## 1. Event settings — organizer

Sign in at [/signin](https://marquee.stage11.dev/signin) → **Enter as
organizer**. You land on [/dashboard](https://marquee.stage11.dev/dashboard):
the program pipeline (submitted → in review → waved → onboarding → scheduled →
published), the wave planner, and the chase numbers — including how many
decided submissions have not yet been notified.

Open [/settings](https://marquee.stage11.dev/settings): conference details,
timezone (agenda and calendar invites inherit it), session formats with
duration ranges that feed the form builder and the agenda, and tracks. Edits
save as you make them.

## 2. Build a form — organizer

[/forms](https://marquee.stage11.dev/forms). Two forms exist — the public Call
for Speakers (Abstracts) and a Hotel & Travel form (Sessions, the
bypass-evaluation kind, per the video's Abstracts-vs-Sessions distinction).
Open one, or press **+ New form**: five build steps (type & basics, welcome,
fields, participants, rules). Nine field types, per-field required/validation,
conditional visibility, and track routing. Format and track options are bound
to Settings, not hand-typed.

## 3. Open the form logged out — no seat

Open a private window on
[/f/cfp](https://marquee.stage11.dev/f/cfp). It is a real server-rendered page
(the form is in the HTML, not behind a script), with the field list, character
budgets, and required markers visible before you type.

## 4. Submit as a speaker

Fill it in — title, abstract, format, one or more tracks, speaker details, bio,
and a headshot (JPG/PNG; a crop preview renders before you submit). Notice the
private resume link that appears while you draft: your answers autosave
server-side. Submit. The confirmation page keeps the resume link and states the
address the conference will write to.

## 5. See the speaker's side — speaker seat

Back at [/signin](https://marquee.stage11.dev/signin), **Enter as speaker**.
This opens the portal of a seeded, accepted speaker — the state the video
spends most of its runtime on: acceptance status with its wave ("Accepted ·
Wave 1"), the scheduled slot with room, building, street address, and an
arrival plan, per-role confirmation, a bio and headshot the speaker edits
themselves, and an onboarding task list (hotel & travel first — the tasks the
brief enumerates).

## 6. Set up evaluation — organizer

As organizer, open [/evaluation](https://marquee.stage11.dev/evaluation): the
evaluation plan with two rounds, each with **its own scorecard** (round 1:
Originality 50% · Relevance 25% · Clarity 25%; round 2: final score +
committee notes), anonymous-review toggles per round, reviewer pools, 3 reviews
per submission, and assignment distribution. Results and per-criterion CSV
export are one click away. You can also mint an **Agent evaluator seat** — a
reviewer identity with its own credential, prompt, and rubric, for a committee
that includes an AI reviewer without giving it the keys.

## 7. Evaluate — reviewer seat

Sign out, **Enter as reviewer**. You are Dario Quill, and your queue holds only
submissions in your authorized tracks — the scoping is enforced at the API, not
hidden in the UI. Review anonymously with **Approve / Maybe / Deny** (keyboard:
A M D, 1–5 to score, Enter to save & next), the weighted scorecard, comments,
and a declare-conflict action that recuses you from that submission.

## 8. Push accepted sessions to the agenda — organizer

As organizer, open
[/agenda-builder](https://marquee.stage11.dev/agenda-builder). Drag accepted
sessions from the unscheduled tray into a day, time, and room — format defaults
set the duration; placement persists as it happens, no save button. Five views:
list, day, week, **track**, room. Conflicts — room overlap, speaker
double-booking, and building-to-building transit time — warn live without
blocking. When ready, select scheduled sessions and **Review publication**: the
gate lists exactly what will become public before you press.

## 9. View the public program — no seat

Logged out: the agenda at [/agenda](https://marquee.stage11.dev/agenda) (day
tabs, track and format filters, session pages), the speaker directory at
[/speakers](https://marquee.stage11.dev/speakers), per-session calendar files,
and an embed builder at
[/embed/config](https://marquee.stage11.dev/embed/config) with copyable embed
code. Attendees can star sessions into a personal schedule and subscribe to it
as a calendar — no account.

---

## If you have five more minutes

- **The API is the product.** `curl https://marquee.stage11.dev/api/openapi.json`
  — 195 operations, OpenAPI 3.1, and the `ETag` header is the SHA-256 of the
  bytes you just received. The rendered reference is at
  [/api/docs](https://marquee.stage11.dev/api/docs). The admin UI you have been
  clicking is a plain client of the same routes.
- **Mail cannot escape the demo.** Comms run through an outbox with a
  demo-mode allowlist: press Send anywhere and the full rendered message is
  visible in [/communications](https://marquee.stage11.dev/communications),
  but no real speaker gets mailed. Judging a comms product should not require
  trusting the judge's restraint.
- **"Hand this to your agent"** — on the forms, agenda, and other operator
  screens, a button copies a paste-ready brief so your own coding agent can
  drive the same work through the CLI and API.
