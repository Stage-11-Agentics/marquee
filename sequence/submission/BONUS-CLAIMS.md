# Bonus claims — what we claim, what we don't

The brief names five bonuses. We claim three and forfeit two, stated plainly so
nothing here contradicts what a judge finds. Verified against build
`30b53f5ae78e`, 2026-08-12.

---

## Claimed

### Cloudflare infrastructure ("mild bonus points for deploy to Cloudflare infra")

The whole product is one Cloudflare Worker: D1 is the source of truth, R2 holds
uploads, KV caches, and four Queues carry mail, mirror, operations, and webhook
work off the request path. The live site is that Worker at
https://marquee.stage11.dev; `curl https://marquee.stage11.dev/health` names
the deployed build. The README's deploy section is the exact sequence used to
ship it — `wrangler.jsonc` at the repo root is our real production config, not
a placeholder.

### API ("bonus points for API")

The brief's reference is the incumbent's partial, sales-gated API. Marquee's
answer is a different category:

- **211 operations across 167 paths** in a live OpenAPI 3.1 document —
  `curl https://marquee.stage11.dev/api/openapi.json` — generated from the same
  route objects the Worker serves. A route cannot ship without its contract:
  the registration function takes the OpenAPI definition and the handler as
  one object.
- **The admin UI is a plain client of this API.** Nothing the UI does is
  UI-only; every screen speaks the same documented, token-authenticated
  routes.
- **The document is content-addressed:** its `ETag` is the SHA-256 of the bytes
  served. Check in one line:
  `curl -s https://marquee.stage11.dev/api/openapi.json | shasum -a 256`
  against `curl -sI .../api/openapi.json | grep -i etag`.
- **Self-contained rendered reference** at
  [/api/docs](https://marquee.stage11.dev/api/docs), no external dependencies.
- **Scoped bearer tokens** with explicit permissions and optional
  per-conference restriction, minted in the UI (`/settings/api`); secrets
  shown once, stored hashed.
- **A 48-command dependency-free CLI** (`cli/marquee.mjs`) covering the whole
  operating loop — setup, forms, review, decisions, scheduling, publishing,
  chasing, diagnosing — plus a generated agent skill file (`SKILL.md`) so a
  coding agent can run a conference on it.

### Speed / performance ("we do not want slow SaaS pls")

- The public agenda — a server-rendered page carrying the full published
  program — answers with time-to-first-byte around a quarter second; the CFP
  form and public API are faster still. Measure it yourself:
  `curl -s -o /dev/null -w '%{time_starttransfer}\n' https://marquee.stage11.dev/agenda`.
- The organizer's submissions register renders ~1,000 real rows with
  server-side filtering — built and seeded at the scale where the incumbent's
  slowness drew three separate on-camera complaints.
- Speed is budgeted per surface (`scripts/checks/check-speed.mjs`, driven by a
  real browser) and measurable in one command. We do not claim CI enforcement
  of those budgets — they are an instrument, not a gate.

---

## Not claimed

### Airtable persistence ("bonus points for persistence/DB to Airtable")

**Not claimed.** D1 is the source of truth, chosen deliberately: at 1,000+
submissions, Airtable-as-primary fights the speed requirement head-on. An
asynchronous Airtable mirror is a designed extension point (the outbound queue
and `last_write_source` column exist), not a shipped feature, and the README
says exactly that. Per the Discord ruling, the bonus attaches to
Airtable-as-source-of-truth, so we forfeit it rather than fake it.

### Forge hosting ("very teeny bonus points")

**Not claimed.** The repo is on GitHub:
https://github.com/Stage-11-Agentics/marquee.
