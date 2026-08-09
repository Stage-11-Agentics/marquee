# Code Review: MRQ-1 — Platform skeleton and first real deploy

Reviewed commit: `c554757ee2858e0ea8fa4ba2d1f8317d72b19246` (`mrq-1-platform-skeleton`)
Review method: read the diff cold, then executed the worktree — `tsc --noEmit`, `vite build`, `wrangler deploy --dry-run`, live `wrangler dev` on :5198 and live `vite dev` on :5199 with curl probes, plus a schema check of every `wrangler.jsonc` key against `node_modules/wrangler/config-schema.json`.

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the shape of the skeleton is right. Three findings are all the same class of defect — the plan says "non-local", "production", "localhost-only", and the code implements none of those qualifiers — and one of them (issue 1) leaves the repo with no working hot-reload dev server, which every downstream Wave-0 ticket inherits. All three fixes are a handful of lines.

## 2. Summary

I reviewed the full Cloudflare Workers walking skeleton: `wrangler.jsonc` binding surface, Hono entry with HTTPS/HSTS middleware and `/health`, the session-cookie helper, TS/Vite scaffold, README stub, and ignore rules. The core deliverables are correct and verified live — `/health` returns `{"service":"marquee","status":"ok"}` under `wrangler dev`, and guardrail **G6 holds**: the emitted header is `mq_session=local-validation; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Lax` with no `Domain` attribute, structurally impossible to add through either helper. The blocking finding is that the HTTPS-redirect middleware is unconditional, which makes `vite dev` — the standard dev server for the `@cloudflare/vite-plugin` stack this ticket chose — 308-loop on every request with no HTTPS listener to land on.

## 3. Issues

```
**[MAJOR] src/index.ts:27-30 — Unconditional http→https redirect makes `vite dev` unusable**
```
The plan says "Redirect **non-local** HTTP requests to the equivalent HTTPS URL"; the implementation redirects every non-`https:` request, with no localhost exemption. `wrangler dev` survives only because `wrangler.jsonc` sets `dev.local_protocol: "https"` — but that key is Wrangler's, not the Vite plugin's, and the plugin's dev server is plain HTTP.

Reproduced live: `npx vite dev --port 5199`, then

- `curl -i http://127.0.0.1:5199/health` → `308` → `location: https://127.0.0.1:5199/health`
- `curl -k https://127.0.0.1:5199/health` → empty response (no TLS listener on that port)

Every route, plus the Vite client and HMR socket, dead-ends. The remaining path (`vite build` && `wrangler dev`) has no hot reload and reads a stale bundle via `.wrangler/deploy/config.json`, so the repo ships with no working inner-loop dev server — on a project where speed is a graded feature and a fleet of delegators is about to build UI on top of this file.

**Fix:** exempt loopback hosts, matching the plan's own wording:
```ts
const isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
if (!isLocal && url.protocol !== "https:") { ... }
```

```
**[MAJOR] src/index.ts:33-36 — HSTS with `includeSubDomains` is emitted on localhost responses**
```
The plan says "emit HSTS **on production responses**"; the middleware emits it on every response, including local dev. Confirmed live — `curl -k https://localhost:5198/health` returns `Strict-Transport-Security: max-age=63072000; includeSubDomains`.

Chrome and Firefox store HSTS for `localhost`, and `includeSubDomains` extends it to `*.localhost`. One `wrangler dev` session on this repo pins the developer's entire `localhost` namespace to HTTPS for two years, breaking unrelated `http://localhost:PORT` projects on the same machine. The failure is machine-wide, silent, and only unwound through `chrome://net-internals/#hsts`. Also note trap 15 is about `.dev` being HSTS-preloaded — the Worker does not need to assert HSTS for `marquee.stage11.dev` to be HTTPS-only, so the header buys nothing locally and costs a lot.

**Fix:** reuse the `isLocal` check from issue 1 and set the header only when the request is not loopback (zone-level HSTS in the Cloudflare dashboard is the production-correct home for this either way).

```
**[MAJOR] src/index.ts:44-47 — Validation route is gated on a secret's value, not on being local**
```
The operator ruling authorises a "**localhost-only** cookie-contract route." The implemented gate is `context.env.TURNSTILE_SITE_KEY !== TURNSTILE_ALWAYS_PASS_SITE_KEY` — i.e. "are the always-pass test keys loaded," which is exactly the state of any deployment that has not yet had production Turnstile secrets set. `secrets.required` only *warns* on missing secrets in local dev; it does not block deploy.

Concrete failure: MRQ-57's checklist orders "fill placeholders; deploy" before secret rotation is confirmed, or a preview environment reuses `.dev.vars.example`. In either case `GET https://marquee.stage11.dev/__validation/session-cookie` is public and mints an `mq_session` cookie. It is inert today because nothing reads sessions yet — it stops being inert the moment M-02 lands session auth, and nobody re-audits a route that was already merged.

Note also that plan resolution #4 committed M-01 to "an ad-hoc, uncommitted executable probe" and to adding no "dormant test file"; a committed route in the product request path is the thing that resolution was avoiding.

**Fix:** gate on the request host, which is what the ruling actually specified — `if (!isLocal) return context.notFound();` — or delete the route and curl the cookie contract through a scratch route in an uncommitted probe.

```
**[MINOR] wrangler.jsonc:18 — `run_worker_first: true` routes every static asset through the Worker**
```
With this set, every image, script, and stylesheet request becomes a Worker invocation that only proxies to `ASSETS` via the `app.all("*")` fallback (`src/index.ts:56`) — added latency and CPU on a product where speed is graded (R7), and against the 10 ms CPU ceiling this ticket exists to probe. The default (`false`) serves assets at the edge without invoking the Worker at all.

**Fix:** `run_worker_first` accepts a route-pattern array (verified in the shipped config schema) — scope it to the dynamic surface, e.g. `["/api/*", "/health", "/!(assets)*"]`, once M-02 fixes the route shape. If it stays `true` for now, leave a comment saying why so a later ticket can narrow it.

```
**[MINOR] wrangler.jsonc:19 — SPA `not_found_handling` returns 200 HTML for unknown API paths**
```
Verified: `GET https://localhost:5198/package.json`, `/SPEC.md`, `/wrangler.jsonc` all return `200 text/html` with `index.html`. (No repo file is exposed — the fallback is correct on that axis.) But the same rule means a future mistyped or removed `/api/*` endpoint answers `200 text/html` instead of `404 application/json`, which is a bad failure mode for the agent-native API surface the product is built around: clients see success and parse HTML.

**Fix:** add an explicit `app.all("/api/*", c => c.json({ error: "not_found" }, 404))` guard ahead of the assets fallback when M-02 introduces the API prefix.

```
**[MINOR] src/index.ts:60 — Inert queue consumer silently acknowledges and drops messages**
```
All four queues are declared as both producer and consumer, and `async queue() {}` returns without error, so workerd acks the batch. Once MRQ-57 creates the real queues, any ticket that wires a producer before its consumer handler lands loses those messages with no error, no retry, and no DLQ signal — a debugging trap that presents as "the email never sent."

**Fix:** until a real router exists, `batch.retryAll()` (messages sit in the queue rather than vanishing) or at minimum a `console.warn` naming the unhandled queue.

```
**[MINOR] tsconfig.json:13 — `include: ["src/**/*.ts"]` excludes the build config from typechecking**
```
`vite.config.ts` is never checked by `npx tsc --noEmit`, so a broken plugin config surfaces only at build time. Small now, less small once M-06 owns a check script that gates CI.

**Fix:** `"include": ["src/**/*.ts", "vite.config.ts"]`.

```
**[MINOR] package.json:3 — `version: "0.0.0"` does not follow the Stage 11 `X.XX.XXX` convention**
```
Stage 11 versions as `X.XX.XXX`; the PEP 440 carve-out is Python-specific, so a TypeScript package can carry the canonical form directly. This repo ships public as the hackathon entry, where the version string is visible.

**Fix:** `"version": "0.01.001"`.

## 4. Positive Observations

- **G6 is met structurally, not just behaviourally.** `SESSION_COOKIE_OPTIONS` is a frozen module-private constant and neither helper accepts caller-supplied options, so no downstream ticket can widen the cookie to `.stage11.dev` without editing this file. That is the right way to kill trap 15 — the guardrail is enforced by the type surface, not by a convention someone has to remember. `clearSessionCookie` reusing the same constant means set and clear can't drift.
- **The binding surface is genuinely complete and schema-valid.** I checked every key against the shipped `config-schema.json`: `secrets.required` is a real Wrangler property (`RawConfig.properties.secrets`, `additionalProperties: false`), and `wrangler deploy --dry-run` resolves all eight bindings cleanly. The ticket's whole premise — that no later ticket has to touch `wrangler.jsonc` — actually holds.
- **The placeholder discipline is exactly right.** `REPLACE_ME-*` / `replace-me-*` are schema-valid enough that `wrangler dev` and `--dry-run` both run to completion against local emulation, while being impossible to mistake for real resources, and each sits under a `TODO-OPERATOR (MRQ-57)` comment. That is a hard balance to strike and it was struck well.
- **Nothing leaks.** I scanned every committed file for account IDs, 32-hex tokens, `/Users/` paths, and Stage 11 internals: the only hits are the `<cloudflare-account-id>` placeholder in the README and Cloudflare's published always-pass Turnstile keys in `.dev.vars.example`. `account_id` is absent as planned; `.dev.vars`, `dist/`, and `.wrangler/` are ignored — worth noting because the Vite build writes both `.dev.vars` and absolute local paths into `dist/marquee/`, and the ignore rules were already in place to catch it.
- **`await next()` then `context.header(...)` is safe here**, which is not obvious — Hono clones a finalized response before mutating headers (`context.js`, `header()` → `createResponseInstance`), so the HSTS header applies cleanly even to the immutable `Response` returned by `ASSETS.fetch()`. Verified live on the asset path.
- **Scope discipline held.** No `scripts` block (M-06's), no design tokens or shell (M-05a's), README limited to the environment/deploy stub the boot prompt required, and the deviation flagged rather than quietly taken. `tsc --noEmit` and `vite build` both pass clean.
