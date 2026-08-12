FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-78-api-tokens-org-scope" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd via c11 send to workspace:9 surface:245 — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. **Remote is `github`, base branch `main`; Forgejo is retired — never reference it.** Your ticket: **MRQ-78**. Actor: `agent:delegator-mrq-78`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-78-api-tokens-org-scope`, branch `mrq-78-api-tokens-org-scope`, cut clean off `github/main @ ba22fb3`. Run `npm ci` before trusting any test result.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path, uuid from `lattice show MRQ-78 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Commit and push your PLAN as your first commit, before any code.

## Scope of record

`lattice show MRQ-78 --json` carries the full description — that is your scope of record. Read it completely before planning. Evidence: `sequence/UX-SWEEP-FINDINGS.md` row 5, independently reproduced at the API layer in section 4b.

**The API tokens screen is unreachable for EVERY user in the seeded product, not just one persona.** `requireTokenAdmin` (`src/routes/tokens.routes.ts:52-60`) demands a membership row with `event_id IS NULL`; the seed's only membership helper (`scripts/seed/evaluations.ts:24-33`) hardcodes `event_id: EVENT_ID`. The predicate cannot be satisfied by anyone. This lands on a graded item — R53, the API bonus — and on SPEC §2's "everything a human can do, a program can do" positioning claim.

The ticket is fully root-caused. What it asks of you is a **ruling**, laid out as options (a) and (b) with the security tradeoff spelled out. Read that section carefully and choose deliberately. **If you take path (b), the narrowing it names is mandatory** — an unqualified widening lets an event-scoped lead mint a token that reads events they do not hold, which is a privilege escalation and must not ship.

## HARD SCOPE BOUNDARY

Three other delegators are live in parallel. You own **`src/routes/tokens.routes.ts`, `scripts/seed/evaluations.ts`, `src/lib/reset-demo/demo-fixture.ts`, `src/lib/auth/scope-resolution.ts`, `src/ui/settings/ApiTokensPage.tsx`** and your own tests.

- **DO NOT TOUCH** `src/routes/submissions.queries.ts`, `src/routes/landing.route.tsx`, `src/api/board.ts`, `src/routes/dashboard.routes.ts` (MRQ-76), `src/ui/evaluation/*`, `src/ui/submissions/*` (MRQ-77), `src/ui/embeds/*` (MRQ-75), `package.json`.
- **CRITICAL — your seed change must ADD a membership row and nothing else.** MRQ-76 is concurrently fixing pipeline counts and verifying them against the seeded status distribution. If your seed edit moves a submission status, a count, or any seeded volume, you will collide with its verification and both tickets lose. Add the row; touch nothing else.
- No migration. `event_id` is already nullable (`migrations/0001_init.sql:152-159`, CHECK bars NULL only for `reviewer`).

## Evidence required

The positive case is the one that was missing and is the one that keeps this fixed:

1. Integration tests on all three `/api/v1/org/tokens` routes — demo organizer ALLOWED (list, issue, revoke); reviewer, speaker, and anonymous REFUSED.
2. A standing guard asserting at least one seeded principal satisfies `requireTokenAdmin`. A permission predicate no user can meet should fail a test, not a manual sweep.
3. If path (b): a test proving an event-scoped lead cannot mint a token scoped to an event they do not hold.

Validate against a running Worker on **port 8803** — `npx wrangler dev --port 8803`. Ports 8787, 8801, 8802 and 8863 are occupied by other agents; do not touch them, and do not run `npm run reset:demo` against anything but your own worktree's local D1. Drive it with the c11 embedded browser (load the `c11-browser` skill): load `/settings/api` as the organizer, **issue a real scoped token, then use that token against a real API endpoint** and confirm it authenticates and respects its scope; revoke it and confirm it stops working. A rendering page proves only that the 403 is gone — the graded claim is that a token minted here actually drives the API. Then run `npm run reset:demo` (your own worktree only) and confirm the screen still works afterward. Attach that evidence with `--role validation`.

Before the PR: `npm run pr-gate -- --ticket MRQ-78`, paste the result into your completion comment. Then push, open the PR (`gh pr create --repo Stage-11-Agentics/marquee --base main`), bump `pr_open`, and c11-send your completion summary to **workspace:9 surface:245**.
