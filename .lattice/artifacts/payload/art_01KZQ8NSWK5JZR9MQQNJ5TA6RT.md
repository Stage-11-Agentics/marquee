# Plan Review: MRQ-7 — Public landing page with live pipeline preview

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The plan correctly scopes the landing route to a single SSR module, uses the right file-naming convention (`*.route.tsx` is a pre-declared but previously-unused SSR pattern in `_manifest.ts`), and its "split from M-05a" rationale checks out against the seed (all four aggregate categories — submissions, agenda rows, speaker tasks, track assignments — are non-empty in the seed). However, the plan does not resolve how the existing client bundle (`src/ui/app.tsx`, which unconditionally mounts `AppShell` into `#app` on every page and has no `/` entry in `routeTable`) coexists with server-rendered landing content, and it never specifies where the client-side JS lives that turns the demo anchors into "POST then navigate" actions. AC-4's defined test methodology (an e2e BFS crawler) is also not matched by the plan's proposed "focused integration coverage." These are load-bearing gaps, not polish items — each risks either a broken/overwritten landing page or an unmet AC.

## 3. Issues

```
**[CRITICAL] Scope / Mount the SSR route — client bundle will overwrite or crash on the SSR landing page**
`src/ui/app.tsx` unconditionally does `document.getElementById("app")` and renders `<AppShell />`
on every path, throwing "Marquee app root is missing" if no `#app` element exists. `AppShell`
dispatches via `matchRoute()` against `src/ui/shell/route-table.ts`, which has **no entry for `/`**
— so if `#app` is present, AppShell renders its "This route is not installed" empty state into it.
The plan says it will "preserve [app.tsx's] rendered root ... so the client bundle supplies the
token/component CSS without replacing the server-rendered landing," but doesn't explain the
mechanism: if landing.route.tsx omits `#app`, the client script throws (uncaught, on every load);
if it includes `#app`, AppShell will render an empty/error state into or over it, which is exactly
the replacement the plan says it avoids. Neither branch matches "without replacing."
**Recommendation:** Specify the actual mechanism before implementation — either (a) add a `/`
entry to `routeTable` that renders nothing/null so AppShell mounts inertly, (b) split token/component
CSS loading out of app.tsx's side-effectful bootstrap so the landing page can `<link>` the CSS
directly without executing the AppShell mount, or (c) don't load the client bundle's boot script on
`/` at all and instead inline only the CSS. Pick one and state it in the plan.
```

```
**[CRITICAL] Scope — demo anchor "POST then navigate" behavior has no stated implementation home**
`/api/v1/auth/demo` returns JSON with a `Set-Cookie`, not a redirect (`src/routes/auth.endpoints.ts:24-71`).
No client code anywhere currently calls this endpoint — the only caller today is the integration
test. For the plan's "Demo anchors will POST the existing organizer/speaker roles, then navigate to
`/submissions`" to work, something client-side must intercept the anchor click, `fetch()` the POST,
wait for the session cookie to be set, and then navigate. The plan's file surface is limited to
`landing.route.tsx` plus mount points in `index.ts` and `app.tsx` (for CSS only, per the issue
above) — it never names where this interaction script lives (inline `<script>` in the SSR HTML? a
small hydration island? a new client entry?). "Their hrefs remain crawlable fallback links" covers
the no-JS case but not the primary JS-enabled path the AC actually needs to land on a populated
screen.
**Recommendation:** Name the concrete implementation (e.g., "a small inline `<script>` in the SSR
document does `fetch(POST) → location.href = '/submissions'` on click, progressively enhancing the
plain `<a href>` fallback") and confirm it will pass CSP/whatever inline-script policy the worker
enforces.
```

```
**[MAJOR] Acceptance Criteria Coverage — AC-4's defined test methodology doesn't match the plan's validation**
EVALUATION.md tags AC-4 as `e2e:` — "BFS crawler from both entries: every route 2xx, every href
resolves, no lorem|TODO|placeholder|coming soon|Tab \d copy, no zero-child list container." No
`tests/e2e/` directory exists yet; the plan's validation section only lists "focused landing tests,"
`npm test`, `pr-gate`, and a manual `wrangler dev` + curl pass — no e2e/crawler work. `trace-ac-core.mjs`
is a static scan of test-title strings (requiring an `AC-4 · ` prefix), so a same-file integration
test with the right title prefix will satisfy the static gate even though it doesn't implement the
BFS-crawler semantics EVALUATION.md actually specifies for AC-4. Since AC-4 is in the no-waiver
Tier A set, shipping a title-only stub would pass CI while leaving the AC's real intent unverified.
**Recommendation:** Either scope AC-4 down explicitly in this ticket (e.g., a narrow integration
test that checks "no forbidden copy strings" and "both demo links resolve to 2xx," documented as a
partial/interim claim) or flag that full BFS-crawler e2e coverage is out of scope for this 2h
fast-track ticket and should be tracked separately — don't let the AC-tagged test title imply more
coverage than the test performs.
```

```
**[MINOR] Feasibility / Mount the SSR route — deviation-from-manifest pattern not acknowledged**
`src/index.ts:93-99` documents that hand-mounting a route outside the glob-discovered `*.routes.ts`
manifest is a tracked "deviate-with-flag" pattern (tracked by MRQ-59). The plan mounts
`landing.route.tsx` directly in `index.ts` without mentioning whether it follows that same flagging
convention.
**Recommendation:** Either follow the existing deviation-tracking convention for this hand-mount, or
state explicitly why `*.route.tsx` (the SSR variant) is exempt from it.
```

```
**[MINOR] Risk Identification — coupling between the landing query and the submissions page's hardcoded event id**
The landing route dynamically queries "the first `demo_mode = 1` conference," while
`SubmissionsPage` hardcodes a default `eventId = "evt_aie-ny-2026"` (`src/ui/submissions/SubmissionsPage.tsx:126,170`).
Today there is exactly one `demo_mode=1` event and the ids match, so this works, but the plan
doesn't note the assumption. If a second demo event is ever seeded, the landing page's counts and
the post-login submissions view could silently diverge.
**Recommendation:** Add a one-line note in the plan (or a code comment) recording this coupling, so
a future seed change doesn't silently break the demo path without an obvious signal.
```

## 4. Positive Observations

- The plan grounds its "why this must come after M-05a" rationale in the actual seed contents (submissions, speaker tasks, agenda rows, track assignments) rather than asserting it — and that grounding checks out: the seed genuinely produces non-zero counts in all four categories.
- `src/routes/landing.route.tsx` correctly follows the codebase's own pre-declared naming split (`*.routes.ts` = API manifest, `*.route.tsx` = SSR page) even though no prior file has used the SSR half of that convention yet — good convention-matching rather than inventing a new one.
- Non-goals are explicit and well-scoped (no auth changes, no new API route, no design-token changes), which correctly keeps this fast-track ticket from creeping into M-03/M-08 territory.
- Validation plan includes a real `wrangler dev` + curl smoke pass rather than stopping at unit/integration tests, which is the right instinct for an SSR page — it just needs to be paired with resolving the client-hydration question above, not substituted for it.
