# MRQ-146 plan

## Goal

Make the two agent-facing deployment claims match the behavior that actually ships:
scope the OpenAPI concurrency statement to the two agenda mutation operations and
make the repository's generated `SKILL.md` fetchable as markdown from the deployed
Worker.

## Implementation

1. Baseline the clean branch and inspect the existing OpenAPI, route, asset, and
   check seams before editing.
2. Update the canonical OpenAPI description in `src/api/openapi.ts` so it does not
   claim concurrency on every mutation. Add required `If-Match` header parameters
   to the PATCH and DELETE agenda-item route definitions in
   `src/routes/agenda.routes.ts`, keeping the existing route registry as the one
   source for served JSON, rendered docs, and CLI parity.
3. Add a Worker route in `src/index.ts` that serves the canonical root `SKILL.md`
   content as `text/markdown; charset=utf-8`, and add `/SKILL.md` to
   `wrangler.jsonc` `assets.run_worker_first` so Cloudflare's assets router cannot
   replace it with the SPA shell. Do not create a second hand-maintained skill
   copy or broaden the public asset allowlist.
4. Add focused regression coverage for the OpenAPI description/header inventory
   and the served skill response if the existing test seams support it without
   expanding scope.

## Verification and handoff

- Confirm the clean-branch baseline and distinguish environment/load failures from
  product failures.
- Run the focused tests, `npm run check:api`, and the required
  `npm run pr-gate -- --ticket MRQ-146` on the committed exact HEAD.
- Build or exercise the Worker locally to prove `/SKILL.md` starts with markdown
  content rather than the SPA doctype, and inspect the generated bundle/config.
- Record the exact OpenAPI description and case-sensitive `If-Match` count, the
  first three served skill lines, check/gate results, and any live deployment
  limitation in the PR body. Open the GitHub PR only after pushing the exact
  validated branch; leave deployment as a separate human/operator gate.
