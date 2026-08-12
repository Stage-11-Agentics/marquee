# MRQ-90: Public-form rate-limit test is flaky by construction — a fixed window keyed to the wall-clock minute

FOURTH timing-dependent test defect found on 2026-08-11 night. Reddened main once already, cost a diagnosis cycle, and will keep doing it at random during the endgame.

## Symptom

tests/integration/api/public-form.AC-25-42-155-157-231-234.test.ts:273
  AssertionError: expected false to be true

The test fires 35 PATCHes at /api/v1/public/forms/public-cfp/drafts/{token} and asserts one of them returns 429. Sometimes none does.

## Mechanism — CONFIRMED, not suspected

src/routes/public-form.routes.ts:143, draftTokenAllowed():

  const limit = 30;
  const windowSeconds = 60;
  const window = Math.floor(now / 1000 / windowSeconds);
  const key = `public-form:autosave:${await sha256Hex(token)}:${window}`;

That is a FIXED window keyed to the wall-clock minute, not a sliding window and not a counter the test controls. The bucket resets when the real minute rolls over, mid-loop. If the 35 requests straddle a minute boundary the count splits across two keys and neither reaches 30, so no 429 ever fires. On an idle machine all 35 land inside one window and it trips at request 31 — which is why it passes locally and on a fast runner, and fails on a slow or unlucky one.

Proven: main at 7baf74f failed, then passed on a re-run with ZERO code changes.

## Why it is worth fixing rather than re-running

A test that fails on a clock boundary fails looking exactly like whatever change is in flight. It cost a full diagnosis tonight — the natural first suspicion was the three PRs that had just merged. It also trains the habit of re-running instead of reading, which is the same habit that makes a real failure invisible (see PR #34's hang-detector reasoning, and PR #14's AC-62 wall-clock assertion).

## The family this belongs to

Fourth of a kind on one night:
1. AC-62 asserted a 300ms median inside the hermetic parallel suite (fixed, PR #14)
2. delivery-health froze its fixture clock while the route read the real one — detonated at UTC midnight and blocked EVERY PR (fixed, PR #34)
3. MRQ-81's presign tests depended on ambient .dev.vars secrets that CI does not have (fixed in PR #30)
4. this one

The shared lesson: any assertion whose truth depends on wall-clock time, sample size, or ambient environment is a landmine with a random fuse. Worth a standing rule in the test conventions.

## Scope

Make the assertion deterministic. Options, in preference order:
- Let the limiter take an injectable clock so the test pins now and never crosses a boundary. Cleanest; the route already threads context.
- Have the test wait until just past a window boundary before starting the loop, so all 35 land in one fresh bucket. Test-only, no production change, deterministic.
- Assert draftTokenAllowed() directly as a unit with a controlled now, and keep one integration request for wiring.

Do NOT simply raise the request count or add retries — that makes the flake rarer, not absent, which is worse because it fails only when someone is depending on it.

Also worth checking while in there: the same fixed-window shape is used for the turnstile-token replay key and any other CACHE-backed limiter, and whether any of them are asserted the same way.

## Constraints

- Do not weaken the limiter itself. It is a real guard on an anonymous public write path; the defect is in how it is TESTED, not in that it exists.
- Corrected fleet gate: 3x tsc --noEmit, npx vite build, check:design, check:api, trace:ac, plus the diff's own test files.
- Test titles must begin 'AC-<n> · ' or 'CONTRACT · '. test.each() fails trace:ac.
- main is behind a manual merge gate; open a PR, a human merges.
