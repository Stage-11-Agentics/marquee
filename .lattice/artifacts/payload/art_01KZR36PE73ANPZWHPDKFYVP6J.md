# Code Review: MRQ-49 — Audit: public write surface and upload safety

Reviewer: independent (did not write this code). Branch `mrq-49-audit-write`, HEAD `54f5ea3`.

## 1. Verdict

**PASS** — Implementation is correct, matches the plan and the operator ruling amendment, and meets AC-231/AC-232 obligations for this ticket. Findings below are all minor and none block merge.

## 2. Summary

Reviewed the two authorized changes from this audit ticket: (1) the contained single-use Turnstile token fix in the public presign handler (`src/routes/uploads.routes.ts`) with its replay regression test, and (2) the AST inventory guard for conditional-answer writers (`tests/node/public-write-inventory.test.mjs`). Both were verified by execution, not just reading: the new node test passes, the R2 unit suite passes (8/8), and the full default suite passes (51 tests, 13.4s, within the 30s hermetic budget). The replay fix sits exactly where the operator ruling requires — the second attempt is refused before any attachment row insert or signer call — and it touches only the public presign handler, not shared upload/auth seams. Quality is high; issues found are minor coverage and brittleness notes.

## 3. Issues

**[MINOR] src/routes/uploads.routes.ts:66-71 — KV get-then-put consumption marker is not atomic**
`consumePublicTurnstileToken` checks `cache.get` then `cache.put`. Workers KV has no compare-and-set and is eventually consistent cross-colo (~60s propagation), so two near-simultaneous replays of the same token — especially at different edge locations — could both pass the marker check. In production this is mitigated upstream because Cloudflare siteverify itself consumes tokens (single-use), and the doc comment honestly frames the KV marker as defense in depth for stubbed/retried verification. The sequential replay case the operator ruled on is correctly closed and test-proven. This is an accepted-limitation note, not a defect.
**Fix:** No change required for this ticket (the operator authorized only a contained handler fix). If a hard atomic guarantee is ever wanted, replace the KV marker with a D1 insert into a table with a unique token-hash key and treat a constraint violation as "already used" — atomic in both the test environment and production.

**[MINOR] tests/unit/r2/uploads-routes.test.ts:166 — deleted test's siteverify-rejection case is no longer exercised in this file**
The replaced "invalid/replayed Turnstile token" test was the only one in this file that hit the presign path with a *non-empty* token and `stubTurnstile(false)` (i.e., siteverify actually returning `success: false`). The remaining missing-token test uses `""`, which short-circuits inside `verifyTurnstile` before the stub is reached. The handler's `!turnstile.ok` branch is still covered, and `turnstile.ts` was not modified, so the practical loss is small — but it is a slight coverage regression relative to the deleted test.
**Fix:** Add back a small case (or extend the replay test) sending a non-empty token with `stubTurnstile(false)` and asserting 403 + zero rows, so the siteverify-rejects path stays pinned on this route.

**[MINOR] tests/node/public-write-inventory.test.mjs:50-71 — exact line-number pinning is stricter (and more brittle) than the reference pattern**
`comms.AC-250.test.mjs` pins paths and counts; this test pins `{file, line}` for ten call sites across five files. Any edit above those lines — a comment, an import — fails the default suite with a "re-audit every consumer" message. As a deliberate trip-wire for a security-sensitive inventory this is defensible, and the assertion messages tell the maintainer exactly what to do, but the churn cost during active pre-deadline development is real, and repeated mechanical re-pinning trains people to update the numbers without re-auditing — eroding the guard's purpose.
**Fix:** Consider pinning `{file, count}` (matching the comms pattern) with the ordered file list, or file + ordinal occurrence, keeping the same failure messages. Acceptable to keep as-is if the trip-wire strictness is intended.

**Handoff reminder (not a code issue):** the operator ruling requires the PR body to state explicitly that MRQ-57's real Cloudflare deployment is gated on this fix. The PR does not exist yet at review time — carry this into the PR creation step.

## 4. Positive Observations

- **The fix lands exactly where the operator ruling demands.** Consumption (`uploads.routes.ts:154-156`) sits after Turnstile verification but before the draft lookup, rate-limit checks, and `insertPendingAttachment` (line 203) — so a replayed token is refused before any row or signer side effect, and the test proves it with both a row-count and an R2 `list` absence assertion plus a positive control (first presign succeeds and its key is usable). This is precisely the "one token, one presign" contract.
- **Containment discipline.** The change touches only the public presign handler; the authenticated presign, complete, and serve paths, and the shared `turnstile.ts`/`rate-limit.ts` seams are untouched — matching the "do not change shared upload/auth seams" boundary.
- **Consumption semantics mirror production.** Burning the token on any verified attempt (even ones that later fail scope or policy checks) matches real siteverify behavior, so test-stubbed and production behavior stay aligned rather than diverging.
- **Honest, load-bearing comment.** The doc comment on `consumePublicTurnstileToken` states what the marker is (defense in depth), when it matters (stubbed/retried verification), and its TTL rationale (300s matches Turnstile token validity) — a constraint the code alone can't show.
- **Test hygiene ripple handled correctly.** Every other test in the file was updated to mint a unique token (`valid-ext`, `valid-cap-${attempt}`, …) so single-use consumption can't cause cross-test interference, and the integration suite already used `nextTurnstileToken()` — verified compatible.
- **The AST inventory reuses the established alias and pattern.** `typescript-ast` (`npm:typescript@^5.9.3`) is the same aliased dependency `comms.AC-250.test.mjs` uses, the walker is idiomatic to that file, and the positive controls (shared projected writer present; exactly two `submission-record.routes.ts` writers — the known admin exception under audit) keep the guard from passing vacuously.
- **Verified end-to-end at review time:** `node --test tests/node/public-write-inventory.test.mjs` → 1/1 pass; `vitest run tests/unit/r2/uploads-routes.test.ts` → 8/8 pass; `npm test` → 51/51 pass, hermetic, 13.4s against a 30s budget.
