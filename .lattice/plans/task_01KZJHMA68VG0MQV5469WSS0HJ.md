# MRQ-30: API surface completion and signed outbound webhooks

BUILDPLAN: M-29 (Tier B rank 7, US-68) + M-54 (Tier B rank 7, US-68) — Wave 2 (§5) · MERGED at mint (5 h + 4 h = 9 h; one story, one API module, identical ticket-level dependency {M-07})

**M-29 — API surface completion** (5 h, ACs AC-105 – AC-108, AC-242, dep M-07)
Scope (verbatim): scoped token UI and effective grant∩membership, docs route linked from sidebar, `check:api` route-manifest parity.
AC-242: tokens issued with named scopes (`program:read/write`, `review:write`, `speaker:write`, `agenda:write`, `comms:send`, `mirror:write`) and optional event restriction; effective authority is grant ∩ membership; the secret is shown once and stored only as a hash; revocation is immediate.

**M-54 — Signed outbound webhooks** (4 h, AC-241, deps M-07 + CP-2)
Scope (verbatim): endpoint CRUD/test/log, six-event allowlist, queue retry/backoff, HMAC over `id.timestamp.body`, replay idempotency; **cannot begin until CP-2/Tier A is green**.
Six-event allowlist: `submission.created|updated|status_changed`, `person.updated`, `speaker_task.completed`, `agenda.published`.

**SEQUENCING (binding, read before planning):** CP-2 is a checkpoint, not a ticket, so it cannot be linked — the webhook half must not start until Tier A is green. **Land the token/docs half first**: M-38+M-39 (the 🔒 gate-12 CLI + SKILL pair) depends on this ticket, and gate 12 cannot be waived. If Tier A is not yet green when this ticket is claimed, ship the M-29 half, open the PR, and take the webhook half as the second pass.

ACs (union): AC-105 – AC-108, **AC-241, AC-242**
Hours: 9 (5 + 4)
Workflow: sub-agent-full (≥7 h combined)
Shared files: none — routes register by glob (M-07's generated `_manifest.ts`); **never hand-edit a route registry**. Docs, CLI, and SKILL all derive from that one registry — `check:api` asserts operation counts and content hashes match across served JSON and rendered docs (Amendment 6; this is what beats the incumbent's 177-vs-18 docs drift).
Deps: M-07 · plus the CP-2 gate on the webhook half (recorded here; no ticket to link)
Plan: filled in by delegator's plan phase

## Plan authority and current boundary

This plan is for `agent:delegator-mrq-30` in `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-30-api`, branch `mrq-30-api`, with the plan file owned by the Lattice root at
`/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/plans/task_01KZJHMA68VG0MQV5469WSS0HJ.md`.
The initial branch tip is `e521f50` (the clean cut named in the dispatch); after fetch, `forgejo/master` is `3be1909`, the orchestrator's dispatch commit whose parent is that cut. The implementation phase will re-check the exact base before editing and will not edit contract documents, `_manifest.ts`, `package.json`, migrations/0001, or `src/db/schema.ts`.

The binding sequence is decisive: CP-2/Tier A is not green yet (MRQ-24 is in review, MRQ-38 is in validation, and MRQ-39 is backlog), so **this pass implements M-29 only**. M-54 remains a planned second pass and must not add webhook routes, queue consumers, delivery tables, or AC-241 evidence until the Orchestrator records CP-2 green. Per the ticket's explicit sequencing rule, the M-29 PR may reach `pr_open` before that gate; the webhook half is not silently treated as shipped.

Baseline, measured before implementation:

- `npm ci` was required because the worktree lacked `node_modules/vitest/vitest.mjs`; it completed successfully with 114 packages and no audit vulnerabilities.
- `npm test` PASS: 27 files / 159 tests, 12.435s wall (under the 30s budget). The harness emitted only the expected missing-local-secret warnings; no secret values were written.
- `npm run check:api` PASS: OpenAPI 3.1, 110 operations, served JSON/docs parity, CLI half skipped because `cli/` does not exist yet. This is the pre-change operation count; the finished pass must include the token operations and retain the CLI notice.

## M-29 implementation contract

### 1. One credential path, with effective authority

1. Add a glob-discovered `src/routes/tokens.routes.ts` module with the frozen paths `GET/POST /api/v1/org/tokens` and `DELETE /api/v1/org/tokens/{tokenId}`. Use `defineApiRoute`, the shared error envelope, the fixed `API_GRANTS` enum, standard rate-limit buckets, and real handlers. Do not hand-edit `src/routes/_manifest.ts` or add a second dispatch table.
2. Token creation is session-backed and organization-scoped. Require an authenticated session whose membership is at least `program_lead` for the issuer's organization; do not let a bearer token mint another bearer token. Validate a non-empty bounded name, a non-empty set of exactly the seven named grants (`program:read`, `program:write`, `review:write`, `speaker:write`, `agenda:write`, `comms:send`, `mirror:write`), and optional unique `event_ids` that all belong to the issuer's organization. Do not accept legacy role strings on the creation surface.
3. Generate the plaintext secret only in the create handler (`mq_` plus the existing 256-bit token generator), hash it with the existing SHA-256 helper, and persist only the hash, prefix, scopes JSON, issuer, organization, timestamps, and the existing compatibility `event_id` (set only when the plural restriction has exactly one event; leave it null for zero or multiple events). The 201 response includes the plaintext exactly once as `secret`; list and revoke responses never include `secret`, `token_hash`, or a recoverable equivalent. No migration is needed: `api_tokens` and its JSON/check constraints already exist in M-02.
4. Revoke by setting `revoked_at` rather than deleting the audit row. The existing resolver query must continue to include `revoked_at IS NULL`, so the next request fails with 401 without a cache/grace path. A token's own event restriction and its issuer's memberships are both required on every event-scoped route.
5. Extend, do not bypass, the canonical `createCredentialResolver()`/`resolveAuth()` path. When resolving a bearer row, load the `created_by` person's memberships constrained to the token organization and carry that membership set on the canonical token principal. Centralize the grant-intersection predicate in the existing auth scope layer so both `src/api/router.ts` policy checks and `authHasRole` use the same effective `grant ∩ membership` result. A token carrying `program:write` must therefore be refused for an issuer who is only a reviewer, before the handler or any write; an event-restricted owner token must still be refused outside its listed events. Preserve session behavior and the existing `/auth/me` shape. Do not add route-local token SQL authorization checks or a second authentication union.
6. Because `GET` and `POST /org/tokens` intentionally share a path but have different read/write policies, replace the current path-only per-entry middleware registration with method-scoped registration (or the smallest equivalent Hono registration) and add a regression proving the two policies do not run for the other method. This is a necessary M-07 seam correction for this exact frozen route shape, not a new auth path or a hand-maintained registry.

### 2. UI and docs navigation

1. Add a real `/settings/api` admin surface (for example `src/ui/settings/ApiTokensPage.tsx` plus module-local CSS) reachable from `AppShell` and the existing settings route table. Reproduce the v1.9 Flight Deck structure: token list with name/prefix/created/last-used/revocation action, one primary create action, and stable empty/loading/error geometry. The create form exposes the exact named scopes and an optional event restriction, uses “conference” in organizer-facing copy, and shows the full secret in a one-time copy surface with explicit “Marquee will not show this again” language.
2. Replace the footer's unavailable `API & CLI` button with a real sidebar link to `/api/docs`; keep the API's `/api/v1/events/...` wire noun unchanged. Link token settings to the docs from the token screen and, where the settings shell exposes sub-navigation, link API tokens there. Do not expose plaintext credentials in markup after the one-time issue state is dismissed.
3. Keep the API docs route sourced from the same generated document. The new route module must be picked up by the existing `*.routes.ts` glob, appear in `dist/api-registry.json`/served OpenAPI, and be counted by `check:api`; no copied OpenAPI JSON, manual route list, or docs-only endpoint is allowed.

## Tests and AC evidence

Add `tests/integration/api/tokens.AC-242.test.ts` (or the repository-equivalent Worker integration path) with literal AC-prefixed test names. Each of the four hand-review properties below gets both a positive control and a negative assertion that proves absence, not merely a status code:

1. **Grant ∩ membership:** a reviewer-issued token deliberately carrying `program:write` is refused on a real event-setting write and the event row is byte/state-identical afterwards; a correctly-scoped program-lead/owner token succeeds and its intended change is observable.
2. **Secret lifecycle:** creation returns the plaintext once; a direct query over the complete `api_tokens` row/table contains neither the literal secret nor a secret-bearing response in list output; the returned token can positively authenticate without a cookie.
3. **Immediate revocation:** the correctly-scoped token succeeds before revocation; after the revoke mutation, its very next write returns 401 and the target row remains unchanged. Assert the revoked row remains present with `revoked_at` so the test distinguishes immediate denial from deletion or a permanently broken fixture.
4. **Event restriction:** a token restricted to conference A succeeds on A, is rejected on conference B, and the 403 body contains neither B's id nor B's name/data. The positive A response must contain the expected A record.

The fixture must include at least two conferences in one organization, an owner/program-lead issuer, a reviewer issuer, and real event rows. Use the production app/router, not a handler-only mock, so resolver → policy → handler ordering and zero-side-effect denial are covered. Extend the existing OpenAPI/meta/manifest assertions with the token operation IDs, and add a static/UI route-table assertion for the sidebar docs link and `/settings/api` reachability. Create `tests/ac-claims/MRQ-30.json` with `owns: ["AC-242"]` and `exercises: ["AC-105", "AC-106", "AC-107", "AC-108"]`; do not duplicate existing ownership of AC-105/106/107, and do not claim AC-241 in this pre-CP-2 pass.

## M-54 second pass (planned, gated, not implemented here)

When the Orchestrator records CP-2/Tier A green and the migration ticket supplying `webhook_endpoints`/`webhook_deliveries` is available, resume this ticket for M-54. The second pass will add the exact `/webhooks` CRUD/test/deliveries routes, six-event allowlist, `WEBHOOK_QUEUE` retry/backoff, delivery-id replay idempotency, and tests against an independently implemented verifier. The receiver-facing contract to state in that PR is **HMAC-SHA256** with the signed message bytes formed as the ASCII concatenation `delivery_id + "." + timestamp + "." + raw_request_body`; the timestamp and delivery id are sent in headers, and the receiver recomputes the HMAC with the endpoint secret over those exact bytes. The implementation must sign the exact body bytes it sends, never a parsed/re-serialized object.

There is a contract inconsistency to flag before that second pass: current `SPEC.md` §4.2 still names the older six events (`submission.created`, `submission.status_changed`, `evaluation.completed`, `task.completed`, `agenda.published`, `speaker.confirmed`), while `sequence/USER_STORIES.md` Amendment 6 and the current ticket/user brief name (`submission.created|updated|status_changed`, `person.updated`, `speaker_task.completed`, `agenda.published`). No allowlist choice is made in this pre-gate pass; the Orchestrator must ratify one list before M-54 code or AC-241 claims land.

## Verification and delivery sequence

1. After the plan commit, transition `planned` → `in_progress`, re-fetch `forgejo`, and verify the exact branch/base before source edits. Implement M-29 in small commits, pushing each meaningful commit to `forgejo/mrq-30-api` and verifying remote equality after each push.
2. Run focused token/resolver/UI tests first, then `npm test`, type checks, Vite build, `npm run check:api`, `npm run trace:ac -- --scope=merged --ticket=MRQ-30`, and `npm run check:design`. Keep the default suite hermetic and under 30 seconds. Do not report M-54/AC-241 as validated.
3. Self-review the exact branch HEAD adversarially for grant-only authorization, stale/revoked-token caching, secret/hash leakage, cross-event body leakage, same-path middleware bleed, direct provider calls, and route-manifest drift. Attach a PASS review artifact naming the exact reviewed commit.
4. Bump `in_validation`, record a Worker/API validation comment (real `/api/openapi.json`, `/api/docs`, token create/list/revoke and bearer calls; no browser approval is needed for this API flow), run `npm run pr-gate -- --ticket MRQ-30`, and paste its result into the completion comment. Open the Forgejo PR against `master`, attach the URL, bump `pr_open`, and c11-send the Orchestrator at workspace 9 / surface 60. `pr_open` is terminal for this delegator; M-54 remains explicitly owed behind CP-2.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **Sequencing:** accepted the binding split: M-29 ships first because CP-2 is not green; M-54 is not implemented or claimed in this PR.
- **Schema:** use the already-merged `api_tokens` table and its `event_id` compatibility CHECK; do not edit 0001 or invent a migration. Plural `event_ids` remains authoritative in `scopes` JSON.
- **Auth:** resolver-loaded issuer memberships are the only source for token effective authority; route handlers never create a parallel token check.
- **Parity:** route modules are `*.routes.ts`; `_manifest.ts` remains generated; `check:api` and existing claim ownership are extended rather than bypassed.
- **Webhook contradiction:** held for Orchestrator ratification because SPEC and the newer story/ticket wording disagree on the six-event names.
