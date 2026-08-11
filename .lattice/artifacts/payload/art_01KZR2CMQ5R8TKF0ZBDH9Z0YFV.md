# Code Review: MRQ-36 — the `marquee` CLI and the shipped SKILL.md

Reviewed at branch `mrq-36-cli`, head `143c62a`, base `65aa56d` (worktree `Marquee-worktrees/mrq-36-cli`). All verification was re-run independently: the two node test files (3 tests, 1.3s, green), `npm run pr-gate -- --ticket MRQ-36` (PASS, 15.1s / 45s budget), and `npm run check:api` (PASS, CLI-registry half now `checked` with zero findings). Server-side contracts were verified by reading the actual route sources, not the mock.

### 1. Verdict

**PASS**

All in-scope ACs (AC-138–AC-144, AC-250 CLI half) are implemented, tested, and independently re-verified. AC-145 is honestly deferred to the `check:skill-agent` oracle in the claims file rather than falsely claimed. The one major finding below is a hardening gap in the anti-drift seam — a small test addition that can be amended before or immediately after merge; it does not violate any AC.

### 2. Summary

A dependency-free Node CLI (`cli/`) with a single declarative command registry driving dispatch, help, and the generated `SKILL.md`, plus a generated `cli/api-registry.json` that activates `check:api`'s dormant CLI-parity half. The work is careful and contract-literate: every CLI filter allowlist matches the server's zod schemas key-for-key, the reminder exclusivity rule mirrors the server's exactly, and the public-hygiene test is thorough. The key finding is that the "one route registry" seam is only partially wired — `registryOperations()` is exported but never consumed, so nothing ties the commands' declared `operations` (or their hardcoded request paths) to the generated API registry, while a docstring claims that guard exists.

### 3. Issues

**[MAJOR] cli/registry.mjs:1-5, tests/node/cli.AC-138-141-250.test.mjs — The claimed registry drift guard does not exist**
The registry docstring states "adding a command in only one surface is a build error in the CLI tests," and the ticket's shared-files note says CLI and SKILL "derive from the one route registry." In fact `registryOperations()` has no consumers, and neither the `operations` arrays in `COMMAND_REGISTRY` nor the hardcoded request paths in `marquee.mjs` are checked against `cli/api-registry.json` by any test. `check:api` guards api-registry.json ↔ served OpenAPI, and the skill test guards SKILL.md ↔ COMMAND_REGISTRY, but the COMMAND_REGISTRY ↔ api-registry.json link is open: if a server route or operationId is renamed, `check:api` regenerates cleanly, the hand-mocked hermetic tests stay green, and the CLI breaks only at runtime against a real instance. I verified all ten referenced operationIds currently exist in the generated registry, so nothing is broken today — but the seam this gate-backing ticket exists to hold is unenforced, and the comment tells future maintainers to trust a guard that isn't there.
**Fix:** Add one test that loads `cli/api-registry.json` and asserts (a) every `registryOperations()` entry appears as an operationId, and (b) for each command, the path template associated with each of its operations matches the request path `marquee.mjs` actually builds (a small operationId → path-template lookup makes this mechanical). Alternatively, soften the docstring to claim only what is checked.

**[MINOR] cli/marquee.mjs:169-183 (`event seed`) — The enqueue/poll reset branch is unreachable against the real server, and the summary overstates**
`GET /api/v1/auth/me` returns `demo_event_id: demoEvent?.id ?? null` for any authenticated caller whenever a demo event exists (no access check), so the short-circuit always fires on a demo instance. When no demo event exists, `POST /api/v1/admin/reset-demo` itself returns 403 `demo_disabled` (the handler requires an existing `demo_mode` event), and the CLI never sends the `x-marquee-local-validation` header. So the `waitForReset` polling branch can never succeed against the real API — it is validated only by the hermetic mock, which permits what the real server forbids. The short-circuit itself is correct and necessary (the reset wipes `api_tokens`, which would revoke the oracle's own credential mid-loop — verified in `src/lib/reset-demo/reseed-demo.ts:46`), but the registry summary "Restore the seeded conference" and the plan's "calls the API's queue-backed demo-seed/reset operation" describe behavior the command cannot actually deliver over bearer auth.
**Fix:** Either drop the unreachable enqueue/poll branch and make `event seed` an explicit "resolve the seeded conference" read (updating the summary and SKILL wording to match), or keep it and document precisely when it can run (local validation header / session auth) — and add a mock-side 403 case so the test models the real server's refusal.

**[MINOR] cli/marquee.mjs:126-133 (`resolveEventId`) — The `auth/me` fallback is dead code**
`eventIdFrom` throws (`usageError`) whenever an event ID is missing for every command that reaches `resolveEventId`, so the `demo_event_id` fallback after it can never execute. The only command for which `eventIdFrom` returns `undefined` is `event seed`, which never calls `resolveEventId`.
**Fix:** Delete the fallback (and the then-unused `client` parameter), or make the fallback real by having `eventIdFrom` return `undefined` instead of throwing and moving the error to `resolveEventId` after the `auth/me` attempt fails.

**[MINOR] cli/marquee.mjs:118 (`eventIdFrom`) — Redundant clauses in the `expected` expression**
`command.path[0] === "tasks" || command.path[0] === "remind" || command.path[0] === "agenda"` are all subsumed by the preceding `command.path[0] !== "event"`; the expression reads as uncertainty about its own logic.
**Fix:** Reduce to `command.path.at(-1) === "show" || command.path[0] !== "event"`.

**[MINOR] cli/client.mjs:40 — A `--url` with a path prefix is silently dropped**
`new URL("/api/v1/...", base)` discards any path component of the base URL, so `--url https://host/marquee` silently targets `https://host/api/v1/...`. The PR contract claims support for "remote self-hosted Marquee instances"; one hosted under a subpath would fail confusingly.
**Fix:** Either join paths against the base's pathname, or have `baseUrl` reject a URL with a non-root path with a clear message.

**[MINOR] cli/marquee.mjs:207-208 (`tasks list`) — `--filter` silently overrides `--overdue`**
`marquee tasks list <id> --overdue --filter incomplete` sends `filter=incomplete` with no warning; the two flags look independent but conflict.
**Fix:** `usageError` when both `--overdue` and `--filter` are passed with different values.

### 4. Positive Observations

- **Contract fidelity is excellent.** `LIST_FILTER_KEYS` matches `submissionFilterSchema` key-for-key (kind/status/track/format/wave/task/placement/q), `REMINDER_FILTER_KEYS` matches `reminderSelectorSchema` exactly, the bulk body `{selector: {filter}, action}` matches `submissions-bulk.routes.ts`, the reminder exclusivity rule (`template_key` XOR `subject`+`body`) mirrors the server check, the SKILL's `task_overdue` example is a real `MAIL_TEMPLATE_KEYS` entry, and the `--filter status=` → `[]` path preserves the empty-selection no-op semantics the guardrails required. Server-side filtering is genuinely preserved — no page-of-IDs materialization anywhere.
- **The SKILL parity test is the right shape**: `SKILL.md` must byte-equal `renderSkill()`, so the shipped file cannot drift from the registry; headings, the seven product terms, the banned-synonym absence, and both API-only endpoints are all asserted, and the banned internal strings are constructed via `join` so the test file itself stays clean in the public tree — a nice touch for a public repo.
- **The hermetic CLI test earns its ACs**: a real spawned process against a real local HTTP server, asserting bearer-only auth on every request, cookie absence, exit codes, empty stderr on success, parseable stdout, both reminder forms' exact wire bodies, and two-instance `--url`/`--token` targeting. Fast (1.3s) and well inside the inner-loop budget.
- **`check:api` activation landed cleanly** — the dormant CLI-parity half now reports `checked` with zero findings, digest and signatures matching the served document, exactly as M-06 designed the seam.
- **Honest claims discipline**: AC-145 is documented as the oracle's criterion in `tests/ac-claims/MRQ-36.json` rather than claimed by a local test, and the seed short-circuit carries a comment explaining the real credential-destruction constraint.
