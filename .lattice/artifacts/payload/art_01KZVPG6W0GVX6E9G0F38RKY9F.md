# Plan Review — MRQ-128 (Restore the `/settings/webhooks` organizer surface)

Reviewed against `github/main` @ `75b871d9` (the tree the plan cites; note the primary
checkout's `main` is behind at `2aa398a0`, where `docs/ROUTES.md`, `check:routes`, and
the MRQ-106 test do not yet exist — every claim below is verified against `75b871d9`).

## 1. Verdict

**FAIL (plan-level)**

The gaps are narrow and fixable in a short amendment pass — no redesign — but two of
them would let the builder pass every gate the plan names while the defect this ticket
reports is still on screen, and one is an unresolved contract question (how a
`secret_hash`-only store signs a delivery) that the builder should not be left to
improvise under deadline.

## 2. Summary

The plan is unusually well-grounded: its factual claims about the tree check out
line-for-line (migration `0005` tables, `WEBHOOK_QUEUE` at `src/index.ts:43`, the
`assert.doesNotMatch(map, /`\/settings\/webhooks`/)` at
`tests/node/wave-0-sweep.MRQ-106.test.mjs:61`, the `--write` invocation string), and its
scope cut — CRUD + test-send + log, no dispatcher — is the right call for the hours
remaining and is stated honestly. The key concern is that step 5 ("register the route in
`src/ui/shell/route-table.ts` … follow those siblings exactly") is **necessary but not
sufficient**: `check:routes` generates `docs/ROUTES.md` *from* `route-table.ts`, so the
table entry alone flips the MRQ-106 assertion and the route map green while
`AppShell.tsx` still renders the empty state — i.e. the plan's own acceptance evidence
would go green on the exact defect the ticket filed. Secondary gaps: the
`secret_hash` / HMAC signing contradiction, and an acceptance section that stops at
`pr-gate` when the ticket explicitly asks for real-browser validation.

## 3. Issues

**[CRITICAL] §Scope item 5 "The route" — registering in `route-table.ts` does not render a page; `AppShell.tsx` is never mentioned**

`/settings/api` is served by **two** edits, not one: the `route-table.ts` row
(`src/ui/shell/route-table.ts:87`) **and** the branch in `AppShell.tsx`
(`const isApiTokens = location.pathname === "/settings/api"` at line 156, consumed in the
render ternary at line 234). A `/settings/webhooks` row with no matching branch falls to
the `EmptyState` at `AppShell.tsx:248` and renders **"Webhooks is ready for its module"** —
cosmetically different from the reported "This route is not installed", substantively the
same dead surface. Worse, this failure is invisible to the plan's stated gates:
`check-routes.mjs` reads `route-table.ts`, `app.tsx`, and `src/routes/*.route.tsx` as its
only sources, so `docs/ROUTES.md` will list `/settings/webhooks` and the MRQ-106
assertion will pass regardless of whether a page component exists. "Follow those siblings
exactly" is actively misleading here, because it points at the half of the sibling pattern
that the generator can see.

**Recommendation:** Rewrite step 5 to name both edits and the new file explicitly:
(a) create `src/ui/settings/WebhooksPage.tsx`; (b) add the `route-table.ts` row in the
`utility` group; (c) add the branch to the `AppShell.tsx` render chain next to
`isApiTokens`. Add an acceptance line that the rendered page contains endpoint
management controls and **must not** contain the string `is ready for its module`.

**[CRITICAL] §Scope item 2 vs item 3 — "store `secret_hash`, never the secret" cannot coexist with "signs and POSTs"**

HMAC-SHA256 over `id.timestamp.body` (SPEC §4.2) requires the signer to hold the same
value the receiver holds. If only `sha256(secret)` is persisted, a test-send can produce a
signature the endpoint owner cannot verify — a green test over a signature nobody can
check is exactly the defect class this repo's gates exist to prevent. The migration column
is literally named `secret_hash` and the plan forbids a migration, so the builder has no
escape hatch and will improvise one of: storing plaintext in a column named `_hash`,
signing with the digest, or shipping an unverifiable signature.

**Recommendation:** Rule on this in the plan. The cheapest honest resolution inside the
no-migration constraint is: **sign with `sha256_hex(secret)` and document that derivation
in the shown-once panel and in the PR body** — the receiver can compute it from the secret
it was shown, the stored column stays a digest, and no schema change is needed. Whatever
is chosen, state it explicitly and require the delivery-log/UI copy to describe the exact
signing input.

**[MAJOR] §Acceptance — no real-browser validation, though the ticket demands it**

The task description ends with "validate the real browser path, rather than treating the
SPA 200 as success," and the plan's acceptance stops at "`npm run pr-gate` green." Given
the finding above, `pr-gate` is precisely the oracle that cannot see this defect.

**Recommendation:** Add to acceptance: run `npx vite dev`, sign in, visit
`/settings/webhooks` in a browser, and capture evidence of the rendered surface (endpoint
list + add form), one create, one test-send, and the resulting delivery row in the log.
Also note explicitly that **merging does not ship** (`DEPLOY.md`) — closing the live
defect the ticket observed requires a separate deploy step, and no migration apply is
needed because `0005` is already in the deployed range (verify with
`git diff --name-only <deployed-sha> github/main -- migrations/`).

**[MAJOR] §Scope item 3 "Test-send" — `webhook_deliveries.event_type` has a six-value CHECK, and the plan forbids migrations**

`migrations/0005` constrains `event_type IN ('submission.created', 'submission.status_changed',
'evaluation.completed', 'speaker_task.completed', 'agenda.published', 'speaker.confirmed')`.
The natural implementation of "writes a real `webhook_deliveries` row" for a test send —
`event_type: 'test'` or `'webhook.test'` — fails the CHECK at runtime, and the plan
correctly rules out changing the schema. Nothing in the plan warns about this.

**Recommendation:** Specify that a test-send writes a row using one of the six allowlisted
names (the endpoint's first subscribed event is the obvious choice) with a synthetic
payload, and that the UI labels it as a test in copy rather than in `event_type`. Add a
test asserting a test-send against each of the six subscriptions inserts successfully.

**[MAJOR] §Scope item 1 "CRUD API" — no auth policy, no route paths, no file named**

Every API module in this repo declares an explicit policy — e.g.
`policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: …, concurrency: … }`
(`src/routes/venues.routes.ts:38,57`) — and `API_GRANTS` (`src/api/grants.ts`) has **no
webhook grant**. `tokens.routes.ts` solves the analogous secret-bearing case differently:
`requireTokenAdmin` rejects anything that is not an organizer *session* at program-lead or
above. Which model applies here is a real decision (webhook endpoints are as
security-sensitive as API tokens), and the plan leaves it entirely open. The plan also
never names the route file or the URL shapes; SPEC §4.2 registers
`GET/POST /webhooks`, `PATCH/DELETE /webhooks/:id`, `POST /webhooks/:id/test`,
`GET /webhooks/:id/deliveries`, which the plan's "scoped to an event" phrasing should be
reconciled with (the served surface is `/api/v1/events/{eventId}/…`).

**Recommendation:** Name the file (`src/routes/webhooks.routes.ts` — registration is by
glob via `src/routes/_manifest.ts`, so no manifest edit is needed and OpenAPI comes from
`defineApiRoute`), fix the exact paths, and rule the auth model — recommend copying
`tokens.routes.ts`'s session-plus-program-lead check rather than minting a new grant,
since a new grant value touches the token scope enum and its tests.

**[MAJOR] §Explicitly OUT of scope — AC-241's evaluation contract is broader than this build, and the plan does not say how to tag tests**

`EVALUATION.md:589` defines AC-241 as `auto`: "endpoint CRUD/test/log; six-event
allowlist; **queued retry/backoff**; HMAC verifies over `id.timestamp.body`; **replay
idempotency** prevents a second effect." The plan's cut (no dispatcher, no queue) is the
right one, but it leaves AC-241 partially met — and `trace:ac` requires every test title
to be prefixed `AC-nnn · ` (`scripts/checks/trace-ac-core.mjs`), so a builder who tags
new tests `AC-241 · …` will have the traceability tooling report a criterion as covered
when retry/backoff and replay idempotency are not built. That is the same
green-over-dead-feature failure the repo's gates exist to stop.

**Recommendation:** State in the plan which AC the new tests may claim and which parts of
AC-241 remain open; require the PR body (and, if there is a status column for it, the
board) to record AC-241 as **partial — CRUD/test/log only, dispatcher deferred**.

**[MINOR] §Scope — the surface will have no entry point**

`grep` for `/settings/api` across `src/` finds only the route table and the `AppShell`
branch: there is no link to it anywhere in the UI, while `EventSettings.tsx` gives Venues
and Tasks real "Open →" buttons (lines 284, 289). Copying the API-tokens sibling
"exactly" therefore ships a page reachable only by typing the URL — thin against
`SITEMAP.md`, which places Webhooks under Settings, and against "respect the operator."

**Recommendation:** Add one card/button in `EventSettings.tsx` matching the Venues and
Tasks pattern. Cheap, and it makes the browser validation above a click-path rather than
a URL-paste.

**[MINOR] §Test-send — no bounds on an outbound request to a user-supplied URL**

Test-send `fetch`es an arbitrary organizer-supplied `https://` URL from the Worker. With
no timeout, a slow or hanging endpoint stalls the request; with no error handling, a
non-2xx or network failure throws instead of recording a `failed` row — which would make
the delivery log unable to show the failure it exists to show.

**Recommendation:** Specify `AbortSignal.timeout(...)`, `redirect: "manual"`, capture of
`response_code` and a truncated `error`, and that transport failures write
`status: 'failed'` rather than propagating a 500. Add a test for the failure path.

**[MINOR] §Sibling boundary — file-name collision risk with MRQ-79**

`mrq-79-inbound-resend-webhook` exists as a branch (currently no commits ahead of
`75b871d9`). Both tickets plausibly reach for `src/routes/webhooks.routes.ts`.

**Recommendation:** Claim the filename explicitly in the plan (or take
`webhook-endpoints.routes.ts`) so the boundary is mechanical rather than social.

## 4. Positive Observations

- **The "verified, not assumed" opening is exemplary.** Every claim I re-checked held
  exactly — the migration's tables and CHECKs, the `WEBHOOK_QUEUE` binding, the shape of
  the `git grep` result, and the reframing from "restore a regressed page" to "the surface
  was advertised and never built." That reframing is the single most valuable thing in the
  plan, and it is correct.
- **The TRAP section is the right instinct, precisely aimed.** The MRQ-106 assertion is
  quoted verbatim from `tests/node/wave-0-sweep.MRQ-106.test.mjs:61`, the `--write`
  invocation matches the string that same test asserts against `docs/ROUTES.md`, and
  "that assertion will fail when you succeed, and that is correct" is exactly the guidance
  that stops a builder from doing the wrong repair under time pressure.
- **The out-of-scope ruling is honest and load-bearing.** Cutting the dispatcher, saying
  so plainly in the PR body, and grounding it in "a screen must never claim more than it
  does" is the right trade for the hours available and the right way to record it.
- **Sibling boundaries and the no-migration finding** are both correct and save the
  builder real time — `webhook_endpoints` and `webhook_deliveries` genuinely need nothing,
  and the "shares the word webhook" warning about MRQ-79 is a collision this fleet would
  otherwise have hit.
