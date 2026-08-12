# MRQ-105 — Cold start: from git clone to an owned conference

Branch `mrq-105-cold-start`, worktree `../Marquee-worktrees/mrq-105`, off `github/main` (23a06b0).

## The invariant that outranks everything

The deployed judged site must render byte-identically while the seed is
present. The unclaimed landing appears **only** when zero `owner` memberships
exist; the seeded demo has one. This is a tested invariant (AC-277), not an
assumption — a landing test asserts the seeded-shape render is unchanged.

## Build order

1. **Migration `0009_cold_start.sql`** — rebuild `magic_links`: widen the
   `purpose` CHECK to `login|draft_resume|cospeaker_profile|task_link|claim|org_invite`,
   make `person_id` NULLABLE with a CHECK that it is non-null exactly for the
   person-bound purposes. SQLite cannot ALTER a CHECK, so table rebuild
   (0007's pattern). Re-create both indexes. Register in
   `tests/integration/apply-migrations.ts`.
2. **Claim/invite token core** (`src/lib/auth/claim-links.ts`) — mint and
   exchange over the same hashing/single-statement consumption as
   `magic-links.ts`. One live claim token at a time: minting expires prior
   unused claim links. 24 h claim TTL, 7 d invite TTL.
3. **`POST /api/v1/setup/claim-link`** — public, self-limiting: only mints when
   zero `owner` memberships exist. Returns the absolute claim URL once.
   `setup claim-link` CLI verb wraps it. (AC-275)
4. **`GET /claim/:token` · `GET /join/:token`** SSR page + `POST /api/v1/claim`
   — one exchange call site for both purposes: org-if-absent, person, membership
   (`owner` for claim, invited role for invite), session cookie. Replay/expired/
   unknown → one inert page. No mail anywhere in the path. (AC-276, AC-282)
5. **Unclaimed landing** — `landing.route.tsx` branches on the zero-owner guard.
   Leaks no instance state; every event-scoped API route still auths normally.
   (AC-277)
6. **Post-claim handoff** — token offer reusing `POST /api/v1/org/tokens`
   (ordinary `api_tokens` row, no new table/kind), three doors. (AC-278)
7. **`POST /api/v1/events`** + `/conferences/new` UI + switcher `＋`, both
   hitting the one endpoint; conference-scoped checklist. (AC-279, AC-280)
8. **Org invites + organizers** — `GET/POST /api/v1/org/invites`,
   `DELETE /api/v1/org/invites/{inviteId}`, `GET /api/v1/org/members`,
   `DELETE /api/v1/org/members/{personId}`. Removal revokes `auth_sessions` in
   the same batch; the last `owner` cannot be removed. (AC-282, AC-283)
9. **`GET /api/v1/instance/status`** — every row derived from real binding and
   secret presence, no stored flag (statically asserted). Instance panel with
   fixed row positions; each unconfigured row's fix command copy-exact against
   the README. (AC-284)
10. **Publish acknowledgment** — opening intake with mail unconfigured warns,
    names the three consequences, records actor+time; never hard-blocks.
    (AC-285)
11. **`POST /api/v1/admin/remove-demo`** — `is_demo`/demo-scope only,
    idempotent, leaves non-demo rows byte-identical. (AC-286)
12. **CLI setup verbs + SKILL setup chapter** through `renderSkill()`
    (byte-equality test binding). Verb names reconciled against MRQ-104's
    shipped registry before minting. (AC-281)
13. **AC-287 docs-truth scan** — GETTING-STARTED status banner and the README
    caveat removed in this same PR, asserted against the route manifest.

## Constraints

- `package.json` untouched. No new dependencies.
- Suite budget 45 s: pure logic and UI-contract scans go to `tests/node`;
  Worker-backed integration consolidated into as few files as the ACs allow
  (target: one `tests/integration/cold-start.AC-275-287.test.ts`).
- Test titles `AC-nnn · description`; `tests/ac-claims/MRQ-105.json` owns
  AC-275 – AC-287 and ships in the same PR.
- `check:api` registry/OpenAPI parity applies to every new route.
- Do not merge — human-gated, post-freeze.
