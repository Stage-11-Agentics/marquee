# MRQ-133: Sign in — the door the product promises and has never had, and a 401 that leads to it

Build the door that this product has been promising and never shipped: a sign-in page, and a 401 that leads to it.

WHY, HONESTLY: three surfaces already promise this page. The claim page tells a brand-new owner "No password, ever. Once mail is configured, sign-in links arrive by email" (src/routes/claim.route.tsx). The error taxonomy tells every operator "Your session has expired. Sign in again to pick up where you left off" (src/ui/shell/api-client.ts ERROR_TREATMENTS.unauthenticated). The API implements the whole flow already — POST /api/v1/auth/magic-link mints, mails, and in demo mode returns the link on screen; GET /api/v1/auth/exchange consumes it and sets the session. Nothing in the product calls any of it. There is no UI, on any surface, that requests a sign-in link. A returning organizer, reviewer, or speaker whose session is gone has NO door: /claim refuses forever once the instance is claimed, the demo doors 403 off a demo instance, and /join needs someone already inside to mint it. The documented recovery — re-run the claim-link CLI — is exactly the command that refuses after the first owner exists. Second defect, same story: an expired magic link renders a raw JSON envelope to a human. Verified live on marquee.stage11.dev — clicking a 16-minute-old link from your inbox shows {"error":{"code":"magic_link_invalid",...}} in the browser window.

OPERATOR RULINGS (Atin, 2026-08-12, live session — these are settled, do not relitigate):
1. PRE-deadline scope. Merge on green tonight. This is NOT MRQ-131's post-freeze band.
2. /signin is the UNIVERSAL door — every seat, every stranded state, one destination.
3. A 401 on a live screen raises an OVERLAY WALL over the current screen. It does not navigate, does not replace the page, does not redirect.
4. The landing page gains a "Sign in" link ONLY when the instance is not in demo mode. The demo landing is a graded surface tonight and must come out byte-identical.

READ FIRST, in order:
1. src/routes/claim.route.tsx and src/routes/claim.routes.ts — THE PATTERN, and the reason this ticket is small. A server-rendered, session-free page with its own Flight Deck chrome, an inert panel for a spent link, a hidden-field form posting to an API route, and inline styles in the module. Reproduce that idiom exactly. Do not invent a second page shape, and do not put this page in the admin bundle: it is reached with no session, which is the whole point.
2. src/routes/auth.routes.ts — requestMagicLink, exchangeMagicLink, demoLogin as they stand today.
3. src/lib/auth/magic-links.ts — isSafeRedirectTarget, the 15-minute login TTL, the atomic single-use consume. src/lib/auth/auth-sessions.ts for the 30-day session.
4. src/lib/instance-status.ts — mailConfigured(env). This is where the page's honesty comes from; the module deliberately touches no database and consults no stored flag, and this page must not either.
5. src/ui/shell/api-client.ts (onForbidden, the listener idiom to mirror) and src/ui/shell/seat.tsx (useSeat + SeatBlockedPage, the wall precedent).
6. DESIGN.md — Flight Deck, and "elements never jump". PHILOSOPHY.md — respect the operator; the organizer's language.

SCOPE, in build order:

1. THE PAGE. src/routes/signin.route.tsx, mounted in src/index.ts beside claimRoutes, added to the isPublicPage predicate in src/ui/app.tsx so the admin shell never mounts over it, then `npm run check:routes -- --write` to regenerate docs/ROUTES.md. /login and /sign-in resolve to the same page — humans and agents both guess URLs and each 404 costs a turn (MRQ-131 precedent). Four states, one page, all decided server-side so nothing flickers:
   a. Anonymous, mail configured — email field, one primary button ("Email me a sign-in link"), and after submit the generic acknowledgement, never a hint about whether the address exists.
   b. Anonymous, mail NOT configured — the form still renders, above an honest callout in the instance-status voice: this deployment cannot send mail yet, so a link will not arrive, with the exact fix line from INSTANCE_STATUS_FIXES.mail. A page that promises undeliverable mail is how a self-hoster gets locked out of their own conference.
   c. Demo instance (findDemoEvent) — additionally the three demo doors (organizer · reviewer · speaker), posting to POST /api/v1/auth/demo exactly as the landing script does, plus the on-screen magic link the API already returns in demo mode. A judge completes the real speaker-auth loop here in ten seconds.
   d. Already signed in — no form. "Signed in as {name} · {email}", a Continue button to that seat's home, and Sign out. Resolve the session server-side (resolveAuth); do not render a login form to someone who is logged in.
   A reason banner reads ?reason=expired | signed_out | session_ended. Copy is operational and blameless, per DESIGN's voice: no exclamation marks, no "Oops".

2. THE API, minimally widened. POST /api/v1/auth/magic-link:
   - event_id becomes OPTIONAL. When absent, resolve the person by email across people (oldest row wins). Comment it as the deliberate single-org shortcut, same posture MRQ-131 took for org-level writes; multi-org disambiguation is explicitly not this ticket.
   - Outbox attribution (outbox.event_id is NOT NULL and stays that way): the person's most recent membership event, else the newest event in that person's org. If the org has no event at all, mint nothing, enqueue nothing, and return the same generic body — never leak instance state through a differing response, and never surface a link on screen to compensate.
   - redirect_to: a safe ?next= (isSafeRedirectTarget — reject //evil.com, http://, protocol-relative) else the role home resolved at mint time: owner/program_lead/ops → /dashboard, reviewer → /reviewer, otherwise /portal.
   - Per-person cooldown: if an unused, unexpired login link for that person was minted in the last 60 seconds, do not mint or enqueue a second one. Same response either way. One query; it is what stops this route being a mail cannon aimed at any address someone can guess.
   - Move the rate-limit bucket from "write" to "send". The route sends mail; "send" is the bucket that means that.
   - The generic acknowledgement string stays verbatim.

3. THE EXPIRED LINK BECOMES A PAGE. GET /api/v1/auth/exchange, on missing/expired/used/unknown: if the request accepts text/html — a browser navigation, which is how every emailed link arrives — 302 to /signin?reason=expired, still dropping the rejected cookie. Otherwise the existing JSON 401, byte-unchanged, for API clients. Update the OpenAPI responses; `npm run check:api` parity must pass.

4. THE WALL. Add onUnauthenticated(listener) to api-client mirroring the existing onForbidden exactly — same Set, same unsubscribe shape, fired where the envelope code is "unauthenticated". AppShell subscribes and raises ONE overlay above whatever is on screen: their work stays visible behind it, nothing navigates out from under them. "Your session ended." / "Sign in again and you will come back to this page." Primary action → /signin?next=<current pathname+search>; secondary → Return to home. Sticky for the session so a burst of failing panels raises one wall, not six. It must never fire on public pages, and never inside PortalPage, CoSpeakerPage, or the claim pages — they own their own walls already.

5. WEAVE IT IN. Every stranded state in the product currently points at "/" and hopes:
   - PortalPage's 401 wall ("Return to sign in", src/ui/portal/PortalPage.tsx) → /signin?next=/portal.
   - CoSpeakerPage's expired-invitation state → /signin.
   - Landing nav gains "Sign in" ONLY when not demo_mode. The demo landing's markup is unchanged — diff it and prove it. UnclaimedLandingPage stays as it is: no accounts exist there yet, the claim link is correctly the only door.
   - Re-read ERROR_TREATMENTS.unauthenticated now that the door exists and the wall carries the action; keep it truthful, change wording only if the wall makes the old sentence redundant.

6. TESTS, inside the 45s suite budget. Prefer tests/node for pure logic; ONE new Worker-backed integration file, not several:
   - integration: event_id-less request resolves the person and enqueues one outbox row; unknown email returns the identical body and enqueues nothing; demo mode returns magic_link on screen; the 60s cooldown does not double-send; exchange with Accept: text/html 302s to /signin?reason=expired and clears the cookie; with Accept: application/json still returns the 401 envelope; /signin renders each of the four states.
   - node/unit: role-home resolution, ?next= safety rejections, outbox event attribution ordering.
   - client unit, beside tests/unit/client-error-handling.test.ts: onUnauthenticated fires on "unauthenticated" and not on "forbidden".
   - Gates: npm run check:routes (docs/ROUTES.md regenerated and committed), check:api, check:design, pr-gate.

REAL-ARTIFACT SMOKE — HARD GATE, NOT OPTIONAL. Green tests here would prove almost nothing: this is browser-cookie behaviour and the failure modes live in the browser. Drive the running Worker yourself and attach screenshots to the ticket:
   (1) Sign out of the admin shell → land on /signin → submit the demo organizer's address → follow the on-screen link → back inside /dashboard as that person.
   (2) A stale tab takes a 401 → the wall appears over the screen → Sign in → returns to the same path.
   (3) An expired link renders the page, not JSON.
   Run on a free port — 8787, 8801, 8802, 8803 and 8863 are taken, pick 8804+ — and pass `--var INSECURE_LOCAL_COOKIES:1`. Without it Safari and WKWebView drop the Secure cookie on http:// and you will 401 after a 200 login, in the browser only, while curl passes. This has cost this project real hours; see README.md and the comment block in src/lib/cookies.ts.

BOUNDARIES: no new dependencies. No password auth, ever. No change to session TTL, cookie flags, or the claim/invite exchange path. Do not migrate outbox.event_id to nullable. Do not touch the demo landing's existing markup. Keep the diff in auth.routes.ts surgical — MRQ-107 (reviewer provisioning, PR open) edits the same file's roleSchema and demo persona query, and MRQ-129 (multi-event, in progress) is reworking event context; rebase on github/main before you open the PR and again if either lands first.

NOT IN SCOPE: email verification, multi-org disambiguation, "remember this device", an account-settings surface, rate-limiter backend changes beyond the bucket swap and the per-person cooldown.

PROCESS: fresh worktree off github/main (the primary checkout is the board's home and stays parked on main). Commit early and often — a branch costs nothing and an agent that exits without committing loses real work. PR via `gh pr create --repo Stage-11-Agentics/marquee --base main`. Merge on green: this is pre-deadline scope by operator ruling.
