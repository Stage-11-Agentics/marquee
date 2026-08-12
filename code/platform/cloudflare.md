# Cloudflare platform configuration

## R2 browser uploads

The speaker portal uploads directly to the presigned R2 URL returned by the
Worker. That URL is cross-origin from `https://marquee.stage11.dev`, so the
browser sends an `OPTIONS` preflight before the `PUT`.

The reviewed source of truth is [`r2-cors.json`](./r2-cors.json). It allows the
production origin and the local origins used by the README's Wrangler recipe,
authorizes the actual `PUT`, permits the two headers the signer requires, and
exposes the R2 `etag`. Cloudflare R2 handles the `OPTIONS` preflight itself;
`OPTIONS` is not an allowed R2 method in the API, so the policy lists `PUT`, the
method the preflight asks R2 to authorize. No origin wildcard is permitted.

Apply the same policy idempotently to the production bucket from a clean
checkout after `npm ci`:

```sh
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
node scripts/platform/apply-r2-cors.mjs
```

The wrapper requires both environment variables, passes them only to Wrangler,
and defaults to `marquee-media`. A scoped token that cannot edit the bucket
fails at Wrangler's permission check; do not replace it with a broader token.
To apply the same reviewed policy to the Wrangler preview bucket when a future
browser path actually uses it, set `MARQUEE_R2_CORS_BUCKET=marquee-media-preview`.
The current local recipe uses Miniflare's local R2 binding and does not sign a
browser request to that preview bucket.

## Deploy-time preflight check

The slow, real-provider check is explicitly invoked as:

```sh
MARQUEE_R2_CORS_URL="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/marquee-media/mrq-92-preflight-probe" \
npm run check:r2-cors
```

It performs a real cross-origin `OPTIONS` request, verifies the exact
production origin, `PUT`, `content-type`, and `if-none-match`, then repeats the
probe with a deliberately wrong origin and verifies that origin is not allowed.
When `MARQUEE_E2E_URL` is set, `npm run e2e` runs this check before its deployed
Playwright journey, so a deploy check cannot report a healthy upload path while
the bucket preflight is broken. The R2 probe URL and all credentials are
environment-only.
