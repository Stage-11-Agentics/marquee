# Plan Review: MRQ-132 · Attendee personal schedule

**Reviewer:** plan-review agent, 2026-08-12. Base verified at `github/main` = `6d8ee256` (PR #86 merged 2026-08-12T14:39Z).

## 1. Verdict

**FAIL (plan-level)**

To be clear about the scale of the failure: this is an **amendment pass, not a redesign**. The architecture, the state model, the sequencing, and the fidelity discipline are all right. Five concrete corrections are needed — three of them because the plan as written instructs the builder to do something the codebase actively contradicts, and two because a required registration step is missing and its omission is *silent* (no red test, no gate failure).

## 2. Summary

Reviewed the MRQ-132 build plan against the ratified design doc (`sequence/attendee-schedule-design.md`), the binding prototype, and the actual state of `github/main` — including the merged MRQ-120 card contract, the route/gate machinery (`scripts/checks/*`), and the existing ICS and rate-limit infrastructure. The plan is unusually strong on design fidelity and sequencing, and every base assumption it makes about MRQ-120 checks out (`data-public-session-id/-slug/-start/-day` all emitted at `PublicAgendaPage.tsx:309–312`; format/room facets and day/slot group headers present; `PUBLIC_AGENDA_SCRIPT` is the real pattern at `:113`).

The key concern is that the plan was written against the *design doc's* mental model of the codebase rather than the codebase: it points the builder at the wrong ICS module (a purpose-built public multi-VEVENT feed builder already exists), sanctions a bespoke rate limiter when `defineApiRoute` **requires** a first-class `RatePolicy` on every route, and omits two hand-maintained registration lists that a new D1 table must be added to — one of which fails silently.

## 3. Issues

**[CRITICAL] Architecture → Server: D1 + anonymous API — a new migration must be hand-registered in two places; one omission is silent**

The plan says "D1 migration + schedules API" (Sequencing step 4) and stops there. Two hand-maintained lists govern whether a new table actually exists:

1. `tests/integration/apply-migrations.ts` is an explicit `?raw` import list of every migration (currently `0001`–`0010`, fourteen imports). A migration file that is not added there does not exist in the vitest workers pool — every integration test touching `public_schedules` fails with "no such table," which reads as a broken API rather than a missing import. Loud, but wastes a debugging cycle.
2. `WIPE_ORDER` in `src/lib/reset-demo/reseed-demo.ts` ends `… "events", "organizations"`. A `public_schedules` row with `event_id REFERENCES events(id)` that is not wiped before `events` either breaks demo reset under FK enforcement or silently orphans rows. `WipeTable` is derived *from* `WIPE_ORDER`, so omission produces **no type error and no test failure** — it surfaces the next time an operator resets the demo.

**Recommendation:** Add an explicit plan step: name the migration `0011_public_schedules.sql`, add its `?raw` import to `tests/integration/apply-migrations.ts`, and insert `"public_schedules"` into `WIPE_ORDER` **above** `"events"`. Also bump the hand-maintained `expectedTables` list and the `assert.equal(expectedTables.length, 48, …)` count in `scripts/schema-verify.mjs:175–176` to 49 (that script is *not* wired into `pr-gate` or `package.json`, so this is housekeeping for the next person, not a gate).

---

**[MAJOR] Architecture → Server: D1 + anonymous API — the bespoke rate limiter contradicts a mandatory route field**

The plan says: "modest rate limit (per-IP, KV or in-memory per-isolate is acceptable for v1 — note the choice in the PR)." There is nothing to choose. `ApiRoutePolicy` in `src/api/route.ts` makes `rateLimit: RatePolicy` a **required field on every route**, with buckets `read | write | send | import` and keyings `principal | ip_submission`, enforced centrally (`src/api/rate-limit.ts`, `enforceRateLimit`, `applyRateLimitHeaders`). The anonymous-write precedent is exact: `src/routes/public-form.routes.ts:808` uses `policy: { auth: { kind: "public" }, rateLimit: { bucket: "write", keying: "ip_submission" }, concurrency: "none" }`. A hand-rolled per-isolate counter would be dead code sitting next to the limiter that actually runs, and per-isolate state on Workers is close to meaningless anyway.

**Recommendation:** Replace that clause with the concrete policies: `{bucket:"read", keying:"ip_submission"}` on GET (JSON and `.ics`), `{bucket:"write", keying:"ip_submission"}` on POST and PUT. Declare `429` in `errorResponses([...])` on all five routes. Delete the "note the choice in the PR" instruction — there is no choice to note.

---

**[MAJOR] Architecture → ICS — points at the wrong module; a public multi-VEVENT builder already exists**

The plan says to reuse `src/jobs/calendar/ics.ts` and "extend with a multi-VEVENT `VCALENDAR` assembler if the invite path only does single events." That assembler already exists as its own module: **`src/lib/public-ics.ts` → `buildPublicCalendarFeed(data, origin, now)`** — a `METHOD:PUBLISH` feed with `X-WR-CALNAME`/`X-WR-TIMEZONE`, per-session `UID:<id>@marquee.stage11.dev`, `URL` → `/s/:slug?event=…`, `LOCATION` → `roomLabel`, `STATUS:CONFIRMED`, `TRANSP:OPAQUE`, folded via the shared `foldIcsLine`/`escapeIcsText` from `ics.ts`. It is exactly the shape the plan describes building, already consumed by `src/routes/embed.route.tsx`. Following the plan literally produces a second multi-event assembler in a different module.

Two smaller notes in the same area, both settled by precedent rather than invention:
- `buildPublicCalendarFeed` emits UTC `DTSTART`/`DTEND` with no `VTIMEZONE`; `ics.ts` has a full `vtimezone()` + `localDateTime()` path with `TZID`. The plan asks for "TZID from the event's timezone." Pick one deliberately — UTC instants are correct and simpler for a subscription feed, and matching the existing public feed keeps one behavior across both public calendar surfaces.
- Serving `text/calendar` from a `*.routes.ts` OpenAPI module is fine and precedented: `src/routes/evaluation-results.routes.ts:161` declares `content: { "text/csv": { schema: z.string() } }` and returns a raw `Response`. Use that shape; do **not** reach for a `*.route.tsx` Hono module (`calendar.route.ts`'s `/i/:uid.ics` is the non-versioned legacy surface, allowlisted in `check-api.mjs`).

**Recommendation:** Rewrite the ICS section as: extend/parameterize `src/lib/public-ics.ts` for a session subset (and reuse it for the `{code}.ics` feed), reuse `buildCalendarLinks` from `src/jobs/calendar/ics.ts` for the Google/Outlook buttons on `/s/:slug`, and declare `text/calendar` responses in the `text/csv` shape above. Add a line ruling UTC-vs-TZID.

---

**[MAJOR] Public UI changes → For-agents doc — a new SSR page breaks the route-map gate and may be swallowed by the SPA**

The plan proposes "a small SSR page (e.g. `/agenda/agents` …)". Two consequences it does not name, and `pr-gate` runs the route map check as step 8:

1. `scripts/checks/check-routes.mjs` **generates** the route map from `src/ui/shell/route-table.ts`, the `isPublicPage` predicate in `src/ui/app.tsx`, and `src/routes/*.route.tsx`, then **diffs it against `docs/ROUTES.md` and exits non-zero on drift.** A new SSR page without `npm run check:routes -- --write` is a guaranteed gate failure.
2. `isPublicPage` (`src/ui/app.tsx:23–31`) matches `/agenda` by **exact equality** (`window.location.pathname === "/agenda"`). `/agenda/agents` matches nothing, and `src/index.ts` ends in `app.all("*", … ASSETS.fetch(…))` — the exact failure mode `check-routes.mjs`'s header docstring was written about ("`/site`, `/settings/webhooks`, and `/comms` all looked alive to a probe while being nothing at all").

**Recommendation:** Add to the plan: register the page in the `*.route.tsx` SSR module, extend `isPublicPage` (`startsWith("/agenda")` or an explicit `=== "/agenda/agents"`), regenerate `docs/ROUTES.md` with `check:routes --write`, and verify with a real `curl` that the path returns the SSR page and not the SPA shell. Note that `check:design` does **not** cover this — `verify-design-contract.mjs` deliberately scopes itself to the admin shell and exempts the public site.

---

**[MAJOR] Public UI changes → `data-public-session-end` — the obvious source field is the wrong one**

The plan and the design doc both call this "one line," citing `PublicSession.endTime`. But `endTime` (`src/lib/public-site.ts:74`, computed at `:610` via `zonedParts(...)`) is a **zoned display string** (`"14:30"`), while the existing sibling attribute emits epoch milliseconds (`data-public-session-start={session.startsAt}`, `PublicAgendaPage.tsx:311`). Client interval math over `"14:30"` strings silently misbehaves the moment two starred sessions sit on different days — which is precisely the overlap-chip case the ruled conflict pair exercises, and precisely the case a same-day e2e test would pass.

**Recommendation:** Specify the attribute as epoch milliseconds — `data-public-session-end={session.startsAt + session.durationMin * 60_000}` (`durationMin` is already on the projection at `:76`) — or emit `data-public-session-duration` and derive. Add a unit assertion that both `-start` and `-end` parse as finite numbers, and make the overlap test span a day boundary, not just adjacent slots.

---

**[MINOR] Architecture → Server API — `sessionIds` must accept slugs as well as ids**

The design doc's agent-native section rules: "**Session identity is stable and public (id + slug both accepted in `sessionIds`)** so agents can key off either the API or scraped page hooks." The plan's POST contract validates ids only ("validate sessions exist + published + belong to event; cap 200 ids"). This is a ruled requirement, and it is the difference between an agent using the documented JSON loop and an agent that scraped the card hooks both working.

**Recommendation:** Accept either form, normalize to ids on write, and add a test that a slug-keyed POST round-trips.

---

**[MINOR] Alignment — the register row the task description explicitly names is never updated**

The task description ends "Register rows 37/38, section T-J (post-eval product feature)," which resolves to `sequence/eval-response-tickets.md:298` — currently titled **"T-J · Personal attendee schedule — WON'T (for the eval window)."** The plan touches neither that section nor the register rows. Shipping the feature while the register says WON'T leaves the arc's own bookkeeping lying.

**Recommendation:** Add a doc step: flip T-J's status in `sequence/eval-response-tickets.md`, update rows 37/38, and add a line to `sequence/run-state.md`. Cheap, and the task description asked for it.

---

**[MINOR] Test plan — the AC claims file is required, not conditional**

The plan hedges: "`tests/ac-claims/MRQ-132.json` **if** the convention requires." It does. `pr-gate` step 10 runs `trace:ac --scope=merged --ticket=MRQ-132`, and `scripts/checks/trace-ac.mjs:38` emits `missing-current-ticket-manifest` when no claim file names the current ticket. The plan's instinct to mirror MRQ-120 is right — `tests/ac-claims/MRQ-120.json` is `{"ticket": "MRQ-120", "owns": [], "exercises": ["AC-83","AC-85","AC-89","AC-240"], "notes": "…"}`.

**Recommendation:** Make it unconditional. Note that a *wrong* AC id in `exercises` is a hard failure (it lands in `result.errors`), not a warning — so verify each id against `EVALUATION.md` rather than guessing. `AC-85` (agenda cold interactive) is the one to be careful about, since this ticket adds weight to that exact page.

---

**[MINOR] Missing — speed is a gate and this ticket adds bytes to the page it measures**

`SPEED_BUDGETS` (`scripts/checks/speed-budgets.mjs`) includes `agenda-cold-interactive`, p95 ≤ 1000 ms, `kind: "acceptance"`, source **AC-85** — an acceptance failure, not a warning. This ticket adds an inline script (state, mine-view, glance panel, NOW line, hover cards, four sheets, briefing generator, **plus an inline QR encoder**) to the public agenda page. `check:speed` is not in `pr-gate`'s ten steps, so nothing will catch a regression before merge — but R7 and AC-85 both will afterward.

**Recommendation:** Add a budget line to the plan: keep the script's contribution bounded, do all glance/mine-view work after first paint, and run `npm run check:speed` once during the validation gate as evidence. If the inline QR encoder is what pushes it, prefer the SSR data-URI variant the plan already offers as an alternative — or lazy-build the QR only when the phone sheet opens.

---

**[MINOR] Missing — no caching or `Cache-Control` story for the feed a calendar client polls forever**

The plan covers 404-on-unknown-code correctly (and rightly rejects the empty-VCALENDAR-for-404 trap), but says nothing about response headers. A subscribed calendar client re-fetches `{code}.ics` indefinitely. Existing public surfaces are explicit here: `calendar.route.ts` sets `no-store`, the embed path uses a KV cache with `purgePublicEmbedCache`.

**Recommendation:** Rule it in the plan — a short `Cache-Control` (e.g. `max-age=300`) on `{code}.ics` and `no-store` on the JSON, or the reverse with a documented reason. One sentence; otherwise it gets decided by omission.

---

**[MINOR] Sequencing — one PR carrying five phases against a 120 s gate**

The design doc estimated this at 3.5–4 delegator-days across five independently shippable slices (T-SCHED-0…4); the operator collapsed it to one ticket, which is settled and not for me to relitigate. But "one PR at the end" is the plan's own choice, not the operator's ruling, and phase 1 is explicitly self-contained ("lands even if later phases slip"). A single PR spanning a migration, five API routes, a large inline script, an SSR page, and both ICS artifacts is a hard review object.

**Recommendation:** Keep the one ticket; consider two PRs — phase 1 (`/s/:slug` add-to-calendar + ICS work) first, since the plan already asserts its independence, then the rest. If it stays one PR, say so deliberately and keep the per-phase commits clean enough to review commit-by-commit.

## 4. Positive Observations

- **Every base-state claim verified true.** MRQ-120's merge (PR #86, `6d8ee256`), the four card attributes, format/room facets, day/slot group headers, and `PUBLIC_AGENDA_SCRIPT` as the vanilla-script pattern all check out exactly as the plan describes. Plans that assert a base state are usually where review finds rot; this one was accurate.
- **Design fidelity is handled correctly, including the tie-break.** Naming the prototype as the binding visual contract *and* declaring "where prototype and this plan disagree on a visual detail, the prototype wins" removes the ambiguity that otherwise gets resolved by whichever artifact the builder read last. It also correctly follows the round-1 segmented-header ruling over the design doc's superseded §2 "toggle chip" text.
- **"Elements never jump" is operationalized, not cited.** "SSR reserves every slot the script later fills (star buttons, count badge, glance container, export row). Hydration flips state; it never inserts layout-shifting content above the fold" is a testable instruction. Worth noting the house rule is genuinely load-bearing here and the plan saw it.
- **The `#k` fragment discipline is right.** Never send the fragment, `history.replaceState` to strip it after capture, code=read / hashed-key=write, key returned once and stored only as SHA-256, `crypto.getRandomValues` for both. That is the correct security model for an explicitly no-login feature, and the 403-on-hash-mismatch and 404-on-unknown-code cases are both in the test plan.
- **The validation gate has teeth.** Driving the real dev server, downloading and linting both ICS artifacts, curling the JSON and the feed, and attaching evidence — "I saw it work, not it should work" — is exactly the real-artifact smoke discipline that a wall of green tests cannot substitute for. The 390px mobile check is named rather than assumed.
- **Overlap semantics called out precisely.** "touching ≠ overlapping" in the test plan is the kind of edge case that otherwise ships as an off-by-one users notice before tests do.
- **Good instinct on the empty-VCALENDAR trap** — explicitly ruling that a 404 feed must 404 rather than return a valid empty calendar prevents a subscribed client from silently showing an empty schedule forever.
