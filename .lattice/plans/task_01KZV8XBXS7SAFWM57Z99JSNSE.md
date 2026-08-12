# MRQ-130 — "Hand this to your agent": copyable agent briefs

**Actor:** agent:delegator-mrq-130
**Branch:** `mrq-130-agent-briefs` (worktree `../Marquee-worktrees/mrq-130-agent-briefs`, off `github/main` @ `cd907d3`)
**Rule above all others:** strictly additive. No existing control is moved, resized, disabled, or removed on any surface.

## Scope

One shared presentational component plus **four** briefs. The People → import
brief is **MRQ-131's**, built in parallel; this ticket does not touch any
People/CRM route. The component is exported in a shape MRQ-131 can consume
inside its own import modal.

| # | Surface | Route | Job the brief describes |
|---|---------|-------|-------------------------|
| 1 | CFP forms | `/forms` | Build a call for papers from a description of the conference |
| 2 | Communications | `/communications` | Find who is behind and send the right nudge |
| 3 | Agenda builder | `/agenda-builder` | Place accepted Sessions, respecting conflicts |
| 4 | Onboarding (speaker portal, organizer side) | `/onboarding` | Invite speakers to the Portal and chase their Tasks |

## Design contract

Binding shape: `prototypes/crm/index.html` → `modalImport()` (the "Import
people" modal), lines 946–984 and the `.agentbrief` rules at 321–325.
Reproduced one-to-one:

- `label` — "Hand this to your agent"
- one line of human-facing explanation (`.hint`)
- the brief in a readable block: soft ink, mono, `1.65` line-height, wrapped,
  on the recessed surface — a quoted note, not a terminal
- a **full-width** primary Copy button
- a muted single line: one per-surface sentence, the "everything the screen can
  do, it can do" claim, and the endpoint for anyone who would rather drive it
  themselves — one line, not a second code block

### Placement (this is where "additive" is enforced)

Each surface gets **one new trigger button** appended to its existing action
row, opening a modal that holds the panel. Nothing is displaced:

- **CFP forms** — appended to `PageHeader actions` after Duplicate / + New form
  / the lifecycle button. All four remain.
- **Communications** — appended to `.comms-banner` after `.comms-policy`
  (which keeps `margin-left:auto`). The banner text and policy chip remain.
- **Agenda builder** — appended to `PageHeader actions` after the conflicts
  button. The conflicts button remains.
- **Onboarding** — appended to `PageHeader actions` after Import speakers /
  Invite to portal / Send reminder. All three remain.

A modal (rather than an always-open panel) is what keeps this additive on four
already-dense screens: zero vertical pressure, so no existing control has to
shrink or move to make room. The prototype's brief also lives inside an
overlay, so this matches its context as well as its shape.

**Elements never jump:** the Copy button is full-width, so the label swapping
to "Copied" cannot change its size. The confirmation is that label swap plus an
`aria-live` announcement — no inserted or removed nodes.

## Brief content — all four items, on every brief

1. **Where this instance lives** — `window.location.origin` at render time, never
   a placeholder. The endpoint line uses the real event id for the same reason.
2. **The machine-readable entry point** — "Read /api/openapi.json first".
3. **The auth path** — an API token, mintable at Settings → API tokens.
4. **A definition of done** — what to report back, including the undo handle:

| Surface | Undo / verification handle |
|---------|---------------------------|
| CFP forms | `form_id`; the form stays a draft until the operator publishes |
| Communications | `outbox_ids` (plus selected / queued / duplicate counts) |
| Agenda | agenda item ids and their version, so a placement can be moved or removed |
| Onboarding | `outbox_ids` for what each speaker actually received |

The briefs are per-surface copy, not one template with the nouns swapped. Only
the second paragraph (instance, openapi, token, conference id) is shared — it
is the same contract on every surface, and it is the paragraph the prototype
already fixed.

## Files

**New**
- `src/ui/shell/agent-briefs.ts` — pure copy builder. `agentBrief(surface, { origin, eventId })`.
- `src/ui/shell/AgentBrief.tsx` — `AgentBriefPanel` (the shape, exported for MRQ-131) and `AgentBriefLauncher` (button + modal).
- `src/ui/shell/agent-brief.css` — tokens only, no literal colors.
- `tests/unit/agent-briefs.MRQ-130.test.ts` — one file, all coverage.

**Edited (one added element each, nothing removed)**
- `src/ui/forms/FormsPage.tsx`
- `src/ui/comms/CommsScreen.tsx`
- `src/ui/agenda/AgendaPage.tsx`
- `src/ui/onboarding/OnboardingPage.tsx`

No new dependencies; `package.json` untouched.

## Test plan

One `tests/unit` file (pure + `preact-render-to-string`; no Worker isolate, so
it costs milliseconds rather than ~19s):

- Every one of the four briefs contains the origin it was given, the literal
  `/api/openapi.json`, `Settings → API tokens`, and the conference id.
- Every brief names its undo handle and asks for a report back.
- No brief contains an exclamation mark (DESIGN voice rule).
- The four brief bodies are pairwise distinct beyond the shared paragraph —
  guards against the generic-template failure the ticket calls out.
- The endpoint line is a single muted line and carries a real path with the
  real event id, not `{eventId}`.
- Rendered panel carries the label, the hint, the brief, a full-width primary
  Copy button, and the muted endpoint line.
- Source contract: each of the four surfaces mounts `AgentBriefLauncher`, **and
  still contains every control it had before** (asserted by name, so a later
  edit that deletes one to make room fails the suite).

Gate: `npm run pr-gate -- --ticket MRQ-130`.

## Validation

Drive the real surfaces in the c11 embedded browser against `npx vite dev`:
open each of the four screens, confirm the trigger renders, the modal opens,
the brief reads correctly with the live origin, Copy reports success, and every
pre-existing control on that screen is still present and operable.

## Delivery

PR to `Stage-11-Agentics/marquee`, base `main`. **Do not merge** — post-deadline
scope, human-gated until the competition freeze clears (cf. MRQ-105). Set
`pr_open` and raise a flag on the surface.
