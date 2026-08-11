FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-30-api" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-30** (BUILDPLAN **M-29 + M-54** — API surface completion and signed outbound webhooks; ~9h). Actor: `agent:delegator-mrq-30`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-30-api`, branch `mrq-30-api`, cut clean off `forgejo/master` (`e521f50`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMA68VG0MQV5469WSS0HJ.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Read the full scope with `lattice show MRQ-30 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any code.**

## You back the competition's API bonus — and the README now leads with it

R53's explicit API bonus is the strongest true claim this project makes, and **MRQ-40 is writing the README right now with Cloudflare and that API bonus as its lead**. If the API surface is incomplete or the token model is hand-wavy, that lead becomes an overclaim. Build the thing the README is about to promise.

## AC-242 is a credential system — I hand-review every line of it

Tokens issue with named scopes (`program:read/write`, `review:write`, `speaker:write`, `agenda:write`, `comms:send`, `mirror:write`) and an optional event restriction. Four properties, each of which needs a test that asserts the **absence** of the thing, not just a status code:

1. **Effective authority is grant ∩ membership** — never the grant alone. A token carrying `program:write` held by someone whose membership does not grant it must be refused, and **no row written**. This is the property most likely to be implemented as "check the token" and quietly skip the membership half.
2. **The secret is shown once and stored only as a hash.** Assert the plaintext secret appears in the creation response and **nowhere in the database** — query the table and assert the literal secret string is absent.
3. **Revocation is immediate** — a revoked token's next request fails, with no caching or grace window. Assert the rejection *and* that the request had no side effect.
4. **Event restriction holds**: a token scoped to one conference cannot reach another. Assert 403 and that the other conference's data does not appear in the body.

Include a positive control in each — a correctly-scoped token must succeed — so the tests cannot pass vacuously against a surface that rejects everything.

**Do not weaken what is already merged to make tokens fit.** MRQ-3's per-event reviewer scoping reaches down to a database CHECK; MRQ-18 tightened `reviewer-scope.ts` so a committee member cannot cross conferences; MRQ-33 added the pre-write guard `reviewerCanBeAssignedToSubmission`; MRQ-60/61 wired the credential resolver. Your token path **extends** that resolver — it does not become a second way in. A second authentication path is the defect this ticket is most likely to introduce.

## The rest

- Docs route linked from the sidebar, and **`check:api` route-manifest parity** — you own that check's health. JSON route modules are named `*.routes.ts`; verify your paths reach the generated manifest and the OpenAPI document.
- **Signed outbound webhooks (M-54)**: sign them, and make the signature verifiable by a receiver without our source. State the algorithm and the signed payload shape in your PR body.
- `outbox.send_policy` has **exactly two `always_live` sites** and you are not a third — `tests/node/comms.AC-250.test.mjs` machine-enforces that count and also forbids a direct `api.resend.com` fetch.

## Standing rules

The suite is the fleet's inner-loop clock (~10–18s quiet against 30s); prefer `tests/node` for anything not needing a Worker runtime. `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9**; elements never jump; the organizer's noun in UI copy is **"conference"** while the wire API keeps `/api/v1/events/...` (SPEC Amendment 13). **This repo ships public** — no tokens, secrets, internal hostnames, or Stage 11 internals in anything you write.

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-30.json`**. `trace:ac` blocks merge on uncovered `auto` ACs.

Before the PR: `npm run pr-gate -- --ticket MRQ-30`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
