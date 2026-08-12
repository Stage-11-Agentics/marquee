# MRQ-104: CLI reaches 8% of the API — close the agent-native gap with the verbs the walkthrough loop actually needs

PHILOSOPHY.md §3 claims 'a CLI — every workflow drivable from a terminal, scriptable, composable'. Today cli/marquee.mjs ships 11 commands touching 11 of the API's 133 operations (2 of 81 writes), covering roughly 3 of the 11 walkthrough-loop steps. Research: sequence/research/cli-parity.md.

The expensive half is already done: every /api/v1 path referenced under src/ui/** is a documented, bearer-authenticated operation, and securityFor() emits bearerAuth on every non-public route. There is no web-only capability anywhere in the product. So this is not API work — it is dispatch branches over endpoints that already answer.

SCOPE (the recommended cut from the research, ~1 day):
1. Add "bin": {"marquee": "cli/marquee.mjs"} to package.json so AC-141's 'marquee --help' is literally true.
2. Four verbs that matter: submissions schedule, submissions publish, agenda place, search.
3. Event configuration: event set, tracks list/add/remove, formats list/add/remove. Needs patch/delete helpers on MarqueeClient.
4. Agenda writes: agenda move, agenda remove. These are the ONLY two if-match routes in the product; MarqueeClient neither reads ETags nor sends If-Match, so this needs a read-then-write helper.
5. Regenerate SKILL.md via cli/generate-skill.mjs — both raw curl blocks must disappear.
6. Extend tests/node/cli.AC-138-141-250.test.mjs and skill.AC-142-144.test.mjs.

OUT OF SCOPE: form-field CRUD, venue geometry, portal verbs, imports, saved views, embeds. Legitimately visual or one-time; the API is the right level and a CLI verb would be worse than curl. Do NOT build a generated OpenAPI passthrough.

ACCEPTANCE CRITERIA:
- marquee (or node cli/marquee.mjs) drives 9+ of the 11 walkthrough-loop steps.
- SKILL.md contains zero curl blocks and regenerates clean under generate-skill.mjs --check.
- Every new command supports --json with exactly one JSON value on stdout (AC-139) and has its own --help (AC-141).
- agenda move round-trips If-Match correctly against a real 409.
- npm test green inside its 45s budget; npm run check:api still passes.
- PHILOSOPHY.md §3's CLI bullet is true as written, or amended to what shipped.

WHEN DONE the operator can hand an agent SKILL.md and a token and have it configure an event, triage, accept, schedule and publish without a browser and without curl.

## Reset 2026-08-12 by agent:claude-cli-parity
