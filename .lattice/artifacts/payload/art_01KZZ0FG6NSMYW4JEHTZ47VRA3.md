# Code Review: MRQ-181 — preserve magic links across session conflicts

Reviewer: independent (Claude), cold context. Branch `mrq-mrq-181` (commits `48ec5c5a`, `54eef389`) against `github/main` (`5ff0b96c`).

## 1. Verdict

**PASS**

All three acceptance criteria are met and verified by execution, not just by reading. The issues below are minor; none blocks merge. Recommend the same-person and stale-banner nits as fast-follows (or a pre-merge polish commit if the implementer is still seated).

## 2. Summary

The diff splits magic-link handling into a non-consuming `readMagicLink` and a status-carrying consume, pre-checks for an existing session **before** spending the token in `/api/v1/auth/exchange`, adds truthful, distinct copy for `expired` / `used` / `already_signed_in`, and wires a "Sign out and use this sign-in link" recovery action on `/signin` that carries the preserved token. Quality is high: the layering is clean, the race path re-reads to report the truthful state, non-enumeration of unknown/wrong-purpose tokens is deliberately preserved, and the claim/invite consumers already follow the read-before-consume pattern (verified in `instance-claim.ts` / `claim.routes.ts`, satisfying ticket point 4). I independently verified: the new regression test **passes on the branch** and **fails on `github/main`**, the full `auth-demo` file (22 tests), both signin integration files (24 tests), the `auth-boundary` node inventory, and `tsc --noEmit` are all green in the implementation worktree (scoped runs, unlocked per the gate rule).

One finding worth the merge warden's attention, though it does not change the verdict: **the judged failure does not reproduce as described on current `github/main`.** Running the new test against main shows the blocked scenario *succeeding* — main consumes the link and silently seat-switches to the link's person (302 → `/portal`), rather than redirecting to `/signin?reason=expired`. The judge's exact trace (`reason=expired` on a fresh link) most likely came from an older deploy or a double-fetch that consumed the link first. Either way this change removes both hazards — the silent seat-switch *and* the burned-link misreport — and the test pins the new contract, so the fix is sound; the archaeology is worth a line in the PR/ticket comment so nobody expects main to reproduce the judge's redirect verbatim.

## 3. Issues

**[MINOR] src/routes/auth.routes.ts:307 — Same-person session is also refused**
When the existing session already belongs to the link's person (`state.link.person_id === auth.personId` — e.g., a speaker clicks their own emailed link while still signed in), the exchange now bounces to `/signin` with "This browser is already signed in," where main previously signed them straight in. The recovery page's "Continue" makes this one extra click, so it meets the AC, but the refusal copy ("continue as the person already signed in") reads oddly when both identities are the same person.
**Fix:** In the pre-check, when the live link's `person_id` matches the session's `personId`, complete the exchange (or redirect to `link.redirect_to` without consuming). One-line branch; add a test case.

**[MINOR] src/routes/signin.route.tsx:52 — Signed-out render of `already_signed_in` states a falsehood**
The signed-out `line` for `already_signed_in` reads "This browser is already signed in. Sign out before using that link." If the session dies between the redirect and the render (or the URL is revisited from history), the visitor is *not* signed in, and this is the same species of dishonesty the ticket exists to kill. The preserved `token` param is also unused in that state — `retryToken` only surfaces through `SignedInPanel`.
**Fix:** Rewrite the signed-out line in the past tense ("A sign-in link was blocked because this browser was signed in. You're signed out now — open the link from your email again."), and optionally render a "Use this sign-in link" action when `retryToken` is present while signed out.

**[MINOR] src/routes/auth.routes.ts:315 / src/routes/signin.route.tsx:469 — Live token echoed into a second URL**
`/signin?reason=already_signed_in&token=…` puts the raw single-use credential into the redirect Location, browser history, request logs for `/signin`, and the DOM. Mitigations are real — the token is already URL-borne by design (the emailed exchange link), 256-bit, single-use, 15-minute TTL, regex-validated on read, the page is `Cache-Control: no-store`, and JSX escapes the attribute — so this is an accepted tradeoff, not a defect. Note that `magic-links.ts`'s doc-comment claim that "the raw token never touches … the logs" is now only true of *application* logs.
**Fix:** Accept as-is; if it ever needs tightening, a server-side one-time handle (random key → token, no-store) would keep the credential out of the `/signin` URL. Consider trimming the stale doc-comment clause.

**[MINOR] src/lib/auth/magic-links.ts:176 — `consumeMagicLinkWithStatus` is a pure pass-through**
It forwards verbatim to the private `consumeMagicLinkState`. Exporting the inner function under the public name would drop eight lines; the split presumably exists to keep the boundary-inventory identifier distinct, but the wrapper adds nothing behaviorally.
**Fix:** Rename `consumeMagicLinkState` → `consumeMagicLinkWithStatus` and export it directly; keep the legacy `consumeMagicLink` shim as-is.

**[MINOR] src/routes/auth.routes.ts:294 — OpenAPI 401 description not updated**
The 401 response is still described as "The magic link is missing, expired, or already used," but the endpoint now also returns 401 `magic_link_session_conflict` for API callers holding a session. Agent-native surface (PHILOSOPHY.md) argues for documenting the new code.
**Fix:** Extend the description to mention the session-conflict rejection and its code.

Non-issues checked and cleared: `dropRejectedSessionCookie` only clears the cookie when the middleware flagged `credentialRejected`, so the live session survives the `already_signed_in` redirect (confirmed by the test's signed-in page render). The consume-race re-read can't return `live` (same `now` bounds both the UPDATE guard and the re-read), so the defensive `invalid` branch is safe. The non-consuming validity oracle a session holder gains is moot at 256 bits of token entropy under the `read` rate bucket. `readInstanceLink`'s refactor onto `readMagicLink` is behavior-preserving, including purpose-mismatch non-enumeration. The button swap on `/signin` occurs across distinct page loads, not within a page state, so the no-jump rule is respected.

## 4. Positive Observations

- **Read-before-spend as a stated invariant.** The `readMagicLink` doc-comment ("a refusal can burn the only usable link and leave the person with no way through the door") encodes the ticket's lesson where the next maintainer will actually see it, and the claim path already following the same pattern means the fix generalizes rather than patching one door.
- **The race loser now gets the truth.** Re-reading after a `changes = 0` UPDATE so a raced second exchange reports `used`/`expired` instead of a generic failure is exactly the honesty rule applied at the layer where it was cheapest.
- **Non-enumeration deliberately preserved.** Unknown and wrong-purpose tokens still collapse into one indistinct answer while the newly distinguishable states are all ones the legitimate holder already knows about — the copy got more honest without becoming an oracle.
- **The regression test is a genuine contract test.** It asserts the fresh-link-survives property at the database (`used_at` still null), the session count, the recovery affordance in the rendered page, the post-signout retry with the *same* token, and all three reason codes with their copy — and it fails on `github/main` for a real behavioral difference, verified in a clean baseline worktree.
- **The auth-boundary inventory was extended, not bypassed.** Adding `consumeMagicLinkWithStatus` to the counted call sites keeps the single-consumer-seam guarantee enforceable instead of quietly widening it.
