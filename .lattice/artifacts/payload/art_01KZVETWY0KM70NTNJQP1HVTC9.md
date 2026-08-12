# Code Review: MRQ-132 · Attendee personal schedule

Reviewer: independent Claude review agent (cold context).
Branch: `mrq-132-attendee-schedule` @ `4f76067f` (5 phase commits on `github/main`).
Verified locally in the worktree: `npm test` → 153 pass / 0 fail, 29.9s (budget 45s); `npm run pr-gate -- --ticket MRQ-132` → **pass**, 32.7s (budget 120s), AC trace 0 uncovered.

---

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the architecture is the right one — the defects below are localized to the client module and to which routes load it. Nothing here calls for re-planning.

## 2. Summary

I reviewed the full diff (migration, schedule API, ICS builders, SSR surfaces, the 952-line vanilla client module, and the tests) and cross-checked the parts the diff cannot show — `[hidden]` semantics under the public stylesheet, `allDays` on `loadPublicAgenda`, rate-limit enforcement, script injection per route. The craft is genuinely high: the server side is clean, well-tested, and correctly scoped; the ICS work is the best part of the change, and the QR golden test is an unusually honest piece of testing.

The key finding is a permanent trap on the client: every export path posts the raw localStorage star set, the API rejects the whole set with a 422 if **any** starred session has been unpublished since, and the client swallows the failure. One pulled talk — routine at a live conference — permanently breaks .ics download, the QR handoff, share, and the calendar feed for every attendee who starred it, with an error message that says "try again in a moment." Two smaller-but-visible issues follow it: the "My schedule (n)" badge is hard-zero on three public pages that render it without the script, and the rate limit the plan asked for is declarative only — no limiter adapter exists in this codebase, so `POST /api/v1/public/schedules` is an anonymous, unbounded, un-CAPTCHA'd row-creation endpoint.

## 3. Issues

**[MAJOR] src/ui/public/agenda/schedule-script.ts:735,757 — A single unpublished starred session permanently breaks every export path**

`ensureCode()` posts `sessionIds: [...starred]` and `pushUpdate()` PUTs the same raw set. The API (`src/routes/public-schedules.routes.ts:59-66,107-113`) rejects the *entire* request with 422 if any id is not a currently-published session of the event. Stars live in localStorage indefinitely, and sessions get unpublished, replaced, or re-slugged mid-conference all the time.

Failure scenario: an attendee stars `sub-memory` on Monday. The organizer pulls that talk on Tuesday. On Wednesday the attendee taps "Download .ics" → `ensureCode()` → 422 → rejection → `failSheet('share')` shows *"That did not reach the server. Your stars are safe on this device — try again in a moment."* Same for "Open on your phone" and "Subscribe / share." It never recovers: the stale id is never pruned, so every retry fails identically, forever, and the copy actively misdirects the user to retry. The attendee's only exit is clearing site data. For an attendee who already had a code, `pushUpdate()` hits the same 422 — see the next issue.

Note the fix is *not* "prune `starred` to the rendered cards": `toggleStar` fires on the facet-filtered agenda view too, where `cardsById` is a filtered subset, so pruning there would silently delete legitimate stars.

**Fix:** make the client self-healing off the server's own answer. Have the write endpoints return the unresolvable ids as a structured field (e.g. `error.details.unknownSessionIds`) rather than only naming up to 10 in a prose message; in the client, on a 422, remove exactly those ids from `starred`/localStorage, `paint()`, and retry once. Keep the 422 for agents — it is the right answer for them.

---

**[MAJOR] src/ui/public/agenda/schedule-script.ts:750-758 — `pushUpdate` never checks the response and never retries, so the live feed can diverge silently and permanently**

The debounced PUT is fire-and-forget with `.catch(() => {})`. A rejected promise is the *only* thing caught — a 422 or 403 response resolves normally and is discarded unexamined. And there is no retry on the offline path either: the comment says "the feed catches up next time," but there is no next time unless the attendee happens to toggle another star.

Failure scenario: the attendee is on conference-hall wifi (the design's own stated premise) and unstars a session. The PUT fails. The device is correct; the code, the shared link, and the subscribed calendar feed all keep showing a session they removed, indefinitely. The feed is the flagship of this feature and it is the surface that goes stale.

**Fix:** check `response.ok`; on a transient failure set a dirty flag and re-attempt on the next `visibilitychange`/`online` event (and after the next successful `ensureCode()`), so the device's truth eventually reaches the code. On a 422, apply the pruning from the issue above.

---

**[MAJOR] src/ui/public/agenda/PublicAgendaPage.tsx:360,393 — The "★ My schedule (n)" count is hard-zero on `/speakers`, `/p/:slug`, and `/agenda/agents`**

`PublicShell` now renders `ViewSegments` unconditionally, but only two routes load the module or stamp the root config: `/agenda` and `/s/:slug` (`src/routes/public-agenda.route.tsx:93,135`). `/speakers` (line 110), `/p/:slug` (line 139), and `/agenda/agents` (line 96-107) render the badge with no script — and even if the script were added, it early-returns because those pages pass no `schedule` prop, so `[data-public-schedule]` is absent.

Failure scenario: an attendee stars six sessions, taps "Speakers", and the header reads "★ My schedule 0". Nothing is broken behind the link, but the site is stating a wrong number as fact in fixed-width tabular numerals — precisely the kind of quiet lie the "elements never jump / accessible truth can't disagree with paint" discipline elsewhere in this change is guarding against. It is most visible on `/agenda/agents`, the page the new footer link points every reader at.

**Fix:** pass a `schedule` config (event slug/name/timezone, `days: []`, `view: "agenda"`) from `PublicSpeakerDirectoryPage`, `PublicSpeakerPage`, and `PublicAgentsPage`, and add `PUBLIC_SCHEDULE_SCRIPT` to those three routes — the module's `paintStars()` path costs nothing when there are no cards. Alternative if you'd rather not ship the script everywhere: SSR the count slot empty and let it stay empty off the agenda, rather than rendering `0`.

---

**[MAJOR] src/routes/public-schedules.routes.ts:68 — The rate limit the plan required does not exist; this is an anonymous unbounded write endpoint**

`policy: { rateLimit: { bucket: "write" } }` is vocabulary, not enforcement. `runtime.rateLimiter` is never assigned anywhere in `src/` — `src/api/router.ts:196` falls back to `allowAllRateLimiter`, which allows everything and only emits truthful-looking headers. So `POST /api/v1/public/schedules` accepts unlimited anonymous requests, each writing a permanent D1 row, with no Turnstile (the only comparable anonymous write in the product — public form submission — does verify Turnstile, `src/routes/public-form.routes.ts:16`) and no retention sweep for rows nobody ever reads again.

The plan asked for a "modest rate limit (per-IP, KV or in-memory per-isolate is acceptable for v1 — note the choice in the PR)"; what shipped is neither, and the PR does not note that the policy is inert. The unenforced-limiter situation is repo-wide and not this ticket's fault, but this ticket is the first route to depend on it for *storage* rather than just for compute.

**Fix:** at minimum, say plainly in the PR that the limiter is a no-op today. Better: install a small KV/in-memory limiter for the `write` bucket keyed on `cf-connecting-ip` (the keying already resolves to `ip:` for anonymous principals, `src/api/rate-limit.ts:52-59`), or require a Turnstile token for creation. Also worth a follow-up ticket: a retention rule for schedule rows, since nothing ever deletes them outside a demo reset.

---

**[MINOR] src/ui/public/agenda/schedule-script.ts:729-745 — Stars toggled during the initial POST are lost from the server copy**

`ensureCode()` snapshots `[...starred]` at request time; while it is in flight `state.code` is null, so `pushUpdate()` returns immediately at line 751 and the toggle never reaches the server. The code is then created holding a set the device has already moved past, and stays wrong until the next unrelated toggle.

**Fix:** call `pushUpdate()` unconditionally in `ensureCode()`'s success handler (or compare the posted set with `starred` and push if they differ).

---

**[MINOR] src/ui/public/agenda/schedule-script.ts:216,287 — The NOW rule and the Next chip are painted once and never tick**

`paintGlance` and `paintNextChip` read `Date.now()` at hydration only, and nothing re-runs them. The itinerary is exactly the page an attendee leaves open on a phone all morning; by 11am the red NOW rule is sitting at 09:00 and "Next" is on a session that ended an hour ago. The plan called for a real clock, and a wrong clock is worse than none.

**Fix:** `setInterval(() => { paintNextChip(mineSessions()); paintGlance(mineSessions()); }, 60_000)` when `MINE`, guarded on `document.visibilityState`.

---

**[MINOR] src/ui/public/agenda/schedule-script.ts:767-772 — `failSheet` destroys the sheet's explanatory copy permanently**

It overwrites the sheet's first `<p>` with the error text and never restores it. After one transient failure, a later *successful* "Subscribe / share" shows "That did not reach the server…" above two perfectly good URLs.

**Fix:** capture the original text once (or render a dedicated `[data-schedule-error]` slot, hidden by default) and clear it on success.

---

**[MINOR] src/ui/public/agenda/schedule-script.ts:839-856 — A sync link is adopted silently, and the device's existing stars are pushed into the stranger's code**

Any visitor arriving at `/agenda?sched=<code>#k=<key>` has their device bound to that code, their existing stars unioned into it, and the union PUT to the server — with no confirmation and no visible indication that this device now shares a schedule. Whoever crafted the link holds the code and can read back everything the visitor had starred.

The stakes are low (conference picks, no PII, no account) and the sync semantics are what the plan specified, but the *silence* is the part that wasn't specified: the share path gets a banner and a deliberate "Import a copy" tap, and the strictly more consequential path gets neither.

**Fix:** reuse the import banner for keyed links — "This link syncs both devices to schedule MQ-… — link this device?" — and adopt on tap. At minimum, show the adopted code somewhere after the fact so the state is discoverable.

---

**[MINOR] tests/ — no browser-level coverage of a 952-line client module**

The plan's test plan called for Playwright specs (star → count → reload persists; segment switch → mine view filters + glance + empty state; conflict chips; origin-preserving back-nav; the share/import two-device flow). None shipped. In fairness the repo has **no** `tests/e2e` directory at all — `playwright.config.ts` points at a `testDir` that does not exist — so this is a standing gap rather than a regression. But it means the entire itinerary, the sheets, the sync loop, and every issue above are unexercised by anything; the only client-side test is the QR golden matrix, and the server tests assert SSR strings.

**Fix:** land the star → count → reload spec and the segment-switch spec as the first two files in `tests/e2e/`, or state explicitly in the PR that e2e is deferred repo-wide so the gap is a recorded decision rather than an omission.

---

**[MINOR] src/ui/public/agenda/schedule-script.ts:355-365 — Sheets are `aria-modal="true"` with no focus trap and no focus restore**

`openSheet` focuses the first control and Escape closes, but Tab walks straight out into the page behind the scrim, and closing drops focus to `<body>` instead of returning it to the button that opened the sheet. Keyboard and screen-reader users get a dialog that claims to be modal and isn't.

**Fix:** trap Tab within the open sheet and restore focus to the invoking `[data-schedule-action]` button in `closeSheets()`.

---

**[MINOR] src/ui/public/agenda/schedule-script.ts:203-206 — A session crossing local midnight renders a broken glance block**

Block geometry uses `zoneParts(start).minutes` and `zoneParts(end).minutes` — minutes-since-local-midnight. A 23:30–00:30 session yields `end < start`; the height is clamped to the 30-minute floor by `Math.max` at line 227, so it draws a stub block in the wrong place, and it also drags `axisStart` down to 00:00, stretching the axis for every other day. Rare for a conference program, but a late party/social item is not exotic.

**Fix:** compute end minutes as `start.minutes + (end - start) / 60_000` and clamp the drawn block to the axis end.

---

**[MINOR] src/routes/public-agenda.route.tsx:85-93 — `?view=mine` loads the entire published program on every visit**

The itinerary requests `allDays: true` with every facet dropped, ships the whole program to the browser, and hides all but the starred rows. Correct by design (the server cannot know the starred set, and a facet-filtered itinerary would miscount), but it is the one place in this change that scales against R7. At AIE NYC size it is a non-issue; at a 600-session program it is a heavy page for a 6-row view.

**Fix:** nothing now — worth a note in the PR so the tradeoff is a recorded decision, and a follow-up if program size ever grows.

## 4. Positive Observations

- **The ICS work is exemplary.** One `buildPublishedCalendar` serving the single-session download and the live feed means those two can never drift, and the reasoning for `METHOD:PUBLISH` over the invite builder is written down where the next reader will need it. `src/lib/public-calendar.ts` is a genuinely well-drawn seam.
- **The route-shape comments earn their space.** Both `/{slug}/calendar.ics` docblocks explain that `{slug}.ics` would register as a Hono parameter named `slug.ics` and shadow the JSON sibling — and there is a test named after exactly that failure. That is the difference between a comment and institutional memory.
- **The ICS test data is hostile on purpose and for the right reasons.** RFC 5545 separators, an em dash, diacritics, hard newlines, plus an octet-length assertion on every folded line — this is what folding bugs actually look like, and the test would catch them.
- **The QR golden test is the most honest test in the diff.** It names both bugs the encoder had on the way in, pins a matrix verified by two independent decoders, and instructs the next author to redo that verification rather than edit the expectation. That is precisely the right treatment for code that cannot be checked by reading it.
- **The security posture on the schedule API is careful and correct**: write key returned once and stored only as SHA-256, constant-time comparison, 65-bit codes drawn from `crypto.getRandomValues` with a modulo that happens to be bias-free (256 % 32 == 0), a read-aloud-safe alphabet, PUT scoped to the code's own event so foreign session ids cannot be smuggled in, a 404 (not an empty VCALENDAR) for an unknown feed with a test asserting exactly that, and the write key never appearing in any read response — also asserted.
- **The server is genuinely well tested**: CRUD happy path, 403 on wrong key, 404 on unknown code, 400 on malformed code, 422 on unpublished, the 200-session cap, an emptied-set-is-legal case, live-feed freshness across a PUT, code/key freshness across 8 draws, and the operator-only `access_note` verified absent from every public surface.
- **The migration is clean and additive**, with a `json_valid`/`json_type` CHECK on `session_ids`, a sensible `(event_id, updated_at DESC)` index, demo-reset wiring in `WIPE_ORDER` *and* a `DELETE_PLANS` entry, and a `reset-demo` count assertion pinning it at 0 — the reset story was handled without being asked.
- **`[hidden]` actually works here.** I specifically checked whether the SSR-hidden slots (`display: grid`/`flex` on `.public-filters`, `.sched-summary`, `.glance`, `.public-agenda-row`) would defeat the UA `[hidden]` rule — `src/styles/tokens.css:136` carries `[hidden] { display: none !important; }`, so they don't. And the module is injected as a classic inline script at `</body>`, so the un-hide lands before first paint rather than as a visible jump.
- **The reserve-then-fill discipline is followed throughout** — fixed-width count badge, 58px summary, fixed axis height, `aria-pressed` as the single source of both state and paint — and `overflow-wrap: anywhere` on public prose is the kind of unglamorous fix that only comes from actually looking at a real abstract on a real phone.
- **`/agenda/agents` as a page rather than a sheet** is the right call, argued in one paragraph, and the test asserts every endpoint and hook name appears on it. `ROUTES.md`, the public-page predicate in `app.tsx`, and the route-summary text block were all updated in the same breath — the generated-route gate passes because the change was done properly, not because it was worked around.
