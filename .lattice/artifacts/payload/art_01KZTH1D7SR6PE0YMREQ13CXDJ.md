# MRQ-111 code review — three rounds, single headless reviewer

Reviewed commit: **`80ef5bd`** (branch HEAD, `mrq-111-speaker-roster`).

## Verdict: PASS

Rendered at `c931e44` plus the working-tree title-prefix rename, which the
reviewer inspected in place and named as the fix for its own last open item
(§10 below). `80ef5bd` **is** exactly that rename and nothing else, so the PASS
describes this commit's content.

## Round 1 — `86f06de` · FAIL, 13 findings

Two blockers, both real:

1. **Red suite.** `tests/node/quick-search.AC-101-104.test.mjs:69` asserts the
   `search.routes.ts` href *literal*; I had updated only the vitest twin. Fixed.
2. **Silent data loss.** Add-speaker merges by email; the form posted explicit
   `null` for every blank field and `resolvePersonProfile` reads `null` as
   *clear*. Re-adding an accepted speaker by name and email wiped their title,
   company, and bio org-wide. Fixed on both sides — the form omits blanks, and
   the create path drops null/undefined keys when merging onto someone existing.

Majors: the Pending override left `invited_at` via `COALESCE` so the rollup
answered "invited" to the request that set "pending"; the roster admitted
`draft`/`rejected`/`withdrawn` submissions, making it a CFP funnel wearing the
wrong noun; quick search typed submitters and moderators as `Speaker`, so the
newly-live deep link dead-ended on a 404; and `uq_memberships_event` **does**
exist (`0001_init.sql:755`), making my `WHERE NOT EXISTS` guard a TOCTOU that
could raise UNIQUE inside the cascade's batch and abort acceptance task minting.
All fixed — the last became `ON CONFLICT DO NOTHING` and a corrected comment.

Minors fixed: headshot accepted-then-ignored on create (removed from the
contract); email collision surfacing as 500 (now a 422 field error); no search
debounce (180ms on the query only); two save buttons that resized on press;
`.sr-only` borrowed from another screen's stylesheet.

Two positions **accepted rather than fixed**, and the reviewer agreed:

- **§9 one-way membership bridge.** Nothing revokes a membership on reversal.
  The person may hold another accepted session, the organizer may have added
  them by hand, and the reversal dialog asks explicitly about tasks, mail, and
  calendar without ever claiming to revoke portal access. Removing someone from
  the roster is an organizer act and wants its own control. Documented in
  `speaker-membership.ts`.
- **§10 `eventFor` is not org-scoped.** Pre-existing and the house pattern
  (`event-settings`, `imports`, `agenda`, `comms`; only `forms.routes.ts:204`
  scopes it). Flagged to the Orchestrator rather than fixed here with a second,
  divergent authorization pattern.

## Round 2 — `4efc01f` · FAIL, 5 findings

11 of 13 confirmed closed against running code. New:

1. **`cli/api-registry.json` not regenerated** — blocked the gate's API-contract
   step, and the agent-native CLI could not reach the roster at all. Regenerated.
2. **Search status scope** — fixing the roster's status set opened the same
   dead-end on a different edge: a rejected-only person was still typed
   `Speaker`. Now filtered by the same exported `ROSTER_SUBMISSION_STATUSES`.
3. **Case-sensitive email guard** — my new 422 pre-check used exact match while
   `createSpeaker` resolves identity with `lower(email)`; the reviewer *ran* it
   and produced two people sharing `dana@example.com`. Now `lower()` on both.
4. **Invitation dates disagreeing** — the memberships write restamped
   `invited_at` while participations preserved it. Both now `COALESCE`, and the
   membership inherits `MIN(participations.invited_at)` before falling back to
   now, because the row is usually minted by the same request and has nothing of
   its own to preserve.
5. Leftover `resolveHeadshot` call on the create path. Removed.

## Round 3 — `c931e44` (+ the rename) · **PASS**

All five closed, verified against running code. The two structural risks I asked
it to hunt came back clean: the conditional memberships UPDATE binds 8-for-8 in
the non-null branch and 5-for-5 in the null branch, both exercised by passing
tests; and `search.routes → speakers.queries → person-profile` is acyclic.
It also confirmed the batch *ordering* is what makes finding 4's fix work — the
membership insert is pushed before the participations UPDATE, so `MIN()` reads
pre-update values, and D1 `batch()` is sequential.

Two informational notes left open deliberately, neither a regression:

- A membership-only speaker (organizer-added, no session) is on the roster with
  a working record link but will never surface in quick search, whose candidates
  come only from `participations`. Pre-existing shape; worth its own ticket.
- The `MIN(part.invited_at)` subquery is not scoped by roster statuses, so a
  withdrawn session's invitation date can be inherited. Arguably correct — the
  human was invited — just unstated.

## Gate

`npm run pr-gate -- --ticket MRQ-111` → **pass**, 73.1s against a 120s budget,
with the box's 1-minute load average spiking to 89 during the run.
