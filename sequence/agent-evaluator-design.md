# Agent evaluator seats — open evaluation as a first-class API seat

**Status:** binding design for MRQ-134. Written at intake 2026-08-12 against `github/main @ 8dc17d3`.
**Operator ruling (2026-08-12):** Marquee ships no opinionated AI reviewer. It ships the *seat* an
external agent sits in. Bring your own model, your own prompt, your own rubric.

---

## 1. The claim we are making true

> **Evaluation is open.** Marquee does not ship an opinionated AI reviewer, because your program
> committee's judgment is not a feature we should be guessing at. Instead, evaluation is a
> first-class API seat: issue a scoped credential as an evaluator, and any agent you choose — any
> model, any prompt, any rubric you wrote yourself — reads the assigned queue and records a score
> with its reasoning, exactly as a human reviewer does. Agent judgments are attributed as agent
> judgments, sit alongside human reviews rather than replacing them, and a chair can override any
> of them. As models improve, your review process improves with them, on your schedule and under
> your control. Marquee's job is to hold the truth of your conference — who submitted, who
> decided, what was said, and what goes on stage.

This is `PHILOSOPHY.md`'s "agent-native by design" taken literally on the one surface where a
built-in AI feature would have been the obvious, worse choice. A vendored evaluator is a bet on one
model and one prompt, ages badly, and asks an organizer to trust judgment they did not author. A
seat ages *with* the frontier and keeps authorship where it belongs.

**It is also the cheaper build.** Almost everything is already right (§3). What is missing is an
identity binding, a badge, and the documentation that tells an agent the surface exists.

## 2. Why the claim is false today

Two independent failures, either of which alone is fatal.

**2.1 The shipped skill has no review surface at all.** `SKILL.md`'s command registry is seed →
triage → chase → agenda → publish → diagnose. Nothing about evaluation plans, rounds, scorecards,
reviewer queues, or recording an evaluation — while the closing line names "Evaluation plan" and
"Committee" as canonical product nouns. What it *does* expose nearby is
`submissions accept --filter` / `reject --filter`: an agent reading this skill learns it may make
bulk decisions but may not record reasoning. That is the inverse of the product we want to describe.

**2.2 The API refuses every bearer token on the reviewer surface.** `src/lib/reviewer-scope.ts`:

```ts
/**
 * Reviewer identity is intentionally session-backed. Bearer tokens can carry
 * `review:write` for future service integrations, but they do not identify a
 * reviewer person and therefore cannot be guessed into a queue assignment.
 */
export function reviewerPersonIdForEvent(principal: Principal, eventId: string): string | null {
  if (principal.kind !== "session") return null;
```

`authorizeReviewerScope` throws `403` the moment that returns null, so for any token:

| Route | Today |
|---|---|
| `POST /api/v1/events/{e}/rounds/{r}/submissions/{s}/evaluations` | 403 |
| `GET /api/v1/events/{e}/rounds/{r}/submissions/{s}` (the abstract) | 403 |
| `GET /api/v1/events/{e}/reviewer/queue` | 200, empty, `scopes: []` |

The `review:write` grant exists and is honoured as *reachability*; resource authority is
session-only. **The comment is not an accident and this ticket is not a repudiation of it** — it
names service integrations as the anticipated future and states the exact precondition ("they do
not identify a reviewer person"). This ticket supplies the identity. It does not weaken a check.

## 3. What is already right (do not rebuild any of this)

- **The write payload is already an AI judgment.** `evaluations` carries `score REAL`,
  `criteria_scores` (per-criterion JSON), `comment TEXT` (the reasoning), `recommendation`.
- **Override semantics are already correct, for free.** The upsert key is
  `(round_id, submission_id, reviewer_person_id)`. An agent re-run idempotently updates its own
  row; a human's review lands *beside* the agent's, never on top of it.
- **Resource authorization is already correct.** `authorizeReviewerScope` checks event membership,
  explicit track intersection, and a direct-or-committee assignment for this round and submission,
  entirely before any payload loads, so a guessed ID cannot distinguish absent from hidden.
- **Scoped per-event tokens already exist**, with a create/revoke UI at `/settings/api` and the
  standing rule that a grant never exceeds the issuer's membership.

## 4. The design: an agent evaluator is a reviewer seat

**The organizing idea, and the thing to protect through every implementation decision: there is no
parallel "AI subsystem."** An agent evaluator is a person row with a flag, holding a reviewer
membership and track scopes, assigned to rounds through the control that already assigns reviewers,
counted in the coverage that already counts reviewers, and rendered everywhere a reviewer name
renders. Everything below is that sentence made concrete.

### 4.1 Data model

One migration. **Take the next free number after checking merged `main` at branch time** — see §8.

```sql
ALTER TABLE people ADD COLUMN kind TEXT NOT NULL DEFAULT 'human'
  CHECK (kind IN ('human', 'agent'));

ALTER TABLE api_tokens ADD COLUMN acts_as_person_id TEXT REFERENCES people(id);
CREATE INDEX idx_api_tokens_acts_as ON api_tokens(acts_as_person_id)
  WHERE acts_as_person_id IS NOT NULL;
```

`people.kind` is the distinction the whole feature hangs on: it is what lets the results view say
"agent" honestly, what keeps an agent's score out of a human aggregate, and what stops a token from
impersonating a person (§4.3). It is deliberately on `people` and not on `evaluations`, because the
fact being recorded is *what the reviewer is*, not *what one review was* — and putting it on the
person means every surface that already joins `people` gets it with no query change.

### 4.2 Identity resolution — the only authorization change in this ticket

In `auth-middleware.ts`, a token that carries `acts_as_person_id` resolves its principal **as that
person**: load the seat's memberships, expose `actingPersonId` on the token principal. Then:

```ts
export function reviewerPersonIdForEvent(principal: Principal, eventId: string): string | null {
  const personId = principal.kind === "session"
    ? principal.personId
    : principal.actingPersonId ?? null;
  if (personId === null) return null;
  // …every existing check below runs unchanged, against personId…
}
```

Rewrite the doc comment to describe the world as it then is (per the house rule on timeless docs):
reviewer identity comes from a session or from a token bound to an agent seat; an unbound token
still identifies no reviewer and still cannot be guessed into a queue assignment.

### 4.3 Security invariants — non-negotiable, each needs a test

1. **A token may act only as a person whose `kind = 'agent'`.** Binding to a human is rejected at
   issue time *and* re-checked at resolution time, so a row edited underneath a live token fails
   closed. This is the invariant that makes the feature not-an-impersonation-hole; treat any
   simplification of it as out of bounds.
2. **A bound token acts *only* as the seat.** It does not additionally carry the issuing human's
   memberships. An evaluator-bound token is a reviewer-only credential: at issue time its named
   scopes are constrained to `review:write`.
3. **The seat must belong to the token's org**, and an event-restricted token still intersects with
   its `event_ids`.
4. **Agent seats may hold `reviewer` memberships only** — never `owner`, `program_lead`, or `ops`.
5. **Every existing check in `authorizeReviewerScope` runs unchanged.** Track intersection and
   round assignment are not relaxed for agents. An unassigned agent seat sees an empty queue,
   exactly like an unassigned human.
6. **Revoking a token never deletes evaluations.** The seat's recorded judgments and their
   attribution survive revocation; audit integrity outranks tidiness.

### 4.4 The write path

Unchanged. `writeEvaluationRoute` already does the right thing once `authorization.personId`
resolves. Do not add an agent branch to it. If you find yourself writing `if (isAgent)` inside the
write handler, the design has been lost.

## 5. How it appears in the product

The organizer never thinks "API token." They think: *I added an agent to my committee, and here is
its key.* Five touchpoints, four of which are existing controls.

**5.1 Creating the seat — `/evaluation`, on the committee card.** Beside the existing committee
controls (and beside MRQ-107's "Invite reviewer" when that lands), an **"Add agent evaluator"**
action. The dialog asks for a name (placeholder: `Triage agent`) and track responsibilities — the
same two questions the human invite asks. On save, one transactional API call creates the
`kind='agent'` person, its reviewer membership, its `reviewer_track_scopes`, its
`committee_members` row, and a bound `review:write` token; the response carries the secret **once**,
rendered with the existing shown-once panel pattern from `ApiTokensPage.tsx:195` (`chip warning`
"Shown once", copy button, "I saved it"). Reuse that component; do not invent a second secret UI.

**5.2 Assigning it — no new control.** The seat appears in `SubmissionRecordPage.tsx`'s existing
`Assign reviewer…` select (`record.evaluation.reviewer_options`) with its badge, and in the
evaluation page's assignment/auto-distribution paths, because it is a reviewer. Assigning an agent
to a round is the gesture that already exists.

**5.3 Reading its judgment — the badge.** Everywhere a `reviewer_name` renders, an agent seat
renders with a small neutral chip reading **Agent**:

- `SubmissionRecordPage.tsx:165`, the *Answers and evaluation evidence* card, whose line is today
  `{round_name} · Scorecard · {reviewer_name}` and becomes `Round 1 · Scorecard · Triage agent [Agent]`
  above the score and the rationale text.
- `SubmissionRecordPage.tsx:168`, the *Evaluation panel* aside's assignment rows and the assign select.
- The chair results table, **if** MRQ-109 has landed on your base; if it has not, do not build it —
  add the chip where the surface exists and say so in the PR body.

The chip is a `Chip`, not a color, not an icon, not an emoji: `DESIGN.md` governs and the register
already has a chip vocabulary. **Reserve its width** — a row must not reflow between a human and an
agent reviewer (`CLAUDE.md`, elements never jump).

**5.4 The override — already free, make it legible.** A chair overrides by recording their own
evaluation, which lands beside the agent's under the existing upsert key. No new endpoint. What is
missing is only that the two are visually distinguishable, which 5.3 supplies.

**5.5 `/settings/api` — the seat's credential, honestly labelled.** A bound token's row shows
`Evaluator seat · <name>` in place of the conference-restriction chip's usual content, so an
organizer auditing credentials can see which key is an agent and which agent it is. The generic
"Create API token" form does **not** grow a person picker — seats are created from `/evaluation`,
where the organizer is already thinking about reviewers. One door, in the room the work happens in.

## 6. Rulings

**R1 — Agent scores are excluded from the headline aggregate and shown as their own line.**
The product story is "the agent does a first pass, humans decide." An agent's 4.0 silently lifting a
committee average would contradict the sentence we are shipping. Exclude by default; render the
agent line separately and labelled. (If MRQ-109's weighted aggregate has landed, exclude there and
keep its arithmetic otherwise untouched.)

**R2 — Agent completions *do* count toward assignment coverage.** If a chair assigned the seat, they
meant its work to count as work done. Coverage counts, score does not; that split is the honest one
and it keeps `round_assignments` semantics uniform.

**R3 — No scheduled or automatic invocation.** Marquee never calls a model. There is no cron, no
queue consumer, no "run the agent" button. The agent runs where its owner runs it, on their
credential and their bill. This is the whole point of the positioning and it is also why the feature
carries no vendor risk.

**R4 — One seat per agent, not one per run.** Re-running an agent updates its rows. Organizers who
want to compare two models create two seats, and the badge plus the seat name tells them apart.

**R5 — "Agent," never "AI," in user-facing strings.** `PHILOSOPHY.md`'s organizer's-language rule:
"AI" is vendor register and ages into a period costume. "Agent evaluator," "agent seat," "Agent"
chip. The one deliberate exception is §9's public claim, where the reader is arriving with the
industry's vocabulary in hand.

## 7. The agent-facing contract

**7.1 CLI** — three commands, matching the existing registry's shape and `--json` discipline:

```
node cli/marquee.mjs review queue  <event-id>
node cli/marquee.mjs review show   <event-id> <submission-id>
node cli/marquee.mjs review submit <event-id> <submission-id> \
  --score <n> --recommendation approve|maybe|deny --comment <text> [--criteria <json>]
```

**7.2 `SKILL.md` gains a Review section**, placed between Triage and Chase, because that is where it
sits in the real workflow. It must state: how a seat authenticates; that the queue is exactly the
assignments the chair made, and empty is a real answer meaning "nothing assigned to you"; that
`comment` is the reasoning and is shown to the chair verbatim; that a re-submit updates the seat's
own row; and that the seat cannot decide — accept/reject remain the organizer's. Regenerate through
`cli/generate-skill.mjs`; `tests/node/skill.AC-142-144.test.mjs` gates the content, so read it before
writing.

**7.3 A worked example belongs in the skill**, not just a reference: one short loop that reads the
queue, reads a record, and posts a score with rationale. An agent that has to infer the loop from
three command signatures will infer it wrong.

## 8. Collisions — read this before you plan

Four PRs are open on exactly this surface: **MRQ-107** (reviewer provisioning), **MRQ-108** (review
depth, criterion kinds), **MRQ-109** (chair results, weighted aggregates), **MRQ-110** (per-round
pools, recusal). They touch `review.routes.ts`, `evaluation.routes.ts`, `EvaluationPage.tsx`,
`SubmissionRecordPage.tsx`, and they add migrations `0008`–`0010` — **with two different `0009`s on
different branches.**

- **Base on `github/main`.** Rebase and re-run the gate whenever one of the four lands.
- **Migration number: check merged `main` at the moment you write it**, take the next genuinely free
  number, and name it distinctively (`NNNN_agent_evaluator_seats.sql`). Do not assume `0011`.
- **`reviewer-scope.ts` is yours** — none of the four touch it. That is the load-bearing file and it
  is uncontended.
- Where a surface you need (the chair results table) has not landed, **build against what exists and
  say so in the PR body**. Do not block, and do not build a second results table.

## 9. The one trap: do not ship the claim without the evidence

The eval kit's `ABS-14` is judged **only if the clone claims AI review anywhere in its UI or
marketing**; absent any claim it is scored not-applicable and excluded. Nothing in `src/ui` claims it
today. The moment §1's sentence appears in the product, the item becomes graded, and its pass
criteria demand: an agent-produced score **with substantive rationale** visible on the seeded
submission *"Taming 40-Minute CI"*, agent-versus-human distinguishable in the results view, and a
human override that persists across reload.

**Therefore the seed is not optional and not decoration.** `reset-demo` must produce: one agent seat
named `Triage agent`; a real evaluation from it on *"Taming 40-Minute CI"* whose comment is specific
to that abstract (CI duration, monorepo, build caching — not reusable boilerplate); and at least one
*human* review on the same submission, so a chair opening that record sees the distinction the claim
promises, side by side, without doing anything.

Ship the claim and the evidence in the same PR or ship neither.

## 10. Acceptance criteria (pre-minted at intake — do not mint more)

**`AC-288` – `AC-293`**, minted at intake into `EVALUATION.md` §2.5 and `sequence/USER_STORIES.md`
Amendment 20 (US-87), both already committed on your branch. The band is **post-deadline**: outside
the Wednesday terminal gate, and unenforced by `trace:ac` until your claims manifest lands — at
which point coverage is required like any other `auto` row. Write tests to satisfy them; **do not
edit the rows and do not mint more** (`COMMON.md`: delegators never edit contract docs or mint ACs).
If a row is wrong, deviate-with-flag in your completion comment.

| AC | What you must prove |
|---|---|
| AC-288 | A bound seat records an evaluation end to end, attributed to the seat. |
| AC-289 | Negative authority: human-bound rejected, unbound still 403s, out-of-scope seat 403s. |
| AC-290 | A bound token carries the seat's authority only, never the issuer's. |
| AC-291 | Human override coexists with the agent's row; each re-submit updates only its own. |
| AC-292 | Agent scores stay out of the human aggregate; agent coverage still counts. |
| AC-293 | `e2e:` the seeded record shows agent and human side by side, badged, no reflow. |

## 11. Out of scope

Marquee-hosted inference of any kind (R3). Prompt storage, rubric templates, or model configuration
in-product — the prompt is the operator's asset and lives with them. Agent seats for any role other
than reviewer. Comparison-mode agent participation (scorecard rounds only in this ticket).
Retro-badging historical seed reviews beyond the one worked example in §9.
