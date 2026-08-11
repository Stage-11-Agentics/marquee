# MRQ-57: Real Cloudflare deploy — resources, secrets, custom domain

Owner: `agent:mrq-57-deploy` (surface:261 launch, 2026-08-11 evening).
Operator: Atin, at the keyboard for the credential steps.

## Credential path — corrected

`sequence/OPERATOR-PRECONDITIONS.md` §3 says to pull `CLOUDFLARE_ACCOUNT_ID` "from `.env`
in the platform repo". **That file does not exist**, and it is not missing — it is
*generated*. `code/platform/.env.template` holds `op://` references and
`code/platform/secrets.md:26` records the templates as never hydrated on this machine.
The correct first step is therefore `op signin` + `op inject`, not a dashboard trip.
Correcting §3 is a deliverable of this ticket (see Follow-ups).

**Template scope — what hydration does and does not give us:**

| Yields | Does **not** yield |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | `CLOUDFLARE_R2_TOKEN` |
| `CLOUDFLARE_ZONE_ID_STAGE11_DEV` | R2 S3 access key id / secret |
| `CLOUDFLARE_ZONE_ID_STAGE11_SYSTEMS` | `CLOUDFLARE_R2_ENDPOINT` |
| `CLOUDFLARE_DNS_TOKEN`, `CLOUDFLARE_REGISTRAR_TOKEN` | Turnstile site/secret keys |
| `RESEND_API_KEY` — one of the seven required Wrangler secrets | |

`code/platform/cloudflare.md` cites the R2 token and S3 keys as living in `.env` while
nothing generates them — a doc defect, also a Follow-up. If the vault's Cloudflare item
carries no extra fields, R2 S3 keys and Turnstile are **confirmed dashboard-only**.

### Safety fix already applied

`code/platform/.gitignore` contained only `.credentials/` — `.env` was **not** ignored,
so `op inject -o .env` would have written live secrets to a git-visible path. Added
`.env` / `.env.*` with `!.env.template` / `!.env.example`; verified with `git check-ignore`.
Left uncommitted (Atin's repo, Atin's call). Never exercised: no `.env` has ever been
committed to that history.

## Sequence

### Phase 0 — operator credentials (blocking, human-only)

1. `op signin` → hydrate: `op inject -i <platform>/.env.template -o <platform>/.env`.
2. Enumerate the vault's Cloudflare item for R2 / Turnstile fields (names only to any
   transcript). Settle the dashboard list definitively.
3. `npx wrangler login` — OAuth. **The consent screen must read `projects@stage11.ai`**
   (Stage11 Projects). Not `Stage11Agentics`, not `atin@atin.me`.
4. **HARD GATE:** `wrangler whoami` account ID **must equal** the vault's
   `CLOUDFLARE_ACCOUNT_ID`. If they disagree, **STOP** — that mismatch deploys Marquee
   into the wrong account.
5. Confirm **Workers Paid** (precondition §1). Free caps CPU at 10 ms/invocation and
   Marquee SSRs a 1,000-row table — on Free, SSR does not work at all.
6. Prove the **R2 entitlement with a real fetch** (precondition §2), not a dashboard
   checkbox. The entitlement has lapsed account-wide before; symptoms are API error
   **10042** and `aws s3 ls` → `NotEntitled`. Fix is dashboard-only (terms + payment
   method), which is why it must be discovered tonight and not at the deadline.

### Phase 1 — resources (agent-doable once Phase 0 lands)

Names, replacing the `replace-me-*` placeholders in `wrangler.jsonc`:

| Binding | Kind | Name |
|---|---|---|
| `DB` | D1 | `marquee` |
| `CACHE` | KV | `marquee-cache` |
| `MEDIA` | R2 | `marquee-media` (+ `marquee-media-preview`) |
| `MAIL_QUEUE` | Queue | `marquee-mail` |
| `MIRROR_QUEUE` | Queue | `marquee-mirror` |
| `OPERATIONS_QUEUE` | Queue | `marquee-operations` |
| `WEBHOOK_QUEUE` | Queue | `marquee-webhook` |

Then: replace `REPLACE_ME-DB`, `REPLACE_ME-CACHE`, and the `vars` block's
`R2_ACCOUNT_ID` / `R2_BUCKET_NAME`. **`account_id` comes from the environment and is
never committed** — the repo goes public.

Crons are already declared (hourly reminder scan; daily Airtable keepalive; nightly
orphan sweep) and need no creation, only a successful deploy.

### Phase 2 — secrets

Seven, via `wrangler secret put`: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`,
`RESEND_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `UPLOAD_TOKEN_SECRET`,
`UPLOAD_RATE_LIMIT_SECRET`. The real Turnstile pair **replaces** the published
always-pass test keys. `.dev.vars` stays untracked. Nothing secret enters the repo.

### Phase 3 — migrations + seed

`wrangler d1 migrations apply DB --remote` (seven migrations, `0001`–`0007`), then
`npm run seed -- --remote`. The seed orchestrator already supports `--remote`; every row
is a deterministic upsert, so re-running converges rather than duplicating.

### Phase 4 — deploy + domain

Deploy, then the two custom domains already declared as routes:
`marquee.stage11.dev` and `media.marquee.stage11.dev`. **Confirm with Atin before the
first real deploy and before any DNS change** — outward-facing and hard to reverse.

### Phase 5 — verification over the real origin

- Health route.
- **G6:** the session cookie carries **no `Domain` attribute**. `.dev` is HSTS-preloaded;
  a parent-domain cookie would leak across `*.stage11.dev`. Verify against the real
  origin, not locally.
- Inherited from MRQ-14, real-resource-only: presigned PUT against the real S3 host
  (CORS, expiry, replay → 412); a PUT against a custom domain must **fail**; S3 ↔
  R2-binding coherence (HEAD + range agree, checksum mismatch deletes); separate-origin
  serving (`Content-Disposition: attachment` + `nosniff`, app host 404s the same path);
  Image Resizing variants; the orphan-sweep cron actually firing; real Turnstile passing
  a valid token and rejecting a missing one.
- Open probe from MRQ-16: whether the edge intercepts `/cdn-cgi/image/*` on a Workers
  Custom Domain ahead of the Worker, or passes it through to be 404'd by the media-host
  rule. Frozen variants are `avatar` 64 / `card` 160 / `profile` 320.
- **AC-16:** program dashboard full render, p95 ≤ 1000 ms over 10 warm loads against the
  seed. Record the number; the `felt` residual is the operator's at checkpoint C2.

## Constraints

- `main` is behind a manual merge gate (CODEOWNERS + ruleset). Every code change goes
  through a PR Atin merges. Do not bypass.
- **Do not run the full suite** (~150s; concurrent runs wedged this machine at load 158).
  Gate with three `tsc --noEmit` passes, `npx vite build`, `check:design`, `check:api`,
  `trace:ac`. Let GitHub CI run the suite.
- Ports 8787, 8801–8803, 8863 are taken — use 8804+. Local `wrangler dev` needs
  `--var INSECURE_LOCAL_COOKIES:1` or the browser 401s after a 200 login.
- Private stays private: never push `main` to a public remote. The public artifact is the
  curated orphan `mrq-42-assembly`.

## Follow-ups to file (platform-level, not Marquee)

1. `code/platform/secrets.md` — the repo that teaches step 5 ("verify `.env` is
   gitignored") was itself failing it. Note that **first hydration in a repo is exactly
   when to run step 5**, because that is when the check stops being theoretical.
2. `sequence/OPERATOR-PRECONDITIONS.md` §3 — name the hydration step instead of "pull it
   from `.env` in the platform repo".
3. `code/platform/cloudflare.md` — it cites `CLOUDFLARE_R2_TOKEN` / R2 S3 keys /
   `CLOUDFLARE_R2_ENDPOINT` as living in `.env`, but `.env.template` does not generate
   them. Either add them to the template or say plainly where they come from.
4. Anything learned tonight about Workers Paid, R2 entitlement, or Queues goes back into
   `code/platform/cloudflare.md` — house rule.
