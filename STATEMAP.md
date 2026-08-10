# Marquee — State map

Every lifecycle in the product, and — where it matters — whether a state is
**stored** or **derived**. Getting that distinction wrong is how a program tool
starts lying to its operator, so it is called out at each machine.

Vocabulary is the organizer's, per `PHILOSOPHY.md` 6: Abstract, Session,
Speaker, Evaluation plan, Round, Scorecard, Committee, Portal, Task, Agenda.

---

## 1. Submission status — the one stored enum

`submissions.status` is the single stored lifecycle. Seven values, complete from
the first migration. **`waitlisted` displays as "Maybe"** — the reviewer floor is
approve / maybe / deny, so the judge meets their own word.

```mermaid
stateDiagram-v2
  [*] --> draft: autosave on the public form
  draft --> submitted: submitter completes the form
  [*] --> submitted: admin creates a record

  submitted --> in_review: assigned to a committee
  in_review --> accepted: decision approve
  in_review --> waitlisted: decision maybe
  in_review --> rejected: decision deny

  submitted --> accepted: bypass evaluation<br/>guaranteed Session
  waitlisted --> accepted: promoted in a later wave
  accepted --> waitlisted: un-accept cascade
  accepted --> rejected: un-accept cascade

  submitted --> withdrawn
  in_review --> withdrawn
  accepted --> withdrawn
  waitlisted --> withdrawn

  rejected --> [*]
  withdrawn --> [*]
```

**Every transition into `accepted`, `waitlisted`, or `rejected` writes a decision
row** — one-at-a-time and bulk alike. That is what keeps the acceptance email and
the portal from rendering the outcome through different paths.

---

## 2. Pipeline stage — derived, never stored

The seven stages on the dashboard and the board are **computed from status plus
agenda placement**. There is no `stage` column. This is why placing a session on
the agenda moves it on the board without anybody setting a field.

```mermaid
flowchart TD
  Start["A submission"] --> Q1{"Has a published<br/>agenda slot?"}
  Q1 -->|yes| Published["7 Published"]
  Q1 -->|no| Q2{"Has an agenda<br/>slot at all?"}
  Q2 -->|yes| Scheduled["6 Scheduled"]
  Q2 -->|no| Q3{"Accepted?"}
  Q3 -->|yes| Onboarding["5 Onboarding"]
  Q3 -->|no| Q4{"status is<br/>in_review?"}
  Q4 -->|yes| InReview["2 In review"]
  Q4 -->|no| Submitted["1 Submitted"]
```

**Waved** (stage 3) is the acceptance batch a record belongs to, not a status —
a record is accepted *in* a wave.

---

## 3. Abstract vs Session — two kinds, one table

The distinction the walkthrough video makes and that is easy to get wrong.

```mermaid
stateDiagram-v2
  state "Abstract — applies to speak" as A
  state "Session — guaranteed" as S

  [*] --> A: submitted to a CFP form
  [*] --> S: invited, sponsor, or admin-created

  A --> Evaluated: enters the evaluation pipeline
  Evaluated --> Accepted_A: decision
  S --> Accepted_S: bypasses evaluation entirely

  Accepted_A --> Schedulable
  Accepted_S --> Schedulable

  state "Ready for the agenda" as Schedulable
  state "Accepted Abstract" as Accepted_A
  state "Accepted Session" as Accepted_S
  state "In evaluation" as Evaluated
```

Only submissions whose status is in `event_settings.schedulable_statuses`
(default `['accepted']`) may be placed. Sessions with `bypass_evaluation`
qualify without an evaluation record.

---

## 4. CFP form lifecycle

The form the organizer builds, and the public page it produces.

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Draft: new form
  Draft --> Open: publish
  Open --> Closed: close, or the close date passes
  Closed --> Open: reopen
  Draft --> Draft: duplicate creates another Draft
```

The public page it renders has four states of its own:

```mermaid
stateDiagram-v2
  direction LR
  [*] --> OpenForm: form is Open
  OpenForm --> Resumed: submitter returns via the private resume link
  Resumed --> OpenForm
  OpenForm --> AtLimit: submitter hit the per-person cap
  [*] --> ClosedForm: form is Closed
  state "Accepting submissions" as OpenForm
  state "Resumed draft" as Resumed
  state "At submission limit" as AtLimit
  state "Not open" as ClosedForm
```

The builder walks seven steps: Type and basics → Welcome → Form fields →
Participants → Rules and routing → Messages → Publish.

---

## 5. Evaluation — rounds, queue, and the reviewer's verdict

```mermaid
stateDiagram-v2
  [*] --> Unassigned: submission arrives
  Unassigned --> Assigned: committee assignment,<br/>scoped to the reviewer's tracks
  Assigned --> Reviewed: approve · maybe · deny<br/>scores optional
  Assigned --> Abstained: conflict of interest
  Reviewed --> Round2: promoted to the next round
  Round2 --> Decided
  Reviewed --> Decided: single round
  Decided --> [*]
  state "Round 2" as Round2
```

A reviewer sees only submissions intersecting their assigned tracks, and
anonymised responses have identity stripped **from the query payload, not the
template**.

---

## 6. Speaker onboarding — the chase

The moat. An acceptance assigns a task set; the system does the chasing.

```mermaid
stateDiagram-v2
  [*] --> Assigned: acceptance cascade assigns the task set
  Assigned --> InProgress: speaker opens the portal
  InProgress --> Complete: acknowledge · form · file upload
  InProgress --> Overdue: due date passes
  Assigned --> Overdue: never started
  Overdue --> Complete: after a nudge
  Complete --> [*]
  state "In progress" as InProgress
```

Three task kinds, each with its own completion payload:

```mermaid
flowchart LR
  T["Speaker task"] --> A["Acknowledge<br/>read and accept"]
  T --> F["Form<br/>structured answers"]
  T --> R["File request<br/>headshot · slides"]
```

Severity on the chase board is derived from how overdue the *worst* outstanding
task is — a speaker is at risk because of their tasks, not by a flag.

---

## 7. Acceptance cascade

What a status change actually sets in motion. `PHILOSOPHY.md` 2: the status
change **is** the notification.

```mermaid
flowchart TD
  Accept["Status → accepted"] --> Decision["Write decision row<br/>with feedback"]
  Decision --> Portal["Portal status updates"]
  Decision --> Email["Acceptance email queued"]
  Decision --> Tasks["Speaker task set assigned"]
  Decision --> Invite["Calendar invite offered<br/>after scheduling"]

  Inbound["Status changed in Airtable"] -.->|"cascade does NOT run"| Flagged
  Flagged["'changed in Airtable ·<br/>cascade not run'"] --> Manual["One-click:<br/>run onboarding cascade"]
  Manual --> Decision
```

An inbound mirror write sets the status and stops. Cascading on inbound would
let a spreadsheet edit mass-mail hundreds of speakers.

---

## 8. Agenda item

```mermaid
stateDiagram-v2
  [*] --> Pool: accepted and unplaced
  Pool --> Placed: dragged to a room and time
  Placed --> Pool: dragged back
  Placed --> Conflicting: room overlap or<br/>double-booked speaker
  Conflicting --> Placed: resolved
  Placed --> PublishedItem: publish
  Conflicting --> PublishedItem: conflicts warn, never block
  PublishedItem --> Placed: unpublish
  state "Published to the event site" as PublishedItem
```

There is no save button — placement persists as it happens. Five views over the
same data: List · Day · Week · Track · Room. **No Month view.**

---

## 9. Calendar invite

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Offered: session is scheduled
  Offered --> Sent: organizer sends or resends
  Sent --> Confirmed: speaker accepts
  Sent --> Declined: speaker declines
  Sent --> Sent: reschedule reissues
```

Delivered as ICS `METHOD:REQUEST` at a stable invite URL. OAuth calendar write is
a documented extension point, not a shipped path.

---

## 10. Airtable mirror

D1 is the source of truth. The mirror never sits on a request path.

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Syncing: queue drains, or webhook fires
  Syncing --> Idle: applied
  Syncing --> Conflict: both sides changed
  Conflict --> Idle: last_write_source recorded,<br/>record flagged for a human
```

---

## 11. The fresh-install walk

The setup state a brand-new install starts in. Steps complete from **real work**,
not from visiting the screen: taxonomy ticks when the event genuinely has tracks,
formats, and rooms; intake ticks when a form is genuinely published.

```mermaid
stateDiagram-v2
  [*] --> NoEvent: fresh install
  NoEvent --> Created: create the event
  Created --> Configured: tracks, formats, and rooms saved
  Configured --> Formed: call for speakers built
  Formed --> Planned: evaluation planned
  Planned --> IntakeOpen: form published
  IntakeOpen --> [*]: submissions begin arriving

  NoEvent --> Seeded: exit to the seeded demo
  Created --> Seeded
  Configured --> Seeded
  Formed --> Seeded
  Planned --> Seeded
  IntakeOpen --> Seeded
  state "Seeded AIE demo restored" as Seeded
  state "No event yet" as NoEvent
  state "Intake open" as IntakeOpen
```

The walk is a sandbox: it holds the seeded demo whole in a snapshot, restores it
on exit, and never persists its own event over the demo's.

---

## 12. Import from Sessionize

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Upload
  Upload --> Mapping: choose column mapping
  Mapping --> Preview: first rows shown
  Preview --> Mapping: back
  Preview --> Running: run import
  Running --> Results: created · updated · skipped · failed
  Results --> [*]
  Results --> Undone: undo this batch
```

Matching is idempotent by Sessionize ID — re-running an export updates matches
and inserts new records without duplicating anything.
