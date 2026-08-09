# Marquee

Marquee is an open-source speaker and session management platform for conference organizers. This repository currently contains the Cloudflare Workers walking skeleton.

## Local development

Requirements: Node.js 20.19 or newer.

```sh
npm install
cp .dev.vars.example .dev.vars
npx vite build
npx wrangler dev
```

Wrangler serves the local Worker over HTTPS with a development certificate. The committed example uses Cloudflare's published always-pass Turnstile test keys. They are for local development only and must never be deployed.

## Local PR gate

Every delegator runs the fast local gate immediately before pushing and opening a pull request:

```sh
npm run pr-gate -- --ticket MRQ-N
```

The gate type-checks the Worker, client, and tests; builds both bundles; verifies the Flight Deck design contract; runs the hermetic test suite within its 30-second ceiling; and traces the current ticket's acceptance-criterion claims. See [`scripts/checks/README.md`](scripts/checks/README.md) for the stable harness commands, claim manifest format, and fast/slow boundary.

## Cloudflare deployment

Wrangler must be authenticated, and the target account ID must be supplied through the environment rather than committed configuration:

```sh
export CLOUDFLARE_ACCOUNT_ID="<cloudflare-account-id>"
npx wrangler login
```

Before deploying, replace every `REPLACE_ME-*` or `replace-me-*` resource value in `wrangler.jsonc`, store production Turnstile values with Wrangler secrets, and confirm the account is on Workers Paid. The production route is HTTPS-only at `https://marquee.stage11.dev`.
