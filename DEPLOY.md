# Deploying Marquee

The live site is **https://marquee.stage11.dev**, media on **media.marquee.stage11.dev**.

**There is no auto-deploy. Merging does not ship.** CI green and a merged PR leave the
deployed Worker exactly where it was, and nothing anywhere signals the gap. The live site
fell behind `main` three times in one evening this way, twice serving a screen the fleet had
already fixed. Whoever merges a judge-facing change owns getting it live, or hands that to
someone by name.

Confirm what is actually running before assuming:

```sh
curl -fsS https://marquee.stage11.dev/health
# {"service":"marquee","status":"ok","build":"<short sha>","built_at":"…"}
```

`build` is the commit. If it does not match `git rev-parse --short=12 github/main`, the site
is stale.

---

## Redeploy

The ordinary case: resources exist, secrets are set, no schema change.

```sh
# 1. A clean tree at the commit you intend to ship.
cd ~/Projects/Stage11/deployments/Marquee
git fetch github
git worktree add ../Marquee-worktrees/deploy github/main
cd ../Marquee-worktrees/deploy
npm ci

# 2. Credentials.
set -a; source ~/Projects/Stage11/code/platform/.credentials/.env; set +a
export CLOUDFLARE_API_TOKEN="$MARQUEE_CLOUDFLARE_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID
npx wrangler whoami        # must be Projects@stage11.ai's Account, 16483d6f…

# 3. Build, then ship. The build is not optional — see below.
npx vite build
npx wrangler deploy

# 4. Prove it took.
curl -fsS https://marquee.stage11.dev/health
```

Then clean up: `git worktree remove ../Marquee-worktrees/deploy`.

### Schema changes

Only when migrations changed between the deployed build and what you are shipping —
`git diff --name-only <deployed-sha> github/main -- migrations/`. If that is empty, skip this
entirely; you are shipping code, not data.

```sh
CI=1 npx wrangler d1 migrations apply DB --remote
npm run seed -- --remote      # deterministic upserts: converges, does not duplicate
```

---

## The four things that go wrong

**`npx vite build` is load-bearing, not a formality.** With the Cloudflare Vite plugin,
`wrangler.jsonc` is *not* what Wrangler reads — `.wrangler/deploy/config.json` redirects it to
a **generated** `dist/marquee/wrangler.json`. Deploy without rebuilding and you ship the
previous config while your edit sits on disk looking correct. Wrangler prints "Using
redirected Wrangler configuration" and names both files; it is easy to skim past.

**Deploy from a clean worktree, never the main checkout.** That checkout routinely carries
other agents' in-flight work and runs commits behind. Deploying from it ships a blend of
`main` and whatever happens to be sitting there.

**Export the token under its canonical name only inside the deploy shell.** It is stored as
`MARQUEE_CLOUDFLARE_API_TOKEN` deliberately: a bare `CLOUDFLARE_API_TOKEN` in
`.credentials/.env` would silently apply to every tool that sources that file, in every
project. Prefer the scoped token over `wrangler login` — OAuth runs a throwaway callback
server on `localhost:8976` that must outlive the human's click, and when it does not, consent
is granted with nowhere to land and no error naming the cause.

**Verify by build hash, not by the page loading.** The old build serves a perfectly healthy
200. `/health` carries the commit; that is the only honest check.

---

## After a deploy

Check the things a judge sees, on the real origin — not locally, and not by reasoning about
the diff:

```sh
curl -fsS https://marquee.stage11.dev/health                       # build == main
curl -s https://marquee.stage11.dev/ | grep 'View public CFP'      # → /f/cfp
curl -s -o /dev/null -w '%{http_code}\n' https://marquee.stage11.dev/f/cfp
curl -s -i -X POST https://marquee.stage11.dev/api/v1/auth/demo \
  -H 'content-type: application/json' -d '{"role":"organizer"}' | grep -i set-cookie
# R2 browser-upload preflight (uses the account ID exported in the deploy shell)
MARQUEE_R2_CORS_URL="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/marquee-media/mrq-92-preflight-probe" \
  npm run check:r2-cors
```

The R2 check is a real external preflight, not part of `npm test`. It verifies
the production origin, the signed upload's `PUT` and headers, and a deliberately
wrong origin. Run it after every deploy; it is the guard against the local
`LOCAL_UPLOAD_SHIM` hiding a broken cross-origin path.

The reviewed source of truth is `scripts/platform/r2-cors.json`. Apply it from a
clean checkout with the existing scoped credential:

```sh
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
node scripts/platform/apply-r2-cors.mjs
```

The apply wrapper defaults to `marquee-media`; set
`MARQUEE_R2_CORS_BUCKET=marquee-media-preview` only when a browser path uses the
preview bucket. Local development uses `LOCAL_UPLOAD_SHIM=1`, so it deliberately
does not exercise a real cross-origin R2 PUT and the production policy grants no
localhost origin.

**Guardrail G6: the session cookie must carry no `Domain` attribute.** `stage11.dev` is
HSTS-preloaded and a parent-domain cookie would leak across it. Expect exactly
`mq_session=…; Max-Age=…; Path=/; HttpOnly; Secure; SameSite=Lax`.

The dev-only flags must both read `"0"` in the deploy output: `INSECURE_LOCAL_COOKIES` and
`LOCAL_UPLOAD_SHIM`. Either one at `"1"` on a deployed Worker is a defect —
they exist because a Worker cannot detect that it is running locally.

Anything that changed a screen deserves one look at that screen, not just a 200.

---

## First-time setup

Creating resources, minting the token and its scopes, secrets, custom domains, and the
account preconditions are in **`README.md` → Deploy to Cloudflare** (the self-host path) and in
`~/Projects/Stage11/code/platform/cloudflare.md` → *Workers — Deploying a Full Application*,
which carries the hard-won parts: proving Workers Paid by creating a paid-only resource rather
than reading an API that lies about it, proving the R2 entitlement with a real ranged fetch,
and the `10063` workers.dev-subdomain error that blocks crons and queue *consumers* and is
fixable by API despite insisting you visit the dashboard.

Secrets live in `~/Projects/Stage11/code/platform/.credentials/.env` — **not** the platform
repo root, which holds only an unhydrated `.env.template`. Nothing secret ever enters this
repo; it is published.
