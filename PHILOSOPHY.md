# Marquee — Philosophy

## The one thing

**Fantastic conferences, effortlessly.** Marquee exists so that the people who make a conference happen — the program lead, the ops coordinator, the reviewers, the speakers — spend their attention on the program, not on the tool. Everything else in this document is in service of that.

## Principles

### 1. Respect the operator

The buyer we studied wasn't missing features — he was missing a tool that respects him. He filmed himself getting lost in the incumbent's admin, tripping over a min-two-speakers default, and watching validation silently fail, and he said "slow" three times unprompted. So:

- **Speed is respect.** Every list, filter, and transition stays instant at real scale (~1,000 submissions). A slow screen is a defect, not a cost.
- **Sane defaults are respect.** One speaker minimum. Formats carry their durations. The common case is the pre-filled case.
- **Honesty is respect.** Validation fires where the user is and says what's wrong in plain language. Empty states say what to do next. A save that fails, says so.
- **Never lost.** Every module is one click from the dashboard. Search finds anything by name from anywhere.

### 2. Effortless is earned by the system doing the work

The post-acceptance half of a conference is chase work — bios, headshots, slides, travel, confirmations. Marquee's job is to *be* the reminder service so no human has to be:

- **Status change is the notification.** Accepting a wave of talks queues the emails, updates the portals, and offers the calendar invites — one action, cascading correctly.
- **The dashboard answers "who is behind?" at a glance,** in real time, without configuring a report.
- **Reversals cascade too.** Un-accepting a talk tells you everything it touches — agenda, portal, invites — and handles each. The unglamorous path is designed, not discovered.

### 3. Agent-native by design

Marquee treats AI agents as first-class operators alongside humans. Every capability the UI offers is reachable programmatically, and we ship the affordances that make agents effective:

- **A real API** — the UI is built on it; nothing is UI-only.
- **A CLI** (`marquee`) — every workflow drivable from a terminal, scriptable, composable.
- **A skill file** — shipped in the repo, teaching any coding agent how to operate a conference on Marquee: seed an event, triage a review queue, chase stragglers, build an agenda.

The conference of the near future is run by an operator and their agents together. Marquee is built for that pair — maximum flexibility in how you interact, no privileged surface.

### 4. The whole loop, or nothing

A program tool earns trust by carrying the *entire* lifecycle — CFP → review → acceptance → onboarding → agenda → publish — with zero dead ends. Depth in one module never buys back a broken link in the chain. The half the incumbents skip (post-acceptance speaker ops) is first-class here; it is the reason Marquee exists.

### 5. Own your conference

Open source, self-hosted, your data. No demo gates, no per-event ransom, no "contact sales." Your ops team keeps living in their spreadsheet-shaped views (the Airtable mirror is a genuine, visible surface, not a checkbox). Leaving is easy — exports in open formats — which is exactly why you'd stay.

### 6. Speak the organizer's language

Abstract. Session. Speaker. Evaluation plan. Committee. Portal. Task. Agenda. The words on screen are the words a program team already uses — not FOSS-conference jargon, not enterprise-ware abstractions.

## Taste

- Elements never jump. State changes must not shift the controls around them.
- Tabular numbers, real names, long titles — designed against ugly real data, not pretty mock data.
- One obvious primary action per screen.
- Prototype-to-product fidelity: what was loved in design ships one-to-one.
- When a rule here conflicts with a client decision that is upheld, this document is what changes — and it changes explicitly.
