# Differentiators — what Marquee ships that nobody asked for

Eight things, each checkable in under a minute, none of them on the brief's
list. Verified against build `1f53732201aa`, 2026-08-12.

### 1. The UI is a plain client of a 195-operation API

The brief said "bonus points for API." Marquee's architecture makes a UI-only
feature structurally impossible to write: a route enters the registry only
through a function that takes the OpenAPI contract and the handler as one
object (`src/api/route.ts`). 195 operations, live at
[/api/openapi.json](https://marquee.stage11.dev/api/openapi.json), rendered at
[/api/docs](https://marquee.stage11.dev/api/docs), and the document's ETag is
the SHA-256 of its own bytes — a docs-match-code guarantee you can check with
`curl` and `shasum`. Neither incumbent ships a write API their own UI runs on;
one of them ships no write API at all.

### 2. A 48-command CLI and a generated agent skill file

`node cli/marquee.mjs --help`: the whole operating loop — set up a conference,
build forms, triage the queue, review, accept, schedule, publish, chase
stragglers, diagnose the deployment — as commands, with zero npm dependencies.
`SKILL.md` (19 KB, in the repo) is generated from the CLI registry and teaches
any coding agent to run a conference on Marquee; a test fails if the skill ever
has to fall back to `curl`, because that would mean the CLI has a hole. Four
operator screens carry a **"Hand this to your agent"** button that copies a
paste-ready brief.

### 3. Demo-safe mail — judging integrity as a feature

The live demo holds ~150 accepted speakers. A judge can press Send anywhere —
bulk reminders included — because the single queue consumer enforces an
allowlist: non-allowlisted addresses render, log, and appear in
[/communications](https://marquee.stage11.dev/communications) with their full
content, marked honestly as not delivered. There are exactly two audited
bypasses, both explicit. Evaluating a comms product should not require trusting
the evaluator's restraint.

### 4. The "decided but not told" number

The organizer dashboard counts decisions that have not reached their speakers —
several hundred in the seeded demo, one click from the compose flow that fixes
it. No product in this field computes that number, and it is the number that
ends conferences: the incumbent's own docs confirm a status change sends
nothing unless someone remembers to.

### 5. Reversal is designed, not discovered

Un-accepting a talk opens a dialog that enumerates every downstream effect —
portal tasks, queued emails, calendar invites — with cancel-or-retain per item,
and stamps both branches into attributed history
(`src/routes/submission-reversal.routes.ts`). Calendar invites cancel with a
real `METHOD:CANCEL`, not silence. Nobody in the field is documented to ship
reversal at all.

### 6. Transit conflicts — the third conflict class

The venue model knows buildings as places: coordinates, addresses, access
notes. The agenda builder warns when a speaker's consecutive sessions are in
different buildings with too little time between them — "leave by" is computed
from that speaker's own previous session (`src/lib/venue-geometry.ts`) — and
the speaker's portal shows the same arrival plan. Room overlap and
double-booking are table stakes; physical geography is in no brief and no
competitor.

### 7. The attendee is a real seat

Nobody asked for the audience side, so it exists: star sessions on the public
agenda into **My schedule** ([/agenda?view=mine](https://marquee.stage11.dev/agenda?view=mine)),
share it on a short link, subscribe to it as a calendar feed, download
per-session ICS — no account, no app. There is even a page addressed to
machines at [/agenda/agents](https://marquee.stage11.dev/agenda/agents).

### 8. Marquee never phones home — structurally

No vendor SDK, no analytics, no telemetry endpoint that is not your own
deployment. A speaker's email address *cannot* be logged: logs are built from a
field allowlist, and the builder has no field for an address, a body, a cookie,
or an auth header (`src/lib/observability/log.ts`;
`docs/OBSERVABILITY.md` lists every event, every field, and three off
switches). For a tool that holds other people's data, the privacy posture is
enforced by construction, not policy.

---

**One honest sentence to close on:** every claim above is either live on the
demo right now or cited to a file in the open repository, and the things
Marquee does not do are written down with the same care — see
`LIMITATIONS.md`.
