# Stack — the architecture in a paragraph

## The paragraph

> Marquee is one Cloudflare Worker. Hono routes it, Preact renders it, Zod
> validates every boundary, TypeScript covers all of it. D1 (SQLite at the
> edge) is the single source of truth — 20 migrations carrying real constraints
> in the database, not just the app; R2 holds uploads, KV caches, and four
> Queues keep mail, mirror work, bulk operations, and webhooks off the request
> path. Public pages — the CFP form, the agenda, the speaker directory — are
> server-rendered, so they are fast, and they work before (and without) any
> JavaScript. The admin app is a single-page client of the same REST API
> anyone else can call: 211 operations, defined once as route objects that
> generate both the handler and the live OpenAPI 3.1 document, so the docs
> cannot drift from the code. Vite builds it; `npx vite dev` runs the real
> Worker locally; 1,180 tests run hermetically — 542 Worker-project, 442
> node-project, 196 in the Node test runner — no network, no live services.

## Why these choices, in one line each

- **Cloudflare Workers + D1** — the judges' own stack preference, and the
  latency profile that makes a 1,000-row register feel instant.
- **Server-rendered public surfaces** — a speaker deciding whether to submit,
  or an attendee checking the agenda, gets HTML, not a loading spinner.
- **One route definition, three artifacts** — handler, OpenAPI operation, and
  rendered docs come from the same object; "undocumented endpoint" is not a
  state the codebase can express.
- **Queues for everything with a side effect** — mail and bulk operations are
  durable rows first, deliveries second; a crash mid-wave loses nothing.
- **Zod at every boundary** — the same schema validates the browser form, the
  raw API call, and the CLI; a crafted request that bypasses the client
  cannot persist an invalid record.
- **No external SDKs in the data path** — nothing phones home; observability
  is structured logs on a field allowlist with the reference code surfaced in
  the UI.

## Numbers a technical judge can check

| Fact | Where |
|---|---|
| 211 API operations / 167 paths, OpenAPI 3.1 | `curl https://marquee.stage11.dev/api/openapi.json` |
| ETag = SHA-256 of the served spec | compare `curl -sI` ETag to `shasum -a 256` of the body |
| 20 migrations, constraints in-database | `migrations/` |
| 1,180 hermetic tests (542 Worker + 442 node project + 196 Node runner) | `npm test` (hermetic, no network) |
| Server-rendered public pages | `curl https://marquee.stage11.dev/agenda` — the program is in the HTML |
| Deployed build | `curl https://marquee.stage11.dev/health` |
| Local run | README §"Clean local checkout" — build, migrate, seed, `wrangler dev` |
