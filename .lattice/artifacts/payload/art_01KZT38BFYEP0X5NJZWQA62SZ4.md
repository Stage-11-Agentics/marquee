# Code Review: MRQ-92 — restore browser upload path

Reviewed at worktree `mrq-92-r2-cors`, HEAD `6e01a40`, against PR #46
(`Stage-11-Agentics/marquee`).

## 1. Verdict

**FAIL (implementation-level)**

The diagnosis is right, the fix is real, and I verified the production outcome
independently (see §4). The failure is in the surrounding wiring: the policy file
is committed to a path that the public-assembly allowlist silently drops, which
leaves the *public competition repo* with a failing test suite and a broken apply
script; and the `run-e2e.mjs` hook regresses `npm run e2e`. Both are small,
mechanical fixes.

## 2. Summary

Reviewed the R2 CORS policy, its apply wrapper, the `check:r2-cors` probe, the
`run-e2e` wiring, the speaker-facing error copy, and the new tests. The core
mechanism is correct and I confirmed against live production that the
`marquee-media` bucket now allows a real cross-origin `PUT` from
`https://marquee.stage11.dev` and rejects a wrong origin — the ship-blocker is
genuinely fixed on the deployed site, with the currently-deployed Worker.

The key finding is that `code/` is not in `PUBLIC_ROOT_DIRECTORIES`
(`scripts/checks/assemble-public.mjs:19`). `code/platform/r2-cors.json` therefore
never reaches the public tree, while the two files that read it — a test and the
apply script — do. I assembled the public tree and reproduced both failures.

## 3. Issues

**[CRITICAL] tests/node/r2-cors.MRQ-92.test.mjs:7 and scripts/platform/apply-r2-cors.mjs:9 — the policy file is dropped from the public tree, but its two readers are not**

`scripts/checks/assemble-public.mjs:19` defines `PUBLIC_ROOT_DIRECTORIES` as an
explicit allowlist — `.github, cli, fixtures, migrations, scripts, src, tests` —
with the comment "New private top-level material does not become publishable
merely because it lives beside the application." `code/` is a new top-level
directory and is not on that list. `scripts/` and `tests/` are.

Reproduced by assembling the tree from this HEAD:

```
$ npm run assemble:public -- --repo "$PWD" --ref HEAD --output /tmp/pubstage
$ ls /tmp/pubstage/code
ls: /tmp/pubstage/code: No such file or directory

$ cd /tmp/pubstage && node --test tests/node/r2-cors.MRQ-92.test.mjs
Error: ENOENT: no such file or directory, open '/tmp/pubstage/code/platform/r2-cors.json'

$ CLOUDFLARE_API_TOKEN=x CLOUDFLARE_ACCOUNT_ID=y node scripts/platform/apply-r2-cors.mjs
Error: ENOENT: no such file or directory, access '/tmp/pubstage/code/platform/r2-cors.json'
```

So the public repo — the competition deliverable, due tonight — ships a red
`npm test` and an apply command that cannot run. `code/platform/cloudflare.md` is
dropped too, so the public repo also loses the only documentation of the policy.
The acceptance criterion "re-appliable from a clean checkout by one command" holds
in the private repo and fails in the public one.

Separately, `code/platform/` is Stage 11's *internal* knowledge-base path
(`~/Projects/Stage11/code/platform/`). The ticket's "document it in
`code/platform/cloudflare.md`" was pointing at that KB, not asking for a new
top-level `code/` inside a repo that is about to go public.

**Fix:** Move the policy into an allowlisted root — `scripts/platform/r2-cors.json`
alongside its apply script is the natural home — and update the three references
(`apply-r2-cors.mjs:9`, the test's `policyPath`, and the doc). Put the prose in
`docs/` or `DEPLOY.md`, which the repo already uses for deploy knowledge. Then
file the R2-browser-upload-CORS lesson into the real Stage 11
`code/platform/cloudflare.md`, which today has a long R2 section
(lines 218–273) and says nothing about bucket CORS — the exact gap this ticket
discovered. If a new public root really is wanted, it has to be added to
`PUBLIC_ROOT_DIRECTORIES` deliberately, and `assemble-public.test.mjs` updated.

---

**[MAJOR] scripts/checks/run-e2e.mjs:9-11 — the CORS import runs before the stub branch and breaks `npm run e2e`**

The new block sits above the "are there any specs?" check, so it fires
unconditionally whenever `MARQUEE_E2E_URL` is set. `tests/e2e/` does not exist
yet, so the documented contract (README: "this runner will then require
`MARQUEE_E2E_URL`") previously produced a stub report and exit 0. Now:

```
$ MARQUEE_E2E_URL=https://marquee.stage11.dev npm run e2e
Error: MARQUEE_R2_CORS_URL is required; point it at an object path in the deployed R2 bucket.
    at .../scripts/checks/check-r2-cors.mjs:8:9
    at .../scripts/checks/run-e2e.mjs:10:3
```

`e2e` now crashes on a second, undocumented environment variable — and it crashes
in the stub case, where there is nothing to guard. Anyone running the deploy check
per `DEPLOY.md` hits an unrelated failure.

**Fix:** Move the import into the real-run branch (beside
`await import("@playwright/test/cli")`), and either derive `MARQUEE_R2_CORS_URL`
from the environment the deploy shell already has or skip the probe with a printed
notice when it is unset — the same pattern `check-api.mjs` uses for its
not-yet-built half.

---

**[MAJOR] scripts/checks/check-r2-cors.mjs:48-50 — the wrong-origin assertion does not actually prove the policy is scoped**

The check tests `rejected.headers.get("access-control-allow-origin") === wrongOrigin`.
If someone widened the policy to `AllowedOrigins: ["*"]`, R2 would answer the
wrong-origin preflight with `access-control-allow-origin: *`, which is not equal
to `wrongOrigin` — so the check passes and reports `status: "pass"`. The
acceptance criterion this check exists to enforce is "a deliberately wrong origin
is still rejected (verify the policy is scoped, not open)," and a wildcard policy
slips straight through it.

For reference, the live bucket today answers a disallowed origin with
`HTTP 403 · CORS not configured for this bucket` and no ACAO header at all.

**Fix:** Assert the absence and the wildcard explicitly:

```js
const allowOrigin = rejected.headers.get("access-control-allow-origin");
if (allowOrigin !== null) {
  throw new Error(`R2 preflight returned an allow-origin (${allowOrigin}) for ${wrongOrigin}; the policy is not scoped.`);
}
```

---

**[MINOR] src/ui/upload/upload-client.ts:16 — a user-initiated cancel is reported as a failure and blamed on their connection**

`"upload PUT aborted"` is what `xhr.onabort` produces when the speaker clicks the
portal's own **Cancel upload** button (`PortalPage.tsx:296`). Mapping it to
"We couldn't upload that file. Check your connection and try again." tells someone
who deliberately cancelled that something broke and that their network is suspect.
Per `PHILOSOPHY.md`'s respect-the-operator rule and the portal's stated error
philosophy, a cancel is not an error.

The same collapse also flattens every status code into a connection message —
a 400 or a 500 from R2 has nothing to do with the speaker's connection. (403/412
are fine: `onExpiredOrForbidden` sets `uploadLinkExpired` and that branch wins at
`PortalPage.tsx:266`.)

**Fix:** Drop `"upload PUT aborted"` from the mapping and let the cancel path clear
the error instead of setting one. Give the status-code branch its own sentence —
something like "That upload didn't go through. Retry when you're ready." — and
keep "Check your connection" for the genuine `onerror` transport case.

---

**[MINOR] src/ui/portal/PortalPage.tsx:265 — `console.error("Speaker upload failed", …)` fires for non-upload failures**

The guard is `task.kind === "file"`, not "the upload leg failed." It logs
"Speaker upload failed" when the speaker simply forgot to pick a file
("Choose a file before completing this task."), when `validateClientUpload`
rejects a type or size, and when the subsequent `/complete` call fails — none of
which are upload transport failures. That makes the console diagnostic the ticket
asked to preserve harder to trust.

**Fix:** Log from the `catch` only when `speakerUploadFailureMessage(caught)` is
non-null, i.e. log exactly the transport failures whose text is being replaced.

---

**[MINOR] scripts/checks/check-r2-cors.mjs:1-69 — the new check does not follow the check-harness conventions**

Every other command in `scripts/checks/` imports from `./lib/command.mjs` and uses
`emit()` plus `writeReport("artifacts/checks/<name>.json", …)`, and honours
`MARQUEE_GATE` via `isGateRun()`. This one hand-rolls `console.log(JSON.stringify(…))`
and writes no report artifact. Now that `check:r2-cors` has been added to the
README's "immutable command surface" list, it should look like its siblings — a
deploy check that leaves no artifact cannot be inspected after the fact.

**Fix:** Use `emit` and `writeReport` from `./lib/command.mjs`, matching
`check-api.mjs`.

---

**[MINOR] code/platform/r2-cors.json:5-8 — the localhost origins are dead entries on the production bucket**

`http://127.0.0.1:8787` and `http://localhost:8787` are granted access to the
production `marquee-media` bucket, but no local path ever makes a cross-origin PUT:
the README recipe runs with `--var LOCAL_UPLOAD_SHIM:1`, and
`uploads.routes.ts:137-142` then returns a same-origin
`/api/v1/uploads/local/{id}` URL instead of a presigned R2 URL.
`code/platform/cloudflare.md` says as much itself. The ticket asked to "scope
`AllowedOrigins` to the real origins" — these are plaintext-HTTP origins that no
real client uses.

**Fix:** Drop them, and note in the doc that local development uses the shim so a
future reader does not re-add them speculatively. If a no-shim local path is ever
wanted, add the origin then, with the reason.

---

**[MINOR] scripts/platform/apply-r2-cors.mjs:31-33 — throwing inside the `error` listener leaves the awaited promise unsettled**

`child.once("error", (error) => { throw error; })` throws from an EventEmitter
callback, so it surfaces as an `uncaughtException` while the `await new Promise(…)`
below never settles. It does fail loudly and non-zero, so it is not silent — but
it produces a confusing trace for the one case it exists to handle (wrangler
missing or not executable).

Also, `code/platform/cloudflare.md:27` says the wrapper "passes them only to
Wrangler," while line 27 of the script passes `env: process.env` — the whole
environment. Small, but it is a claim about credential handling in a repo going
public.

**Fix:** `reject` the promise from the listener rather than throwing, and reword
the doc to "requires both environment variables and invokes Wrangler with them"
(or actually pass a narrowed env).

---

**[MINOR] tests/ac-claims/MRQ-92.json:4 — claims `exercises` for ACs no test in this ticket names**

The manifest declares `exercises: ["AC-146", "AC-147"]`, but all four new tests use
the `CONTRACT · ` prefix, which per `scripts/checks/README.md` means "no product
AC." `trace:ac` passes (I ran it — 0 uncovered, 0 errors), so nothing breaks; the
manifest just asserts cross-coverage the ticket does not provide.

**Fix:** Either title the retry test `AC-147 · …` — it genuinely exercises "an
aborted PUT is recoverable by retry without re-entering the form" — or set
`"exercises": []`.

---

**[NIT] tests/node/r2-cors.MRQ-92.test.mjs:57 — an assertion that was never at risk**

`assert.doesNotMatch(portal, /upload PUT network error/)` guards against a string
that `PortalPage.tsx` never contained; the literal lives in `upload-client.ts`,
where it must remain. The assertion cannot fail for the reason it implies.
(Source-text assertions themselves are an established convention here — a dozen
other `tests/node/*.mjs` files do the same — so the style is fine; this particular
assertion is just inert.)

## 4. Independent verification of the production fix

I confirmed the central claim myself against live production, read-mostly, using a
demo speaker session:

```
POST /api/v1/me/uploads/sign  →  host 16483d…5.r2.cloudflarestorage.com
                                 requiredHeaders {content-type, if-none-match: *}

OPTIONS <signed url>  Origin: https://marquee.stage11.dev
  HTTP/1.1 204 No Content
  Access-Control-Allow-Origin: https://marquee.stage11.dev
  Access-Control-Allow-Headers: content-type, if-none-match
  Access-Control-Allow-Methods: PUT
  Access-Control-Max-Age: 3600
  Vary: Origin

OPTIONS <signed url>  Origin: https://not-allowed.example
  HTTP/1.1 403 Forbidden — "CORS not configured for this bucket"   (no ACAO)

PUT <signed url>  Origin: https://marquee.stage11.dev  (1 KB PDF)
  HTTP/1.1 200 OK
  Access-Control-Allow-Origin: https://marquee.stage11.dev
  Access-Control-Expose-Headers: etag
  ETag: "1bbc324fd49ac1b6e692f4520dcc42d7"
```

Three things follow. **The ship-blocker is fixed on the live site right now** — the
real cross-origin `PUT` succeeds against the currently-deployed Worker, because the
fix was a bucket configuration change, not a code change. **The policy is scoped,
not open** — the wrong origin is rejected at the edge. And **`etag` exposure is
confirmed**, which the automated check cannot see (expose-headers appears on the
actual response, not the preflight).

Two notes for the PR: this evidence belongs in it, since the acceptance criterion
asks for a live successful `OPTIONS` + `PUT` and the PR currently offers only local
browser validation plus the probe. And my probe left one pending attachment row
and one ~1 KB orphan object in `marquee-media` (I did not call `/complete`); the
nightly orphan sweep should clear it, but it is worth knowing it is mine.

I also ran `npm test` (95 node tests + the vitest suites, all pass — 89s wall clock,
over the 45s objective, but the machine is running several sibling delegators, so
per `CLAUDE.md` that is load, not a defect) and `npm run trace:ac` (pass, 0 uncovered).

## 5. Positive Observations

- **The diagnosis is exactly right and was reproduced before it was fixed.** The
  ticket's "rule out before fixing" order was followed: the PR reports the
  pre-apply `HTTP 403` from the production-origin preflight, which is what
  distinguishes a missing CORS policy from MRQ-89's credential. No guessing.
- **The policy is minimal and correct.** `PUT` only (R2 answers `OPTIONS` itself
  and does not accept it as an allowed method — a real footgun, and the doc
  explains it rather than leaving the next reader to rediscover it), exactly the
  two headers `presignPut` signs, `etag` exposed, no wildcard. The live preflight
  above matches the committed JSON field for field.
- **The apply wrapper fails closed.** Missing `CLOUDFLARE_API_TOKEN` /
  `CLOUDFLARE_ACCOUNT_ID` is a hard error, the bucket name is allowlisted against
  two known names rather than accepting arbitrary input, and `--force` makes it
  genuinely non-interactive and idempotent. I verified `wrangler r2 bucket cors set`
  accepts both `--file` and `-y, --force` on the pinned 4.120.1. No credential
  enters the repo.
- **The scoped credential question was answered, not sidestepped.** The PR states
  plainly that MRQ-89's bucket-scoped token was sufficient and that nothing was
  widened — which is exactly what the constraint asked for.
- **The PR is honest about its boundaries.** It says the local `LOCAL_UPLOAD_SHIM`
  path proves the error copy and not a real cross-origin PUT, and it does not claim
  the unmerged branch is live. That kind of precision about what evidence does and
  does not cover is what makes a review like this cheap.
- **`UPLOAD_PUT_NETWORK_ERROR` was extracted to a constant** rather than duplicated
  as a string literal across the client and its consumer — small, but it is why the
  mapping function cannot drift from the thrower.
