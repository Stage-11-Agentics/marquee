# MRQ-195: The magic-link retry path puts a raw exchangeable token in browser history and view-source

Filed from #217's reviewer as a **non-blocking** note during the MRQ-181 review, and correctly not
held for it. **A tightening, not a defect** — I verified both halves before writing this.

## What changed

MRQ-181's fix preserves an unspent magic link when a session conflict blocks the exchange. To offer
the retry, the fresh token now also rides in:

- the `/signin?…&token=` redirect URL, and
- a rendered `data-signin-token` HTML attribute (`src/routes/signin.route.tsx:220`, read back at
  `:400`).

That widens the token's exposure surface — **browser history and view-source** — beyond the single
email-link URL it previously occupied.

## Why it is not a defect

- **It does not enable replay or bypass.** Single-use is still atomically enforced server-side,
  which #217's reviewer confirmed by live fire rather than by reading: replay from a fresh browser
  consumes the link correctly and binds to the right person, and A's retry after sign-out returns
  `used` with **no** `Set-Cookie`.
- **It is not a new pattern here.** Raw tokens already travel in URLs across the codebase —
  `auth.routes.ts:248`, `evaluation.routes.ts:958`, `public-form.routes.ts:322` all build
  `…/api/v1/auth/exchange?token=<raw>`. Confirmed; the invite-link path does the same.

So this ticket is not "MRQ-181 introduced a vulnerability." It is: **the retry path made an existing
exposure slightly wider, and the existing exposure is worth revisiting on its own terms.**

## What to consider

1. **A short-lived server-side handle instead of the raw token** on the retry path — the browser
   carries an opaque reference, the server holds the token. That fixes the new surface without
   touching the email-link contract.
2. **Decide whether the wider pattern is intended.** Raw tokens in URLs is a deliberate-looking
   choice across at least four call sites; if it is deliberate, say so in one place so the next
   reviewer meets a decision rather than an accident. If it is not, this is a larger piece of work
   than the retry path and should be scoped separately rather than folded in here.
3. Whatever you choose, **do not regress what #217 proved**: session-conflict preserves the unspent
   link; replay from a fresh browser consumes it and binds correctly; a retry after sign-out returns
   `used` with no `Set-Cookie`; expiry is enforced against the server clock. Those four are the
   acceptance of the change this sits on top of, and they were verified against a real Worker and
   D1.

## Acceptance

- The retry path no longer places a raw, exchangeable token in browser history or view-source, **or**
  the decision to keep doing so is recorded in the code with its reasoning.
- The four MRQ-181 properties above still hold, proven the same way — against a running Worker, not
  by inspection.
- **Pair the test:** assert the retry still works end to end, not only that the token is absent from
  the URL. "No token in the URL" is trivially satisfied by breaking the retry.

## Constraints

- Cut your worktree from `github/main`. Verify:
  `if git fetch github; then if git merge-base --is-ancestor github/main HEAD; then echo current; else echo 'behind -- rebase'; fi; else echo 'FETCH FAILED -- not attempted'; fi`
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree.
- **Push when the work is written, before the verification run.**
- **A red gate is real.** `fail` from a findings-derived check is load-invariant; `pass-over-budget`
  is a warn; `timeout` is the only status contention can manufacture.
- Gate through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`.
- Test titles start with `CONTRACT` or `AC-<n>`, then a middle dot.
- No migration without the operator. Do not deploy.
