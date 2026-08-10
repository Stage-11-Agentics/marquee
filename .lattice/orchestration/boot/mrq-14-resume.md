FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-14-uploads" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-14** (BUILDPLAN **M-13** — uploads: presign, verify, serve). Actor: `agent:delegator-mrq-14`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-14-uploads`, branch `mrq-14-uploads`, cut clean off `forgejo/master`.

## You are RESUMING. Do not re-plan.

Your plan already exists, was plan-reviewed, and is committed at:
`/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/plans/task_01KZJHM8NGV7SK9EVZTXVQWA5A.md` (118 lines)

Its `## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)` block records that the review FAILED at review time and triages every finding — **that block overrides any conflicting wording above it in the file.**

1. Claim MRQ-14. **Revalidate** the plan against current `forgejo/master`, which now contains MRQ-1's skeleton, MRQ-2's schema, and MRQ-6's design system + harness. Post one short comment ("plan revalidated; no amendments" or an amendment block for genuine drift), bump `in_progress`, and implement. **Do not run a fresh plan-review.**

## Already resolved for you

Your plan review raised schema requirements — they are **done**. MRQ-2 folded them into the single init migration and they are ratified as **SPEC Amendment 12**: `attachments.sha256` is NULLABLE, `r2_etag` exists, and indexed `draft_file` / `submission_file` relations exist. Build against the merged schema; do not add a second migration.

The M-01 seams your review identified are **yours to add in this PR**: exact S3 env/secret declarations in `wrangler.jsonc`, the scheduled/cron dispatch handler, the media host binding, and Worker-first media routing.

## Binding traps (from the ticket text)

- Presigned PUT targets `{account}.r2.cloudflarestorage.com` — **never** a custom domain (trap 9).
- R2 is canonical for media; Airtable only ever receives a public R2 URL (trap 10).
- `/complete` does a HEAD verify **and** a magic-byte sniff — never trust client content-type.
- Per-IP and per-submission caps in KV; nightly orphan sweep.
- Serving on a separate origin with `Content-Disposition: attachment` + `nosniff`.
- **AC-231 is a security guardrail:** an unauthenticated or out-of-scope presign must fail closed, and you name the test that proves it.

## Credential reality

There is still no real Cloudflare account wired up — that work is **MRQ-57**. Verify locally against miniflare's R2 binding. The six real-bucket-only assertions are already recorded on MRQ-57's description; if you find more, report them rather than faking a local proof.

## Before your PR

Run `npm run pr-gate -- --ticket MRQ-14` and paste the result into your completion comment — private Forgejo has no CI runner.

**Headless `lattice code-review` remains SUSPENDED.** Self-review: compute your diff, write the standard-shape review (Verdict, findings with file:line), attach `--role review` naming your exact HEAD, note "own-reviewer, quota directive".

Push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at workspace:9 surface:60. **Note for your PR body:** this ticket is guardrail-adjacent, so the Orchestrator reviews it by hand before merging — expect that gate, and make AC-231's proof easy to find.
