# MRQ-207 — Organization settings fold

Contract-first, security-sensitive. Branch `mrq-207-org-settings-fold`, cut from
`github/main@cdcc4883`.

## Allocation (merge captain, 2026-08-14)

- **AC-294 – AC-301**, **US-88 – US-89**, **Amendment 21** in SPEC / USER_STORIES /
  EVALUATION. `Next mint:` set to AC-302 in this branch; final truth after MRQ-204
  also lands is AC-308 (higher value wins).
- Migration number **0017** is mine (`0017_org_settings.sql`); MRQ-204 takes 0018.
  Both `apply-migrations.ts` import lines are kept on rebase, numeric order.

## Scope boundaries

Mine: the cascade mechanism, the invite mint (role + `event_id` + short code),
org profile/defaults, `readTheme()` org fallback, the `/org` settings shell and its
nav row, the API-tokens move.

Not mine: org Home page and its row (MRQ-209), governance policy — role legend,
owner transfer, stale-seat banner (MRQ-212), QR rendering and the evaluation
committee door (MRQ-213), the Server panel's contents (MRQ-210). The invite mint
is built general enough for MRQ-213 to add a second entry point without a second
mint path.

## Plan

1. **Schema.** `0017_org_settings.sql`: `organizations` gains
   `default_timezone`, `default_theme`, `comms_from_name`, `comms_reply_to`,
   `logo_key`, `accent` (all nullable — unset must stay distinguishable from
   chosen). `magic_links` gains `invite_role`, `invite_event_id`,
   `short_code_hash` + partial unique index. Schema mirror and
   `scripts/schema-verify.mjs` (FK count 105 → 106, positional org insert made
   explicit) move with it.
2. **Invite mint carries the seat.** `mintOrganizerInvite` takes an `InviteSeat`
   (`role`, `eventId`); the exchange reads the seat off the consumed row, never
   off the request, and creates the membership with both. Invites minted before
   this amendment default to org-wide owner, which is what they already minted.
3. **Short code.** `src/lib/auth/short-code.ts` — `WORD-WORD-NNNN` from a
   256-word list, ~29 bits, hashed at rest, resolved by the same `/join/:token`
   door and consumed by the same statement.
4. **Revocation arms.** `src/lib/auth/access-revocation.ts` returns *statements*,
   not calls, so every arm lands in one `DB.batch()`: sessions, unexpired
   person-bound links, and the named `created_by` tokens (show-and-choose, never
   a sweep). Organizer removal composes them and widens to every non-speaker
   membership.
5. **Person-record routes.** Remove-from-conference (participations ended, tasks
   cancelled through the existing `cancelled_at` machinery, conference-scoped seat
   dropped, credentials revoked, `reconcileTaskSet` after the delete) plus its
   preview, and portal-access revocation alone. Published sessions stay published
   and keep their slot (O5a).
6. **Org defaults reach the client.** `readTheme()` gains a third layer under the
   user's own choice, mirrored into storage so the pre-paint script can read it
   with no flash. Registry moves to `src/lib/theme-registry.ts` so the Worker can
   validate without a second copy.
7. **Surface.** `/org` with four tabs; API tokens moves off Conference settings
   with `/settings/api` still resolving.
8. **Contract + tests.** Amendment 21 in all three documents, `tests/ac-claims/
   MRQ-207.json`, and per-arm revocation tests written failing first.

## Acceptance

Per-arm revocation (session · unexpired links · listed tokens, each failing
before), invite exchange creates the correctly-scoped membership, org defaults
round-trip, remove-from-conference leaves published sessions and every org-level
person record untouched (count before/after), `trace:ac` green.

## Reset 2026-08-14 by agent:mrq-207-resume
