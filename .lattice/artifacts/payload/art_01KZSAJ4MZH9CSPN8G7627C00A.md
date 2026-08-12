# Plan Review: MRQ-57 — Real Cloudflare deploy

## 1. Verdict

**FAIL (plan-level)**

Phase 0 (operator credentials) is sound and should start immediately regardless — it is the
long pole and nothing below changes it. Phases 1–5 need revision before an agent executes them.

## 2. Summary

Reviewed the MRQ-57 plan against `wrangler.jsonc`, `README.md`, `EVALUATION.md`,
`package.json`, the check harness (`pr-gate.mjs`, `trace-ac.mjs`, `check-repo.mjs`,
`assemble-public.mjs`, `speed.ts`), and `sequence/OPERATOR-PRECONDITIONS.md`. The operator
sequencing is the best part of this plan — the account-ID hard gate and the "prove R2 with a
real fetch" step are exactly the two things that fail at deploy rather than in dev, and the
credential-path correction is a genuine find.

The key concern is that the plan treats this as a config-and-credentials ticket when the
codebase addresses **three further obligations to MRQ-57 by name** (`check:readme`,
`reset:demo` remote auth, deployed speed evidence), and the two decisions it does make about
`wrangler.jsonc` — which names to use, and what gets committed — both collide with the
**published** README that this repo's own AC-160 gate executes verbatim.

## 3. Issues

```
**[CRITICAL] Phase 1 (resource names) — the plan's names contradict the README's published deploy sequence**
```
`README.md` §"Deploy to Cloudflare" step 2 is the self-host contract and instructs:
`wrangler d1 create marquee-db`, `wrangler kv namespace create CACHE`, and
`wrangler queues create marquee-{mail,mirror,operations,webhook}-queue`. The plan's table
picks `marquee`, `marquee-cache`, and `marquee-{mail,mirror,operations,webhook}` — no `-queue`
suffix, different D1 name.

For D1 and KV this is cosmetic (the commands bind by `DB`/`CACHE` and the README tells the
self-hoster to paste their own IDs). **For queues it is not.** Queue names are the runtime
contract: `wrangler.jsonc` references them literally in four `producers` and four `consumers`
entries. A self-hoster who runs README step 2 verbatim creates `marquee-mail-queue` and then
deploys a config that asks for `marquee-mail` — `wrangler deploy` fails with a
queue-not-found. That is precisely what AC-160 / `npm run check:readme` / EVALUATION gate 14
("Numbered sequence runs verbatim from a clean checkout with zero human input, ending in a
live 200") is built to catch, and this ticket is the one that makes that gate runnable.

**Recommendation:** Adopt the README's names verbatim (`marquee-db`, `marquee-media`, KV
`CACHE`, `marquee-*-queue`). If a different scheme is genuinely wanted, make `README.md` an
explicit deliverable of this PR and update step 2 in the same commit — but the cheap move on
deadline night is to match what is already published.

```
**[CRITICAL] Phase 1 (account_id) — the plan both forbids and instructs committing the account ID**
```
The plan says **"`account_id` comes from the environment and is never committed — the repo
goes public"** and, one sentence earlier, says to replace **`R2_ACCOUNT_ID`** in the `vars`
block. `vars.R2_ACCOUNT_ID` *is* the Cloudflare account ID — it is consumed as the S3 account
id at `src/routes/uploads.routes.ts:75` — and `wrangler.jsonc` is on the public allowlist
(`PUBLIC_ROOT_FILES` in `scripts/checks/assemble-public.mjs`). `README.md` states the same
rule the plan states: *"Keep the account ID in the environment; do not commit it."* Filling
that var in and shipping the assembly publishes it.

The same unasked question applies to the real D1 `database_id` and KV `id`, which the plan
does commit.

**Recommendation:** Settle this explicitly, do not let it be discovered at assembly time. Two
clean options: (a) move `R2_ACCOUNT_ID` out of `vars` into a Wrangler secret — it reaches
`env` identically, so only `wrangler.jsonc`'s `secrets.required` list and `.dev.vars.example`
change; or (b) rule that the account ID and resource UUIDs are not secrets (they are inert
without credentials), record the ruling in the plan, and fix the README sentence that says
otherwise. Either way, name the decision in the plan before the PR.

```
**[MAJOR] Phase 1 (placeholder list) — four of twelve placeholder sites are enumerated**
```
The plan's "Then: replace `REPLACE_ME-DB`, `REPLACE_ME-CACHE`, and the `vars` block's
`R2_ACCOUNT_ID` / `R2_BUCKET_NAME`" is a subset. `wrangler.jsonc` also carries
`d1_databases[0].database_name: "replace-me-db"`, `r2_buckets[0].bucket_name` and
`preview_bucket_name`, and **eight** queue-name strings — four producers *and* four consumers,
which must match each other exactly. The task description's phrasing ("every
`REPLACE_ME-<binding>` placeholder") hides the lowercase `replace-me-*` family entirely.

**Recommendation:** Enumerate all twelve, and make the phase's exit check mechanical:
`grep -ci 'replace.me' wrangler.jsonc` must return 0. Re-run `npx wrangler deploy --dry-run`
and read the printed bindings table — it lists every resolved binding name in one screen.

```
**[MAJOR] Phase 5 (AC-16) — the speed harness cannot target a deployed origin, and no code change is budgeted**
```
`runSpeedCheck` in `scripts/checks/speed.ts` is hard-wired to `withLocalRuntime`, and its
`SpeedReport.environment` is typed as the literal `{ kind: "local-wrangler-dev", runtime:
"wrangler dev/miniflare", deployed: false }`. The `--input` replay seam in `check-speed.mjs`
stamps every such report *"Provided input is not deployed evidence; MRQ-57 owns production
measurements."* There is no supported way to point `check:speed` at `https://marquee.stage11.dev`.

Further, `speed.ts:374` assigns MRQ-57 the **whole** deployed budget set — "`/f/:formSlug`
cold interactive, browser search paint, board/portal surfaces, and production Long Tasks" —
not just AC-16's dashboard p95, which is the only one the plan mentions. The plan lists no
source files to modify and budgets 2 hours.

**Recommendation:** Pick one and write it down: (a) add a deployed-runtime seam (a `--url`
option plus a `deployed: true` environment variant) — a real code change that goes through the
merge gate and is not 2 hours' work on top of everything else; or (b) descope deployed speed
evidence to a named follow-up ticket and say so, leaving AC-16's hard half on local evidence
with the residual at checkpoint C2. Silence here reads as "covered" and is not.

```
**[MAJOR] Scope — two further obligations the codebase addresses to MRQ-57 by name are unmentioned**
```
- **`check:readme`** is still a stub: `package.json` registers it as
  `stub-command.mjs check:readme MRQ-57 "self-host deploy sequence is not implemented"`. That
  is EVALUATION §1.1 and **gate 14**. Meanwhile `tests/ac-claims/MRQ-40.json` already *owns*
  AC-160, and `trace:ac` reports `uncovered: 0` — so the contract reads as covered while the
  command is a stub. This ticket is the one that unblocks it (it needs a real Cloudflare API
  token in CI, EVALUATION §113 item 7).
- **`reset:demo` remote auth** — `scripts/reset-demo.mjs:13`: *"Remote invocation auth is
  deferred to MRQ-57."* The script hard-requires `LOCAL_VALIDATION_TOKEN` and the
  loopback-only header, so it cannot reset the deployed demo. On a judged URL that a
  practitioner will click through, "reset the demo" is not a nicety.

**Recommendation:** For each, decide implement-or-defer *in the plan*, with a named owner
ticket for anything deferred. An obligation the code names and the plan doesn't is how a gate
goes missing between two tickets that each thought the other had it.

```
**[MAJOR] Missing gate — the public artifact is never refreshed, and `check:repo` is absent**
```
`wrangler.jsonc` is in the public assembly, and the competition artifact is the orphan
`mrq-42-assembly`. After MRQ-57 the public tree still carries `replace-me-*` unless the
assembly is re-run — a judge cloning the public repo gets the placeholders that README line 45
calls "a deliberate stop sign." More pointed: this is the **one ticket that handles real
secrets**, and `check:repo` — gitleaks over full history, plus the denied-path and denied-
content scan — is not in the plan's gate list.

**Recommendation:** Add as the closing phase: `npm run assemble:public`, then
`npm run check:repo -- --repo <assembly> --ref mrq-42-assembly`. Note `check:repo` hard-fails
on `gitleaks-unavailable`, so confirm gitleaks is installed before relying on it.

```
**[MAJOR] Risk not identified — the `stage11.dev` zone may not live in the account being logged into**
```
Phase 0's hard gate compares `wrangler whoami` against the vault's `CLOUDFLARE_ACCOUNT_ID`.
That is the right check for the Worker and it is well chosen. But a Workers **Custom Domain**
additionally requires the *zone* to sit in that same account, and the plan's own template
table lists `CLOUDFLARE_ZONE_ID_STAGE11_DEV` as a separate value with no stated account. If
`stage11.dev` is on `Stage11Agentics` or `atin@atin.me`, then both `marquee.stage11.dev` and
`media.marquee.stage11.dev` are unattachable — and that is a zone-move in a dashboard, not a
retry. It shares the exact property the preconditions doc is organised around: invisible in
dev, detonates at deploy.

**Recommendation:** Add a Phase 0 step, before any resource is created: confirm the
`stage11.dev` zone's owning account equals the Worker account. Cheapest check is the zones
list on the authenticated account.

```
**[MINOR] Phase 3 — `CI=1` is missing from the migration apply**
```
README step 4 runs `CI=1 npx wrangler d1 migrations apply DB --remote`. Without `CI=1` the
remote apply prompts for confirmation and an unattended run hangs rather than fails. Same
class of thing: the demo-mode `d1 execute` in README needs `--yes`.

**Recommendation:** Copy the README's exact invocations. They already encode this.

```
**[MINOR] Phase 4 — "Deploy" should name `npx vite build && npx wrangler deploy`**
```
Verified by dry-run: `wrangler deploy` at the repo root is silently redirected via
`.wrangler/deploy/config.json` to the build-generated `dist/marquee/wrangler.json`, which is
what supplies `assets.directory: "../client"` and `main: "index.js"` — the root
`wrangler.jsonc` has no `assets.directory` at all. Deploying from a tree that hasn't been
built, or with a stale `dist/`, is the failure mode. The plan runs `vite build` in its gate
list but not in the deploy phase.

**Recommendation:** State the two commands together in Phase 4, and re-run `--dry-run` first
to read the resolved bindings table before the real deploy.

```
**[MINOR] Constraints — the substitute gate omits `pr-gate` and the AC claim manifest**
```
`scripts/checks/pr-gate.mjs` is the declared merge gate: three typechecks, `vite build`,
`check:design`, `check:api`, `npm test`, and `trace:ac --scope=merged --ticket=MRQ-N`. The
plan's hand-rolled list is that minus `npm test`. Skipping the suite is defensible — run-state
confirms 145–158s against a 45s *objective*, and `run-test.mjs` reports `pass-over-budget`
rather than failing — so the plan's reasoning is right even though it bypasses the wrapper.
But `trace:ac` emits a `missing-current-ticket-manifest` warning unless
`tests/ac-claims/MRQ-57.json` exists, and the plan never mentions creating one.

**Recommendation:** Run `npm run pr-gate -- --ticket MRQ-57` (it is the same checks, correctly
ordered, with the harness timing recorded) and add the claim manifest — or state explicitly
that MRQ-57 owns no `auto` ACs and the warning is expected.

```
**[MINOR] Phase 4 — merge-gate sequencing versus what is actually live**
```
The plan edits `wrangler.jsonc`, deploys, then verifies, while `main` sits behind a human
merge gate. It never says whether the judged URL is deployed from the unmerged branch and
re-deployed after merge, or whether merge precedes deploy.

**Recommendation:** Say which. On deadline night, an unrecorded divergence between `main` and
what is live is the expensive kind of ambiguity.

```
**[MINOR] Safety fix — the `.gitignore` protection is left as an unowned working-tree edit**
```
Catching that `code/platform/.gitignore` did not ignore `.env` before running
`op inject -o .env` is the single best thing in this plan. But "left uncommitted (Atin's repo,
Atin's call)" means one `git clean` erases it, and the hydration it protects happens tonight.

**Recommendation:** Raise it to Atin as an explicit one-line ask during Phase 0 — the same
conversation that is already happening at the keyboard — rather than leaving it hanging.

## 4. Positive Observations

- **Phase 0 is the strongest section.** The account-ID hard gate with an explicit **STOP** is
  the right shape for the one mistake that is worse than no work, and "prove the R2
  entitlement with a real fetch, not a dashboard checkbox" correctly refuses to trust the
  surface that has lied before. Both are lifted faithfully from
  `sequence/OPERATOR-PRECONDITIONS.md` and sharpened rather than just restated.
- **The credential-path correction is real work, not plan padding.** Tracing §3's "pull it
  from `.env` in the platform repo" to a file that is *generated, not missing*, and then
  laying out what hydration does and does not yield in a two-column table, is exactly the
  research that stops a 20-minute dashboard detour at 11pm.
- **Discovering the missing `.env` gitignore before hydrating** is the kind of find that only
  comes from actually looking, and it was verified with `git check-ignore` rather than assumed.
- **Honest carry-forward of MRQ-14's real-resource-only assertions.** Naming them as this
  ticket's checklist rather than letting them evaporate between miniflare and production is
  precisely the discipline that keeps "tested" from quietly meaning "tested against mocks."
- **"Confirm with Atin before the first real deploy and before any DNS change"** is correctly
  placed — outward-facing and hard to reverse, exactly where a checkpoint belongs.
- **Follow-ups routed back to `code/platform/`** per the house rule, with the doc defects named
  specifically rather than as a vague "update the docs."
