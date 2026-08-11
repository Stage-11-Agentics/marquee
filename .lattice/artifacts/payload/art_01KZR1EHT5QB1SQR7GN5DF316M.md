# Code Review: MRQ-40 — README, self-host path, and extension points

Reviewed at branch `mrq-40-readme` (`19a777f`, commits `99e1833` + `19a777f`).
Real diff vs master: `README.md` (+316/−15), `tests/ac-claims/MRQ-40.json` (new),
`tests/node/readme.AC-160-162.test.mjs` (new). The `.lattice/*` files in the
supplied diff are orchestration state, not reviewable product changes.

**Note on timing:** master merged this branch (`4e90d44`) and removed the
worktree while this review was in flight. The verdict below still stands as the
review of record; the two major issues are small follow-up commits, not a
revert.

## 1. Verdict

**FAIL (implementation-level)** — the plan is sound and the deliverable is
close to excellent, but the README contains one factually false claim about
the API surface (webhooks) and the claims manifest marks AC-161 as owned and
covered when its EVALUATION oracle (the `e2e:empty` crawler) does not exist
anywhere in the tree. Both are surgical fixes (~20 lines including the test
update). Everything else verified clean.

## 2. Summary

I verified the README's claims against the actual code rather than reading it
as prose: every local command, flag, path, endpoint, payload, and seeded ID
checks out against the implementation, and the new tests plus the full
hermetic suite pass (11.6s, within the 30s budget; `trace:ac` green). The one
correctness defect is the webhook sentence, which claims contract-level
definition of a feature that has no route, no OpenAPI entry, and no migration
table — in a ticket whose explicit charter is honest claims. Secondary: the
AC-161 ownership claim papers over a missing e2e oracle and will collide with
BUILDPLAN M-48's `duplicate-owner` check later.

## 3. Issues

**[MAJOR] README.md:41-43 — Webhook claim is false against the shipped API surface**
"Signed outbound webhook endpoints are defined in the API contract, but
delivery is deferred: this checkout does not send webhook deliveries yet."
Nothing webhook-shaped exists in the served API contract: `grep -ri webhook
src/` finds only the `WEBHOOK_QUEUE` binding (`src/index.ts:32`) and the
Airtable mirror's inbound-webhook columns (`src/db/schema.ts:556-557`); there
is no webhook route module, no OpenAPI entry, no `webhook_endpoints` table in
`migrations/0001_init.sql`, and no `/settings/webhooks` screen. The design
lives only in `SPEC.md` §330-331 (AC-241). Since the README defines "the API"
two paragraphs earlier as "generated from the same route definitions that the
Worker serves," a stranger will open `/api/docs`, find no webhook endpoints,
and conclude the README overclaims — the exact failure mode this ticket exists
to prevent. The sentence also implies endpoint *registration* works and only
*delivery* is deferred; neither exists. The claim is locked in by
`tests/node/readme.AC-160-162.test.mjs:24`.
**Fix:** Reword to match reality, e.g. "Signed outbound webhooks are a
specified extension (see SPEC.md); neither endpoint registration nor delivery
is built in this checkout." Alternatively move webhooks into the extension-
points table alongside the other three honest non-features. Update the
matching assertion in the test.

**[MAJOR] tests/ac-claims/MRQ-40.json:3 — Owning AC-161 masks the missing empty-install crawler**
`EVALUATION.md:549` defines AC-161's oracle as "`e2e:empty` crawler over an
empty install: every route renders an empty-state component containing a
next-action link." No such crawler exists (`git grep "e2e:empty\|empty-install"
-- tests/ scripts/` matches only the new README test), and `BUILDPLAN.md:141`
assigns that work to **M-48**. By claiming `owns: ["AC-161"]` and titling a
prose-matching README test `AC-161 · …`, this ticket makes `trace:ac` report
`uncovered: 0` — the ledger now says an `auto` AC is covered when its actual
oracle is unbuilt. When M-48 lands and claims ownership, `trace-ac-core.mjs`
(`duplicate-owner`) will error. The ticket's "ACs: AC-160 – AC-162" line
explains the choice, but the board double-books AC-161 across M-45 and M-48,
and the manifest is where that collision becomes mechanical.
**Fix:** Move AC-161 from `owns` to `exercises` in `tests/ac-claims/MRQ-40.json`
(the README test legitimately exercises the documentation facet), leaving
ownership free for M-48's crawler — or file the debt explicitly so M-48's
delegator knows to take ownership and this ticket's test keeps only the
exercise claim.

**[MAJOR] README.md:47-118 — The numbered local sequence is not verbatim-executable by the gate it backs**
AC-160 / gate 14 (`check:readme`, still a stub pointing at MRQ-57): "executes
the README's numbered deploy sequence **verbatim** — commands extracted from
its fenced blocks — … with **no human input at any step**." As structured,
a verbatim extractor of the numbered steps hangs at step 3 (`wrangler dev`
runs foreground and never exits) and step 4 requires a concurrent second
terminal. The one-shot smoke (step 5) is the correct no-human-input path — it
backgrounds the Worker, polls health, and cleans up — but nothing
machine-readable tells an extractor "run blocks 1, 2, 5; skip 3, 4," and the
deploy section's `sh` blocks (`wrangler login`) are interactive as well. This
is a coordination risk with MRQ-57 rather than a defect a user hits today,
but MRQ-40 owns the README that gate must consume, and the gate-backing role
is the reason this ticket outranked the cut line.
**Fix:** Adopt a marker MRQ-57 can key on: fence the foreground/interactive
blocks as something other than `sh` (e.g. `sh session`/`console`), or precede
gate-runnable blocks with an HTML comment (`<!-- readme-gate:run -->`), and
note the convention in a line MRQ-57 can inherit. Cheap now, ambiguous later.

**[MINOR] README.md:34-36 — `mirror:write` reads as issuable by program leads**
"Organization program leads and owners can issue named bearer tokens with
explicit permission scopes (… and `mirror:write`)." Per
`src/lib/auth/scope-resolution.ts:14-35`, `mirror:write` is owner-only; a
program lead's grant set stops at `comms:send`. The trailing "effective
authority never exceeds the issuer's membership" technically covers it, but
the flat list invites a program lead to try and fail.
**Fix:** Append "(`mirror:write` is owner-only)" or split the list.

**[MINOR] README.md:74-76 — "the local config used by the next command" is ambiguous**
The sentence follows step 2's block, whose own commands (`d1 migrations
apply`, `seed`) deliberately use the root `wrangler.jsonc` — only step 3's
`wrangler dev --config dist/marquee/wrangler.json` uses the emitted config
(matching the established pattern in `scripts/checks/local-runtime.ts:126-135`).
A careful reader will wonder whether the migrations command silently used the
wrong config.
**Fix:** "…which step 3's `wrangler dev` uses; migrations and seed use the
repository `wrangler.jsonc`."

**[MINOR] README.md:212-215 — Demo-off local variant says "with" when it means "instead of"**
"For a local instance, use the same command with `--local --persist-to
<your-state-dir>`." The same command contains `--remote`; the flags must
replace it, not join it (`wrangler d1 execute` rejects `--local` + `--remote`
together).
**Fix:** "…replacing `--remote` with `--local --persist-to <your-state-dir>`."

## 4. Positive Observations

- **Every executable claim I checked is true.** Node engine floor (22.18 ↔
  `package.json` engines), seed flags `--remote`/`--persist-to`
  (`scripts/seed/index.ts` header contract), `CI=1` migrations, the
  dist-config-for-dev / root-config-for-migrations split (mirrors
  `scripts/checks/local-runtime.ts` exactly), health payload
  (`src/index.ts:88` literal match), demo login role enum / `403
  demo_disabled` / `mq_session` cookie (`src/routes/auth.routes.ts:20-110`,
  `src/lib/cookies.ts:4`), seeded event id `evt_aie-ny-2026`
  (`scripts/seed/event.ts:14` + `src/lib/ids.ts`), `wrangler d1 execute
  --yes` (verified against the installed wrangler 4.x help), the submissions
  `total` field the grep oracle keys on
  (`src/routes/submissions.queries.ts:415`), the landing empty-state copy
  ("No demo conference is configured yet.",
  `src/routes/landing.route.tsx:112`), the non-loopback HTTPS redirect
  (`src/index.ts:70`), the exactly-two `always_live` write sites
  (`src/jobs/mail/outbox.ts:129,134`), and the four queue names/bindings
  (`wrangler.jsonc:66-78`). That density of verified truth is rare in READMEs.
- **The one-shot smoke block is genuinely well-engineered shell**: `set -eu`,
  trap-based cleanup of both the Worker PID and the temp state dir, a bounded
  60-attempt readiness poll, and a data oracle that greps a non-zero `total`
  from an authenticated API response instead of trusting a 200.
- **The hosted/local boundary is drawn with unusual honesty** — "Wrangler dev
  is local-only here. It is not evidence that a production Cloudflare
  account… is configured," the `REPLACE_ME` stop-sign framing, and the
  Airtable mirror presented exactly per Amendment 4 (deliberate trade, never
  source of truth).
- **The M-30 fold-in was done properly**: the Sessionize section reproduces
  `docs/notes/M-30.md` faithfully, including the AC-109 caveat that the
  fixture has never been checked against a real export — a limitation most
  authors would have quietly dropped.
- **Tests are the right weight for the ticket**: plain `node:test`, literal
  AC-prefixed titles that satisfy `trace-ac-core`'s AST scan, `\s+` used where
  the README wraps, and a `doesNotMatch(/\bMRQ-\d+\b/)` hygiene assertion
  that keeps ticket numbers out of the public document. Full suite green in
  11.6s of the 30s budget; `trace:ac` reports 0 errors.
- **Public-repo hygiene held**: the old `marquee.stage11.dev` route is gone in
  favor of `your-domain.example`, and no Stage 11 / Lattice / c11 / internal
  references survive in the README.
