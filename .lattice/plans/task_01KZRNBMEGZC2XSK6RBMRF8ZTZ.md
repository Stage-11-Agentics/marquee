# MRQ-73: Instrumentation and resilience platform — structured logs, correlation, fallback layer, support handshake

Instrumentation and resilience platform. Every failure in Marquee — server, client, queue, cron — becomes one structured, correlated, PII-safe event that a human or an agent can trace from the screen to the log line, without a vendor. Paired with the fallback layer that keeps the product usable while it is failing.

Provoked by a live defect: a "Dashboard refresh failed" banner that was undiagnosable by construction. The server generated a correlation id, returned it in the envelope, and logged the error WITHOUT it; the client threw the id away and kept the HTTP status. The id existed at both ends and was used at neither.

## Contract position

No new ACs and no SPEC/EVALUATION amendment. Observability appears nowhere in the requirements register, and `trace:ac --scope=merged` emits `missing-current-ticket-manifest` as a WARNING (status fails only on errors/uncovered). Ship `tests/ac-claims/MRQ-73.json` with `owns: []` and a note, exactly as MRQ-72 did.

## Scope

### A. Server logging
- `wrangler.jsonc`: add `"observability": { "enabled": true, "head_sampling_rate": 1 }`. Verified valid against the bundled wrangler config schema.
- New `src/lib/observability/log.ts`. One JSON line per event via console.log. Closed union of event names plus a `schema_version` field — not ad-hoc strings, so logs stay queryable and the CLI can filter reliably.
- THE LOAD-BEARING RULE: a field ALLOWLIST, not a redaction denylist. The log builder accepts only declared fields, so a speaker's email cannot be logged because the shape has no slot for it. Never emit request bodies, raw query strings, cookies, Authorization headers, or mail addresses. Route TEMPLATES (`/api/v1/events/{eventId}/dashboard`), never raw URLs. Opaque ULIDs are fine. Stack traces truncated; hard cap around 4KB per line.
- `LOG_LEVEL` env var, default `info`.
- `src/api/router.ts`: extend the existing request-id middleware to time the request and emit one `http_request` event on completion (method, route template, status, duration_ms). In `app.onError`, emit `api_error` CARRYING THE REQUEST ID — this is the correlation break that caused the provoking defect. Expected `ApiError` logs at warn without a stack; unexpected logs at error with one.
- Replace the four surviving `console.*` calls: `src/index.ts:145`, `src/index.ts` queue warn, `src/routes/submission-record.routes.ts:588`, `src/routes/landing.route.tsx:288`.
- Queue and `scheduled` handlers emit their own events. A failing cron currently leaves NO trace whatsoever.

### B. Build identity
Nothing in the repo stamps a build today, so "which version is this?" is unanswerable and every bug report is ambiguous. Stamp the git SHA and build timestamp at build time (vite `define`), and expose it in every log line, at `/health`, in the diagnostic report, and somewhere in the UI. Several other parts depend on this; do it early.

### C. Cross-async correlation
An acceptance becomes queue message -> mail send -> webhook. Propagate the correlation id INTO the queue message body so one acceptance is followable across four invocations. Without this, queue logs are orphans. This is the single biggest amateur/professional gap in the current codebase.

### D. Client error legibility and the fallback layer
- New `src/ui/shell/api-client.ts`: a fetch wrapper that parses the error envelope and throws a `MarqueeApiError` carrying `code`, `message`, `requestId`, `status`.
- `DashboardPage.tsx` uses it and renders the reference: "Dashboard refresh failed — <message> · ref 8f2a4c". That closes the provoking defect.
- There are 39 `fetch(` call sites across 21 files in `src/ui`. Convert the dashboard plus the highest-traffic screens (submissions, review, portal). Leave the rest on the documented pattern; say plainly in the PR which ones you left.
- ERROR TAXONOMY: map each stable envelope code to one plain human sentence plus a recovery action. `rate_limited` -> "Going faster than the system allows — retrying in 30s", never "429".
- STALE-WHILE-ERROR: never blank a screen because a refresh failed. Show last-good data with a quiet "as of 2 min ago, retrying" band. The dashboard already retains its snapshot; most screens do not.
- BACKOFF WITH JITTER: `DashboardPage` currently re-polls every 5s forever regardless of failure. On a sustained outage that is every open tab hammering a wounded origin. Fix it.
- OFFLINE DETECTION: "your connection dropped" and "the server is broken" are the same screen today and must never be.
- PER-PANEL ERROR BOUNDARIES so one broken card does not white-screen the shell.
- All of the above obeys the house UI rule: elements never jump. Reserve space, fixed widths, no layout shift when a state flips.

### E. Client error beacon
- `POST /api/v1/telemetry/client-errors` in a new `src/routes/telemetry.routes.ts` via `defineApiRoute`. Policy: `auth: { kind: "public" }` (errors happen on public pages), `write` rate bucket, `concurrency: "none"`. Zod-validated with hard length caps.
- LOGGED, NOT PERSISTED. No table, no migration, no PII at rest.
- Client: `window.onerror`, `unhandledrejection`, and Preact error boundaries. THROTTLING IS NOT OPTIONAL — the dashboard revalidates every 5s, so an unthrottled beacon on a broken dashboard fires ~720 reports/hour per open tab. Throttle per session, dedupe by message+stack signature, prefer `navigator.sendBeacon`.

### F. Deep diagnostics
- `/health` stays a cheap liveness probe. Do not change it beyond adding build info.
- New authenticated `GET /api/v1/telemetry/diagnostics`: D1 ping latency, KV, R2 head, queue bindings present, migration version, build info, and a `status: ok|degraded` verdict. One curl answers "is it broken, and where". MRQ-74 consumes this.
- SILENT-CRON HEARTBEAT: record last-success per cron trigger and expose it here. A cron that does not fire logs nothing today.

### G. Performance (R7 is a graded feature)
- The `http_request` line's `duration_ms` gives live p50/p95 per route.
- Add D1 query count and total query ms per request — the N+1 detector.
- `Server-Timing` response header so it shows in browser devtools.
- Web Vitals (LCP/INP) from the client through the same beacon.

### H. The support handshake
For OSS run by non-technical organizers this is the killer feature. Every error surface shows a short reference code, plus a "Copy diagnostic report" action putting reference id, route, build SHA, browser, timestamp, recent client events and the sanitized error on the clipboard — one paste into a GitHub issue. `marquee diagnose --bundle` is the server-side twin.

### I. Agent-native CLI
- `marquee diagnose` (maps to the new diagnostics operation) and `marquee logs --tail` wrapping `wrangler tail --format json`, filtering our events by `--request-id` / `--level` / `--event`.
- Verified invariants: a registry command with `operations: []` is fine, but every command needs working `--help`, AND `SKILL.md` must be byte-equal to `renderSkill()`. Regenerating the skill is mandatory, not cosmetic (`tests/node/skill.AC-142-144.test.mjs`).

### J. Trust controls and docs
- `docs/OBSERVABILITY.md`: what is logged, what is DELIBERATELY NEVER logged (the allowlist), how to read it, how to turn it off, and honest words about what Workers Logs costs at conference scale.
- NEVER PHONE HOME. The beacon posts to the operator's own Worker and nowhere else. State this loudly in the README, not only the doc. An organizer handling speaker data deserves to read exactly what is recorded.
- A real off switch: `observability.enabled: false` plus an env var disabling the client beacon.
- Join `audit_log` to `request_id` so "who did this, and what broke" is one query.

## Explicitly out of scope
Sentry (deferred, DSN-gated, post-deadline; name it in the doc as the extension point). PostHog or any product analytics — rejected on principle for a PII-carrying OSS tool. No D1 tables, no migration. The organizer-facing health surface is MRQ-74.

## Constraints
- Adding any API route obligates `npx vite build && node cli/generate-api-registry.mjs`. `check:api` asserts EXACT registry parity — missing and extra both fail — plus a document SHA match.
- The fast suite has a 29s hard kill and a 30s budget. New tests must be fast. Worker-free unit tests go in `tests/unit` (node pool); Worker-backed tests in `tests/integration`.
- Do not edit `package.json` unless a script is genuinely required; BUILDPLAN section 7 reserves it. MRQ-73 owns it if anyone does; MRQ-74 must not touch it.
- Shipped files must avoid the repo-policy denied vocabulary (see `scripts/checks/repo-policy.mjs`): no company name, no absolute /Users/ paths, no real email addresses, no internal tooling vocabulary in code or docs.
- Any UI follows DESIGN.md / Flight Deck tokens.

## File ownership (MRQ-73 and MRQ-74 run in parallel)
MRQ-73 OWNS: `src/lib/observability/*`, `src/api/router.ts`, `src/index.ts`, `src/api/errors.ts`, `src/ui/shell/api-client.ts`, `src/ui/shell/error-reporting.ts`, `src/ui/shell/AppShell.tsx`, `src/ui/dashboard/DashboardPage.tsx`, `src/routes/telemetry.routes.ts`, `cli/`, `SKILL.md`, `wrangler.jsonc`, `vite.config.ts`, `docs/`, `README.md`, `package.json`.
MRQ-73 MUST NOT TOUCH: `src/ui/shell/route-table.ts`, `src/ui/health/*`, `src/routes/health-surface.routes.ts`, `src/lib/delivery-health.ts`.
Both regenerate `cli/api-registry.json`; a conflict there is expected and the resolution is always rebase, rebuild, regenerate. MRQ-73 merges FIRST.

## Verification
1. Unit tests on the parts with real failure modes: the allowlist (assert an email-bearing payload CANNOT be emitted), stack truncation, beacon schema caps, throttle/dedupe, backoff/jitter, the error taxonomy mapping.
2. Integration test: `X-Request-Id` header and the `http_request` line carry the same id; a forced 500's envelope and its `api_error` line agree on that id.
3. `npm run pr-gate -- --ticket MRQ-73` — all eight checks green.
4. REAL-ARTIFACT SMOKE, non-negotiable. `wrangler dev`, drive the running app in a browser: load the dashboard, induce a genuine failure, confirm the reference renders on screen and greps to the log line; throw inside a render and confirm the boundary catches it and the beacon lands in the tail; confirm offline state reads differently from server error. Green tests would not have caught the provoking defect; a smoke pass would have.

## Delivery
Own git worktree, branch `mrq-73-instrumentation`. PR via `gh pr create --repo Stage-11-Agentics/marquee --base main`. Commit part A+B+D first as a standalone landable unit so the provoking defect is closed even if a later part hits a gate wall.
