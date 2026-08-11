FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-60-credresolver" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-60** (API credential resolver; inline-full, ~3h). Actor: `agent:delegator-mrq-60`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-60-credresolver`, branch `mrq-60-credresolver`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-60 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless reviews are suspended** — self-review inline, attach a standard-shape review naming your exact HEAD.

## This ticket closes a live data leak. Read its full description first: `lattice show MRQ-60 --json`.

MRQ-3 merged real auth (magic links, sessions, bearer middleware, scope resolution, per-event reviewer scoping enforced down to a schema CHECK). MRQ-8 merged the API runtime. **They were never wired together** — `src/api/runtime.ts` expects a `CredentialResolver` that does not exist.

The consequence is live on master: MRQ-9's **`GET /events/:id/submissions` is currently unauthenticated**, marked `TODO(MRQ-60)`. SPEC scopes it to authenticated admins. On the private deploy that is survivable; on the public site it serves **every submission in the conference, including unpublished and rejected ones**, to anyone. **MRQ-57 (the real Cloudflare deploy) depends on this ticket precisely so that cannot ship.**

## Scope

- Implement the `CredentialResolver` adapter so the API runtime resolves a principal from MRQ-3's session-cookie and bearer paths.
- **Reconcile `Principal` and `AuthContext`** — they were designed in separate tickets and do not agree. Pick one shape, state why in your PR body, and migrate the other.
- Extend `ApiBindings`; update the ~7 handler schemas that assume an unauthenticated context.
- **Close MRQ-9's hole:** re-gate `GET /events/:id/submissions` to authenticated admin scope, and convert MRQ-9's "currently public" test into one asserting **401/403 for an unauthenticated caller**. That test failing when you arrive is the intended signal — flip it, don't delete it.

## Guardrail expectations (orchestrator hand-reviews this at merge)

Fail closed, and prove it the way MRQ-14 and MRQ-3 did — assert **both** the status code **and** the absence of side effects or leaked data. Specifically: an unauthenticated caller gets 401/403 and **no submission data in the body**; a caller authenticated for a *different* event gets 403 (this is AC-214's cross-event rule reaching the API surface); an expired or tampered session is rejected. Do not weaken MRQ-3's schema-level guarantees to make the API easier — the database CHECK that rejects org-wide reviewer memberships stays.

## Evidence required

An **AC-tagged test** under `tests/` plus **`tests/ac-claims/MRQ-60.json`** if you claim any AC (if this ticket owns none directly, say so explicitly in the PR body rather than shipping an empty claims file). After any rebase run `npm ci` before trusting a red test. Route modules are named `*.routes.ts`.

Before the PR: `npm run pr-gate -- --ticket MRQ-60`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
