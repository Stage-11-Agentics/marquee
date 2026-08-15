# Gate hygiene

Date: 2026-08-15

## Landed

- Added `npm run check:locks`, which resolves Git's shared common directory,
  reports stale `index.lock`, `HEAD.lock`, `config.lock`, and
  `refs/remotes/github/main.lock` files, and always exits zero. It never removes
  a lock; stale warnings name the age, size, live `git` process state, and the
  operator recovery action.
- Added the lock check as the first `pr-gate` pre-flight step.
- Added node-level coverage for fresh and stale locks, warning exit behavior,
  and linked-worktree common-directory resolution using only temporary fixtures.
- Added route-check coverage for the real command and `--write` freshness, plus
  an isolated broken-import fixture proving the resolver still fails loudly.
- Documented build-time route-table emission as the durable fix while keeping
  that Vite/build seam deferred from this narrow tooling change.

## Verification

- `node --test tests/node/check-locks.test.mjs tests/node/check-routes.test.mjs` — 6 passed.
- `node --test tests/node/*.mjs` — 257 passed.
- `npm run check:routes` — pass; 50 SPA routes and 16 server pages.
- `npm run check:locks` — pass; no stale locks in the checkout.
- `npm run check:clocks && npm run check:design` — both pass.
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json` — pass.
- `npm run trace:ac` — pass; 249 live criteria, 0 uncovered, 0 errors.
- The literal `node --test tests/node` form is unsupported by the installed Node
  runtime and treated the directory as a module; the `.mjs` expansion above is
  the equivalent whole-directory run and passed.

## Deliberately not done

- No lock was removed, and no fixture lock touched the repository's real `.git`.
- No build-artifact/Vite route-table emission was attempted; it is outside this
  lightweight tooling change.
- `npm test` and `pr-gate` were not run, as requested; the targeted checks above
  cover the changed tooling seams.
- No PR or Lattice ticket was created; this is authorized for direct `main`
  landing.
