# MRQ-133 — Sign in: the universal door, and a 401 that leads to it

Branch `mrq-133-signin`, worktree `Marquee-worktrees/mrq-133-signin`, cut from `github/main`.

## Shape of the change

Six blocks, built in the ticket's order. Nothing here invents a second page idiom:
`/signin` is `claim.route.tsx` with different states.

### 1. `src/routes/signin.route.tsx` — the page

Server-rendered outside the SPA, exactly like the claim page: module-local
`SIGNIN_STYLES` / `SIGNIN_SCRIPT`, the built asset shell for chrome with the
same honest `FALLBACK_DOCUMENT`, `Cache-Control: no-store`.

Three literal `.get()` registrations — `/signin`, `/login`, `/sign-in` — written
out one per line rather than looped, because `check:routes` reads
`.get("…")` literals out of `*.route.tsx` and a loop is invisible to it (that is
why `/claim/:token` is missing from `docs/ROUTES.md` today).

State is decided entirely server-side, so nothing flickers:

- `resolveAuth(context)` → signed-in state (no form; "Signed in as {name} ·
  {email}", Continue → safe `?next=` else role home, Sign out).
- `mailConfigured(context.env)` → the honest callout with
  `INSTANCE_STATUS_FIXES.mail`, above a form that still renders.
- demo event present → the three demo doors posting `/api/v1/auth/demo`, plus the
  on-screen link the API already returns in demo mode.
- `?reason=expired | signed_out | session_ended` → a reason banner. Operational,
  blameless, no exclamation marks.

`app.tsx`'s `isPublicPage` gains the three paths (three `pathname === "…"`
clauses so the `check:routes` parser's clause count still balances), then
`npm run check:routes -- --write` and commit `docs/ROUTES.md`.

`findDemoEvent` moves to `src/lib/demo-event.ts` and both `auth.routes.ts` and
the new page import it — a one-import, six-deleted-line change in a file two
other tickets are editing.

### 2. `POST /api/v1/auth/magic-link`, minimally widened

- `event_id` optional; absent → resolve the person by email across `people`
  (oldest row wins), commented as the deliberate single-org shortcut.
- Outbox attribution (`outbox.event_id` stays NOT NULL): most recent membership
  event, else newest event in the person's org, else **mint nothing, enqueue
  nothing, same generic body**. The choice is a pure function
  (`pickOutboxEventId`) over two ordered row lists so the ordering rule is
  unit-testable without a database.
- `redirect_to`: safe `?next=` via `isSafeRedirectTarget`, else role home at mint
  time — owner/program_lead/ops → `/dashboard`, reviewer → `/reviewer`, else
  `/portal`.
- 60-second per-person cooldown on unused, unexpired `login` links. One query.
  Same response either way.
- Rate-limit bucket `write` → `send`.
- The acknowledgement string is unchanged, verbatim.

A cooldown consequence worth stating: a second demo submit inside 60s mints
nothing, so it carries no `magic_link`. The page therefore only *replaces* the
on-screen link when the response has one — it never blanks a link already shown.
That keeps the demo honest and keeps the panel from jumping.

### 3. `GET /api/v1/auth/exchange` — the expired link becomes a page

On missing/expired/used/unknown: if `Accept` contains `text/html` (every emailed
link), drop the rejected cookie and 302 to `/signin?reason=expired`. Otherwise the
existing JSON 401, byte-unchanged. OpenAPI responses updated; `check:api` parity
must pass.

### 4. The wall

`onUnauthenticated(listener)` in `api-client.ts`, mirroring `onForbidden` exactly
— same `Set`, same unsubscribe shape — fired where the envelope code is
`unauthenticated`.

`AppShell` subscribes and raises ONE overlay above whatever is on screen, using
the existing `modal-backdrop` / `modal` classes so it needs no new CSS and cannot
drift from Flight Deck. Sticky for the session. Suppressed on `/portal` and
`/co-speaker` (they own their own walls); it cannot reach public pages or the
claim pages at all, since `app.tsx` never mounts the shell there.

Copy: "Your session ended." / "Sign in again and you will come back to this
page." Primary → `/signin?next=<pathname+search>`; secondary → Return to home.

### 5. Weave

- `PortalPage` 401 wall → `/signin?next=/portal`.
- `CoSpeakerPage` expired invitation → `/signin`.
- Landing nav gains "Sign in" **only when no demo event exists**. `LandingData`
  gains `demoMode`; the seeded demo takes the identical branch it takes today, so
  its markup is byte-identical — proven by diff in the PR.
- `UnclaimedLandingPage` untouched.
- `ERROR_TREATMENTS.unauthenticated` re-read and kept: it is still true, it is
  used by banners the wall does not cover, and the wall carries its own action.

### 6. Tests

- `tests/integration/signin.MRQ-133.test.ts` — one Worker-backed file: event_id-less
  resolve + one outbox row; unknown email identical body and no row; demo returns
  `magic_link`; the 60s cooldown does not double-send; `Accept: text/html` 302s to
  `/signin?reason=expired` and clears the cookie; `Accept: application/json` keeps
  the 401 envelope; `/signin` renders each of the four states.
- `tests/unit/signin-destination.MRQ-133.test.ts` — role home, `?next=` safety
  rejections, outbox attribution ordering (pure functions).
- `tests/unit/client-error-handling.test.ts` gains `onUnauthenticated` fires on
  `unauthenticated` and not on `forbidden`.

## Real-artifact smoke — hard gate

Local Worker on a free port (8804+), `--var INSECURE_LOCAL_COOKIES:1`, driven in
c11's embedded browser with real clicks, screenshots attached to the ticket:

1. Sign out of the admin shell → `/signin` → submit the demo organizer's address
   → follow the on-screen link → back inside `/dashboard` as that person.
2. Stale tab takes a 401 → the wall appears over the screen → Sign in → returns to
   the same path.
3. An expired link renders the page, not JSON.

## Gates

`npm test` (45s), `npm run pr-gate` (120s), `check:routes` with `docs/ROUTES.md`
committed, `check:api`, `check:design`. Rebase on `github/main` before opening the
PR and again before merging. Self-review pass over the diff before merge.
