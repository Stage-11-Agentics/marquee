# Plan Review: MRQ-92 — R2 browser-upload CORS

## 1. Verdict

**FAIL (plan-level)**

The plan is disciplined in spirit — right diagnostic order, right secret hygiene, right
insistence on deployed evidence — but three of its concrete commitments do not survive
contact with this repository: it wires a check into a "deploy check" that does not exist,
it places a real-network check in a suite whose contract forbids network, and it derives
the local-dev origin from a Vite dev server this repo does not run. It also names no
files, in a repo where file placement is gated by a public-assembly allowlist.

## 2. Summary

Reviewed the MRQ-92 execution plan against the task description and the live repository
(`upload-client.ts`, `presign.ts`, `PortalPage.tsx`, `wrangler.jsonc`, `package.json`,
`scripts/checks/*`, `vitest.*.config.ts`, `README.md`, `assemble-public.mjs`). The
approach — read live CORS first, commit a policy plus idempotent apply command, add a
separately-invoked preflight check, humanise the failure copy, prove it on the deployed
site — is the correct shape and matches the task's required outcomes one for one.

The key concern is that several steps are specified against surfaces that do not exist
here as described, so an implementer following the plan literally will either invent
scope or silently drop a requirement. Secondarily, the plan carries a single hypothesis
(missing bucket CORS) where the repo supports a second hypothesis that produces the
*identical* browser symptom and has a completely different fix.

## 3. Issues

**[CRITICAL] Approach step 4 — "wire that exact check into the deploy check": there is no deploy check in this repo**

`package.json` has no deploy script. The nearest things are stubs owned by other
tickets: `check:readme` is `stub-command.mjs check:readme MRQ-57 "self-host deploy
sequence is not implemented"`, and `run-e2e.mjs` runs `runStub(... owner: "MRQ-50" ...)`
until `tests/e2e` contains specs. `pr-gate.mjs` is the merge gate and is deliberately
hermetic (typechecks, build, design contract, API contract, `npm test`, AC trace) — a
check that needs real network and real Cloudflare credentials cannot go there without
breaking the gate for every other agent and every CI run without secrets.

The plan therefore commits to an integration point that the implementer will have to
invent, and inventing a deploy pipeline is far outside this ticket.

**Recommendation:** Replace "wire it into the deploy check" with an explicit decision:
add `check:cors` as a standalone npm script (following the `check:speed` / `check:seed`
pattern — `scripts/checks/` module using `parseArguments`/`emit` from `lib/command.mjs`,
failing closed when its env vars are absent), document it in `scripts/checks/README.md`
alongside the other separately-invoked commands, and record in the PR that pipeline
wiring belongs to MRQ-57's deploy sequence. If the plan genuinely intends to touch
`pr-gate.mjs`, it must say so and justify the credential and hermeticity implications.

---

**[CRITICAL] Approach step 4 — "integration check" collides with the hermetic fast suite**

In this repo `tests/integration/**` is *not* the slow suite. `vitest.config.ts` declares
two projects (`vitest.worker.config.ts`, `vitest.node.config.ts`) that together are
`npm test` — the 45s hermetic suite. `scripts/checks/README.md` states the contract
plainly: "Outbound `fetch` is denied. It never uses a deployed URL, real
Resend/Airtable/R2…". A file dropped in `tests/integration/` that performs a real
`OPTIONS` against `marquee-media` would violate that contract, need live credentials in
every local run, and add network latency to the inner-loop clock.

**Recommendation:** State the surface unambiguously in the plan: the preflight check is a
`scripts/checks/` command invoked by name (`npm run check:cors -- --origin=…`), **not** a
Vitest file under `tests/`. If a unit test is also wanted, it should test the policy
JSON's shape (origins explicit, no `*`, required headers present) inside the fast suite,
which is hermetic and genuinely would have caught a malformed policy.

---

**[MAJOR] Judgment call 1 — the "Vite dev origin" does not exist; the localhost origin is dead config**

Two factual problems. First, there is no `dev` script in `package.json` and
`vite.config.ts` declares no `server` block — the documented local recipe in `README.md`
is `npx wrangler dev … --port 8787`, i.e. the local origin is `http://127.0.0.1:8787`,
not a Vite origin. Second, and more important: local dev signs with the fake credentials
from `.dev.vars.example` (`R2_ACCOUNT_ID=local-fake-account-id`), so a local browser PUT
targets `https://local-fake-account-id.r2.cloudflarestorage.com` and never touches
`marquee-media` at all. Adding a localhost entry to a production bucket's
`AllowedOrigins` is permanent, reviewable attack surface that buys nothing.

**Recommendation:** Change the judgment call to: scope `AllowedOrigins` to
`https://marquee.stage11.dev` only, with a comment in the policy file (or its README)
recording *why* no local origin is listed — local dev signs against a fake account and
never reaches this bucket. If the implementer finds a real local or preview path that
signs against `marquee-media` with real credentials, add that exact origin and say so in
the PR. Either way, do not derive an origin from a dev server this repo does not run.

---

**[MAJOR] Approach step 2 — one hypothesis carried where two produce the identical symptom**

`xhr.onerror` fires for DNS failure as readily as for a blocked preflight. If the
production `R2_ACCOUNT_ID` secret is unset or wrong, `presignPut` builds
`https://<wrong-or-undefined>.r2.cloudflarestorage.com/...` and the browser fails to
resolve it — producing exactly `upload PUT network error`, with no CORS involvement and
a completely different fix (set the secret, not the bucket policy). `R2_ACCOUNT_ID` is a
Wrangler secret by design (see the comment in `wrangler.jsonc` `vars`), so it is exactly
the kind of value that can be missing on a deployed Worker while every test stays green.

The plan's step 2 says "capture the browser-visible preflight failure/console evidence",
which presumes the preflight is what fails.

**Recommendation:** Make the diagnosis step branch explicitly on three distinguishable
console signatures before any fix is chosen: (a) name-not-resolved / `ERR_NAME_NOT_RESOLVED`
on the signed host → account-ID/secret problem, not CORS; (b) "blocked by CORS policy" /
preflight `OPTIONS` present with a non-allowing response → the CORS hypothesis; (c) HTTP
status surfaced through `xhr.onload` → credential/permission, i.e. MRQ-89 territory.
Record the signed hostname actually observed in the network panel — it either matches the
real account ID or it does not, and that single observation separates (a) from (b) in
seconds.

---

**[MAJOR] Approach step 5 — the error-copy fix ignores the repo's existing error system and covers one of three call sites**

`src/ui/shell/api-client.ts` already owns this problem: `ERROR_TREATMENTS` maps
`MarqueeErrorCode` (including the client-side `offline` and `unreachable`) to plain
sentences with recovery copy, and `describeError` / `errorSummary` / `referenceCode`
render them. `apiFetch` already distinguishes offline from unreachable "because a dropped
connection and a broken server are different problems". A hand-written sentence in
`PortalPage.tsx` would be a second, parallel copy system for the same failure class.

Also, `putFileToR2` has **three** call sites — `PortalPage.tsx:168`,
`CoSpeakerPage.tsx:113`, and `PublicForm.tsx:238`. The public submission form is on the
11-step walkthrough loop and fails identically under this bug. Fixing copy only in the
speaker portal leaves "upload PUT network error" on the co-speaker and public-submission
paths.

Finally, the portal already has the retry affordance the task asks for: the catch sets
`canRetry` for file tasks and the button renders as "Retry upload". A new retry control
would duplicate it.

**Recommendation:** Rewrite step 5 as: map the XHR failure into the existing error
vocabulary (throw a `MarqueeApiError` with `offline`/`unreachable`, or map at the call
site through `ERROR_TREATMENTS`) so all three call sites get the plain sentence from one
change; keep the exact string `upload PUT network error` as the logged/console detail;
and reuse the existing `canRetry` affordance rather than adding a control. Note the
trade-off if `upload-client.ts` is to stay dependency-light — its header comment says
"framework-neutral", so the mapping may belong at the call sites rather than inside the
transport. Pick one and state it.

---

**[MAJOR] Judgment call 2 — the apply credential is not MRQ-89's, and `set` is destructive**

The plan speaks of "the least-privileged Cloudflare/R2 interface already supported by the
installed toolchain" and of MRQ-89's scoped credential in the same breath. These are
different credential classes: the installed wrangler (4.120) does support
`wrangler r2 bucket cors set|list|delete <bucket> --file <json>` (verified against
`node_modules/.bin/wrangler r2 bucket cors --help`), but it authenticates with Cloudflare
account auth / `CLOUDFLARE_API_TOKEN`, **not** with the S3 access key pair MRQ-89 issued
for the Worker's signer. Vagueness here is how a token gets widened by accident.

Separately, `cors set` replaces the entire configuration — there is no merge — so
overwriting an existing (if unknown) policy without a captured "before" leaves no
rollback.

**Recommendation:** Name the mechanism in the plan: `wrangler r2 bucket cors set
marquee-media --file <policy>.json`, authenticated by an account API token supplied from
the environment, explicitly distinct from the MRQ-89 signer key which is neither used nor
modified. Add a step: run `wrangler r2 bucket cors list marquee-media` first and paste the
pre-change configuration into the PR as the rollback record.

---

**[MAJOR] Whole plan — no files named, in a repo where placement is gated**

The review checklist asks whether the plan identifies files created or modified; it names
none. This is not pedantry here, because `scripts/checks/assemble-public.mjs` gates the
public artifact by allowlist: `PUBLIC_ROOT_DIRECTORIES` is `.github, cli, fixtures,
migrations, scripts, src, tests` and `PUBLIC_ROOT_FILES` is an explicit list. A policy
JSON or doc placed at a new top-level path — or in `docs/`, which is *not* on the
directory allowlist — silently fails to reach the public tree that the competition
requires. Files under `scripts/` publish without any allowlist edit.

**Recommendation:** Enumerate the file list in the plan, e.g. `scripts/checks/r2-cors.json`
(or `scripts/r2/cors.json`), `scripts/checks/check-cors.mjs`, a `check:cors` entry in
`package.json`, `scripts/checks/README.md`, `src/ui/upload/upload-client.ts` and/or the
three call sites, plus a fast-suite test asserting the policy shape. Confirm each path is
inside an allowlisted root, and state whether `assemble-public.mjs` needs any edit (it
should not, if everything lands under `scripts/`, `src/`, `tests/`).

---

**[MINOR] Approach step 8 — the platform doc lives outside this repository**

Required outcome 2 names `code/platform/cloudflare.md`, which is in the Stage 11
monorepo, not in the Marquee checkout. It cannot be part of the PR, and its content must
never be mirrored into this repo: `scripts/checks/repo-policy.mjs` denies committed
content matching `/Stage[- ]?11/i` and related internal markers.

**Recommendation:** Split the documentation deliverable explicitly — in-repo docs (the
policy file's own comments plus `scripts/checks/README.md`) ship in the PR; the platform
knowledge-base entry is a separate write to the other checkout, noted as done in the PR
description rather than included in it.

---

**[MINOR] Whole plan — AC lineage is not mentioned**

`pr-gate.mjs` runs `trace:ac --scope=merged --ticket=MRQ-92`, and `trace-ac.mjs` emits a
`missing-current-ticket-manifest` warning when no `tests/ac-claims/MRQ-92.json` exists —
one manifest per ticket is the established convention (`tests/ac-claims/MRQ-10.json`
through the rest). The project rules also require requirement/AC lineage.

**Recommendation:** Add a step covering `tests/ac-claims/MRQ-92.json` and whether this
ticket claims existing AC IDs or is a defect fix outside the AC register — either is
fine, but the plan should decide rather than discover it at gate time.

---

**[MINOR] Approach steps 7–8 — the acceptance items are not mapped to pre- vs post-deploy evidence**

The plan validates live but declares deployment out of scope. That is coherent only
because the CORS fix is bucket-side and takes effect without a deploy — worth stating,
since it is what makes the live-upload acceptance achievable before merge. The copy
change, by contrast, cannot be seen on `marquee.stage11.dev` until something deploys.

**Recommendation:** Add a short acceptance-to-evidence table to the plan: live upload
completion + `OPTIONS`/`PUT` evidence (post-CORS-apply, pre-deploy); wrong-origin
rejection (curl or fetch with a bogus `Origin`, no deploy needed); re-appliable-by-one-
command (command transcript run twice, showing idempotence); human failure sentence
(local evidence + test, flagged explicitly as not-yet-deployed). Naming the one item that
cannot be proven live is more honest than leaving it implied.

---

**[MINOR] Approach step 3 — `ExposeHeaders: etag` is requested but nothing reads it**

`upload-client.ts` never reads a response header; completion goes through
`/api/v1/me/uploads/{id}/complete`. Exposing `etag` is harmless and the task asks for it,
so keep it — but the plan should not treat it as load-bearing, and the preflight check
should not assert on it as if a failure there would break uploads.

**Recommendation:** Keep `etag` exposed per the task, and scope the check's hard
assertions to what actually gates the upload: `PUT` allowed from the production origin,
`content-type` and `if-none-match` in `AllowedHeaders`, and a wrong origin rejected.

## 4. Positive Observations

- **The diagnostic order is respected and reasoned, not ritual.** Step 2 reads live CORS
  before changing anything and explicitly separates a 403 credential response from a
  browser-level failure — exactly the discipline that keeps this from becoming a
  speculative MRQ-89 change.
- **Secret hygiene is treated as a first-class constraint**, and the refusal to widen
  MRQ-89's token silently — documenting the blocker instead — is the right instinct for a
  repo heading to public.
- **Narrow-fix discipline on the preview bucket.** Making a preview-bucket policy
  conditional on proof that browser uploads use it, rather than applying it defensively,
  is precisely the right call — and correct: the preview bucket is a `wrangler dev
  --remote` binding, not a browser PUT target.
- **The evidence stance is unusually honest.** Refusing to label local tests or a stub e2e
  runner as deployed proof, and pre-committing to record the WKWebView network-panel
  limitation rather than claiming a panel it may not have, is exactly the standard this
  ticket's acceptance demands.
- **Scope and non-goals are crisp** — public repo assembly, deploy wiring, and merging are
  named as out of scope, which is what keeps a ship-blocking bug fix from turning into an
  infrastructure project.
