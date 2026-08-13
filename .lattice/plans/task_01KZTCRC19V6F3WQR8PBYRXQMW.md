# MRQ-107: Reviewer provisioning end to end

Working against `github/main @ 23a06b0`. Worktree: `Marquee-worktrees/mrq-107-reviewer-provisioning`.
Spec: `sequence/eval-response-tickets.md` §T-A + register rows 1–3. Rubric: CFP-10 (w2), ABS-05 (w3),
ABS-08 (w2), and the whole ABS-S3 scenario becomes gradeable.

## Ground truth established before planning

- `memberships` has exactly one writer today: `src/lib/reset-demo/demo-fixture.ts`. This ticket
  creates the first runtime one.
- `POST /committees/{id}/reviewers` (`evaluation.routes.ts:566-586`) 404s unless the person already
  holds a `reviewer` membership for the event — a chicken-and-egg with no runtime egg.
- Queue eligibility (`review.routes.ts:125-151`) counts **committee** assignments
  (`assignment.committee_id` + `committee_members`), not just direct ones. The seed puts 100
  `in_review` submissions on `COMMITTEE_ID` with `reviewer_person_id = NULL`
  (`scripts/seed/evaluations.ts:225-236`). So a reviewer added to the seeded committee inherits a
  real, non-empty queue immediately — and `authorizeReviewerQueueScope`
  (`src/lib/reviewer-scope.ts:80-108, 170-207`) then intersects it with their **track scopes**.
  That is the whole ABS-05 demonstration, and it needs no assignment work beyond the invite.
- The three seeded reviewer personas (Nora Vale / Dario Quill / Imani Sato,
  `scripts/seed/evaluations.ts:14-18`) hold `reviewer` memberships, all-track scopes, and committee
  membership. `STAFF_PERSON_ID` holds owner + program_lead + reviewer — the trap.
- The shipped demo is the seed event `evt_aie-ny-2026` (`SHIPPED_DEMO_*` in `demo-fixture.ts:9-14`);
  `evt_demo` is a small test-only fixture. Every seeded person carries `is_demo = 1`, so the
  existing persona query (`auth.routes.ts:98-105`, no `ORDER BY`, `LIMIT 1`) is **already**
  nondeterministic for `speaker` — it just happens to land somewhere usable.

## Build order (load-bearing)

### 1. Invite reviewer — the transactional provisioning API + UI

**New route** `POST /api/v1/events/{eventId}/committees/{committeeId}/invites`
(`evaluation.routes.ts`, module already globbed as `*.routes.ts`; `operationId:
"inviteCommitteeReviewer"`).

- Auth: `requireProgram(context, eventId, true)` (program_lead+), same as every committee write.
- Body: `{ name, email, title?, company?, track_ids: string[] (min 1) }`. Track ids are validated
  against `tracks` for this event (same shape as `setReviewerScopes`, `evaluation.routes.ts:627-642`)
  — an unscoped reviewer is silently unassignable, so ≥1 responsibility is required, not optional.
- Person resolution: match on `(org_id, lower(email))`; insert a new `people` row when absent.
- **One `DB.batch()`** carries all four writes plus the audit row (cross-cutting fact 6,
  `src/lib/audit.ts:50-66`): `people` (when new) → `memberships (role='reviewer', event_id)` (when
  absent) → `committee_members` (when absent) → `reviewer_track_scopes` (DELETE + INSERT for the
  named tracks, matching the existing scopes PUT so the stated responsibilities are true after the
  call).
- Then mint the credential: existing `mintMagicLink(purpose:"login", redirectTo:"/reviewer")`, mail
  it through `renderMagicLinkLoginMail` + `enqueueAuthMail` + `enqueueMailMessage` (so
  `/communications` carries the evidence), and return the absolute link on screen **only when
  `event.demo_mode === 1`** — precisely the precedent `requestMagicLink` already sets
  (`auth.routes.ts:148-188`). No second credential path is invented.
- Response: `{ person, membership_created, committee_id, track_ids, magic_link? }`.

**Also relax** `addCommitteeReviewer` (`evaluation.routes.ts:566-586`): look the person up by org
membership in the event's org rather than requiring a pre-existing `reviewer` membership, and mint
that membership in the same batch as the `committee_members` insert. A direct add now offers the
role instead of refusing the person.

**UI** (`src/ui/evaluation/EvaluationPage.tsx`, committee dialog region — T-A owns it per §4 rule 1):
- Committee card header gains an **Invite reviewer** button next to Manage, so the control is in
  place rather than two clicks deep (turn budget is scoring surface, cross-cutting fact 2).
- The committee dialog gains an invite section: Name, Email, and track responsibility checkboxes
  fed by `GET /api/v1/events/{eventId}/tracks` (loaded with the plan, not on dialog open, so the
  first paint of the dialog is complete).
- On success: the reviewer appears in the committee list (reload), and the magic link renders in a
  read-only input with a **Copy link** button. The result region is height-reserved so nothing below
  it moves when the link appears (house rule 7 — elements never jump).
- Honest labelling: the link is described as the reviewer's sign-in link for this demo conference,
  and the invite email is stated as sent. No claim the UI cannot back.

### 2. Demo reviewer door (`auth.routes.ts`)

- `roleSchema` gains `reviewer`; `DEMO_ROLE_TO_MEMBERSHIP` gains `reviewer: "reviewer"`.
- Persona query fixed in two ways:
  - **Staff exclusion** when the requested membership role is not itself a staff role
    (`owner`/`program_lead`/`ops`): `NOT EXISTS (… staff membership on this event or org-wide …)`.
    This is what stops `role:"reviewer"` from resolving to `STAFF_PERSON_ID` and signing the judge
    in as the organizer — an outright CFP-10 fail.
  - **Deterministic order**: prefer the persona the fixture names for that role
    (`SHIPPED_DEMO_ORGANIZER_PERSON_ID` / `SHIPPED_DEMO_SPEAKER_PERSON_ID`, and their `evt_demo`
    equivalents), then `created_at, id`. Reviewer names no preferred id, so it falls to the first
    non-staff reviewer in a stable order. This makes today's arbitrary pick explicit **without**
    moving the organizer or speaker door.
- The response already carries `person.name`; the shell reads the seat from `/auth/me`
  (`seat.tsx` — untouched, per the ticket's non-goal).

### 3. Landing third door (`landing.route.tsx`) — last

A third `data-demo-role="reviewer"` action pointing at `/reviewer`, alongside organizer and speaker.
The existing `LANDING_SCRIPT` handler is role-generic, so no script change. Copy updated to name
three doors. Ships only after (1) and (2), so the door always lands on a provisioned reviewer with a
real queue rather than converting `cannot_judge` into `fail`.

## Tests (targeted vitest only — fleet load rule)

`tests/integration/api/reviewer-provisioning.MRQ-107.test.ts`
- invite creates person + membership + committee row + scopes in one transaction; re-invite of the
  same email is idempotent on identity and replaces scopes.
- invite on a demo event returns a `magic_link`; exchanging it yields a session whose `/auth/me`
  carries the `reviewer` membership and no staff role.
- the invited reviewer's `/reviewer/queue` contains exactly the committee-assigned submissions that
  intersect their tracks — and not the ones outside them (ABS-05).
- invalid track id → 422; track_ids empty → 400; non-program seat → 403.
- `addCommitteeReviewer` now mints the missing reviewer membership instead of 404ing.

`tests/integration/auth-demo.test.ts` (extend)
- `role:"reviewer"` never resolves to a person holding a staff role, even when that person also
  holds `reviewer` (the named trap).
- `role:"organizer"` / `role:"speaker"` still resolve to the fixture personas (no regression).

`tests/unit/…` — landing markup asserts three doors (extend `tests/integration/landing.test.ts`).

## Validation

`wrangler`/`vite dev` + the c11 embedded browser: sign in as organizer, invite a reviewer scoped to
one track, copy the link, open it, confirm the queue is the scoped subset and that no organizer
navigation is exposed. Evidence attached with `--role validation`.

## Risks / deviations

- Section §4 rule 1 gives T-A the committee dialog; T-B/T-C land after. No other ticket's region is
  touched in `EvaluationPage.tsx`.
- `seat.tsx` untouched (ticket non-goal).
- If a genuinely necessary divergence from SPEC appears, it is implemented and flagged, never
  resolved by editing a contract doc.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Self-reviewed inline (single-reviewer budget saved for the diff).

1. **Unique indexes make naive inserts abort the whole batch.** `uq_memberships_event`,
   `uq_committee_members_committee_person`, `uq_reviewer_track_scopes_event_person_track`, and
   `uq_people_org_email` all exist (`migrations/0001_init.sql:749-861`). Every idempotent insert in
   the invite batch is therefore written as `INSERT … SELECT … WHERE NOT EXISTS (…)`, not as a
   pre-check plus a bare insert: a pre-check is not race-safe and a thrown constraint would roll the
   whole batch back. Resolution: adopted.
2. **Track scopes: replace, not append.** DELETE-then-INSERT inside the same batch, matching
   `setReviewerScopes`. Re-inviting an existing reviewer with a different track list must leave the
   stated responsibilities true, not unioned. Resolution: adopted.
3. **The magic link is minted outside the batch** (`mintMagicLink` runs its own statement). The four
   provisioning writes remain the transaction; a failure to mint leaves a correctly provisioned
   reviewer with no on-screen link rather than a half-built person. Stated in the response shape.
   Resolution: accepted as designed.
4. **Persona ordering must not move the organizer or speaker door.** Preference list keyed by role,
   falling through to `created_at, id`; staff exclusion applies only to non-staff roles (otherwise
   `role:"organizer"` would exclude the owner it is looking for). Regression tests pin both existing
   doors. Resolution: adopted.
